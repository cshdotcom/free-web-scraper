import { NextRequest } from 'next/server';
import { checkAuth, handleCors, jsonResponse } from '@/lib/crawler-auth';
import { mapUrl } from '@/lib/crawler/crawler';

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
  if (!body?.url) return jsonResponse({ success: false, error: 'Missing required field: url' }, 400);

  // Firecrawl-compatible sitemap enum: 'include' | 'skip' | 'only'.
  // We also accept legacy `ignoreSitemap: true` (maps to 'skip').
  const sitemapEnum: 'include' | 'skip' | 'only' | undefined =
    body.sitemap === 'include' || body.sitemap === 'skip' || body.sitemap === 'only'
      ? body.sitemap
      : undefined;

  const result = await mapUrl(body.url, {
    search: body.search,
    limit: body.limit,
    // Pass both — the crawler resolves them in priority order.
    ignoreSitemap: body.ignoreSitemap,
    sitemap: sitemapEnum,
    includeSubdomains: body.includeSubdomains ?? body.includeSubdomains ?? false,
  });
  if (!result.success) return jsonResponse({ success: false, error: result.error }, 422);
  return jsonResponse({ success: true, links: result.links });
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
