import { NextRequest } from 'next/server';
import { proxyToCrawler, checkAuth, handleCors } from '@/lib/crawler-proxy';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /search — SearxNG-compatible endpoint for OpenWebUI integration.
 *
 * OpenWebUI can be configured to use a SearxNG instance by setting
 * `SEARXNG_API_URL` to point at this service. The expected format is:
 *   GET /search?q=<query>&format=json
 *
 * We proxy to the crawler-service's /search endpoint, which aggregates
 * multiple search engines (Bing, DuckDuckGo, Brave, Mojeek, Startpage)
 * with error tolerance — one engine failing doesn't break the others.
 *
 * Auth: if CRAWLER_API_KEYS is set, the token must be passed as
 * `?key=<token>` (SearxNG/OpenWebUI convention) OR via the standard
 * Authorization/X-API-Key headers.
 */
export async function GET(request: NextRequest) {
  const cors = handleCors(request);
  if (cors) return cors;

  // Auth: accept ?key= OR standard headers (OpenWebUI sends ?key=).
  const cfg = (() => {
    const csv = process.env.CRAWLER_API_KEYS || '';
    const single = process.env.CRAWLER_API_KEY || '';
    return csv ? csv.split(',').map((s) => s.trim()).filter(Boolean)
      : single ? [single] : [];
  })();

  if (cfg.length > 0) {
    const urlKey = request.nextUrl.searchParams.get('key') || '';
    const authHeader = request.headers.get('authorization') || '';
    const xApiKey = request.headers.get('x-api-key') || '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '');
    if (!cfg.includes(urlKey) && !cfg.includes(bearer) && !cfg.includes(xApiKey)) {
      return Response.json(
        { error: 'Unauthorized: invalid or missing API key' },
        { status: 401 },
      );
    }
  }

  // Forward query params to the crawler-service.
  const search = request.nextUrl.search;
  return proxyToCrawler(`/search${search}`, { method: 'GET' });
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
