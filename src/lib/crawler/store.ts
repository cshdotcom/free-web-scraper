import { config } from './config';
import { scrapeUrl, type ScrapeData } from './crawler';

/**
 * In-memory job store for asynchronous crawl/batch scrape jobs.
 *
 * Each job has:
 *  - id (prefixed with crawl_ or batch_)
 *  - status: 'scraping' | 'completed' | 'failed'
 *  - total / completed counters for progress reporting
 *  - data: array of per-URL scrape results as they finish
 *  - errors: array of { url, error } entries for failed scrapes
 *
 * Jobs auto-expire after `jobTtlMs` to bound memory usage.
 */

export type JobType = 'crawl' | 'batch';
export type JobStatus = 'scraping' | 'completed' | 'failed';

export interface JobEntry {
  id: string;
  type: JobType;
  status: JobStatus;
  total: number;
  completed: number;
  data: Array<{ url: string; success: boolean; data?: ScrapeData; error?: string }>;
  /** Per-URL error entries (for the dedicated /errors endpoint). */
  errors: Array<{ url: string; error: string }>;
  createdAt: number;
  expiresAt: number;
  cancel?: () => void;
}

const jobs = new Map<string, JobEntry>();

/** Generate an ID like "crawl_8f3a1b2c" or "batch_8f3a1b2c". */
function makeId(type: JobType): string {
  const rand = Math.random().toString(16).slice(2, 10);
  return `${type}_${rand}`;
}

/** Public base URL used when constructing the poll URL returned to clients. */
function publicBaseUrl(): string {
  return process.env.CRAWLER_PUBLIC_URL || `http://localhost:${config.port}`;
}

/** Create a new crawl/batch job and start processing URLs in the background. */
export function startBatchJob(
  urls: string[],
  type: JobType,
  scrapeOpts: Record<string, unknown>,
  version: 'v1' | 'v2' = 'v1',
  /** Optional per-job concurrency cap (Firecrawl-compatible). */
  maxConcurrencyOverride?: number,
): { id: string; url: string } {
  const id = makeId(type);
  const entry: JobEntry = {
    id,
    type,
    status: 'scraping',
    total: urls.length,
    completed: 0,
    data: [],
    errors: [],
    createdAt: Date.now(),
    expiresAt: Date.now() + config.jobTtlMs,
  };
  jobs.set(id, entry);

  // Kick off the background processing. We don't await here so the
  // request can return immediately with the job ID.
  void (async () => {
    let cancelled = false;
    entry.cancel = () => { cancelled = true; };

    // Background jobs use a SEPARATE, smaller concurrency limit so they
    // don't starve foreground (sync /v2/scrape) requests. Each job still
    // gets a fully isolated BrowserContext — no cookie leakage between
    // concurrent jobs or individual pages within a job.
    // The caller can lower the per-job concurrency via `maxConcurrency`.
    const concurrency = Math.min(
      maxConcurrencyOverride && maxConcurrencyOverride > 0 ? maxConcurrencyOverride : config.backgroundConcurrency,
      config.maxConcurrency,
    );
    let cursor = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (cursor < urls.length && !cancelled) {
        const idx = cursor++;
        const url = urls[idx];
        try {
          const r = await scrapeUrl({ ...(scrapeOpts as any), url });
          entry.data[idx] = { url, success: r.success, data: r.data, error: r.error };
          if (!r.success && r.error) {
            entry.errors.push({ url, error: r.error });
          }
        } catch (e) {
          entry.data[idx] = { url, success: false, error: (e as Error).message };
          entry.errors.push({ url, error: (e as Error).message });
        }
        entry.completed += 1;
      }
    });

    await Promise.all(workers).catch(() => {});
    entry.status = cancelled ? 'failed' : 'completed';
    if (entry.status === 'completed' && entry.data.some((d) => !d?.success) && entry.data.every((d) => d != null)) {
      // Per-URL failures don't make the whole job fail; leave as 'completed'.
    }
  })();

  const pathSegment = type === 'batch' ? 'batch/scrape' : type;
  return { id, url: `${publicBaseUrl()}/${version}/${pathSegment}/${id}` };
}

