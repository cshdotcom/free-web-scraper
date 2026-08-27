import { NextRequest } from 'next/server';
import { checkAuth, handleCors, jsonResponse, rewriteJobUrl } from '@/lib/crawler-auth';
import { startCrawlJob } from '@/lib/crawler/store';
import { config } from '@/lib/crawler/config';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const cors = handleCors(request);
  if (cors) return cors;
  const authError = checkAuth(request);
  if (authError) return jsonResponse({ success: false, error: authError }, 401);

  let body: any;
  try { body = await request.json(); } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }
  const url: string | undefined = body?.url;
  if (!url) return jsonResponse({ success: false, error: 'Missing required field: url' }, 400);
  const limit = Math.min(body.limit ?? config.defaultCrawlLimit, 50);
  const maxDepth = Math.min(body.maxDepth ?? config.defaultCrawlMaxDepth, 5);
  // v1 alias — same sitemap options as /v2/crawl.
  const sitemap: 'include' | 'skip' | 'only' =
    body.sitemap === 'skip' ? 'skip'
    : body.sitemap === 'only' ? 'only'
    : 'include';
  const sitemapDepth = Math.min(Math.max(typeof body.sitemapDepth === 'number' ? body.sitemapDepth : 5, 0), 10);
  const sitemapLimit = Math.max(typeof body.sitemapLimit === 'number' ? body.sitemapLimit : 0, 0);
  const sitemapPath: string | undefined = typeof body.sitemapPath === 'string' && body.sitemapPath.trim()
    ? body.sitemapPath.trim()
    : undefined;
  const {
    urls: _u, url: _url, limit: _l, maxDepth: _md, includes, excludes,
    sitemap: _sm, sitemapDepth: _smD, sitemapLimit: _smL, sitemapPath: _smP,
    scrapeOptions, ...restScrapeOpts
  } = body;
  const scrapeOpts = { ...(scrapeOptions || {}), ...restScrapeOpts };
  const { id, url: pollUrl } = startCrawlJob(url, {
    maxDepth, limit,
    includePatterns: Array.isArray(includes) ? includes : [],
    excludePatterns: Array.isArray(excludes) ? excludes : [],
    scrapeOpts,
    sitemap,
    sitemapDepth,
    sitemapLimit,
    sitemapPath,
  }, 'v2');
  return jsonResponse({ success: true, id, url: rewriteJobUrl(pollUrl) });
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}

