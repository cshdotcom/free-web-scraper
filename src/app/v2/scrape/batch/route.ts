import { NextRequest } from 'next/server';
import { checkAuth, handleCors, jsonResponse } from '@/lib/crawler-auth';
import { scrapeUrl } from '@/lib/crawler/crawler';
import { mapWithConcurrency } from '@/lib/crawler/concurrency';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST(request: NextRequest) {
  const cors = handleCors(request);
  if (cors) return cors;
  const authError = checkAuth(request);
  if (authError) return jsonResponse({ success: false, error: authError }, 401);

  let body: any;
  try { body = await request.json(); } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }
  const urls: string[] = body?.urls;
  if (!Array.isArray(urls) || urls.length === 0) {
    return jsonResponse({ success: false, error: 'Missing or empty required field: urls' }, 400);
  }
  if (urls.length > 50) {
    return jsonResponse({ success: false, error: 'Too many URLs (max 50 for sync batch)' }, 400);
  }

  // Cookies support — three forms accepted:
  //   1. cookies: "k=v; k2=v2"                  → same cookie string for ALL urls
  //   2. cookies: [{name,...}, ...]            → same cookie array for ALL urls
  //   3. cookies: ["k1=v1", "k2=v2", ...]      → PER-URL cookie strings, aligned
  //                                            with urls[] by index (string entries
  //                                            are per-URL, array entries are shared)
  //   4. cookies: [[{...}], [{...}], ...]      → PER-URL cookie arrays, aligned
  //                                            with urls[] by index
  // Mixed form (some strings, some arrays) is also supported — when the
  // cookies array's length matches urls.length, each entry is treated as
  // per-URL. Otherwise (single string / single CookieInput[]) it's shared.
  const { urls: _u, cookies, ...scrapeOpts } = body;
  const perUrlCookies = normalizeCookiesForUrls(cookies, urls.length);

  const results = await mapWithConcurrency(urls, 4, (url: string, i: number) => {
    const opts = { ...scrapeOpts, url };
    if (perUrlCookies[i] !== undefined) opts.cookies = perUrlCookies[i];
    return scrapeUrl(opts);
  });
  return jsonResponse({
    success: true,
    data: results.map((r, i) => ({ url: urls[i], success: r.success, data: r.data, error: r.error })),
  });
}

/**
 * Normalize a cookies field for a batch of `nUrls` URLs.
 *
 * Returns an array of length `nUrls` where each entry is either the
 * cookie value to apply to that URL, or `undefined` if no cookie.
 *
 * Accepted input forms:
 *   - undefined / null / empty → array of `undefined`s
 *   - string ("k=v; ...") → array filled with that string (shared)
 *   - CookieInput[] (objects with name/value) → array filled with that array (shared)
 *   - array of length 1 where each entry is a string → shared (the single string)
 *   - array of length === nUrls → per-URL (each entry is a string or CookieInput[])
 *   - array of length === nUrls where all entries are strings → per-URL strings
 *   - array of length === nUrls where entries are arrays of CookieInput → per-URL arrays
 *
 * Edge cases:
 *   - length 0 array → treated as empty (shared undefined)
 *   - length 1 array containing a string → shared (single cookie string for all)
 *   - length 1 array containing a CookieInput[] → shared (single cookie array for all)
 */
function normalizeCookiesForUrls(
  cookies: unknown,
  nUrls: number,
): (string | import('@/lib/crawler/crawler').CookieInput[] | undefined)[] {
  const out: (string | import('@/lib/crawler/crawler').CookieInput[] | undefined)[] =
    new Array(nUrls).fill(undefined);
  if (cookies == null) return out;

  // Single string → shared.
  if (typeof cookies === 'string') {
    if (!cookies.trim()) return out;
    return out.map(() => cookies);
  }
  // Single CookieInput[] (array of objects with name/value) → shared.
  if (Array.isArray(cookies) && cookies.length > 0 && typeof cookies[0] === 'object' && 'name' in (cookies[0] as any)) {
    return out.map(() => cookies as import('@/lib/crawler/crawler').CookieInput[]);
  }
  // Empty array → no cookies for any URL.
  if (Array.isArray(cookies) && cookies.length === 0) return out;

  // Array of length === nUrls → per-URL.
  if (Array.isArray(cookies) && cookies.length === nUrls) {
    for (let i = 0; i < nUrls; i++) {
      const c = cookies[i];
      if (c == null || c === '') { out[i] = undefined; continue; }
      // Per-URL: string entry → that URL's cookie string.
      if (typeof c === 'string') { out[i] = c; continue; }
      // Per-URL: array of CookieInput objects → that URL's cookies.
      if (Array.isArray(c) && c.length > 0 && typeof c[0] === 'object') {
        out[i] = c as import('@/lib/crawler/crawler').CookieInput[];
        continue;
      }
      // Unknown shape — skip.
      out[i] = undefined;
    }
    return out;
  }

  // Array of length 1 → shared (the single cookie applies to all URLs).
  if (Array.isArray(cookies) && cookies.length === 1) {
    const c = cookies[0];
    if (typeof c === 'string' && c.trim()) return out.map(() => c);
    if (Array.isArray(c) && c.length > 0) return out.map(() => c as import('@/lib/crawler/crawler').CookieInput[]);
  }

  // Fallback: ignore malformed cookies.
  return out;
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
