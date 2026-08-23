import { NextRequest } from 'next/server';
import { proxyToCrawler, checkAuth, handleCors } from '@/lib/crawler-proxy';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST(request: NextRequest) {
  const cors = handleCors(request);
  if (cors) return cors;
  const authError = checkAuth(request);
  if (authError) return Response.json({ success: false, error: authError }, { status: 401 });
  const body = await request.text();
  return proxyToCrawler('/v2/scrape/batch', { method: 'POST', body });
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
