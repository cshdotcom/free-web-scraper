import type { LaunchOptions, Browser } from 'playwright';
import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Configuration for the crawler service.
 * All values can be overridden via environment variables.
 *
 * The browser binaries are bundled into the package via the
 * `PLAYWRIGHT_BROWSERS_PATH` env var pointing at a local `browsers/`
 * directory. This makes the service fully portable: no need to run
 * `playwright install` on the target host.
 */
export interface CrawlerConfig {
  /** Port the HTTP server listens on */
  port: number;
  /** Playwright browser executable path (if using a custom build) */
  browserExecutablePath: string | undefined;
  /** Max concurrency for FOREGROUND (sync /v2/scrape) requests */
  maxConcurrency: number;
  /** Max concurrency for BACKGROUND (async batch/crawl) jobs.
   * Lower than maxConcurrency to reserve resources for foreground. */
  backgroundConcurrency: number;
  /** Default navigation timeout in ms */
  defaultTimeout: number;
  /** Default max crawl pages per crawl job */
  defaultCrawlLimit: number;
  /** Default max crawl depth (BFS levels) */
  defaultCrawlMaxDepth: number;
  /** Time to keep finished jobs in memory (ms) */
  jobTtlMs: number;
  /**
   * List of accepted API keys for authenticating API requests.
   * Empty array = open access (auth disabled).
   * Populated from CRAWLER_API_KEYS (comma-separated) or, for
   * backwards compatibility, CRAWLER_API_KEY (single).
   */
  apiKeys: string[];
  /** Advertised brand name (used in health-check response + logs). */
  brandName: string;
  /** Default user agent for the headless browser */
  userAgent: string;
  /** Pool of user agents to rotate through for anti-bot evasion */
  userAgentPool: string[];
  /** Default viewport width */
  viewportWidth: number;
  /** Default viewport height */
  viewportHeight: number;
  /** Block resource types by default for speed (null = block none, [] = block none explicitly) */
  blockResourceTypes: string[] | null;
  /** Whether headless */
  headless: boolean;
  /** Max retries on 403/429/network errors */
  maxRetries: number;
  /** Base delay for exponential backoff (ms) */
  retryBaseDelayMs: number;
  /** Whether to enable stealth anti-detection patches */
  stealth: boolean;
  /** Whether to auto-dismiss cookie consent banners */
  dismissCookieBanners: boolean;
  /** Path to the bundled browser directory (for portable packaging) */
  bundledBrowsersPath: string | undefined;
}

/** Default advertised brand name. */
export const DEFAULT_BRAND_NAME = 'NodeByte Crawl';

/**
 * Website URL appended to every user agent as an identifier.
 * e.g. "NodeByte Crawl/4.0.2 (+https://nodebyte.cn)"
 * This is a WEBSITE URL (not a repo URL) so site admins can identify the
 * crawler and visit the site to learn more / contact the operator.
 * Configurable via CRAWLER_UA_SITE_URL env var.
 */
export const DEFAULT_SITE_URL = 'https://nodebyte.cn';

/** A pool of realistic DESKTOP user agents to rotate through. */
const DESKTOP_UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
];

/** A pool of realistic MOBILE user agents. */
const MOBILE_UA_POOL = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 15; SM-S928U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-A546U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPad; CPU OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
];

/** Desktop viewport presets. */
const DESKTOP_VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
];

/** Mobile viewport presets. */
const MOBILE_VIEWPORTS = [
  { width: 390, height: 844 },   // iPhone 15
  { width: 412, height: 915 },   // Android
  { width: 414, height: 896 },   // iPhone Pro Max
  { width: 768, height: 1024 },  // iPad
];

export type DeviceType = 'auto' | 'desktop' | 'mobile';

export interface DeviceProfile {
  userAgent: string;
  viewport: { width: number; height: number };
  isMobile: boolean;
  hasTouch: boolean;
}

