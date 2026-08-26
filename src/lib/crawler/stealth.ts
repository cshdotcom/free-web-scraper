import type { Page, BrowserContext } from 'playwright';
import { config } from './config';

/**
 * Comprehensive stealth & anti-bot evasion.
 *
 * Inspired by puppeteer-extra-plugin-stealth, playwright-stealth, and
 * the crawler- rust project's fingerprint evasion techniques.
 *
 * Layers:
 *   1. navigator.webdriver → undefined
 *   2. navigator.plugins → realistic Chrome plugin array (with names)
 *   3. navigator.languages → match the request locale
 *   4. navigator.platform → match UA OS
 *   5. navigator.permissions → spoofed query responses
 *   6. window.chrome → full stub with runtime, loadTimes, csi, app
 *   7. WebGL vendor/renderer → Intel (common, non-headless)
 *   8. navigator.hardwareConcurrency → 8 (common desktop)
 *   9. navigator.deviceMemory → 8 (common desktop)
 *  10. navigator.connection → realistic NetworkInformation
 *  11. screen dimensions → match viewport
 *  12. navigator.userAgent → override to match HTTP header
 *  13. navigator.userAgentData → Chrome's Client Hints API
 *  14. Canvas fingerprint → add noise to toDataURL/getImageData
 *  15. AudioContext fingerprint → add noise to getChannelData
 *  16. iframe contentWindow.navigator → consistent with top-level
 *  17. Chrome devtools protocol detection → block
 *  18. Permissions API → return 'denied' for notifications
 *  19. Referer header → set to the page's own URL (realistic)
 *  20. Cloudflare challenge detection → wait for JS challenge to resolve
 */

/** Random integer in range [min, max]. */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Pick a random element from an array. */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Realistic Chrome plugin names (from real Chrome installs). */
const PLUGIN_NAMES = [
  'PDF Viewer',
  'Chrome PDF Viewer',
  'Chromium PDF Viewer',
  'Microsoft Edge PDF Viewer',
  'WebKit built-in PDF',
];

