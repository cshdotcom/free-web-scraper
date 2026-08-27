import { NextRequest } from 'next/server';
import { checkAuth, handleCors, jsonResponse, rewriteJobUrl } from '@/lib/crawler-auth';
import { startBatchJob } from '@/lib/crawler/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  if (urls.length > 100) {
    return jsonResponse({ success: false, error: 'Too many URLs (max 100 per batch)' }, 400);
  }
  const { urls: _u, scrapeOptions, cookies, ...restScrapeOpts } = body;
  const scrapeOpts = { ...(scrapeOptions || {}), ...restScrapeOpts };
  // v1 alias — same per-URL cookie support as /v2/batch/scrape.
  if (cookies != null) {
    const perUrl = normalizeCookiesForUrls(cookies, urls.length);
    if (perUrl.every((c) => c === undefined)) {
      // no cookies
    } else if (perUrl.every((c, _i, arr) => c === arr[0])) {
      (scrapeOpts as any).cookies = perUrl[0];
    } else {
      (scrapeOpts as any).cookiesPerUrl = perUrl;
    }
  }
  const { id, url } = startBatchJob(urls, 'batch', scrapeOpts, 'v2');
  return jsonResponse({ success: true, id, url: rewriteJobUrl(url) });
}

/** Same logic as /v2/batch/scrape/route.ts — kept in sync. */
function normalizeCookiesForUrls(
  cookies: unknown,
  nUrls: number,
): (string | import('@/lib/crawler/crawler').CookieInput[] | undefined)[] {
  const out: (string | import('@/lib/crawler/crawler').CookieInput[] | undefined)[] =
    new Array(nUrls).fill(undefined);
  if (cookies == null) return out;
  if (typeof cookies === 'string') {
    if (!cookies.trim()) return out;
    return out.map(() => cookies);
  }
  if (Array.isArray(cookies) && cookies.length > 0 && typeof cookies[0] === 'object' && 'name' in (cookies[0] as any)) {
    return out.map(() => cookies as import('@/lib/crawler/crawler').CookieInput[]);
  }
  if (Array.isArray(cookies) && cookies.length === 0) return out;
  if (Array.isArray(cookies) && cookies.length === nUrls) {
    for (let i = 0; i < nUrls; i++) {
      const c = cookies[i];
      if (c == null || c === '') { out[i] = undefined; continue; }
      if (typeof c === 'string') { out[i] = c; continue; }
      if (Array.isArray(c) && c.length > 0 && typeof c[0] === 'object') {
        out[i] = c as import('@/lib/crawler/crawler').CookieInput[];
        continue;
      }
      out[i] = undefined;
    }
    return out;
  }
  if (Array.isArray(cookies) && cookies.length === 1) {
    const c = cookies[0];
    if (typeof c === 'string' && c.trim()) return out.map(() => c);
    if (Array.isArray(c) && c.length > 0) return out.map(() => c as import('@/lib/crawler/crawler').CookieInput[]);
  }
  return out;
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
