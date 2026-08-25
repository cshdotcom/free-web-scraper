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
  if (!job || job.type !== 'batch') {
    return jsonResponse({ success: false, error: 'Batch job not found' }, 404);
  }
  return jsonResponse({
    success: true,
    status: job.status,
    total: job.total,
    completed: job.completed,
    data: job.data,
    expiresAt: new Date(job.expiresAt).toISOString(),
  });
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
