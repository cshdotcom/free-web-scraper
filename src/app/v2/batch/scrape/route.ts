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
  if (urls.length > 1000) {
    return jsonResponse({ success: false, error: 'Too many URLs (max 1000 per batch)' }, 400);
  }
  // Per-job concurrency cap (Firecrawl `maxConcurrency`). When omitted, the
  // job uses the default background concurrency from config.
  const maxConcurrency = typeof body.maxConcurrency === 'number' && body.maxConcurrency > 0
    ? body.maxConcurrency
    : undefined;
  // Strip route-only fields from scrapeOpts.
  const { urls: _u, scrapeOptions, maxConcurrency: _mc, ...restScrapeOpts } = body;
  const scrapeOpts = { ...(scrapeOptions || {}), ...restScrapeOpts };
  const { id, url } = startBatchJob(urls, 'batch', scrapeOpts, 'v2', maxConcurrency);
  return jsonResponse({ success: true, id, url: rewriteJobUrl(url) });
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
