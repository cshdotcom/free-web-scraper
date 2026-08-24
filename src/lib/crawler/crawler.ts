import { type Browser, type BrowserContext, type Page, type Response } from 'playwright';
import { getBrowser, config, pickDeviceProfile, type DeviceType } from './config';
import { extractInPage, fallbackExtract, type ExtractResult, type PageMetadata } from './extractor';
import { htmlToMarkdown } from './markdown';
import { applyStealth, dismissCookieBanners, isRetryableStatus, sleep } from './stealth';

export interface ScrapeOptions {
  url: string;
  /** Output formats: 'markdown' | 'html' | 'rawHtml' | 'links' | 'screenshot' */
  formats?: string[];
  /** Only extract main content (default true) */
  onlyMainContent?: boolean;
  /** CSS selectors to include (comma-separated list) */
  includeTags?: string[];
  /** CSS selectors to exclude (comma-separated list) */
  excludeTags?: string[];
  /** Max navigation timeout in ms (default 45000) */
  timeout?: number;
  /** Extra ms to wait after load for JS rendering */
  waitFor?: number;
  /** Remove base64 inline images from markdown */
  removeBase64Images?: boolean;
  /** Custom user agent override (takes precedence over device) */
  userAgent?: string;
  /** Block specific Playwright resource types (e.g. ['image','font']) */
  blockResources?: string[] | null;
  /** Max retries on 403/429/network errors (default from config) */
  maxRetries?: number;
  /** Wait for a specific CSS selector to appear (useful for SPAs) */
  waitForSelector?: string;
  /** Device emulation: 'auto' (50/50 desktop/mobile), 'desktop', or 'mobile'.
   *  When set, picks a matching UA + viewport + touch from the device pool.
   *  Ignored if `userAgent` is explicitly provided. Default 'auto'. */
  device?: DeviceType;
  /** Cookies to inject before navigation. Each scrape gets a FRESH
   *  browser context — cookies are ONLY used for this request and
   *  discarded immediately after. Not persisted anywhere.
   *  Accepts: array of {name, value, domain?, path?, ...} OR
   *  a cookie string "name=value; name2=value2" (parsed automatically). */
  cookies?: CookieInput[] | string;
}

export interface CookieInput {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

/** Parse a cookie string ("name=value; name2=value2") into CookieInput[].
 * If already an array, returns it as-is (but auto-fills domain if missing).
 * Derives domain from the target URL. */
function parseCookies(cookies: CookieInput[] | string | undefined, targetUrl: string): CookieInput[] {
  if (!cookies) return [];
  let domain: string;
  try { domain = '.' + new URL(targetUrl).hostname; } catch { domain = ''; }
  if (Array.isArray(cookies)) {
    // Auto-fill domain if missing (Playwright requires it)
    return cookies.map(c => ({
      ...c,
      domain: c.domain || domain,
      path: c.path || '/',
    }));
  }
  // Parse cookie string: "name=value; name2=value2"
  return cookies.split(';').map(pair => {
    const idx = pair.indexOf('=');
    if (idx < 0) return null;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!name) return null;
    return { name, value, domain, path: '/' };
  }).filter(Boolean) as CookieInput[];
}

export interface ScrapeData {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: Array<{ url: string; text: string }>;
  screenshot?: string;
  metadata: PageMetadata;
  /** Which extraction strategy was used */
  strategy?: string;
  /** HTTP status code of the page response (200, 404, 403, etc.) */
  statusCode?: number;
}

export interface ScrapeResult {
  success: boolean;
  data?: ScrapeData;
  error?: string;
  /** Number of attempts made (1 = first try, 2+ = retried) */
  attempts?: number;
}

/**
 * Attempt a single scrape of one URL. Handles stealth injection,
 * cookie-banner dismissal, content extraction, and markdown conversion.
 *
 * If the request fails with a retryable status (403/429/503), retries
 * with a fresh user agent + exponential backoff up to `maxRetries` times.
 */
