import { NextRequest } from 'next/server';
import { proxyToCrawler, checkAuth, handleCors } from '@/lib/crawler-proxy';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;


export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cors = handleCors(request); if (cors) return cors;
  const authError = checkAuth(request);
  if (authError) return Response.json({ success: false, error: authError }, { status: 401 });
  const { id } = await params;
  return proxyToCrawler('/v1/crawl/' + encodeURIComponent(id), { method: 'GET' });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const cors = handleCors(request); if (cors) return cors;
  const authError = checkAuth(request);
  if (authError) return Response.json({ success: false, error: authError }, { status: 401 });
  const { id } = await params;
  return proxyToCrawler('/v1/crawl/' + encodeURIComponent(id), { method: 'DELETE' });
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
