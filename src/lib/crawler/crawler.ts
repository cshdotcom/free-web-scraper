import { type Browser, type BrowserContext, type Page, type Response } from 'playwright';
import { getBrowser, config, pickDeviceProfile, type DeviceType } from './config';
import { extractInPage, fallbackExtract, type ExtractResult, type PageMetadata } from './extractor';
import { htmlToMarkdown } from './markdown';
import { applyStealth, dismissCookieBanners, isRetryableStatus, sleep, isCloudflareChallenge, waitForCloudflareChallenge } from './stealth';
import { guardUrl } from './url-guard';
import { checkRobots, checkHeadersForAiOptOut, checkHtmlForAiOptOut } from './robots';
import { impersonateFetch } from './curl-impersonate';

export interface ScrapeOptions {
  url: string;
  /** Output formats: 'markdown' | 'html' | 'rawHtml' | 'links' | 'images' | 'screenshot' */
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
  /** Mobile shortcut: when true, forces mobile device emulation (same as
   *  device: 'mobile'). Ignored when `device` is explicitly set.
   *  Firecrawl-compatible alias. */
  mobile?: boolean;
  /** Cookies to inject before navigation. Each scrape gets a FRESH
   *  browser context — cookies are ONLY used for this request and
   *  discarded immediately after. Not persisted anywhere.
   *  Accepts: array of {name, value, domain?, path?, ...} OR
   *  a cookie string "name=value; name2=value2" (parsed automatically). */
  cookies?: CookieInput[] | string;
  /** Browser actions to run before scraping. Each action is an object
   *  with a `type` field and type-specific parameters. Supported types:
   *    - { type: 'wait', milliseconds?: number, selector?: string }
   *    - { type: 'click', selector: string, all?: boolean }
   *    - { type: 'write', text: string }
   *    - { type: 'press', key: string }
   *    - { type: 'scroll', direction?: 'up'|'down', selector?: string }
   *    - { type: 'screenshot', fullPage?: boolean, quality?: number, viewport?: {width,height} }
   *    - { type: 'pdf', format?: string, landscape?: boolean, scale?: number }
   *    - { type: 'executeJavascript', script: string }
   *  Up to 50 actions; combined wait + waitFor must not exceed 60s. */
  actions?: BrowserAction[];
  /** Location object: { country?: string, languages?: string[] }.
   *  `country` is an ISO 3166-1 alpha-2 code (e.g. 'US', 'DE', 'JP').
   *  When set, configures the browser locale + timezone + Accept-Language
   *  header to match the target region. */
  location?: { country?: string; languages?: string[] };
  /** Custom HTTP headers to send with the navigation request. */
  headers?: Record<string, string>;
  /** Cache hint: max age in ms for which a cached result is acceptable.
   *  0 = always fetch fresh. Currently informational — the in-process
   *  crawler does not maintain a response cache, but the parameter is
   *  accepted for Firecrawl API compatibility. */
  maxAge?: number;
  /** Screenshot options applied when `screenshot` is in formats or when
   *  a screenshot action is used. Accepts: { fullPage?, quality?, viewport? }. */
  screenshot?: { fullPage?: boolean; quality?: number; viewport?: { width: number; height: number } };
  /** Attributes format: extract specific HTML attributes from elements
   *  matching CSS selectors. Each entry: { selector, attribute }.
   *  Returned as `data.attributes: { [selector+attribute]: string[] }`. */
  attributes?: Array<{ selector: string; attribute: string }>;
  /** Override robots.txt enforcement. Default: false (follow robots.txt).
   *  When true, robots.txt rules are ignored. AI opt-out layers
   *  (X-Robots-Tag: noai, <meta> robots, CC-NOAI, TDM-Rep) are NEVER
   *  bypassable — they are hard legal compliance. */
  ignoreRobotsTxt?: boolean;
  /** Whether to follow rel="nofollow" links. Default: false (respect
   *  nofollow). When true, nofollow links are treated as regular links.
   *  This affects the crawl job's link discovery — when a page contains
   *  <a href="..." rel="nofollow"> or <meta name="robots" content="nofollow">,
   *  those links/pages are not followed by default. Set followNofollow:
   *  true to override. */
  followNofollow?: boolean;
}

/** Browser action descriptor — see ScrapeOptions.actions. */
export interface BrowserAction {
  type: 'wait' | 'click' | 'write' | 'press' | 'scroll' | 'screenshot' | 'pdf' | 'executeJavascript' | 'scrape';
  milliseconds?: number;
  selector?: string;
  all?: boolean;
  text?: string;
  key?: string;
  direction?: 'up' | 'down';
  fullPage?: boolean;
  quality?: number;
  viewport?: { width: number; height: number };
  format?: string;
  landscape?: boolean;
  scale?: number;
  script?: string;
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

export interface BrandingProfile {
  colorScheme?: 'light' | 'dark';
  logo?: string;
  colors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
    background?: string;
    textPrimary?: string;
    textSecondary?: string;
  };
  fonts?: string[];
  typography?: {
    fontFamilies?: { primary?: string; heading?: string; code?: string };
    fontSizes?: { h1?: string; h2?: string; h3?: string; body?: string };
  };
}