export async function scrapeUrl(opts: ScrapeOptions): Promise<ScrapeResult> {
  const url = opts.url;
  if (!url) {
    return { success: false, error: 'URL is required' };
  }

  // Validate URL early so we fail fast with a clear message.
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { success: false, error: `Unsupported protocol: ${parsed.protocol}` };
    }
  } catch {
    return { success: false, error: `Invalid URL: ${url}` };
  }

  const formats = opts.formats && opts.formats.length > 0 ? opts.formats : ['markdown'];
  const onlyMainContent = opts.onlyMainContent ?? true;
  const includeTags = opts.includeTags ?? [];
  const excludeTags = opts.excludeTags ?? [];
  const timeout = opts.timeout ?? config.defaultTimeout;
  const waitFor = opts.waitFor ?? 0;
  const removeBase64Images = opts.removeBase64Images ?? false;
  // Smart resource blocking: if the user requests 'screenshot' format OR
  // 'html'/'rawHtml' formats, we DON'T block images (they need to render
  // for a faithful screenshot and complete HTML). For markdown-only scrapes,
  // blocking images/fonts speeds things up without losing content.
  const wantsVisual = formats.includes('screenshot') || formats.includes('html') || formats.includes('rawHtml');
  const blockResources =
    opts.blockResources === null ? null
      : opts.blockResources
        ? opts.blockResources
        : wantsVisual
          ? (config.blockResourceTypes?.filter((t: string) => t !== 'image' && t !== 'media') ?? null)
          : config.blockResourceTypes;
  const maxRetries = opts.maxRetries ?? config.maxRetries;

  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (e) {
    return { success: false, error: `Failed to launch browser: ${(e as Error).message}` };
  }

  let lastError: string | null = null;
  let attempts = 0;

  // Retry loop: rotate device profiles (UA + viewport) + backoff on retryable failures.
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;
    // If user provided a custom UA, use it. Otherwise pick a device profile
    // (UA + viewport + touch) based on the `device` option.
    const device = opts.device ?? 'auto';
    const profile = opts.userAgent
      ? { userAgent: opts.userAgent, viewport: { width: config.viewportWidth, height: config.viewportHeight }, isMobile: false, hasTouch: false }
      : pickDeviceProfile(device);
    const result = await attemptScrape(browser, url, {
      formats, onlyMainContent, includeTags, excludeTags,
      timeout, waitFor, removeBase64Images,
      userAgent: profile.userAgent,
      viewport: profile.viewport,
      isMobile: profile.isMobile,
      hasTouch: profile.hasTouch,
      blockResources,
      waitForSelector: opts.waitForSelector,
      cookies: parseCookies(opts.cookies, opts.url),
    });

    if (result.success) {
      return { ...result, attempts };
    }

    lastError = result.error || 'Unknown error';

    // Decide whether to retry.
    const status = result.data?.metadata?.statusCode ?? 0;
    const retryable =
      isRetryableStatus(status) ||
      /timeout|net::ERR_|ECONNRESET|socket hang up/i.test(lastError);

    if (!retryable || attempt === maxRetries) {
      return { ...result, attempts };
    }

    // Exponential backoff: baseDelay * 2^attempt (+ small jitter).
    const delay = config.retryBaseDelayMs * Math.pow(2, attempt) + Math.random() * 300;
    console.log(`[crawler] retry ${attempts}/${maxRetries + 1} for ${url} (status ${status}, ${lastError.slice(0, 80)}) in ${Math.round(delay)}ms`);
    await sleep(delay);
  }

  return { success: false, error: lastError || 'Failed after retries', attempts };
}

interface AttemptParams {
  formats: string[];
  onlyMainContent: boolean;
  includeTags: string[];
  excludeTags: string[];
  timeout: number;
  waitFor: number;
  removeBase64Images: boolean;
  userAgent: string;
  viewport: { width: number; height: number };
  isMobile: boolean;
  hasTouch: boolean;
  blockResources: string[] | null;
  waitForSelector?: string;
  cookies: CookieInput[];
}

/**
 * A single scrape attempt (no retry logic).
 */