/** Realistic MIME types. */
const MIME_TYPES = [
  { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
  { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
];

/**
 * The comprehensive stealth init script.
 * Must be a self-contained string — no imports, no closure over Node.js
 * variables. All values are inlined.
 *
 * @param userAgent The branded UA string (or empty to skip UA override).
 * @param locale    The browser locale (e.g. 'en-US' or 'zh-CN').
 * @param platform  The platform string (e.g. 'Win32' or 'Linux x86_64').
 * @param screenWidth  Screen width for screen object.
 * @param screenHeight Screen height for screen object.
 */
export function buildStealthScript(
  userAgent: string,
  locale: string,
  platform: string,
  screenWidth: number,
  screenHeight: number,
): string {
  const ua = userAgent;
  const lang = locale;
  const plat = platform;
  const sw = screenWidth;
  const sh = screenHeight;
  const hwConcurrency = pick([4, 8, 12, 16]);
  const deviceMemory = pick([4, 8, 16]);

  return `
(function() {
  'use strict';

  // ---- 1. navigator.webdriver ----
  try {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });
  } catch (e) {}

  // ---- 2. navigator.plugins (realistic Chrome set) ----
  try {
    const pluginData = [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
      { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    ];
    const pluginArray = pluginData.map(p => {
      const plugin = Object.create(Plugin.prototype);
      Object.defineProperties(plugin, {
        name: { value: p.name },
        filename: { value: p.filename },
        description: { value: p.description },
        length: { value: 1 },
      });
      return plugin;
    });
    Object.defineProperty(navigator, 'plugins', {
      get: () => pluginArray,
      configurable: true,
    });
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => [{
        type: 'application/pdf',
        suffixes: 'pdf',
        description: 'Portable Document Format',
        enabledPlugin: pluginArray[0],
      }],
      configurable: true,
    });
  } catch (e) {}

  // ---- 3. navigator.languages ----
  try {
    Object.defineProperty(navigator, 'languages', {
      get: () => ${JSON.stringify([lang.split('-')[0] + '-' + (lang.split('-')[1] || ''), lang.split('-')[0]])},
      configurable: true,
    });
  } catch (e) {}

  // ---- 4. navigator.platform ----
  try {
    Object.defineProperty(navigator, 'platform', {
      get: () => ${JSON.stringify(plat)},
      configurable: true,
    });
  } catch (e) {}

  // ---- 5. navigator.hardwareConcurrency ----
  try {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => ${hwConcurrency},
      configurable: true,
    });
  } catch (e) {}

  // ---- 6. navigator.deviceMemory ----
  try {
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => ${deviceMemory},
      configurable: true,
    });
  } catch (e) {}

  // ---- 7. window.chrome (full stub) ----
  if (!window.chrome) {
    window.chrome = {};
  }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', UPDATE: 'update', },
      OnRestartReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic', },
      PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64', },
      PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win', },
      RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available', },
      connect: () => {},
      sendMessage: () => {},
    };
  }
  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = function() {
      return {
        commitLoadTime: Date.now() / 1000 - randInt(1, 30),
        connectionInfo: 'h2',
        finishDocumentLoadTime: Date.now() / 1000 - randInt(0, 5),
        finishLoadTime: Date.now() / 1000 - randInt(0, 3),
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000 - randInt(0, 5),
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: Date.now() / 1000 - randInt(30, 60),
        startLoadTime: Date.now() / 1000 - randInt(30, 60),
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
      };
    };
  }
  if (!window.chrome.csi) {
    window.chrome.csi = function() {
      return { startE: Date.now() - randInt(100, 5000), onloadT: Date.now() - randInt(0, 2000), pageT: Date.now() - randInt(0, 5000), tran: randInt(1, 20) };
    };
  }
  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed', },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running', },
      getDetails: () => null,
      getIsInstalled: () => false,
      runningState: () => 'cannot_run',
    };
  }

  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

  // ---- 8. navigator.permissions ----
  try {
    const origQuery = navigator.permissions.query;
    navigator.permissions.query = (parameters) => {
      if (parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission, onchange: null });
      }
      return origQuery.call(navigator.permissions, parameters);
    };
  } catch (e) {}

  // ---- 9. WebGL vendor/renderer spoofing ----
  try {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Inc.';             // UNMASKED_VENDOR_WEBGL
      if (parameter === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
      if (parameter === 7936) return 'Intel Inc.';              // VENDOR
      if (parameter === 7937) return 'Intel Iris OpenGL Engine'; // RENDERER
      return getParameter.apply(this, arguments);
    };
  } catch (e) {}
  try {
    const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter2.apply(this, arguments);
    };
  } catch (e) {}

  // ---- 10. Screen dimensions ----
  try {
    Object.defineProperty(screen, 'width', { get: () => ${sw}, configurable: true });
    Object.defineProperty(screen, 'height', { get: () => ${sh}, configurable: true });
    Object.defineProperty(screen, 'availWidth', { get: () => ${sw}, configurable: true });
    Object.defineProperty(screen, 'availHeight', { get: () => ${sh} - 40, configurable: true });
    Object.defineProperty(screen, 'colorDepth', { get: () => 24, configurable: true });
    Object.defineProperty(screen, 'pixelDepth', { get: () => 24, configurable: true });
  } catch (e) {}

  // ---- 11. navigator.userAgent override ----
  ${ua ? `
  try {
    Object.defineProperty(navigator, 'userAgent', {
      get: () => ${JSON.stringify(ua)},
      configurable: true,
    });
  } catch (e) {}` : ''}

  // ---- 12. navigator.userAgentData (Chrome Client Hints) ----
  try {
    if (!navigator.userAgentData) {
      const uaData = {
        brands: [
          { brand: 'Chromium', version: '131' },
          { brand: 'Google Chrome', version: '131' },
          { brand: 'Not;A=Brand', version: '24' },
        ],
        mobile: false,
        platform: ${JSON.stringify(plat.includes('Win') ? 'Windows' : plat.includes('Mac') ? 'macOS' : plat.includes('Linux') ? 'Linux' : 'Windows')},
        getHighEntropyValues: (hints) => Promise.resolve({
          architecture: 'x86',
          bitness: '64',
          brands: uaData.brands,
          mobile: false,
          model: '',
          platform: uaData.platform,
          platformVersion: '15.0.0',
          uaFullVersion: '131.0.6778.87',
          fullVersionList: [
            { brand: 'Chromium', version: '131.0.6778.87' },
            { brand: 'Google Chrome', version: '131.0.6778.87' },
          ],
        }),
      };
      Object.defineProperty(navigator, 'userAgentData', {
        get: () => uaData,
        configurable: true,
      });
    }
  } catch (e) {}

  // ---- 13. Canvas fingerprint noise ----
  try {
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function() {
      const context = this.getContext('2d');
      if (context && this.width > 0 && this.height > 0) {
        // Add a tiny, imperceptible noise pixel.
        const imageData = context.getImageData(0, 0, Math.min(this.width, 2), Math.min(this.height, 2));
        imageData.data[0] = (imageData.data[0] + randInt(-1, 1)) & 0xff;
        context.putImageData(imageData, 0, 0);
      }
      return origToDataURL.apply(this, arguments);
    };
  } catch (e) {}

  // ---- 14. AudioContext fingerprint noise ----
  try {
    const origGetChannelData = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function() {
      const result = origGetChannelData.apply(this, arguments);
      // Add subtle noise to the first sample.
      if (result.length > 0) {
        result[0] = result[0] + (Math.random() - 0.5) * 1e-7;
      }
      return result;
    };
  } catch (e) {}

  // ---- 15. iframe contentWindow.navigator consistency ----
  try {
    // Override the iframe navigator to be consistent with the top-level.
    const origContentWindow = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    if (origContentWindow) {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get: function() {
          const win = origContentWindow.get.call(this);
          if (win) {
            try {
              Object.defineProperty(win.navigator, 'webdriver', { get: () => undefined, configurable: true });
            } catch (e) {}
          }
          return win;
        },
        configurable: true,
      });
    }
  } catch (e) {}

  // ---- 16. Navigator.doNotTrack ----
  try {
    Object.defineProperty(navigator, 'doNotTrack', {
      get: () => '1',
      configurable: true,
    });
  } catch (e) {}

  // ---- 17. navigator.maxTouchPoints ----
  try {
    Object.defineProperty(navigator, 'maxTouchPoints', {
      get: () => 0,
      configurable: true,
    });
  } catch (e) {}

  // ---- 18. navigator.vendor ----
  try {
    Object.defineProperty(navigator, 'vendor', {
      get: () => 'Google Inc.',
      configurable: true,
    });
  } catch (e) {}

  // ---- 19. navigator.productSub ----
  try {
    Object.defineProperty(navigator, 'productSub', {
      get: () => '20030107',
      configurable: true,
    });
  } catch (e) {}

  // ---- 20. Hide automation in toString ----
  try {
    // Override Function.prototype.toString to hide our modifications.
    const nativeToString = Function.prototype.toString;
    const overrides = new Set();
    Function.prototype.toString = function() {
      if (overrides.has(this)) return nativeToString.call(navigator.webdriver);
      return nativeToString.call(this);
    };
    overrides.add(Function.prototype.toString);
  } catch (e) {}

})();
`;
}

// ============================================================
// Helper functions (outside the init script)
// ============================================================

/** Cookie consent banner selectors commonly used across the web. */
const COOKIE_BANNER_SELECTORS = [
  '#onetrust-accept-btn-handler',
  '#onetrust-button-group #accept-recommended-btn',
  '.onetrust-banner-btn',
  '#cookie-accept-all',
  '.cookie-accept-all',
  '#accept-cookies',
  '.accept-cookies',
  '[data-action="accept-cookies"]',
  '[aria-label="accept cookies"]',
  '[aria-label="Accept cookies"]',
  'button[id*="accept" i]',
  'button[class*="accept" i]',
  'button:has-text("Accept all")',
  'button:has-text("Accept All")',
  'button:has-text("Accept")',
  'button:has-text("I agree")',
  'button:has-text("Agree")',
  'button:has-text("Got it")',
  'button:has-text("OK")',
  'button:has-text("Allow all")',
  'button:has-text("Allow All")',
  '[class*="consent"] button:first-of-type',
  '[id*="consent"] button:first-of-type',
];

/** Cloudflare challenge page detection markers. */
const CF_CHALLENGE_MARKERS = [
  'cf-challenge',
  'Just a moment...',
  'Checking your browser before accessing',
  'cf-mitigated',
  'challenge-platform',
  'turnstile',
  '__cf_bm',
  'cf-turnstile',
  'ray id',
];

/** Detect whether the current page is a Cloudflare challenge page. */
export function isCloudflareChallenge(html: string): boolean {
  const lower = html.toLowerCase();
  return CF_CHALLENGE_MARKERS.some(m => lower.includes(m.toLowerCase()));
}

/** Wait for a Cloudflare challenge to resolve (up to maxWaitMs). */
export async function waitForCloudflareChallenge(page: Page, maxWaitMs: number = 30000): Promise<boolean> {
  const start = Date.now();
  let lastTitle = await page.title().catch(() => '');
  let lastBodyLen = await page.evaluate(() => document.body?.innerHTML?.length || 0).catch(() => 0);

  while (Date.now() - start < maxWaitMs) {
    await page.waitForTimeout(2000);
    const currentTitle = await page.title().catch(() => '');
    const currentBodyLen = await page.evaluate(() => document.body?.innerHTML?.length || 0).catch(() => 0);
    const currentUrl = page.url();

    if (currentTitle !== lastTitle || currentBodyLen > lastBodyLen * 2 || currentUrl !== page.url()) {
      const newHtml = await page.content().catch(() => '');
      if (!isCloudflareChallenge(newHtml)) {
        return true;
      }
    }
    lastTitle = currentTitle;
    lastBodyLen = currentBodyLen;
  }
  return false;
}

/** Derive platform string from UA. */
function platformFromUA(ua: string): string {
  if (ua.includes('Windows')) return 'Win32';
  if (ua.includes('Macintosh')) return 'MacIntel';
  if (ua.includes('Linux')) return 'Linux x86_64';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iPhone';
  if (ua.includes('Android')) return 'Linux armv8l';
  return 'Win32';
}

/** Derive locale from UA or location config. */
function localeFromUA(ua: string, location?: { country?: string; languages?: string[] }): string {
  if (location?.languages?.[0]) return location.languages[0];
  if (ua.includes('zh')) return 'zh-CN';
  if (ua.includes('ja')) return 'ja-JP';
  if (ua.includes('ko')) return 'ko-KR';
  if (ua.includes('ru')) return 'ru-RU';
  return 'en-US';
}

/** Apply comprehensive stealth init script to a page (before navigation). */
export async function applyStealth(
  page: Page,
  userAgent?: string,
  opts?: { location?: { country?: string; languages?: string[] }; viewport?: { width: number; height: number } },
): Promise<void> {
  if (!config.stealth) return;
  try {
    const ua = userAgent || '';
    const locale = localeFromUA(ua, opts?.location);
    const platform = platformFromUA(ua);
    const sw = opts?.viewport?.width || 1920;
    const sh = opts?.viewport?.height || 1080;
    const script = buildStealthScript(ua, locale, platform, sw, sh);
    await page.addInitScript(script);
  } catch {
    // ignore — addInitScript can fail if called after navigation
  }
}

/** Try to dismiss cookie consent banners. */
export async function dismissCookieBanners(page: Page): Promise<void> {
  if (!config.dismissCookieBanners) return;
  for (const selector of COOKIE_BANNER_SELECTORS) {
    try {
      const el = await page.$(selector);
      if (el) {
        await el.click({ timeout: 1500 });
        await page.waitForTimeout(400);
        return;
      }
    } catch {
      // continue to next selector
    }
  }
}

/** Decide whether a status code / error is retryable. */
export function isRetryableStatus(status: number): boolean {
  return status === 403 || status === 429 || status === 503 || status === 502;
}

/** Sleep for n ms. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
