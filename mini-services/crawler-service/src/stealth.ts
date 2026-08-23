import type { Page } from 'playwright';
import { config } from './config.js';

/**
 * Stealth & anti-bot evasion utilities.
 *
 * These patches make the headless Chromium look like a real browser to
 * common anti-bot heuristics (Cloudflare, PerimeterX, etc.):
 *   - Remove the `navigator.webdriver` flag
 *   - Spoof `navigator.plugins`, `languages`, `platform`
 *   - Add `window.chrome` stub
 *   - Mask `navigator.permissions` query
 *
 * The `stealthInitScript` is added to every page via `page.addInitScript`
 * so it runs before any page JS executes.
 *
 * `dismissCookieBanners` clicks common accept buttons to get past
 * GDPR/cookie consent walls that hide the real content.
 */

/**
 * The init script. Must be a self-contained string (no imports, no closure).
 * Injected before any page JS runs.
 */
export const STEALTH_INIT_SCRIPT = `
(function() {
  // Remove webdriver flag.
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });

  // Spoof plugins (empty array on real Chrome).
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
    configurable: true,
  });

  // Spoof mimeTypes.
  Object.defineProperty(navigator, 'mimeTypes', {
    get: () => [1, 2, 3, 4],
    configurable: true,
  });

  // Spoof languages to a realistic desktop set.
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
    configurable: true,
  });

  // Add window.chrome stub (real Chrome has this).
  if (!window.chrome) {
    window.chrome = {
      runtime: {},
      loadTimes: function() { return {}; },
      csi: function() { return {}; },
      app: {},
    };
  }

  // Mask permissions query so notifications don't reveal headless.
  const origQuery = window.navigator.permissions && window.navigator.permissions.query;
  if (origQuery) {
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission, onchange: null })
        : origQuery(parameters)
    );
  }

  // WebGL vendor spoofing.
  try {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Inc.';            // UNMASKED_VENDOR_WEBGL
      if (parameter === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
      return getParameter.apply(this, arguments);
    };
  } catch (_) {}

  // Hairline feature check (real Chrome has this).
  try {
    const element = document.createElement('div');
    Object.defineProperty(element, 'childElementCount', { get: () => 1 });
  } catch (_) {}
})();
`;

/**
 * Cookie consent banner selectors commonly used across the web.
 * We try to click the "accept" / "agree" / "ok" button.
 */
const COOKIE_BANNER_SELECTORS = [
  // Common IDs / classes
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

/**
 * Apply stealth init script to a page (must be called BEFORE navigation).
 */
export async function applyStealth(page: Page): Promise<void> {
  if (!config.stealth) return;
  try {
    await page.addInitScript(STEALTH_INIT_SCRIPT);
  } catch {
    // ignore — addInitScript can fail if called after navigation
  }
}

/**
 * Try to dismiss cookie consent banners by clicking common accept buttons.
 * Called after page load. Best-effort: silently fails if no banner is present.
 */
export async function dismissCookieBanners(page: Page): Promise<void> {
  if (!config.dismissCookieBanners) return;
  for (const selector of COOKIE_BANNER_SELECTORS) {
    try {
      // Use a short timeout; skip if not found quickly.
      const el = await page.$(selector);
      if (el) {
        await el.click({ timeout: 1500 });
        // Small delay for the banner to animate away.
        await page.waitForTimeout(400);
        return; // one click is usually enough
      }
    } catch {
      // continue to next selector
    }
  }
}

/**
 * Decide whether a status code / error is retryable.
 * Retryable: 403 (forbidden / anti-bot), 429 (rate limit), 503 (temp),
 * network errors, timeouts.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 403 || status === 429 || status === 503 || status === 502;
}

/**
 * Sleep for n ms.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