async function attemptScrape(
  browser: Browser,
  url: string,
  params: AttemptParams,
): Promise<ScrapeResult> {
  let page: Page | null = null;
  let context: BrowserContext | null = null;
  let statusCode = 0;
  let lastError: string | null = null;

  try {
    // Create a FRESH browser context for each request.
    // This ensures complete cookie isolation — cookies from one request
    // never leak to another. After context.close(), all cookies are gone.
    context = await browser.newContext({
      userAgent: params.userAgent,
      viewport: params.viewport,
      isMobile: params.isMobile,
      hasTouch: params.hasTouch,
      locale: 'en-US',
      timezoneId: 'UTC',
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
      },
    });

    page = await context.newPage();

    // Inject cookies BEFORE navigation (if provided).
    // Cookies are set on the isolated context — they only exist for
    // this single request and are discarded when context.close() runs.
    if (params.cookies && params.cookies.length > 0) {
      await context.addCookies(params.cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain || undefined,
        path: c.path || '/',
        httpOnly: c.httpOnly ?? false,
        secure: c.secure ?? false,
        sameSite: c.sameSite || 'Lax',
      })));
    }

    // Inject stealth patches BEFORE any page JS runs.
    await applyStealth(page);

    // Block resource types for speed if configured.
    if (params.blockResources && params.blockResources.length > 0) {
      await page.route('**/*', (route: import('playwright').Route) => {
        const type = route.request().resourceType();
        if (params.blockResources!.includes(type)) {
          route.abort();
        } else {
          route.continue();
        }
      });
    }

    // Capture the response status code so we can surface it in metadata.
    page.on('response', (resp: Response) => {
      try {
        const respUrl = resp.url();
        if (respUrl === url || respUrl === url.replace(/\/$/, '')) {
          statusCode = resp.status();
        }
      } catch {
        // ignore
      }
    });

    // Suppress console noise and uncaught errors from page JS.
    page.on('console', () => {});
    page.on('pageerror', () => {});
    page.on('requestfailed', () => {});

    // Navigate and wait for network to be mostly idle so JS-rendered
    // content has time to populate the DOM.
    // Note: Playwright throws ERR_HTTP_RESPONSE_CODE_FAILURE for 4xx/5xx
    // responses by default. We catch this and still proceed with extraction
    // so the user gets the status code + page content (error pages are
    // still useful for debugging).
    let navResp: Response | null = null;
    try {
      navResp = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: params.timeout,
      });
    } catch (navErr: any) {
      // If it's a non-2xx HTTP response error, the page still loaded —
      // extract the status code from the error and continue.
      const msg = navErr?.message || '';
      if (msg.includes('ERR_HTTP_RESPONSE_CODE_FAILURE') || msg.includes('net::ERR_ABORTED')) {
        // The response was received but had a non-2xx status. Try to get
        // the status from the response listener (set above) or default to 0.
        // The page content is still available for extraction.
        lastError = `Navigation returned non-2xx status (page may still have content)`;
      } else {
        // Genuine navigation failure (DNS, connection refused, etc.)
        throw navErr;
      }
    }

    if (navResp) {
      statusCode = statusCode || navResp.status();
    }

    // Give SPA / lazy content a moment to render. We wait for
    // 'networkidle' with a short budget, then any explicit waitFor.
    try {
      await page.waitForLoadState('networkidle', { timeout: Math.min(params.timeout, 8000) });
    } catch {
      // networkidle is best-effort; continue if it times out.
    }

    // Dismiss cookie consent banners BEFORE extraction so they don't
    // pollute the cleaned HTML or hide the real content.
    await dismissCookieBanners(page);

    // Optional: wait for a specific selector (SPA content readiness).
    if (params.waitForSelector) {
      try {
        await page.waitForSelector(params.waitForSelector, { timeout: Math.min(params.timeout, 15000) });
      } catch {
        // best-effort; continue
      }
    }

    if (params.waitFor > 0) {
      await page.waitForTimeout(Math.min(params.waitFor, 10000));
    }

    // ---- Trigger lazy-loaded images to load ----
    // Many modern pages use `loading="lazy"` or IntersectionObserver-based
    // lazy loading, which means images below the fold never load in a
    // headless browser (no scrolling = no load). We:
    //   1. Remove all `loading="lazy"` attributes (force eager loading)
    //   2. Set `data-src`/`data-original` → `src` (common lazy-load patterns)
    //   3. Scroll the page in increments to trigger IntersectionObserver
    //   4. Wait a bit for images to finish loading
    // Only do this when the user wants visual content (screenshot/html) or
    // when markdown is requested (images appear as ![](url) in markdown).
    try {
      await page.evaluate(`
        // Force all lazy images to load eagerly.
        document.querySelectorAll('img[loading="lazy"]').forEach(img => {
          img.loading = 'eager';
          img.removeAttribute('loading');
        });
        // Handle common data-src lazy-load patterns.
        document.querySelectorAll('img[data-src], img[data-original], img[data-lazy-src]').forEach(img => {
          const ds = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src');
          if (ds && !img.src) img.src = ds;
        });
        // Also handle srcset lazy patterns.
        document.querySelectorAll('img[data-srcset]').forEach(img => {
          const ds = img.getAttribute('data-srcset');
          if (ds) img.srcset = ds;
        });
      `);
      // Scroll in increments to trigger any IntersectionObserver-based lazy load.
      const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
      const viewportHeight = await page.evaluate(() => window.innerHeight);
      const step = Math.max(viewportHeight, 400);
      for (let y = 0; y < scrollHeight; y += step) {
        await page.evaluate((sy) => window.scrollTo(0, sy), y);
        await page.waitForTimeout(150);
      }
      // Scroll back to top for the screenshot.
      await page.evaluate(() => window.scrollTo(0, 0));
      // Wait for any newly-triggered image requests to finish.
      try {
        await page.waitForLoadState('networkidle', { timeout: Math.min(params.timeout, 5000) });
      } catch {
        // best-effort
      }
    } catch {
      // best-effort; if scrolling fails, continue with extraction
    }

    // Run the in-browser extraction function.
    let extracted: ExtractResult;
    try {
      extracted = await page.evaluate(extractInPage, {
        includeTags: params.onlyMainContent ? params.includeTags : [],
        excludeTags: params.onlyMainContent ? params.excludeTags : [],
        onlyMainContent: params.onlyMainContent,
      });
      extracted.metadata.statusCode = statusCode || extracted.metadata.statusCode;
    } catch (e) {
      // In-browser script failed; fall back to server-side regex extraction.
      lastError = `In-browser extraction failed: ${(e as Error).message}`;
      const rawHtml = await page.content();
      const fb = fallbackExtract(rawHtml, url);
      extracted = {
        contentHtml: fb.contentHtml,
        rawHtml,
        metadata: {
          ...fb.metadata,
          statusCode: statusCode || 200,
          error: lastError,
          sourceURL: url,
        } as PageMetadata,
        links: [],
        statusCode: statusCode || 200,
        error: lastError,
        strategy: 'fallback-regex',
      };
    }

    // ---- Post-extraction quality check ----
    // If we extracted very little content (likely a loading screen or
    // a cookie wall we couldn't dismiss), try a longer wait + re-extract.
    const extractedText = extracted.contentHtml.replace(/<[^>]+>/g, '').trim();
    if (extractedText.length < 200 && params.waitFor === 0) {
      try {
        await page.waitForTimeout(2500);
        const retry = await page.evaluate(extractInPage, {
          includeTags: params.onlyMainContent ? params.includeTags : [],
          excludeTags: params.onlyMainContent ? params.excludeTags : [],
          onlyMainContent: params.onlyMainContent,
        });
        const retryText = retry.contentHtml.replace(/<[^>]+>/g, '').trim();
        if (retryText.length > extractedText.length) {
          extracted = retry;
          extracted.metadata.statusCode = statusCode || extracted.metadata.statusCode;
        }
      } catch {
        // keep original extraction
      }
    }

    // Build the response based on requested formats.
    const data: ScrapeData = { metadata: extracted.metadata, strategy: extracted.strategy, statusCode: statusCode || extracted.metadata.statusCode };

    if (params.formats.includes('markdown')) {
      data.markdown = htmlToMarkdown(extracted.contentHtml, { removeBase64Images: params.removeBase64Images });
    }
    if (params.formats.includes('html')) {
      data.html = extracted.contentHtml;
    }
    if (params.formats.includes('rawHtml')) {
      data.rawHtml = extracted.rawHtml;
    }
    if (params.formats.includes('links')) {
      data.links = extracted.links;
    }
    if (params.formats.includes('screenshot')) {
      try {
        const buf = await page.screenshot({ fullPage: true, type: 'png' });
        data.screenshot = `data:image/png;base64,${buf.toString('base64')}`;
      } catch {
        // Screenshot failed; skip it.
      }
    }

    return { success: true, data };
  } catch (e) {
    const err = e as Error;
    // Distinguish timeout vs other errors for clearer reporting.
    if (err.message?.includes('Timeout') || err.name === 'TimeoutError') {
      return {
        success: false,
        error: `Navigation timeout after ${params.timeout}ms for ${url}`,
        data: { metadata: { sourceURL: url, statusCode, error: 'timeout' } as PageMetadata },
      };
    }
    return {
      success: false,
      error: `Failed to scrape ${url}: ${err.message}`,
      data: { metadata: { sourceURL: url, statusCode, error: err.message } as PageMetadata },
    };
  } finally {
    if (page) {
      try { await page.close(); } catch { /* ignore */ }
    }
    // Close the isolated context — this DESTROYS all cookies, localStorage,
    // sessionStorage, etc. Nothing persists between requests.
    if (context) {
      try { await context.close(); } catch { /* ignore */ }
    }
  }
}

