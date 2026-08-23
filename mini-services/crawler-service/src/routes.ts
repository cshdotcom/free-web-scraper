import { Hono } from 'hono';
import { scrapeUrl, mapUrl, type ScrapeOptions } from './crawler.js';
import { startBatchJob, startCrawlJob, getJob } from './store.js';
import { searchEngines, type SearchResult } from './search.js';
import { config, isValidApiKey } from './config.js';
import { mapWithConcurrency } from './concurrency.js';

export const app = new Hono();

// ---- CORS (Firecrawl SDKs send Origin + Authorization headers) ----
app.use('*', async (c, next) => {
  await next();
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
});

// Handle CORS preflight for every route.
app.options('*', (c) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  return c.body(null, 204);
});

// ---- Auth middleware for /v1/* and /v2/* (multi-API-key) ----
// Accepts the token from either `Authorization: Bearer <token>` or
// `X-API-Key: <token>`. If `config.apiKeys` is empty, auth is disabled
// (open access). Otherwise the token must be present in the list.
for (const version of ['v1', 'v2'] as const) {
  app.use(`/${version}/*`, async (c, next) => {
    if (config.apiKeys.length === 0) return next();
    const authHeader = c.req.header('Authorization') || '';
    const apiKeyHeader = c.req.header('X-API-Key') || '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    const token = bearer || apiKeyHeader;
    if (!token || !isValidApiKey(token)) {
      return c.json({ success: false, error: 'Unauthorized: invalid or missing API key' }, 401);
    }
    await next();
  });
}

// ---- Health check (no auth) ----
app.get('/', (c) => {
  return c.json({
    name: 'nodebyte-crawl',
    version: '2.0.0',
    status: 'ok',
    brandName: config.brandName,
    endpoints: [
      '/v2/scrape',
      '/v2/scrape/batch',
      '/v2/batch/scrape',
      '/v2/crawl',
      '/v2/map',
      '/v2/search',
      '/search (SearxNG-compatible)',
    ],
    documentation: 'https://docs.firecrawl.dev',
    maxConcurrency: config.maxConcurrency,
    stealth: config.stealth,
    maxRetries: config.maxRetries,
    bundledBrowser: Boolean(config.bundledBrowsersPath),
    authEnabled: config.apiKeys.length > 0,
  });
});

// ---- GET /search — SearxNG-compatible JSON endpoint (public, no auth) ----
// Used by OpenWebUI's "SearxNG" search provider. Accepts `q` (query),
// `format=json` (required for JSON output), `pageno` (1-indexed),
// and ignores `categories`.
app.get('/search', async (c) => {
  const q = c.req.query('q') || '';
  const format = c.req.query('format') || '';
  if (format !== 'json') {
    return c.json(
      { error: 'format=json query parameter is required for JSON output' },
      400,
    );
  }
  if (!q.trim()) {
    return c.json({ query: '', number_of_results: 0, results: [] });
  }
  const pageno = Math.max(1, parseInt(c.req.query('pageno') || '1', 10) || 1);
  const perPage = 20;
  // SearxNG uses `categories` for result type; we also accept `language`
  // for locale restriction (e.g. language=en, language=zh).
  const lang = c.req.query('language') || c.req.query('lang') || 'all';
  const { results, engines } = await searchEngines(q, { limit: perPage * pageno, lang });
  // SearxNG-style pagination over the merged results.
  const start = (pageno - 1) * perPage;
  const pageResults = results.slice(start, start + perPage);
  return c.json({
    query: q,
    number_of_results: results.length,
    pageno,
    engines,
    results: pageResults.map((r) => ({
      title: r.title,
      url: r.url,
      content: r.snippet,
      engine: r.engine,
      score: r.score,
    })),
  });
});