export interface ScrapeData {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: Array<{ url: string; text: string }>;
  images?: Array<{ url: string; alt?: string; width?: number; height?: number }>;
  screenshot?: string;
  /** Branding profile extracted from page CSS + meta tags. */
  branding?: BrandingProfile;
  /** Per-action screenshots captured via the `screenshot` action. */
  actions?: {
    screenshots?: string[];
    scrapes?: Array<{ url: string; html: string }>;
    javascriptReturns?: unknown[];
  };
  /** Extracted attribute values keyed by `${selector}|${attribute}`. */
  attributes?: Record<string, string[]>;
  metadata: PageMetadata;
  /** Which extraction strategy was used */
  strategy?: string;
  /** HTTP status code of the page response (200, 404, 403, etc.) */
  statusCode?: number;
  /** robots.txt / AI opt-out block reason (set when statusCode === 403
   *  AND the block came from the compliance layer). */
  blockedReason?: string;
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

  // ---- Layer 1: URL guard (SSRF + protocol + length check) ----
  const guard = await guardUrl(url);
  if (!guard.ok) {
    return {
      success: false,
      error: guard.reason || 'URL rejected by guard',
      data: {
        metadata: { sourceURL: url, statusCode: guard.statusCode || 400, error: guard.reason } as PageMetadata,
        statusCode: guard.statusCode || 400,
        blockedReason: guard.reason,
      },
    };
  }
  const safeUrl = guard.normalizedUrl!;

  // ---- Layer 2: robots.txt + ai.txt compliance ----
  // robots.txt enforcement is controlled by `ignoreRobotsTxt` in the
  // request body. Default: false (follow robots.txt). When true,
  // robots.txt rules are skipped entirely. AI opt-out layers (noai,
  // CC-NOAI, TDM-Rep) are NEVER bypassable.
  const effectiveUa = opts.userAgent || process.env.CRAWLER_BRAND_NAME || 'NodeByte Crawl';
  const robotsResult = await checkRobots(safeUrl, effectiveUa, {
    ignoreRobotsTxt: opts.ignoreRobotsTxt === true,
  });
  if (!robotsResult.ok) {
    return {
      success: false,
      error: robotsResult.reason,
      data: {
        metadata: { sourceURL: safeUrl, statusCode: robotsResult.statusCode || 403, error: robotsResult.reason } as PageMetadata,
        statusCode: robotsResult.statusCode || 403,
        blockedReason: robotsResult.reason,
      },
    };
  }

