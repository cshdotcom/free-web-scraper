/**
 * Sitemap auto-discovery + recursive sitemap-index following.
 *
 * Firecrawl-style behaviour: when a crawl job runs, the crawler
 * automatically:
 *   1. Fetches `/robots.txt` and reads every `Sitemap:` line (these
 *      are the site operator's declared sitemaps).
 *   2. Tries the common sitemap paths (`/sitemap.xml`,
 *      `/sitemap_index.xml`, `/sitemap-index.xml`, `/news_sitemap.xml`).
 *   3. Scrapes the seed page itself for `<link rel="sitemap">` hints.
 *   4. Recursively follows `<sitemapindex>` entries up to
 *      `sitemapDepth` levels deep (configurable per request, default 3).
 *   5. Deduplicates URLs and returns them in priority order:
 *      sitemap-discovered first, then on-page-discovered.
 *
 * Each sitemap fetch is bounded by `CRAWLER_MAX_BODY_BYTES` (default
 * 50 MB) and a 15-second timeout. Failures are tolerated — a single
 * broken sitemap doesn't break the whole discovery.
 */

import { guardedFetch } from './url-guard';

export interface SitemapEntry {
  url: string;
  title?: string;
  description?: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

export interface SitemapResult {
  entries: SitemapEntry[];
  /** Which sources contributed URLs (for debugging). */
  sources: string[];
  /** Sitemap-index recursion depth actually used. */
  depth: number;
}

/** Default sitemap recursion depth (3 = follow 3 levels of sitemapindex). */
const DEFAULT_SITEMAP_DEPTH = 3;

/** Hard cap on sitemap recursion (prevents infinite loops). */
const MAX_SITEMAP_DEPTH = 10;

/** Cap on entries returned from a single sitemap (memory guard). */
const MAX_ENTRIES_PER_SITEMAP = 100_000;

/** Common sitemap path candidates. */
const COMMON_SITEMAP_PATHS = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/sitemap-index.xml',
  '/sitemap-index.xml',
  '/sitemap-news.xml',
  '/news_sitemap.xml',
  '/sitemap.php',
  '/sitemap.txt',
];

/** Per-host cache (TTL: 1 hour). */
interface SitemapCacheEntry {
  result: SitemapResult;
  expiresAt: number;
}
const cache = new Map<string, SitemapCacheEntry>();
const CACHE_TTL = 60 * 60 * 1000;

/**
 * Discover all sitemap URLs for a given seed URL.
 *
 * @param seedUrl     The starting URL (used to derive the origin).
 * @param userAgent   UA to send when fetching sitemaps.
 * @param opts.depth  Max recursion depth for sitemap-index files
 *                    (default 3, max 10). `0` disables recursion.
 * @param opts.skipRobots When true, skip the robots.txt sitemap discovery.
 */