/**
 * Start a BFS recursive crawl job. Starting from `seedUrl`, the crawler:
 *   1. Scrapes the seed page
 *   2. Extracts all same-domain links (or subdomain links, or external links)
 *   3. Scrapes each discovered link (depth +1)
 *   4. Repeats up to `maxDepth` levels, capped at `limit` total pages
 *
 * The `total` field is updated dynamically as new URLs are discovered.
 *
 * Firecrawl-compatible options:
 *   - allowSubdomains: also follow links to subdomains of the seed host.
 *   - allowExternalLinks: follow external links one hop (their own links
 *     are NOT crawled). External homepages are skipped.
 *   - crawlEntireDomain: explore siblings + parents — covers the whole
 *     domain (paths starting at the seed's host root, not just descendants
 *     of the seed path).
 *   - maxDiscoveryDepth: link-depth cap (replaces maxDepth when set).
 *   - sitemap: 'include' (default) | 'skip' | 'only'.
 *   - delay: seconds between scrapes (forces concurrency=1).
 *   - maxConcurrency: per-job concurrency cap.
 *   - ignoreQueryParameters: strip query strings before dedup.
 */
export function startCrawlJob(
  seedUrl: string,
  opts: {
    maxDepth: number;
    limit: number;
    includePatterns?: string[];
    excludePatterns?: string[];
    scrapeOpts: Record<string, unknown>;
    /** Firecrawl-compatible: 'include' | 'skip' | 'only' */
    sitemap?: 'include' | 'skip' | 'only';
    /** Follow subdomains of the seed host. */
    allowSubdomains?: boolean;
    /** Follow external links one hop. */
    allowExternalLinks?: boolean;
    /** Explore siblings/parents (covers the entire domain). */
    crawlEntireDomain?: boolean;
    /** Match includePaths/excludePatterns against the full URL (with query). */
    regexOnFullURL?: boolean;
    /** Strip query parameters before dedup. */
    ignoreQueryParameters?: boolean;
    /** Seconds between scrapes (forces concurrency=1). */
    delay?: number;
    /** Per-job concurrency cap. */
    maxConcurrency?: number;
  },
  version: 'v1' | 'v2' = 'v1',
): { id: string; url: string } {
  const id = makeId('crawl');
  const entry: JobEntry = {
    id,
    type: 'crawl',
    status: 'scraping',
    total: 1,
    completed: 0,
    data: [],
    errors: [],
    createdAt: Date.now(),
    expiresAt: Date.now() + config.jobTtlMs,
  };
  jobs.set(id, entry);

  void (async () => {
    let cancelled = false;
    entry.cancel = () => { cancelled = true; };

    const visited = new Set<string>();
    const queue: Array<{ url: string; depth: number }> = [{ url: seedUrl, depth: 0 }];
    const seedParsed = (() => { try { return new URL(seedUrl); } catch { return null; } })();

    // Helper: build a "cleaned" URL string for dedup. When
    // ignoreQueryParameters is true, the query is stripped.
    const dedupeKey = (rawUrl: string): string => {
      try {
        const u = new URL(rawUrl);
        if (opts.ignoreQueryParameters) u.search = '';
        return u.toString().replace(/#.*$/, '').replace(/\/$/, '');
      } catch {
        return rawUrl.replace(/#.*$/, '').replace(/\/$/, '');
      }
    };

    const matchesFilters = (rawUrl: string): boolean => {
      let testStr = rawUrl;
      if (!opts.regexOnFullURL) {
        try { testStr = new URL(rawUrl).pathname; } catch { /* keep raw */ }
      }
      if (opts.includePatterns && opts.includePatterns.length > 0) {
        const ok = opts.includePatterns.some((p: string) => {
          try { return new RegExp(p).test(testStr); } catch { return testStr.includes(p); }
        });
        if (!ok) return false;
      }
      if (opts.excludePatterns && opts.excludePatterns.length > 0) {
        const blocked = opts.excludePatterns.some((p: string) => {
          try { return new RegExp(p).test(testStr); } catch { return testStr.includes(p); }
        });
        if (blocked) return false;
      }
      return true;
    };

    // Determine whether a discovered link should be followed based on host.
    const isFollowable = (linkUrl: string): boolean => {
      if (!seedParsed) return false;
      try {
        const u = new URL(linkUrl);
        if (opts.allowExternalLinks) return true; // follow any host
        if (opts.allowSubdomains) {
          return u.hostname === seedParsed.hostname
            || u.hostname.endsWith('.' + seedParsed.hostname);
        }
        return u.hostname === seedParsed.hostname;
      } catch { return false; }
    };

    // Determine whether a discovered link is within the crawl scope (paths).
    const isPathInScope = (linkUrl: string): boolean => {
      if (!seedParsed) return true;
      try {
        const u = new URL(linkUrl);
        if (u.hostname !== seedParsed.hostname) return true; // external handled elsewhere
        if (opts.crawlEntireDomain) return true; // siblings + parents allowed
        // Default: only descendant paths of the seed path.
        const seedPath = seedParsed.pathname.replace(/\/$/, '');
        const linkPath = u.pathname.replace(/\/$/, '');
        if (seedPath === '') return true;
        return linkPath === seedPath || linkPath.startsWith(seedPath + '/');
      } catch { return false; }
    };

    while (queue.length > 0 && !cancelled && entry.data.length < opts.limit) {
      const { url, depth } = queue.shift()!;
      const norm = dedupeKey(url);
      if (visited.has(norm)) continue;
      visited.add(norm);
      // The seed URL is always scraped (it doesn't need to match the
      // include/exclude filters; filters apply to discovered links).
      if (norm !== dedupeKey(seedUrl) && !matchesFilters(url)) continue;

      // Grow the total as we discover new URLs to scrape.
      entry.total = Math.min(visited.size + queue.length, opts.limit);
      // Make sure data array can hold this index.
      const idx = entry.data.length;
      entry.data[idx] = { url, success: false };

      try {
        const r = await scrapeUrl({
          ...(opts.scrapeOpts as any),
          url,
          formats: Array.from(new Set([...(opts.scrapeOpts.formats as string[] || ['markdown']), 'links'])),
        });
        entry.data[idx] = { url, success: r.success, data: r.data, error: r.error };
        if (!r.success && r.error) entry.errors.push({ url, error: r.error });

        // Discover new URLs from the scraped page (if we got links).
        if (r.success && r.data?.links && depth < opts.maxDepth) {
          for (const link of r.data.links) {
            const linkUrl = typeof link === 'string' ? link : link.url;
            const linkNorm = dedupeKey(linkUrl);
            if (visited.has(linkNorm)) continue;
            // Followability + scope check.
            if (!isFollowable(linkUrl)) continue;
            if (!isPathInScope(linkUrl)) continue;
            if (!matchesFilters(linkUrl)) continue;
            if (entry.data.length + queue.length >= opts.limit) break;
            queue.push({ url: linkUrl, depth: depth + 1 });
          }
        }
      } catch (e) {
        entry.data[idx] = { url, success: false, error: (e as Error).message };
        entry.errors.push({ url, error: (e as Error).message });
      }
      entry.completed += 1;
      // Optional inter-request delay (forces polite crawling).
      if (opts.delay && opts.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, opts.delay * 1000));
      }
    }

    // Trim data to the actual scraped count (in case we over-allocated).
    entry.total = entry.data.length;
    entry.status = cancelled ? 'failed' : 'completed';
  })();

  return { id, url: `${publicBaseUrl()}/${version}/crawl/${id}` };
}

/** Look up a job by ID. */
export function getJob(id: string): JobEntry | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  if (Date.now() > job.expiresAt) {
    jobs.delete(id);
    return undefined;
  }
  return job;
}

/** Prune expired jobs - called periodically. */
export function pruneExpiredJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now > job.expiresAt) {
      if (job.cancel) job.cancel();
      jobs.delete(id);
    }
  }
}

// Run prune every minute.
setInterval(pruneExpiredJobs, 60 * 1000).unref?.();