/**
 * Pick a device profile for the given device type.
 * - 'auto': 50/50 chance desktop vs mobile
 * - 'desktop': random desktop UA + viewport
 * - 'mobile': random mobile UA + viewport
 *
 * The UA always includes the site URL suffix so site admins can identify
 * the crawler. Format follows the standard bot convention used by
 * Googlebot, Bingbot, etc.:
 *   "Mozilla/5.0 (compatible; NodeByte Bot/4.0.2; +https://nodebyte.cn)"
 *
 * The `compatible;` token + `;` separators match the RFC 9309 bot UA
 * convention so site admins and WAFs can identify our crawler by the
 * `NodeByte Bot` product token. The `CRAWLER_UA_SITE_URL` env var
 * controls the URL in the parenthetical comment.
 */
export function pickDeviceProfile(device: DeviceType = 'auto'): DeviceProfile {
  const siteUrl = process.env.CRAWLER_UA_SITE_URL || DEFAULT_SITE_URL;
  const brand = process.env.CRAWLER_BRAND_NAME || DEFAULT_BRAND_NAME;
  // Convert "NodeByte Crawl" → "NodeByte Bot" for the UA token (more
  // standard for crawlers — Googlebot, Bingbot, etc. all use "Bot").
  // Preserve spaces: "NodeByte Bot" not "NodeByteBot".
  const botToken = brand.replace(/\s*Crawl\s*$/i, ' Bot').trim();
  const version = '4.0.8';

  let pool: string[];
  let viewports: typeof DESKTOP_VIEWPORTS;
  let isMobile: boolean;

  const useMobile = device === 'mobile' || (device === 'auto' && Math.random() < 0.5);

  if (useMobile) {
    pool = MOBILE_UA_POOL;
    viewports = MOBILE_VIEWPORTS;
    isMobile = true;
  } else {
    pool = DESKTOP_UA_POOL;
    viewports = DESKTOP_VIEWPORTS;
    isMobile = false;
  }

  const ua = pool[Math.floor(Math.random() * pool.length)];
  const vp = viewports[Math.floor(Math.random() * viewports.length)];

  // Build the UA following the standard bot convention:
  //   Mozilla/5.0 (compatible; NodeByte Bot/4.0.2; +https://nodebyte.cn)
  // This is the same format used by Googlebot:
  //   Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)
  //
  // For mobile, we use the smartphone variant:
  //   Mozilla/5.0 (iPhone; ...; compatible; NodeByte Bot/4.0.2; +https://nodebyte.cn)
  // (The mobile UA already starts with "Mozilla/5.0 (iPhone; ..." so
  // we insert "; compatible; NodeByte Bot/ver; +url" before the closing ")".)
  const botComment = `compatible; ${botToken}/${version}; +${siteUrl}`;
  let brandedUa: string;
  // Browser UAs have multiple parenthetical comments. We need to find
  // the FIRST closing paren ")" that closes the initial product token
  // comment (e.g. "(Windows NT 10.0; Win64; x64)" or
  // "(Macintosh; Intel Mac OS X 10_15_7)"). We do this by finding the
  // position of the first ")" after the opening "(".
  const firstOpen = ua.indexOf('(');
  if (firstOpen >= 0) {
    const firstClose = ua.indexOf(')', firstOpen);
    if (firstClose >= 0) {
      // Insert "; compatible; NodeByte Bot/ver; +url" before the
      // first closing paren.
      brandedUa = ua.slice(0, firstClose) + `; ${botComment}` + ua.slice(firstClose);
    } else {
      brandedUa = `${ua} (${botComment})`;
    }
  } else {
    // No parenthetical — create one.
    brandedUa = `${ua} (${botComment})`;
  }

  return {
    userAgent: brandedUa,
    viewport: vp,
    isMobile,
    hasTouch: isMobile,
  };
}

/**
 * Parse accepted API keys from the environment.
 *
 *  - If `CRAWLER_API_KEYS` is set (comma-separated), use it.
 *  - Otherwise, if `CRAWLER_API_KEY` is set (single, backwards compat), wrap it in an array.
 *  - Otherwise, return an empty array (= auth disabled / open access).
 */
