import { NextRequest } from 'next/server';
import { checkAuth, handleCors, jsonResponse } from '@/lib/crawler-auth';
import { scrapeUrl } from '@/lib/crawler/crawler';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const cors = handleCors(request);
  if (cors) return cors;
  const authError = checkAuth(request);
  if (authError) return jsonResponse({ success: false, error: authError }, 401);

  let body: any;
  try { body = await request.json(); } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }
  if (!body?.url) return jsonResponse({ success: false, error: 'Missing required field: url' }, 400);

  const result = await scrapeUrl({
    url: body.url,
    formats: body.formats ?? ['markdown'],
    onlyMainContent: body.onlyMainContent ?? true,
    includeTags: body.includeTags,
    excludeTags: body.excludeTags,
    timeout: body.timeout,
    waitFor: body.waitFor,
    removeBase64Images: body.removeBase64Images,
    maxRetries: body.maxRetries,
    waitForSelector: body.waitForSelector,
  });
  // Firecrawl-compatible: always return 200 with success: true/false in the
  // JSON body. See /v2/scrape for rationale.
  return jsonResponse(result, 200);
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
