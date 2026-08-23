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
  /** Max concurrency for in-flight page renders */
  maxConcurrency: number;
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
  if (_browser && _browser.isConnected()) return _browser;
  if (_browserInitPromise) return _browserInitPromise;
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