// ---- Register v1 + v2 Firecrawl-compatible routes ----
// v2 is the primary advertised version; v1 stays as a backwards-compatible alias.
// Both share the same handler bodies; the only thing that varies is the
// version string used to build the poll URL returned by batch/crawl jobs.
function registerVersionedRoutes(version: 'v1' | 'v2') {
  // ---- POST /{version}/scrape - scrape a single URL ----
  app.post(`/${version}/scrape`, async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }
    const url: string | undefined = body?.url;
    if (!url) {
      return c.json({ success: false, error: 'Missing required field: url' }, 400);
    }
    const opts: ScrapeOptions = {
      url,
      formats: body.formats ?? ['markdown'],
      onlyMainContent: body.onlyMainContent ?? true,
      includeTags: body.includeTags,
      excludeTags: body.excludeTags,
      timeout: body.timeout ?? config.defaultTimeout,
      waitFor: body.waitFor ?? 0,
      removeBase64Images: body.removeBase64Images ?? false,
      userAgent: body.userAgent,
      blockResources: body.blockResources ?? config.blockResourceTypes,
    };

    const result = await scrapeUrl(opts);
    if (!result.success) {
      return c.json({ success: false, error: result.error }, 422);
    }
    return c.json({ success: true, data: result.data });
  });

  // ---- POST /{version}/scrape/batch (synchronous multi-URL scrape) ----
  // Some Firecrawl SDKs support a synchronous batch endpoint that returns the
  // results directly. We expose it as /{version}/scrape/batch for compatibility.
  app.post(`/${version}/scrape/batch`, async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }
    const urls: string[] = body?.urls;
    if (!Array.isArray(urls) || urls.length === 0) {
      return c.json({ success: false, error: 'Missing or empty required field: urls' }, 400);
    }
    if (urls.length > 50) {
      return c.json({ success: false, error: 'Too many URLs (max 50 for sync batch)' }, 400);
    }
    const { urls: _u, ...scrapeOpts } = body;
    const results = await mapWithConcurrency(urls, config.maxConcurrency, (url) =>
      scrapeUrl({ ...(scrapeOpts as any), url }),
    );
    return c.json({
      success: true,
      data: results.map((r, i) => ({ url: urls[i], success: r.success, data: r.data, error: r.error })),
    });
  });

  // ---- POST /{version}/batch/scrape - start an async batch scrape job ----
  app.post(`/${version}/batch/scrape`, async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }
    const urls: string[] = body?.urls;
    if (!Array.isArray(urls) || urls.length === 0) {
      return c.json({ success: false, error: 'Missing or empty required field: urls' }, 400);
    }
    if (urls.length > 100) {
      return c.json({ success: false, error: 'Too many URLs (max 100 per batch)' }, 400);
    }

    // Strip "url" from scrape options before forwarding. Also flatten
    // nested scrapeOptions (the frontend sends it as { scrapeOptions: {...} }).
    const { urls: _u, scrapeOptions, ...restScrapeOpts } = body;
    const scrapeOpts = { ...(scrapeOptions || {}), ...restScrapeOpts };
    const { id, url } = startBatchJob(urls, 'batch', scrapeOpts, version);
    return c.json({ success: true, id, url });
  });

  // ---- GET /{version}/batch/scrape/:id - poll a batch job ----
  app.get(`/${version}/batch/scrape/:id`, (c) => {
    const id = c.req.param('id');
    const job = getJob(id);
    if (!job || job.type !== 'batch') {
      return c.json({ success: false, error: 'Batch job not found' }, 404);
    }
    return c.json({
      success: true,
      status: job.status,
      total: job.total,
      completed: job.completed,
      data: job.data,
      expiresAt: new Date(job.expiresAt).toISOString(),
    });
  });

  // ---- POST /{version}/crawl - start a BFS crawl job ----
  app.post(`/${version}/crawl`, async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }
    const url: string | undefined = body?.url;
    if (!url) {
      return c.json({ success: false, error: 'Missing required field: url' }, 400);
    }
    const limit = Math.min(body.limit ?? config.defaultCrawlLimit, 50);
    const maxDepth = Math.min(body.maxDepth ?? config.defaultCrawlMaxDepth, 5);

    // Strip top-level keys we don't want forwarded to scrapeUrl.
    // The frontend sends scrapeOptions as a nested object; we need to
    // flatten it so formats/onlyMainContent/etc. are at the top level
    // that scrapeUrl() expects.
    const { urls: _u, url: _url, limit: _l, maxDepth: _md, includes, excludes, scrapeOptions, ...restScrapeOpts } = body;
    const scrapeOpts = { ...(scrapeOptions || {}), ...restScrapeOpts };

    const { id, url: pollUrl } = startCrawlJob(
      url,
      {
        maxDepth,
        limit,
        includePatterns: Array.isArray(includes) ? includes : [],
        excludePatterns: Array.isArray(excludes) ? excludes : [],
        scrapeOpts,
      },
      version,
    );
    return c.json({ success: true, id, url: pollUrl });
  });

  // ---- GET /{version}/crawl/:id - poll a crawl job ----
  app.get(`/${version}/crawl/:id`, (c) => {
    const id = c.req.param('id');
    const job = getJob(id);
    if (!job || job.type !== 'crawl') {
      return c.json({ success: false, error: 'Crawl job not found' }, 404);
    }
    return c.json({
      success: true,
      status: job.status,
      total: job.total,
      completed: job.completed,
      data: job.data,
      expiresAt: new Date(job.expiresAt).toISOString(),
      next: job.status === 'scraping' ? `?` : undefined,
    });
  });

  // ---- DELETE /{version}/crawl/:id - cancel a crawl job ----
  app.delete(`/${version}/crawl/:id`, (c) => {
    const id = c.req.param('id');
    const job = getJob(id);
    if (!job) {
      return c.json({ success: false, error: 'Crawl job not found' }, 404);
    }
    if (job.cancel) job.cancel();
    job.status = 'failed';
    return c.json({ success: true, status: 'cancelled' });
  });

  // ---- POST /{version}/map - map a site to a list of URLs ----
  app.post(`/${version}/map`, async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }
    const url: string | undefined = body?.url;
    if (!url) {
      return c.json({ success: false, error: 'Missing required field: url' }, 400);
    }
    const result = await mapUrl(url, {
      search: body.search,
      limit: body.limit ?? 100,
      ignoreSitemap: body.ignoreSitemap ?? false,
      includeSubdomains: body.includeSubdomains ?? false,
    });
    if (!result.success) {
      return c.json({ success: false, error: result.error }, 422);
    }
    return c.json({ success: true, links: result.links });
  });

  // ---- POST /{version}/search - Firecrawl-style multi-engine search ----
  // Body: { query: string, limit?: number, engines?: string[], lang?: string }
  //   lang: ISO language code (e.g. "en", "zh", "ja", "all"). Default "all"
  //   (mixed-language results). Set to a specific code to restrict results.
  // Response: { success, query, total, engines: string[], lang, data: SearchResult[] }
  app.post(`/${version}/search`, async (c) => {
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'Invalid JSON body' }, 400);
    }
    const query: string | undefined = body?.query;
    if (!query || !query.trim()) {
      return c.json({ success: false, error: 'Missing required field: query' }, 400);
    }
    const limit = typeof body.limit === 'number' ? body.limit : 50;
    const engines = Array.isArray(body.engines) ? body.engines : undefined;
    const requestedLang = typeof body.lang === 'string' && body.lang.trim() ? body.lang.trim() : 'all';
    const { results, engines: usedEngines, resolvedLang } = await searchEngines(query, { limit, engines, lang: requestedLang });
    const data: SearchResult[] = results;
    return c.json({
      success: true,
      query,
      total: data.length,
      engines: usedEngines,
      lang: resolvedLang || requestedLang,
      data,
    });
  });
}

registerVersionedRoutes('v1');
registerVersionedRoutes('v2');

// ---- Catch-all 404 ----
app.notFound((c) => c.json({ success: false, error: 'Not Found' }, 404));
app.onError((err, c) => {
  console.error('[crawler-service] unhandled error:', err);
  return c.json({ success: false, error: err.message }, 500);
});
