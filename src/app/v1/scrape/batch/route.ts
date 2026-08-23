import { NextRequest } from 'next/server';
import { checkAuth, handleCors, jsonResponse } from '@/lib/crawler-auth';
import { scrapeUrl } from '@/lib/crawler/crawler';
import { mapWithConcurrency } from '@/lib/crawler/concurrency';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

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
  if (urls.length > 50) {
    return jsonResponse({ success: false, error: 'Too many URLs (max 50 for sync batch)' }, 400);
  }
  const { urls: _u, ...scrapeOpts } = body;
  const results = await mapWithConcurrency(urls, 4, (url: string) =>
    scrapeUrl({ ...scrapeOpts, url })
  );
  return jsonResponse({
    success: true,
    data: results.map((r, i) => ({ url: urls[i], success: r.success, data: r.data, error: r.error })),
  });
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
