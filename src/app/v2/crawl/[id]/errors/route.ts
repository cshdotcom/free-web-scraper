import { NextRequest } from 'next/server';
import { checkAuth, handleCors, jsonResponse } from '@/lib/crawler-auth';
import { getJob } from '@/lib/crawler/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /v2/crawl/:id/errors — return per-URL error entries for a crawl job.
 * Mirrors Firecrawl's "Get Crawl Errors" endpoint. Only URLs that the
 * crawler failed to scrape (network errors, timeouts, robots.txt blocks)
 * appear here; successfully scraped pages are in the main crawl response.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cors = handleCors(request);
  if (cors) return cors;
  const authError = checkAuth(request);
  if (authError) return jsonResponse({ success: false, error: authError }, 401);
  const { id } = await params;
  const job = getJob(id);
  if (!job || job.type !== 'crawl') {
    return jsonResponse({ success: false, error: 'Crawl job not found' }, 404);
  }
  return jsonResponse({
    success: true,
    status: job.status,
    total: job.errors.length,
    data: job.errors,
    expiresAt: new Date(job.expiresAt).toISOString(),
  });
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
