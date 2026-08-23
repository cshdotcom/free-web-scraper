/**
 * Proxy + auth helpers for the NodeByte Crawl Next.js app.
 *
 * The Next.js /v2/* and /v1/* route handlers are thin proxies that forward
 * to the internal crawler-service (default http://localhost:3004).
 */

/** Base URL of the crawler service (no trailing slash). */
export function crawlerBaseUrl(): string {
  return (
    process.env.CRAWLER_SERVICE_URL ||
    `http://localhost:${process.env.CRAWLER_PORT || '3004'}`
  );
}

export interface CrawlerConfig {
  /** Whether API key auth is required (mirrors the crawler service). */
  requiresAuth: boolean;
  /** The list of accepted API keys (mirrors the crawler service). */
  apiKeys: string[];
  /** Public base URL advertised in job poll URLs. */
  publicBaseUrl: string;
}

export function getCrawlerConfig(): CrawlerConfig {
  // Read the same env vars the crawler-service reads, so the Next.js
  // proxy can validate the token before forwarding.
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

/**
 * Validate the Authorization / X-API-Key header against the configured keys.
 * Returns null if authorized, or an error string if not.
 */
export function checkAuth(request: Request): string | null {
  const cfg = getCrawlerConfig();
  if (!cfg.requiresAuth) return null;

  const auth = request.headers.get('authorization') || '';
  const xApiKey = request.headers.get('x-api-key') || '';
  const token = auth.replace(/^Bearer\s+/i, '');

  if (cfg.apiKeys.includes(token) || cfg.apiKeys.includes(xApiKey)) return null;
  return 'Unauthorized: invalid or missing API key';
}

/**
 * Forward a request to the crawler service, preserving method, body,
 * and relevant headers. Returns the crawler's response untouched.
 */
export async function proxyToCrawler(
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Promise<Response> {
  const url = crawlerBaseUrl() + path;
  const upstream = await fetch(url, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    body: init.body,
    redirect: 'manual',
  });

  const headers = new Headers(upstream.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

  const contentType = upstream.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const json = await upstream.json();
    rewriteJobUrls(json);
    return new Response(JSON.stringify(json), {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function rewriteJobUrls(obj: unknown): void {
  if (!obj || typeof obj !== 'object') return;
  const cfg = getCrawlerConfig();
  const internalBase = crawlerBaseUrl();

  const rewrite = (val: string): string => {
    if (typeof val !== 'string') return val;
    if (val.startsWith(internalBase)) {
      return cfg.publicBaseUrl + val.slice(internalBase.length);
    }
    return val;
  };

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string') obj[i] = rewrite(obj[i] as string);
      else rewriteJobUrls(obj[i]);
    }
    return;
  }

  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const v = record[key];
    if (key === 'url' && typeof v === 'string') {
      record[key] = rewrite(v);
    } else if (typeof v === 'object') {
      rewriteJobUrls(v);
    }
  }
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