export interface MapResult {
  success: boolean;
  links?: string[];
  error?: string;
}

/**
 * Map a site: fetch the entry URL, extract all links, and (optionally)
 * fetch /sitemap.xml if the site has one. Returns deduped absolute URLs.
 */
export async function mapUrl(url: string, opts: { search?: string; limit?: number; ignoreSitemap?: boolean; includeSubdomains?: boolean } = {}): Promise<MapResult> {
  const limit = opts.limit ?? 100;
  const search = (opts.search ?? '').toLowerCase();
  const ignoreSitemap = opts.ignoreSitemap ?? false;
  const includeSubdomains = opts.includeSubdomains ?? false;

  let baseUrl: URL;
  try {
    baseUrl = new URL(url);
  } catch {
    return { success: false, error: `Invalid URL: ${url}` };
  }

  const collected = new Set<string>();

  // Try sitemap first (faster + more complete) unless explicitly skipped.
  if (!ignoreSitemap) {
    try {
      const sitemapUrls = await trySitemaps(baseUrl);
      for (const u of sitemapUrls) {
        collected.add(u);
      }
    } catch {
      // ignore sitemap failures; fall through to page-scraping.
    }
  }

  // If sitemap didn't give us enough, scrape the page itself for links.
  if (collected.size < limit) {
    const result = await scrapeUrl({
      url,
      formats: ['links'],
      onlyMainContent: false,
      timeout: 20000,
    });
    if (result.success && result.data?.links) {
      for (const link of result.data.links) {
        collected.add(link.url);
      }
    }
  }

  // Filter by same-origin (or subdomain if includeSubdomains).
  const filtered = Array.from(collected).filter((u) => {
    try {
      const parsed = new URL(u);
      if (includeSubdomains) {
        return parsed.hostname === baseUrl.hostname || parsed.hostname.endsWith('.' + baseUrl.hostname);
      }
      return parsed.hostname === baseUrl.hostname;
    } catch {
      return false;
    }
  });

  // Apply search filter.
  const searched = search
    ? filtered.filter((u) => u.toLowerCase().includes(search) || decodeURIComponent(u).toLowerCase().includes(search))
    : filtered;

  // Sort + limit.
  const sorted = Array.from(new Set(searched)).sort();
  return { success: true, links: sorted.slice(0, limit) };
}

async function trySitemaps(baseUrl: URL): Promise<string[]> {
  const candidates = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml'];
  const out: string[] = [];
  for (const path of candidates) {
    try {
      const smUrl = new URL(path, baseUrl).toString();
      const resp = await fetch(smUrl, { method: 'GET' });
      if (!resp.ok) continue;
      const text = await resp.text();
      // crude regex parse; handles both <urlset> and <sitemapindex> schemas.
      const locMatches = text.match(/<loc>([^<]+)<\/loc>/g) || [];
      for (const m of locMatches) {
        const u = m.replace(/<\/?loc>/g, '').trim();
        if (u) out.push(u);
      }
      if (out.length > 0) return out;
    } catch {
      // continue
    }
  }
  return out;
}
