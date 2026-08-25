import { NextRequest } from 'next/server';
import { checkAuth, handleCors, jsonResponse } from '@/lib/crawler-auth';
import { getJob } from '@/lib/crawler/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /v2/batch/scrape/:id/errors — return per-URL error entries for a
 * batch scrape job. Mirrors Firecrawl's "Get Batch Scrape Errors" endpoint.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cors = handleCors(request);
  if (cors) return cors;
  const authError = checkAuth(request);
  if (authError) return jsonResponse({ success: false, error: authError }, 401);
  const { id } = await params;
  const job = await getJob(id);
  if (!job || job.type !== 'batch') {
    return jsonResponse({ success: false, error: 'Batch job not found' }, 404);
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
