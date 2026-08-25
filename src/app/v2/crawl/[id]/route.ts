import { NextRequest } from 'next/server';
import { checkAuth, handleCors, jsonResponse } from '@/lib/crawler-auth';
import { getJob } from '@/lib/crawler/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cors = handleCors(request);
  if (cors) return cors;
  const authError = checkAuth(request);
  if (authError) return jsonResponse({ success: false, error: authError }, 401);
  const { id } = await params;
  const job = await getJob(id);
  if (!job || job.type !== 'crawl') {
    return jsonResponse({ success: false, error: 'Crawl job not found' }, 404);
  }
  return jsonResponse({
    success: true,
    status: job.status,
    total: job.total,
    completed: job.completed,
    data: job.data,
    errors: job.errors,
    expiresAt: new Date(job.expiresAt).toISOString(),
  });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cors = handleCors(request);
  if (cors) return cors;
  const authError = checkAuth(request);
  if (authError) return jsonResponse({ success: false, error: authError }, 401);
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return jsonResponse({ success: false, error: 'Crawl job not found' }, 404);
  if (job.cancel) job.cancel();
  job.status = 'failed';
  return jsonResponse({ success: true, status: 'cancelled' });
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
