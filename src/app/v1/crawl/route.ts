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
  const { urls: _u, url: _url, limit: _l, maxDepth: _md, includes, excludes, scrapeOptions, ...restScrapeOpts } = body;
  const scrapeOpts = { ...(scrapeOptions || {}), ...restScrapeOpts };
  const { id, url: pollUrl } = startCrawlJob(url, {
    maxDepth, limit,
    includePatterns: Array.isArray(includes) ? includes : [],
    excludePatterns: Array.isArray(excludes) ? excludes : [],
    scrapeOpts,
  }, 'v2');
  return jsonResponse({ success: true, id, url: rewriteJobUrl(pollUrl) });
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
