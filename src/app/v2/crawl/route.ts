import { NextRequest } from 'next/server';
import { checkAuth, handleCors, jsonResponse, rewriteJobUrl } from '@/lib/crawler-auth';
import { startCrawlJob } from '@/lib/crawler/store';
import { config } from '@/lib/crawler/config';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const cors = handleCors(request);
  if (cors) return cors;
  const authError = checkAuth(request);
  if (authError) return jsonResponse({ success: false, error: authError }, 401);

  let body: any;
  try { body = await request.json(); } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }
  const url: string | undefined = body?.url;
  if (!url) return jsonResponse({ success: false, error: 'Missing required field: url' }, 400);

  // Firecrawl v2 default limit is 10,000. We cap at config.defaultCrawlLimit
  // (50 by default) unless the request explicitly raises it, to protect RAM.
  // Self-hosting users can raise this via CRAWLER_DEFAULT_CRAWL_LIMIT.
  const requestedLimit = typeof body.limit === 'number' ? body.limit : config.defaultCrawlLimit;
  const limit = Math.min(requestedLimit, 10000);
  // `maxDepth` is our native option; `maxDiscoveryDepth` is Firecrawl's
  // alias. Both accept 1-5. We use whichever is set, defaulting to
  // CRAWLER_CRAWL_MAX_DEPTH.
  const maxDepthRaw = body.maxDepth ?? body.maxDiscoveryDepth ?? config.defaultCrawlMaxDepth;
  const maxDepth = Math.min(maxDepthRaw, 5);

  // includePaths/excludePaths are Firecrawl's aliases for our includes/excludes.
  const includePatterns = Array.isArray(body.includePaths) ? body.includePaths
    : Array.isArray(body.includes) ? body.includes : [];
  const excludePatterns = Array.isArray(body.excludePaths) ? body.excludePaths
    : Array.isArray(body.excludes) ? body.excludes : [];

  // Sitemap handling: 'include' (default) | 'skip' | 'only'.
  // 'include' = sitemap URLs + on-page discovered URLs (auto-discovery
  //   reads /robots.txt Sitemap: lines, common sitemap paths, and
  //   <link rel="sitemap"> hints, then recursively follows sitemap
  //   index files up to `sitemapDepth` levels deep).
  // 'skip' = ignore sitemap entirely; only on-page links are crawled.
  // 'only' = ONLY use sitemap URLs; no on-page link following.
  const sitemap: 'include' | 'skip' | 'only' =
    body.sitemap === 'skip' ? 'skip'
    : body.sitemap === 'only' ? 'only'
    : 'include';
  // Sitemap recursion depth: how deep to follow sitemapindex files.
  // Default 3, max 10. Frontend + API both expose this.
  const sitemapDepth = Math.min(Math.max(typeof body.sitemapDepth === 'number' ? body.sitemapDepth : 3, 0), 10);

  // Explicit sitemap path (URL or relative path). When provided, the
  // crawler fetches this URL and auto-detects:
  //   - XML sitemap (sitemapindex or urlset) → parse as sitemap
  //   - HTML page → extract all <a href> links, using sitemapPath's
  //     directory as the base URL (e.g. https://example.com/path/
  //     resolves ./post-1.html → https://example.com/path/post-1.html)
  // When sitemapPath produces URLs, auto-discovery (robots.txt +
  // common paths) is skipped — the user has explicitly told us
  // where to find URLs.
  const sitemapPath: string | undefined = typeof body.sitemapPath === 'string' && body.sitemapPath.trim()
    ? body.sitemapPath.trim()
    : undefined;

  // Strip out route-level fields so they don't leak into scrapeOpts.
  const {
    urls: _u, url: _url, limit: _l, maxDepth: _md, maxDiscoveryDepth: _mdd,
    includes: _inc, excludes: _exc, includePaths: _ip, excludePaths: _ep,
    sitemapPath: _smPath, sitemapDepth: _smDepth,
    scrapeOptions, ...restScrapeOpts
  } = body;
  const scrapeOpts = { ...(scrapeOptions || {}), ...restScrapeOpts };

  const { id, url: pollUrl } = startCrawlJob(url, {
    maxDepth,
    limit,
    includePatterns,
    excludePatterns,
    scrapeOpts,
    sitemap,
    sitemapDepth,
    sitemapPath,
    allowSubdomains: body.allowSubdomains ?? false,
    allowExternalLinks: body.allowExternalLinks ?? false,
    crawlEntireDomain: body.crawlEntireDomain ?? false,
    regexOnFullURL: body.regexOnFullURL ?? false,
    ignoreQueryParameters: body.ignoreQueryParameters ?? false,
    delay: typeof body.delay === 'number' ? body.delay : undefined,
    maxConcurrency: typeof body.maxConcurrency === 'number' ? body.maxConcurrency : undefined,
    ignoreRobotsTxt: body.ignoreRobotsTxt === true,
  }, 'v2');
  return jsonResponse({ success: true, id, url: rewriteJobUrl(pollUrl) });
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