  // Replace the URL with the guard-normalized one for the rest of the pipeline.
  // (The early URL validation below is now redundant but kept for backward compat.)
  try {
    const parsed = new URL(safeUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { success: false, error: `Unsupported protocol: ${parsed.protocol}` };
    }
  } catch {
    return { success: false, error: `Invalid URL: ${safeUrl}` };
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
  // Also keep images when 'images' format is requested.
  const wantsVisual = formats.includes('screenshot') || formats.includes('html') || formats.includes('rawHtml') || formats.includes('images');
  const blockResources =
    opts.blockResources === null ? null
      : opts.blockResources
        ? opts.blockResources
        : wantsVisual
          ? (config.blockResourceTypes?.filter((t: string) => t !== 'image' && t !== 'media') ?? null)
          : config.blockResourceTypes;
  const maxRetries = opts.maxRetries ?? config.maxRetries;

  // ---- Pre-request layer: curl-impersonate (TLS fingerprint) ----
  // Try fetching with curl-impersonate first (Chrome TLS fingerprint).
  // If the response is a static HTML page, parse it directly and return
  // — skipping the expensive Playwright browser launch entirely. This
  // bypasses Cloudflare/Akamai/DataDome TLS fingerprinting.
  const canUseImpersonate =
    !(opts.actions?.length) &&
    !formats.includes('screenshot') &&
    !formats.includes('branding') &&
    !formats.includes('images');
  const followNofollowOpt = opts.followNofollow === true;
  const impersonateCookies = typeof opts.cookies === 'string' ? opts.cookies : undefined;
  const impersonateHeaders = opts.headers;
  const impersonateUserAgent = opts.userAgent || '';
  const impersonateDevice = opts.device ?? 'auto';

  if (canUseImpersonate) {
    const impersonateUa = impersonateUserAgent || pickDeviceProfile(impersonateDevice).userAgent;
    const impersonateResult = await impersonateFetch(safeUrl, impersonateUa, {
      cookies: impersonateCookies,
      timeout: Math.min(timeout, 15000),
      headers: impersonateHeaders,
    });

    if (impersonateResult.success && impersonateResult.isStatic) {
      console.log(`[crawler] curl-impersonate hit (status ${impersonateResult.status}, ${impersonateResult.body.length} bytes) — skipping Playwright`);

      // Check HTTP headers for AI opt-out (layer 3).
      const headerResult = checkHeadersForAiOptOut(
        new Headers(Object.entries(impersonateResult.headers).map(([k, v]) => [k, v])),
      );
      if (!headerResult.ok) {
        return {
          success: false,
          error: headerResult.reason,
          data: {
            metadata: { sourceURL: safeUrl, statusCode: 403, error: headerResult.reason } as PageMetadata,
            statusCode: 403,
            blockedReason: headerResult.reason,
          },
        };
      }

      // Check HTML for AI opt-out (layer 4).
      const htmlResult = checkHtmlForAiOptOut(impersonateResult.body);
      if (!htmlResult.ok) {
        return {
          success: false,
          error: htmlResult.reason,
          data: {
            metadata: { sourceURL: safeUrl, statusCode: 403, error: htmlResult.reason } as PageMetadata,
            statusCode: 403,
            blockedReason: htmlResult.reason,
          },
        };
      }

      // Use the server-side fallback extractor to parse the HTML.
      const fb = fallbackExtract(impersonateResult.body, safeUrl);
      const data: ScrapeData = {
        metadata: {
          ...fb.metadata,
          statusCode: impersonateResult.status,
          sourceURL: safeUrl,
          url: impersonateResult.finalUrl || safeUrl,
        } as PageMetadata,
        strategy: 'curl-impersonate-static',
        statusCode: impersonateResult.status,
      };

      if (formats.includes('markdown')) {
        data.markdown = htmlToMarkdown(fb.contentHtml, { removeBase64Images });
      }
      if (formats.includes('html')) {
        data.html = fb.contentHtml;
      }
      if (formats.includes('rawHtml')) {
        data.rawHtml = impersonateResult.body;
      }
      if (formats.includes('links')) {
        // fallbackExtract doesn't return links, so extract them
        // from the raw HTML using the same regex approach.
        const rawLinks: Array<{ url: string; text: string }> = [];
        const linkRegex = /<a\s+[^>]*?href\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*?>([\s\S]*?)<\/a>/gi;
        let lm: RegExpExecArray | null;
        while ((lm = linkRegex.exec(impersonateResult.body)) !== null) {
          rawLinks.push({ url: lm[1], text: lm[2].replace(/<[^>]+>/g, '').trim() });
        }
        if (followNofollowOpt) {
          data.links = rawLinks;
        } else {
          data.links = filterNofollowLinks(impersonateResult.body, rawLinks);
        }
      }

      return { success: true, data, attempts: 1 };
    }

    if (!impersonateResult.success) {
      console.log(`[crawler] curl-impersonate failed (status ${impersonateResult.status}) — falling back to Playwright`);
    } else if (!impersonateResult.isStatic) {
      console.log(`[crawler] curl-impersonate got dynamic page — falling back to Playwright`);
    }
  }

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
    // If the browser has crashed or been closed since we got it, try
    // to get a fresh one before the next attempt.
    try {
      if (!browser.isConnected()) {
        console.warn('[crawler] Browser disconnected — re-launching');
        browser = await getBrowser();
      }
    } catch {
      try { browser = await getBrowser(); } catch { /* give up */ }
    }
    // If user provided a custom UA, use it. Otherwise pick a device profile
    // (UA + viewport + touch) based on the `device` option.
    // `mobile: true` is a Firecrawl-compatible shortcut for device: 'mobile'.
    const device = opts.device ?? (opts.mobile ? 'mobile' : 'auto');
    const profile = opts.userAgent
      ? { userAgent: opts.userAgent, viewport: { width: config.viewportWidth, height: config.viewportHeight }, isMobile: false, hasTouch: false }
      : pickDeviceProfile(device);
    // Screenshot viewport override (Firecrawl screenshot.viewport)
    const screenshotViewport = opts.screenshot?.viewport;
    const viewport = screenshotViewport ?? profile.viewport;
    const result = await attemptScrape(browser, safeUrl, {
      formats, onlyMainContent, includeTags, excludeTags,
      timeout, waitFor, removeBase64Images,
      userAgent: profile.userAgent,
      viewport,
      isMobile: profile.isMobile,
      hasTouch: profile.hasTouch,
      blockResources,
      waitForSelector: opts.waitForSelector,
      cookies: parseCookies(opts.cookies, opts.url),
      actions: opts.actions ?? [],
      location: opts.location,
      headers: opts.headers,
      screenshot: opts.screenshot,
      attributes: opts.attributes,
      followNofollow: followNofollowOpt,
    });

    if (result.success) {
      return { ...result, attempts };
    }

    lastError = result.error || 'Unknown error';

    // Decide whether to retry.
    const status = result.data?.metadata?.statusCode ?? 0;
    const retryable =
      isRetryableStatus(status) ||
      /timeout|net::ERR_|ECONNRESET|socket hang up|Target page, context or browser has been closed|browser has been closed|Target closed/i.test(lastError);

    if (!retryable || attempt === maxRetries) {
      return { ...result, attempts };
    }

    // If the error is browser-closed, force a browser re-launch before
    // the retry (the existing browser is dead).
    if (/Target page, context or browser has been closed|browser has been closed|Target closed/i.test(lastError)) {
      console.warn('[crawler] browser closed error — forcing re-launch');
      try { browser = await getBrowser(); } catch { /* will retry on next loop */ }
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
  actions: BrowserAction[];
  location?: { country?: string; languages?: string[] };
  headers?: Record<string, string>;
  screenshot?: { fullPage?: boolean; quality?: number; viewport?: { width: number; height: number } };
  attributes?: Array<{ selector: string; attribute: string }>;
  followNofollow: boolean;
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
    // Resolve location-driven locale, timezone, and Accept-Language values.
    // When `location` is set, override the defaults to match the target region.
    const loc = params.location ?? {};
    const locale = (loc.languages && loc.languages[0]) || localeForCountry(loc.country) || 'en-US';
    const timezone = timezoneForCountry(loc.country) || 'UTC';
    const acceptLang = (loc.languages && loc.languages.join(','))
      || acceptLanguageForCountry(loc.country)
      || 'en-US,en;q=0.9';

    // Merge default headers with user-provided custom headers (user wins).
    const extraHTTPHeaders: Record<string, string> = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': acceptLang,
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      ...(params.headers || {}),
    };

    // Create a FRESH browser context for each request.
    // This ensures complete cookie isolation — cookies from one request
    // never leak to another. After context.close(), all cookies are gone.
    context = await browser.newContext({
      userAgent: params.userAgent,
      viewport: params.viewport,
      isMobile: params.isMobile,
      hasTouch: params.hasTouch,
      locale,
      timezoneId: timezone,
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders,
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
    await applyStealth(page, params.userAgent, {
      location: params.location,
      viewport: params.viewport,
    });

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

    // ---- Layer 3: HTTP header AI opt-out check ----
    // X-Robots-Tag: noai, CC-NOAI: 1, TDM-Rep: 1 — these are NEVER
    // bypassable (hard legal compliance). Returns 403 with reason.
    if (navResp) {
      try {
        const hdrResult = checkHeadersForAiOptOut(navResp.headers());
        if (!hdrResult.ok) {
          return {
            success: false,
            error: hdrResult.reason,
            data: {
              metadata: { sourceURL: url, statusCode: 403, error: hdrResult.reason } as PageMetadata,
              statusCode: 403,
              blockedReason: hdrResult.reason,
            },
          };
        }
      } catch { /* best-effort */ }
    }

    // Give SPA / lazy content a moment to render. We wait for
    // 'networkidle' with a short budget, then any explicit waitFor.
    try {
      await page.waitForLoadState('networkidle', { timeout: Math.min(params.timeout, 8000) });
    } catch {
      // networkidle is best-effort; continue if it times out.
    }

    // ---- Cloudflare challenge detection ----
    // If the page is a Cloudflare JS challenge ("Just a moment..."),
    // wait up to 30 seconds for it to resolve before continuing.
    try {
      const html = await page.content();
      if (isCloudflareChallenge(html)) {
        console.log('[crawler] Cloudflare challenge detected — waiting for resolution');
        const resolved = await waitForCloudflareChallenge(page, 30000);
        if (resolved) {
          console.log('[crawler] Cloudflare challenge resolved — continuing with extraction');
          // Wait for networkidle again after challenge resolution.
          try {
            await page.waitForLoadState('networkidle', { timeout: 5000 });
          } catch { /* best-effort */ }
        } else {
          console.warn('[crawler] Cloudflare challenge did not resolve in 30s — continuing anyway');
        }
      }
    } catch { /* best-effort */ }

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

    // ---- Run pre-scrape browser actions (Firecrawl-compatible) ----
    // Each action runs sequentially. Captures screenshots from `screenshot`
    // actions into `actions.screenshots`, JavaScript return values from
    // `executeJavascript` into `actions.javascriptReturns`, and intermediate
    // HTML snapshots from `scrape` actions into `actions.scrapes`.
    const actionScreenshots: string[] = [];
    const actionScrapes: Array<{ url: string; html: string }> = [];
    const actionJsReturns: unknown[] = [];
    if (params.actions && params.actions.length > 0) {
      // Cap total actions at 50 (Firecrawl-style limit) to protect the worker.
      const actions = params.actions.slice(0, 50);
      for (const act of actions) {
        try {
          switch (act.type) {
            case 'wait':
              if (act.selector) {
                await page.waitForSelector(act.selector, { timeout: Math.min(params.timeout, 30000) });
              } else if (act.milliseconds) {
                await page.waitForTimeout(Math.min(act.milliseconds, 30000));
              }
              break;
            case 'click':
              if (act.all) {
                await page.locator(act.selector!).click({ timeout: 5000 }).catch(() => {});
              } else {
                await page.click(act.selector!, { timeout: 5000 }).catch(() => {});
              }
              break;
            case 'write':
              await page.keyboard.type(act.text || '', { delay: 10 });
              break;
            case 'press':
              await page.keyboard.press(act.key || 'Enter');
              break;
            case 'scroll':
              await page.evaluate((dir) => {
                const dy = dir === 'up' ? -window.innerHeight : window.innerHeight;
                window.scrollBy(0, dy);
              }, act.direction || 'down');
              break;
            case 'screenshot': {
              const buf = await page.screenshot({
                fullPage: act.fullPage ?? false,
                type: 'png',
                ...(act.quality ? { quality: act.quality } : {}),
              });
              actionScreenshots.push(`data:image/png;base64,${buf.toString('base64')}`);
              break;
            }
            case 'pdf': {
              const buf = await page.pdf({
                format: act.format || 'Letter',
                landscape: act.landscape ?? false,
                scale: act.scale ?? 1,
              });
              actionScreenshots.push(`data:application/pdf;base64,${buf.toString('base64')}`);
              break;
            }
            case 'executeJavascript': {
              const ret = await page.evaluate(act.script || 'null');
              actionJsReturns.push(ret);
              break;
            }
            case 'scrape': {
              const html = await page.content();
              actionScrapes.push({ url: page.url(), html });
              break;
            }
            default:
              // Ignore unknown action types — forward-compatible.
              break;
          }
        } catch {
          // best-effort: skip failed actions
        }
      }
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

    // ---- Layer 4: HTML <meta> AI opt-out check ----
    // Scan the raw HTML for <meta name="robots" content="noai"> etc.
    // This is checked AFTER navigation + extraction so we have the
    // rendered DOM (which is what the publisher actually wants to
    // enforce — server-rendered tags are visible to crawlers).
    {
      const htmlResult = checkHtmlForAiOptOut(extracted.rawHtml || extracted.contentHtml || '');
      if (!htmlResult.ok) {
        return {
          success: false,
          error: htmlResult.reason,
          data: {
            metadata: { ...extracted.metadata, statusCode: 403, error: htmlResult.reason } as PageMetadata,
            statusCode: 403,
            blockedReason: htmlResult.reason,
          },
        };
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
      // Filter out nofollow links when followNofollow is false (default).
      if (!params.followNofollow) {
        data.links = filterNofollowLinks(extracted.rawHtml || extracted.contentHtml, extracted.links);
      } else {
        data.links = extracted.links;
      }
    }
    if (params.formats.includes('images')) {
      // Firecrawl-compatible `images` format: each entry has url, alt,
      // AND intrinsic width/height (parsed from naturalWidth/naturalHeight
      // — the original image dimensions, not the rendered size). Skips
      // data: URIs and tracking pixels (< 2x2). Includes <picture>
      // source elements and CSS background-image when discoverable.
      try {
        const imgs = await page.evaluate(() => {
          const out: Array<{ url: string; alt?: string; width?: number; height?: number }> = [];
          // Standard <img> elements.
          for (const img of Array.from(document.querySelectorAll('img'))) {
            const url = img.currentSrc || img.src || '';
            if (!url || url.startsWith('data:')) continue;
            // Skip tracking pixels (1x1 / 0x0).
            if ((img.naturalWidth > 0 && img.naturalWidth < 2) || (img.naturalHeight > 0 && img.naturalHeight < 2)) continue;
            out.push({
              url,
              alt: img.alt || undefined,
              width: img.naturalWidth || undefined,
              height: img.naturalHeight || undefined,
            });
          }
          // <picture><source> elements (often used for responsive images).
          for (const src of Array.from(document.querySelectorAll('picture source'))) {
            const srcset = src.getAttribute('srcset') || '';
            if (!srcset) continue;
            const first = srcset.split(',')[0].trim().split(/\s+/)[0];
            if (first && !first.startsWith('data:')) {
              out.push({ url: first });
            }
          }
          // De-duplicate by URL.
          const seen = new Set<string>();
          return out.filter((i) => {
            if (seen.has(i.url)) return false;
            seen.add(i.url);
            return true;
          });
        });
        data.images = imgs as Array<{ url: string; alt?: string; width?: number; height?: number }>;
      } catch {
        data.images = [];
      }
    }
    if (params.formats.includes('screenshot')) {
      try {
        const buf = await page.screenshot({
          fullPage: params.screenshot?.fullPage ?? true,
          type: 'png',
          ...(params.screenshot?.quality ? { quality: params.screenshot.quality } : {}),
        });
        data.screenshot = `data:image/png;base64,${buf.toString('base64')}`;
      } catch {
        // Screenshot failed; skip it.
      }
    }
    if (params.formats.includes('branding')) {
      // Branding format — extract the site's visual identity (colors,
      // fonts, logo, typography) from page CSS + meta tags. Mirrors
      // Firecrawl's documented `branding` output structure (subset:
      // we don't have a full LLM-driven analysis, so we extract only
      // what's deterministically derivable from the page).
      try {
        const branding = await page.evaluate(() => {
          const result: {
            colorScheme?: 'light' | 'dark';
            logo?: string;
            colors?: { primary?: string; secondary?: string; accent?: string; background?: string; textPrimary?: string; textSecondary?: string };
            fonts?: string[];
            typography?: { fontFamilies?: { primary?: string; heading?: string; code?: string }; fontSizes?: { h1?: string; h2?: string; h3?: string; body?: string } };
          } = {};

          // Color scheme: check <meta name="color-scheme"> or prefers-color-scheme.
          const metaCs = document.querySelector('meta[name="color-scheme"]')?.getAttribute('content') || '';
          const metaTheme = document.querySelector('meta[name="theme-color"]')?.getAttribute('content') || '';
          if (/dark/i.test(metaCs)) result.colorScheme = 'dark';
          else if (/light/i.test(metaCs)) result.colorScheme = 'light';
          else if (metaTheme) {
            // Heuristic: a light theme-color (#fff / #f0f0f0) → light, dark → dark.
            const c = metaTheme.replace('#', '');
            if (c.length >= 6) {
              const r = parseInt(c.slice(0, 2), 16);
              const g = parseInt(c.slice(2, 4), 16);
              const b = parseInt(c.slice(4, 6), 16);
              if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
                const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                result.colorScheme = luma < 0.5 ? 'dark' : 'light';
              }
            }
          }

          // Logo: check <link rel="icon" type="image/svg+xml"> or
          // apple-touch-icon, then <meta property="og:image">, then
          // any element with class containing "logo".
          const iconSvg = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]')?.href;
          const iconPng = document.querySelector<HTMLLinkElement>('link[rel="icon"]:not([type="image/svg+xml"])')?.href;
          const apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.href;
          const ogImage = document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content;
          result.logo = iconSvg || apple || iconPng || ogImage || undefined;

          // Colors: <meta name="theme-color"> + CSS custom properties
          // named --primary, --accent, --brand, etc. + first <button>
          // background-color as a fallback for "primary".
          result.colors = {};
          if (metaTheme) result.colors.primary = metaTheme;
          // CSS custom properties on :root.
          const root = getComputedStyle(document.documentElement);
          for (const name of ['--primary', '--brand', '--accent', '--secondary', '--background', '--bg', '--text', '--text-primary', '--text-secondary']) {
            const v = root.getPropertyValue(name).trim();
            if (!v) continue;
            if (/--primary|--brand/.test(name)) result.colors.primary = result.colors.primary || v;
            else if (name === '--accent') result.colors.accent = v;
            else if (name === '--secondary') result.colors.secondary = v;
            else if (name === '--background' || name === '--bg') result.colors.background = v;
            else if (name === '--text' || name === '--text-primary') result.colors.textPrimary = v;
            else if (name === '--text-secondary') result.colors.textSecondary = v;
          }
          // Fallback: first visible <button> background-color → primary.
          if (!result.colors.primary) {
            const btn = document.querySelector('button, a.button, .btn, [class*="button"]');
            if (btn) {
              const bg = getComputedStyle(btn).backgroundColor;
              if (bg && bg !== 'rgba(0, 0, 0, 0)') result.colors.primary = bg;
            }
          }
          // Fallback: body background → background, body color → textPrimary.
          if (!result.colors.background) {
            const bg = getComputedStyle(document.body).backgroundColor;
            if (bg && bg !== 'rgba(0, 0, 0, 0)') result.colors.background = bg;
          }
          if (!result.colors.textPrimary) {
            const c = getComputedStyle(document.body).color;
            if (c) result.colors.textPrimary = c;
          }

          // Fonts: scan all elements and collect unique font-family values.
          const fontSet = new Set<string>();
          for (const el of Array.from(document.querySelectorAll('body, body *'))) {
            const ff = getComputedStyle(el).fontFamily;
            if (ff) {
              for (const f of ff.split(',').map((s) => s.trim().replace(/['"]/g, ''))) {
                if (f && !f.startsWith('-apple-') && f !== 'system-ui' && f !== 'sans-serif' && f !== 'serif' && f !== 'monospace' && f !== 'inherit' && f !== 'initial') {
                  fontSet.add(f);
                }
              }
            }
            if (fontSet.size >= 10) break; // cap to avoid runaway scans
          }
          result.fonts = Array.from(fontSet);

          // Typography: fontFamilies + fontSizes from key element styles.
          result.typography = { fontFamilies: {}, fontSizes: {} };
          const bodyFf = getComputedStyle(document.body).fontFamily;
          if (bodyFf) result.typography.fontFamilies.primary = bodyFf.split(',')[0].trim().replace(/['"]/g, '');
          const h1 = document.querySelector('h1');
          if (h1) {
            result.typography.fontFamilies.heading = getComputedStyle(h1).fontFamily.split(',')[0].trim().replace(/['"]/g, '');
            result.typography.fontSizes.h1 = getComputedStyle(h1).fontSize;
          }
          const h2 = document.querySelector('h2');
          if (h2) result.typography.fontSizes.h2 = getComputedStyle(h2).fontSize;
          const h3 = document.querySelector('h3');
          if (h3) result.typography.fontSizes.h3 = getComputedStyle(h3).fontSize;
          const code = document.querySelector('code, pre');
          if (code) result.typography.fontFamilies.code = getComputedStyle(code).fontFamily.split(',')[0].trim().replace(/['"]/g, '');
          result.typography.fontSizes.body = getComputedStyle(document.body).fontSize;

          return result;
        });
        data.branding = branding as BrandingProfile;
      } catch {
        // best-effort — branding extraction failed, skip.
      }
    }
    // Attributes format: extract specific HTML attributes from CSS selectors.
    if (params.attributes && params.attributes.length > 0) {
      try {
        const out: Record<string, string[]> = {};
        for (const spec of params.attributes) {
          const key = `${spec.selector}|${spec.attribute}`;
          // Playwright's page.evaluate only accepts a single argument.
          // We wrap the selector + attribute in an object.
          const result = await page.evaluate(({ sel, attr }) => {
            const els = Array.from(document.querySelectorAll(sel));
            return els
              .map((el) => {
                if (attr === 'textContent') return (el as HTMLElement).textContent || '';
                if (attr === 'innerHTML') return (el as HTMLElement).innerHTML || '';
                if (attr === 'outerHTML') return (el as HTMLElement).outerHTML || '';
                return (el as HTMLElement).getAttribute(attr) || '';
              })
              .filter(Boolean);
          }, { sel: spec.selector, attr: spec.attribute });
          out[key] = result as string[];
        }
        data.attributes = out;
      } catch {
        // best-effort
      }
    }
    // Attach action captures (screenshots / scrapes / JS returns).
    if (actionScreenshots.length || actionScrapes.length || actionJsReturns.length) {
      data.actions = {
        screenshots: actionScreenshots.length ? actionScreenshots : undefined,
        scrapes: actionScrapes.length ? actionScrapes : undefined,
        javascriptReturns: actionJsReturns.length ? actionJsReturns : undefined,
      };
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

// ============================================================
// nofollow link filtering
// ============================================================

/**
 * Filter out links with rel="nofollow" from the extracted links list.
 * This is used when followNofollow is false (the default) — links
 * marked with rel="nofollow" in the HTML are removed from the results.
 *
 * Also checks <meta name="robots" content="nofollow"> at the page
 * level — when present, ALL links on the page are treated as nofollow.
 *
 * @param html     The raw HTML of the page.
 * @param links    The extracted links (from extractor or fallback).
 * @returns        Links with nofollow removed.
 */
export function filterNofollowLinks(
  html: string,
  links: Array<{ url: string; text: string }>,
): Array<{ url: string; text: string }> {
  // Check page-level nofollow: <meta name="robots" content="nofollow">
  // or <meta name="robots" content="noindex,nofollow">
  const metaRobotsMatch = html.match(/<meta\s+[^>]*?name\s*=\s*["']robots["'][^>]*?content\s*=\s*["']([^"']+)["'][^>]*?>/i);
  if (metaRobotsMatch) {
    const directives = metaRobotsMatch[1].toLowerCase().split(/[,\s]+/);
    if (directives.includes('nofollow')) {
      // Page-level nofollow: all links are nofollow → return empty.
      console.log('[crawler] Page has meta robots nofollow — filtering all links');
      return [];
    }
  }

  // Build a set of nofollow URLs by parsing <a href="..." rel="nofollow">.
  const nofollowUrls = new Set<string>();
  const anchorRegex = /<a\s+[^>]*?href\s*=\s*["']([^"']+)["'][^>]*?rel\s*=\s*["']([^"']*)["'][^>]*?>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRegex.exec(html)) !== null) {
    const href = m[1];
    const rel = m[2].toLowerCase();
    if (rel.includes('nofollow')) {
      nofollowUrls.add(href);
    }
  }

  // Also check the reverse order: rel="..." href="..."
  const anchorRegex2 = /<a\s+[^>]*?rel\s*=\s*["']([^"']*)["'][^>]*?href\s*=\s*["']([^"']+)["'][^>]*?>/gi;
  while ((m = anchorRegex2.exec(html)) !== null) {
    const rel = m[1].toLowerCase();
    const href = m[2];
    if (rel.includes('nofollow')) {
      nofollowUrls.add(href);
    }
  }

  // Filter out nofollow links.
  return links.filter((link) => {
    // Normalize both the link URL and the nofollow URL for comparison.
    try {
      const linkUrl = new URL(link.url);
      for (const nf of nofollowUrls) {
        try {
          const nfUrl = new URL(nf, link.url);
          if (nfUrl.toString() === linkUrl.toString()) return false;
        } catch {
          if (nf === link.url) return false;
        }
      }
    } catch {
      // If URL parsing fails, check raw string match.
      if (nofollowUrls.has(link.url)) return false;
    }
    return true;
  });
}

export interface MapResult {
  success: boolean;
  links?: Array<string | { url: string; title?: string; description?: string }>;
  error?: string;
}

/**
 * Map a site: fetch the entry URL, extract all links, and (optionally)
 * fetch /sitemap.xml if the site has one. Returns deduped absolute URLs.
 *
 * `sitemap` follows Firecrawl's enum:
 *   - 'include' (default): use sitemap + on-page links.
 *   - 'skip': ignore sitemap, only scrape the seed page for links.
 *   - 'only': ONLY use the sitemap (no page scrape).
 *
 * When the sitemap contains <url> entries with <title>/<description>
 * child elements (some custom sitemaps do), they are forwarded into
 * the response. Otherwise the link objects carry just the URL.
 */
export async function mapUrl(
  url: string,
  opts: {
    search?: string;
    limit?: number;
    /** @deprecated use `sitemap` enum instead — kept for backward compat. */
    ignoreSitemap?: boolean;
    sitemap?: 'include' | 'skip' | 'only';
    includeSubdomains?: boolean;
  } = {},
): Promise<MapResult> {
  const limit = opts.limit ?? 100;
  const search = (opts.search ?? '').toLowerCase();
  // Resolve the sitemap enum: explicit `sitemap` value wins; otherwise
  // legacy `ignoreSitemap: true` maps to 'skip'.
  const sitemapMode: 'include' | 'skip' | 'only' =
    opts.sitemap === 'skip' ? 'skip'
    : opts.sitemap === 'only' ? 'only'
    : opts.ignoreSitemap ? 'skip'
    : 'include';
  const includeSubdomains = opts.includeSubdomains ?? false;

  let baseUrl: URL;
  try {
    baseUrl = new URL(url);
  } catch {
    return { success: false, error: `Invalid URL: ${url}` };
  }

  const collected = new Map<string, { title?: string; description?: string }>();

  // Try sitemap first (faster + more complete) unless explicitly skipped.
  if (sitemapMode !== 'skip') {
    try {
      const sitemapEntries = await trySitemaps(baseUrl);
      for (const e of sitemapEntries) {
        collected.set(e.url, { title: e.title, description: e.description });
      }
    } catch {
      // ignore sitemap failures; fall through to page-scraping.
    }
  }

  // If sitemap didn't give us enough (and the user didn't ask for 'only'),
  // scrape the page itself for links.
  if (sitemapMode !== 'only' && collected.size < limit) {
    const result = await scrapeUrl({
      url,
      formats: ['links'],
      onlyMainContent: false,
      timeout: 20000,
    });
    if (result.success && result.data?.links) {
      for (const link of result.data.links) {
        const linkUrl = typeof link === 'string' ? link : link.url;
        const linkText = typeof link === 'string' ? '' : (link.text || '');
        const existing = collected.get(linkUrl);
        if (!existing) {
          collected.set(linkUrl, { title: linkText || undefined, description: undefined });
        } else if (!existing.title && linkText) {
          existing.title = linkText;
        }
      }
    }
  }

  // Filter by same-origin (or subdomain if includeSubdomains).
  const filteredEntries = Array.from(collected.entries()).filter(([u]) => {
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
    ? filteredEntries.filter(([u, meta]) =>
      u.toLowerCase().includes(search)
      || decodeURIComponent(u).toLowerCase().includes(search)
      || (meta.title || '').toLowerCase().includes(search)
      || (meta.description || '').toLowerCase().includes(search))
    : filteredEntries;

  // Sort + limit. Return objects with title/description only when at least
  // one of those is present; otherwise return bare strings for backward
  // compatibility with the original /v2/map response shape.
  const sorted = searched.sort(([a], [b]) => a.localeCompare(b));
  const sliced = sorted.slice(0, limit);
  const links: Array<string | { url: string; title?: string; description?: string }> = sliced.map(([u, meta]) => {
    if (meta.title || meta.description) {
      return { url: u, title: meta.title, description: meta.description };
    }
    return u;
  });
  return { success: true, links };
}

async function trySitemaps(baseUrl: URL): Promise<Array<{ url: string; title?: string; description?: string }>> {
  const candidates = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml'];
  const out: Array<{ url: string; title?: string; description?: string }> = [];
  for (const path of candidates) {
    try {
      const smUrl = new URL(path, baseUrl).toString();
      const resp = await fetch(smUrl, { method: 'GET' });
      if (!resp.ok) continue;
      const text = await resp.text();
      // Crude regex parse; handles both <urlset> and <sitemapindex> schemas.
      // We extract <loc> URLs and (when present) <title>/<description>
      // siblings inside <url> entries (custom sitemap extensions).
      const blockRegex = /<url>([\s\S]*?)<\/url>/gi;
      let m: RegExpExecArray | null;
      let hasUrlBlocks = false;
      while ((m = blockRegex.exec(text)) !== null) {
        hasUrlBlocks = true;
        const block = m[1];
        const loc = block.match(/<loc>([^<]+)<\/loc>/i);
        if (!loc) continue;
        const u = loc[1].trim();
        const titleMatch = block.match(/<title>([^<]*)<\/title>/i);
        const descMatch = block.match(/<(?:description|news\:title|image\:title)>([^<]*)<\/(?:description|news\:title|image\:title)>/i);
        out.push({
          url: u,
          title: titleMatch ? titleMatch[1].trim() : undefined,
          description: descMatch ? descMatch[1].trim() : undefined,
        });
      }
      if (hasUrlBlocks && out.length > 0) return out;
      // Fallback: plain <loc> extraction (sitemapindex-style or simple urlset).
      const locMatches = text.match(/<loc>([^<]+)<\/loc>/g) || [];
      for (const lm of locMatches) {
        const u = lm.replace(/<\/?loc>/g, '').trim();
        if (u) out.push({ url: u });
      }
      if (out.length > 0) return out;
    } catch {
      // continue
    }
  }
  return out;
}

// ============================================================
// Location helpers — resolve ISO country code to a browser locale,
// timezone, and Accept-Language value. Used by `scrapeUrl` when the
// `location` option is set (Firecrawl-compatible).
// ============================================================

/** Map an ISO 3166-1 alpha-2 country code to a BCP-47 locale. */
function localeForCountry(country?: string): string | undefined {
  if (!country) return undefined;
  const c = country.toUpperCase();
  const map: Record<string, string> = {
    US: 'en-US', GB: 'en-GB', AU: 'en-AU', CA: 'en-CA', IN: 'en-IN',
    DE: 'de-DE', AT: 'de-AT', CH: 'de-CH',
    FR: 'fr-FR', BE: 'fr-BE', CA_FR: 'fr-CA',
    ES: 'es-ES', MX: 'es-MX', AR: 'es-AR',
    IT: 'it-IT', PT: 'pt-PT', BR: 'pt-BR',
    NL: 'nl-NL', SE: 'sv-SE', NO: 'nb-NO', DK: 'da-DK', FI: 'fi-FI',
    JP: 'ja-JP', KR: 'ko-KR', CN: 'zh-CN', TW: 'zh-TW', HK: 'zh-HK',
    RU: 'ru-RU', UA: 'uk-UA', PL: 'pl-PL', CZ: 'cs-CZ', TR: 'tr-TR',
    AE: 'ar-AE', SA: 'ar-SA', IL: 'he-IL', TH: 'th-TH', VN: 'vi-VN',
    ID: 'id-ID', MY: 'ms-MY', PH: 'en-PH', SG: 'en-SG',
  };
  return map[c];
}

/** Map an ISO 3166-1 alpha-2 country code to an IANA timezone. */
function timezoneForCountry(country?: string): string | undefined {
  if (!country) return undefined;
  const c = country.toUpperCase();
  const map: Record<string, string> = {
    US: 'America/New_York', GB: 'Europe/London', AU: 'Australia/Sydney',
    CA: 'America/Toronto', IN: 'Asia/Kolkata', DE: 'Europe/Berlin',
    FR: 'Europe/Paris', ES: 'Europe/Madrid', IT: 'Europe/Rome',
    PT: 'Europe/Lisbon', BR: 'America/Sao_Paulo', JP: 'Asia/Tokyo',
    KR: 'Asia/Seoul', CN: 'Asia/Shanghai', TW: 'Asia/Taipei',
    HK: 'Asia/Hong_Kong', RU: 'Europe/Moscow', UA: 'Europe/Kyiv',
    NL: 'Europe/Amsterdam', SE: 'Europe/Stockholm', NO: 'Europe/Oslo',
    DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki', PL: 'Europe/Warsaw',
    CZ: 'Europe/Prague', TR: 'Europe/Istanbul', AE: 'Asia/Dubai',
    SA: 'Asia/Riyadh', IL: 'Asia/Jerusalem', TH: 'Asia/Bangkok',
    VN: 'Asia/Ho_Chi_Minh', ID: 'Asia/Jakarta', MY: 'Asia/Kuala_Lumpur',
    PH: 'Asia/Manila', SG: 'Asia/Singapore', MX: 'America/Mexico_City',
    AR: 'America/Argentina/Buenos_Aires',
  };
  return map[c];
}

/** Map an ISO 3166-1 alpha-2 country code to an Accept-Language header. */
function acceptLanguageForCountry(country?: string): string | undefined {
  const loc = localeForCountry(country);
  if (!loc) return undefined;
  // e.g. en-US,en;q=0.9  or  ja-JP,ja;q=0.9
  const base = loc.split('-')[0];
  return `${loc},${base};q=0.9`;
}
