/**
 * Auth helpers for the NodeByte Crawl API.
 * Since v3.0, the crawler runs IN the Next.js process (no separate port).
 * The API routes at /v2/*, /v1/*, /search call the crawler library directly.
 */

export interface CrawlerConfig {
  requiresAuth: boolean;
  apiKeys: string[];
  publicBaseUrl: string;
}

export function getCrawlerConfig(): CrawlerConfig {
  const csv = process.env.CRAWLER_API_KEYS || '';
  const single = process.env.CRAWLER_API_KEY || '';
  const apiKeys = csv
    ? csv.split(',').map((s) => s.trim()).filter(Boolean)
    : single
      ? [single]
      : [];
  const publicBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.CRAWLER_PUBLIC_URL ||
    'http://localhost:3000';
  return {
    requiresAuth: apiKeys.length > 0,
    apiKeys,
    publicBaseUrl,
  };
}

/** Validate the Authorization / X-API-Key header. Returns null if authorized. */
export function checkAuth(request: Request): string | null {
  const cfg = getCrawlerConfig();
  if (!cfg.requiresAuth) return null;
  const auth = request.headers.get('authorization') || '';
  const xApiKey = request.headers.get('x-api-key') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (cfg.apiKeys.includes(token) || cfg.apiKeys.includes(xApiKey)) return null;
  return 'Unauthorized: invalid or missing API key';
}

/** Rewrite internal job poll URLs to the public app URL. */
export function rewriteJobUrl(url: string): string {
  const cfg = getCrawlerConfig();
  const internalBase = `http://localhost:${process.env.PORT || '3000'}`;
  if (url.startsWith(internalBase)) {
    return cfg.publicBaseUrl + url.slice(internalBase.length);
  }
  return url;
}

/** Standard CORS preflight handler. */
export function handleCors(request: Request): Response | null {
  if (request.method !== 'OPTIONS') return null;
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/** Build a JSON response with CORS headers. */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    },
  });
}