export async function discoverSitemaps(
  seedUrl: string,
  userAgent: string,
  opts: { depth?: number; skipRobots?: boolean } = {},
): Promise<SitemapResult> {
  const depth = Math.min(Math.max(opts.depth ?? DEFAULT_SITEMAP_DEPTH, 0), MAX_SITEMAP_DEPTH);
  let origin: string;
  let seedParsed: URL;
  try {
    seedParsed = new URL(seedUrl);
    origin = `${seedParsed.protocol}//${seedParsed.host}`;
  } catch {
    return { entries: [], sources: [], depth };
  }

  // Check cache.
  const cacheKey = `${origin}|${depth}|${opts.skipRobots ? '1' : '0'}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const sources: string[] = [];
  const byUrl = new Map<string, SitemapEntry>();
  const visited = new Set<string>();

  /** Add an entry, preserving metadata when already present. */
  const add = (e: SitemapEntry) => {
    if (byUrl.size >= MAX_ENTRIES_PER_SITEMAP) return;
    const existing = byUrl.get(e.url);
    if (existing) {
      if (!existing.title && e.title) existing.title = e.title;
      if (!existing.description && e.description) existing.description = e.description;
      if (!existing.lastmod && e.lastmod) existing.lastmod = e.lastmod;
    } else {
      byUrl.set(e.url, e);
    }
  };

  /** Recursively process a sitemap (URL or sitemapindex). */
  const processSitemap = async (smUrl: string, currentDepth: number): Promise<void> => {
    if (visited.has(smUrl)) return;
    visited.add(smUrl);
    if (currentDepth > depth) return;
    let resp;
    try {
      resp = await guardedFetch(smUrl, { headers: { 'User-Agent': userAgent, Accept: 'application/xml,text/xml,*/*' } });
    } catch { return; }
    if (!resp || resp.status < 200 || resp.status >= 300) return;
    const text = resp.text;
    if (!text) return;

    // Detect sitemapindex vs urlset by tag presence.
    if (/<sitemapindex/i.test(text)) {
      // Sitemap-index: extract <sitemap><loc>...</loc><lastmod>...</lastmod></sitemap>
      const smRegex = /<sitemap>([\s\S]*?)<\/sitemap>/gi;
      let m: RegExpExecArray | null;
      while ((m = smRegex.exec(text)) !== null) {
        const block = m[1];
        const loc = block.match(/<loc>([^<]+)<\/loc>/i);
        if (!loc) continue;
        const childUrl = loc[1].trim();
        sources.push(`sitemapindex[${currentDepth}]: ${childUrl}`);
        await processSitemap(childUrl, currentDepth + 1);
      }
      return;
    }

    // urlset: extract <url> entries.
    const urlRegex = /<url>([\s\S]*?)<\/url>/gi;
    let mu: RegExpExecArray | null;
    while ((mu = urlRegex.exec(text)) !== null) {
      const block = mu[1];
      const loc = block.match(/<loc>([^<]+)<\/loc>/i);
      if (!loc) continue;
      const url = loc[1].trim();
      const titleMatch = block.match(/<\w*:?\s*title>([^<]*)<\/\w*:?\s*title>/i);
      const descMatch = block.match(/<\w*:?\s*description>([^<]*)<\/\w*:?\s*description>/i);
      const newsTitleMatch = block.match(/<news:title>([^<]*)<\/news:title>/i);
      const lastmodMatch = block.match(/<lastmod>([^<]*)<\/lastmod>/i);
      const changefreqMatch = block.match(/<changefreq>([^<]*)<\/changefreq>/i);
      const priorityMatch = block.match(/<priority>([^<]*)<\/priority>/i);
      add({
        url,
        title: (titleMatch?.[1] || newsTitleMatch?.[1] || '').trim() || undefined,
        description: (descMatch?.[1] || '').trim() || undefined,
        lastmod: lastmodMatch?.[1].trim(),
        changefreq: changefreqMatch?.[1].trim(),
        priority: priorityMatch?.[1].trim(),
      });
    }
    // Also handle plain <loc> extraction (sitemap.txt or simple urlset).
    if (byUrl.size === 0) {
      const locMatches = text.match(/<loc>([^<]+)<\/loc>/g) || [];
      for (const lm of locMatches) {
        const u = lm.replace(/<\/?loc>/g, '').trim();
        if (u) add({ url: u });
      }
    }
    sources.push(`urlset[${currentDepth}]: ${smUrl}`);
  };

  // Step 1: robots.txt sitemap declarations.
  if (!opts.skipRobots) {
    let robotsResp;
    try {
      robotsResp = await guardedFetch(`${origin}/robots.txt`, { headers: { 'User-Agent': userAgent } });
    } catch { robotsResp = null; }
    if (robotsResp && robotsResp.status >= 200 && robotsResp.status < 300 && robotsResp.text) {
      const sitemapLines = robotsResp.text.split('\n').filter((l) => /^sitemap:\s*/i.test(l));
      for (const line of sitemapLines) {
        const smUrl = line.replace(/^sitemap:\s*/i, '').trim();
        if (smUrl) {
          sources.push(`robots.txt: ${smUrl}`);
          await processSitemap(smUrl, 0);
        }
      }
    }
  }

  // Step 2: common sitemap paths.
  if (byUrl.size === 0) {
    for (const path of COMMON_SITEMAP_PATHS) {
      const candidate = `${origin}${path}`;
      if (visited.has(candidate)) continue;
      await processSitemap(candidate, 0);
      if (byUrl.size > 0) break; // found one — stop trying alternates
    }
  }

  // Step 3: scrape the seed page for <link rel="sitemap"> hints.
  if (byUrl.size === 0) {
    try {
      const seedResp = await guardedFetch(seedUrl, { headers: { 'User-Agent': userAgent } });
      if (seedResp && seedResp.status >= 200 && seedResp.status < 300 && seedResp.text) {
        const linkRegex = /<link\s+[^>]*?rel\s*=\s*["']sitemap["'][^>]*?href\s*=\s*["']([^"']+)["'][^>]*?>/gi;
        let m: RegExpExecArray | null;
        while ((m = linkRegex.exec(seedResp.text)) !== null) {
          const href = m[1].trim();
          try {
            const abs = new URL(href, seedUrl).toString();
            sources.push(`seed link: ${abs}`);
            await processSitemap(abs, 0);
          } catch { /* ignore relative-url failures */ }
        }
      }
    } catch { /* ignore */ }
  }

  const result: SitemapResult = {
    entries: Array.from(byUrl.values()),
    sources,
    depth,
  };
  cache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL });
  return result;
}

/** Clear the sitemap cache (for tests). */
export function clearSitemapCache(): void {
  cache.clear();
}