function parseApiKeys(): string[] {
  const multi = process.env.CRAWLER_API_KEYS;
  if (multi && multi.trim().length > 0) {
    return multi
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  const single = process.env.CRAWLER_API_KEY;
  if (single && single.trim().length > 0) {
    return [single.trim()];
  }
  return [];
}

/**
 * Check whether a provided API key is valid.
 *
 * Returns `true` when:
 *  - the configured `apiKeys` list is empty (open-access mode), OR
 *  - the given token is present in the configured list.
 */
export function isValidApiKey(token: string): boolean {
  if (config.apiKeys.length === 0) return true;
  return config.apiKeys.includes(token);
}

/** A pool of realistic desktop user agents to rotate through. */
const DEFAULT_UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
];

/**
 * Resolve the bundled-browser directory. We check, in order:
 *   1. CRAWLER_BROWSER_PATH env var (explicit override)
 *   2. PLAYWRIGHT_BROWSERS_PATH env var (set by our packaging script)
 *   3. A `browsers/` directory shipped next to this module
 *   4. Fall back to Playwright's default discovery (requires `playwright install`)
 */
function resolveBundledBrowsersPath(): string | undefined {
  // Explicit override wins.
  if (process.env.CRAWLER_BROWSER_PATH) {
    return process.env.CRAWLER_BROWSER_PATH;
  }
  // If PLAYWRIGHT_BROWSERS_PATH is set, Playwright will find browsers there
  // automatically, so we don't need to pass executablePath at all.
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return undefined;
  }
  // Try a bundled browsers directory relative to the package root.
  const candidates = [
    path.resolve(process.cwd(), 'browsers'),
    path.resolve(__dirname, '..', 'browsers'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) {
        // Look for a chromium-* / chrome-linux64 / chrome-mac subdirectory.
        return findChromiumBinary(dir);
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

/** Walk a browsers directory and find the chromium executable. */
function findChromiumBinary(browsersDir: string): string | undefined {
  try {
    const entries = fs.readdirSync(browsersDir);
    for (const entry of entries) {
      const sub = path.join(browsersDir, entry);
      const stat = fs.statSync(sub);
      if (!stat.isDirectory()) continue;
      // Playwright layout: chromium-XXXX/chrome-linux/chrome or chrome-mac/Chromium.app/...
      // Bundled layout: chromium-XXXX/chrome-linux64/chrome
      const linuxChrome = path.join(sub, 'chrome-linux', 'chrome');
      const linux64Chrome = path.join(sub, 'chrome-linux64', 'chrome');
      const macChrome = path.join(sub, 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
      const winChrome = path.join(sub, 'chrome-win64', 'chrome.exe');
      for (const candidate of [linuxChrome, linux64Chrome, macChrome, winChrome]) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

function readEnv(): CrawlerConfig {
  const port = parseInt(process.env.CRAWLER_PORT ?? '3004', 10);
  const maxConcurrency = parseInt(process.env.CRAWLER_MAX_CONCURRENCY ?? '4', 10);
  const backgroundConcurrency = parseInt(process.env.CRAWLER_BACKGROUND_CONCURRENCY ?? '2', 10);
  const defaultTimeout = parseInt(process.env.CRAWLER_TIMEOUT ?? '45000', 10);
  const defaultCrawlLimit = parseInt(process.env.CRAWLER_CRAWL_LIMIT ?? '20', 10);
  const defaultCrawlMaxDepth = parseInt(process.env.CRAWLER_CRAWL_MAX_DEPTH ?? '2', 10);
  const jobTtlMs = parseInt(process.env.CRAWLER_JOB_TTL_MS ?? String(30 * 60 * 1000), 10);
  const viewportWidth = parseInt(process.env.CRAWLER_VIEWPORT_WIDTH ?? '1280', 10);
  const viewportHeight = parseInt(process.env.CRAWLER_VIEWPORT_HEIGHT ?? '800', 10);
  const headless = (process.env.CRAWLER_HEADLESS ?? 'true') !== 'false';
  const apiKeys = parseApiKeys();
  const brandName = process.env.CRAWLER_BRAND_NAME || DEFAULT_BRAND_NAME;
  const maxRetries = parseInt(process.env.CRAWLER_MAX_RETRIES ?? '2', 10);
  const retryBaseDelayMs = parseInt(process.env.CRAWLER_RETRY_BASE_DELAY ?? '800', 10);
  const stealth = (process.env.CRAWLER_STEALTH ?? 'true') !== 'false';
  const dismissCookieBanners = (process.env.CRAWLER_DISMISS_COOKIE_BANNERS ?? 'true') !== 'false';

  const blockList = (process.env.CRAWLER_BLOCK_RESOURCES ?? 'media,image,font').split(',');
  const blockResourceTypes: string[] | null = blockList.length > 0 ? blockList : null;

  const userAgent =
    process.env.CRAWLER_USER_AGENT ?? DEFAULT_UA_POOL[0];

  // Allow overriding the UA pool via env (newline-separated).
  const userAgentPool = process.env.CRAWLER_USER_AGENT_POOL
    ? process.env.CRAWLER_USER_AGENT_POOL.split('\n').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_UA_POOL;

  const bundledBrowsersPath = resolveBundledBrowsersPath();

  return {
    port,
    browserExecutablePath: bundledBrowsersPath,
    maxConcurrency,
    backgroundConcurrency,
    defaultTimeout,
    defaultCrawlLimit,
    defaultCrawlMaxDepth,
    jobTtlMs,
    apiKeys,
    brandName,
    userAgent,
    userAgentPool,
    viewportWidth,
    viewportHeight,
    blockResourceTypes,
    headless,
    maxRetries,
    retryBaseDelayMs,
    stealth,
    dismissCookieBanners,
    bundledBrowsersPath,
  };
}

export const config: CrawlerConfig = readEnv();

export const launchOptions: LaunchOptions = {
  headless: config.headless,
  executablePath: config.browserExecutablePath,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-default-apps',
    '--no-first-run',
    '--disable-component-extensions-with-background-pages',
    // Realistic window size for desktop fingerprint.
    `--window-size=${config.viewportWidth},${config.viewportHeight}`,
  ],
};

// Singleton browser instance. Created lazily on first use.
let _browser: Browser | null = null;
let _browserInitPromise: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  // Check if we already have a connected browser.
  if (_browser) {
    try {
      if (_browser.isConnected()) return _browser;
    } catch {
      // isConnected() can throw when the browser is in a bad state.
    }
    // Browser is disconnected — reset and re-launch.
    _browser = null;
    _browserInitPromise = null;
  }
  // If an init is already in progress, await it (but validate afterwards).
  if (_browserInitPromise) {
    try {
      const b = await _browserInitPromise;
      if (b && b.isConnected()) return b;
    } catch {
      // init failed — fall through to re-launch
    }
    _browserInitPromise = null;
  }
  _browserInitPromise = (async () => {
    const browser = await chromium.launch(launchOptions);
    _browser = browser;
    if (config.bundledBrowsersPath) {
      console.log(`[crawler-service] Using bundled browser: ${config.bundledBrowsersPath}`);
    }
    // Clean up on exit so we don't leak the OS process.
    const cleanup = async () => {
      try {
        await browser.close();
      } catch {
        // ignore
      }
      _browser = null;
      _browserInitPromise = null;
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', () => {
      try {
        browser.close();
      } catch {
        // ignore
      }
    });
    // Listen for the browser disconnecting unexpectedly (crash, OOM).
    browser.on('disconnected', () => {
      console.warn('[crawler-service] Browser disconnected unexpectedly — will re-launch on next request');
      _browser = null;
      _browserInitPromise = null;
    });
    return browser;
  })();
  return _browserInitPromise;
}

/** Pick a random user agent from the pool. */
export function pickUserAgent(): string {
  const pool = config.userAgentPool;
  if (!pool || pool.length === 0) return config.userAgent;
  return pool[Math.floor(Math.random() * pool.length)];
}
