import { config } from './config';
import { scrapeUrl, type ScrapeData } from './crawler';
import { discoverSitemaps } from './sitemap';

/**
 * Hybrid job store for asynchronous crawl/batch scrape jobs.
 *
 * Primary backend: MySQL via Prisma (`@/lib/db`). When `DATABASE_URL` is
 * configured and points at a reachable MySQL instance, all job state is
 * persisted there — jobs survive server restarts and are visible from
 * any worker process.
 *
 * Fallback: in-memory `Map` when the database is unavailable (e.g. dev
 * mode without a MySQL server, or prisma client not yet generated).
 * The in-memory backend loses state on restart but is API-compatible.
 *
 * Each job has:
 *  - id (prefixed with crawl_ or batch_)
 *  - status: 'scraping' | 'completed' | 'failed'
 *  - total / completed counters for progress reporting
 *  - data: array of per-URL scrape results as they finish
 *  - errors: array of { url, error } entries for failed scrapes
 *
 * Jobs auto-expire after `jobTtlMs` to bound storage usage.
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

// ============================================================
// Storage backend selection
// ============================================================

/**
 * Try to import the Prisma client lazily. We don't `import` it at the
 * top of the file because that would force every consumer of `store.ts`
 * to also load `@prisma/client` — which fails loudly if `prisma
 * generate` hasn't been run yet. Lazy require with a try/catch lets us
 * gracefully fall back to the in-memory store when the DB layer isn't
 * ready.
 */
let dbClient: any | null = null;
let dbBackendAvailable = false;
let dbCheckDone = false;

async function getDb(): Promise<any | null> {
  if (dbCheckDone) return dbBackendAvailable ? dbClient : null;
  dbCheckDone = true;
  // Skip when no DATABASE_URL is configured (open access / dev mode).
  const url = process.env.DATABASE_URL || '';
  if (!url || url.startsWith('file:')) {
    // SQLite file URL is also acceptable — but the production schema is
    // mysql. We treat any non-mysql URL as "not available" so the
    // in-memory fallback kicks in.
    if (!url.startsWith('mysql://') && !url.startsWith('mysql+')) {
      return null;
    }
  }
  try {
    // Dynamic import so `bun install` doesn't choke if @prisma/client
    // hasn't been generated yet.
    const mod = await import('@/lib/db');
    dbClient = (mod as any).db;
    // Verify the client can actually talk to the database by running a
    // trivial query. If this throws, fall back to in-memory.
    await dbClient.$queryRaw`SELECT 1`;
    dbBackendAvailable = true;
    console.log('[store] MySQL backend connected — jobs will persist across restarts');
    return dbClient;
  } catch (e) {
    console.warn(`[store] MySQL backend unavailable, falling back to in-memory store:`, (e as Error).message?.slice(0, 120));
    dbBackendAvailable = false;
    return null;
  }
}

// Kick off the backend probe in the background so the first request
// doesn't pay the full connection cost.
void getDb();

// In-memory fallback (always present, used when DB is unavailable).
const memJobs = new Map<string, JobEntry>();

/** Generate an ID like "crawl_8f3a1b2c" or "batch_8f3a1b2c". */
function makeId(type: JobType): string {
  const rand = Math.random().toString(16).slice(2, 10);
  return `${type}_${rand}`;
}

/** Public base URL used when constructing the poll URL returned to clients. */
function publicBaseUrl(): string {
  return process.env.CRAWLER_PUBLIC_URL || `http://localhost:${config.port}`;
}

// ============================================================
// DB <-> JobEntry marshalling
// ============================================================

function rowToEntry(row: any): JobEntry {
  let data: JobEntry['data'] = [];
  let errors: JobEntry['errors'] = [];
  try {
    if (row.data) data = JSON.parse(row.data);
  } catch { /* keep empty */ }
  try {
    if (row.errors) errors = JSON.parse(row.errors);
    else if (row.error) errors = [{ url: '(job)', error: row.error }];
  } catch { /* keep empty */ }
  return {
    id: row.id,
    type: row.type as JobType,
    status: row.status as JobStatus,
    total: row.total ?? 0,
    completed: row.completed ?? 0,
    data,
    errors,
    createdAt: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
    expiresAt: row.expiresAt ? new Date(row.expiresAt).getTime() : Date.now() + config.jobTtlMs,
  };
}

async function readJobFromDb(id: string): Promise<JobEntry | undefined> {
  const db = await getDb();
  if (!db) return memJobs.get(id);
  try {
    const row = await db.job.findUnique({ where: { id } });
    if (!row) return undefined;
    const entry = rowToEntry(row);
    if (Date.now() > entry.expiresAt) {
      // Expired — delete and return undefined.
      await db.job.delete({ where: { id } }).catch(() => {});
      return undefined;
    }
    return entry;
  } catch {
    return memJobs.get(id);
  }
}

async function writeJobToDb(entry: JobEntry): Promise<void> {
  // Always keep the in-memory copy in sync (so cancel() works even
  // when the DB is the primary source of truth).
  memJobs.set(entry.id, entry);
  const db = await getDb();
  if (!db) return;
  try {
    // Serialize the data — cap at 4 MB to avoid MySQL max_allowed_packet
    // issues. If the data is too large, we store a truncated version
    // with a warning marker.
    let dataJson = JSON.stringify(entry.data);
    if (dataJson.length > 4 * 1024 * 1024) {
      // Truncate: keep the first 2 MB of data + a truncation marker.
      const truncated = entry.data.slice(0, 20);
      truncated.push({ url: '__TRUNCATED__', success: false, error: `Data truncated (${entry.data.length - 20} more entries not persisted due to size limit)` } as any);
      dataJson = JSON.stringify(truncated);
      console.warn(`[store] job ${entry.id} data too large (${(dataJson.length / 1024 / 1024).toFixed(1)} MB) — truncating for DB write`);
    }

    await db.job.upsert({
      where: { id: entry.id },
      create: {
        id: entry.id,
        type: entry.type,
        status: entry.status,
        total: entry.total,
        completed: entry.completed,
        data: dataJson,
        error: entry.errors.length ? entry.errors.map((e) => e.error).join('\n').slice(0, 65535) : null,
        createdAt: new Date(entry.createdAt),
        expiresAt: new Date(entry.expiresAt),
      },
      update: {
        status: entry.status,
        total: entry.total,
        completed: entry.completed,
        data: dataJson,
        error: entry.errors.length ? entry.errors.map((e) => e.error).join('\n').slice(0, 65535) : null,
        expiresAt: new Date(entry.expiresAt),
      },
    });
  } catch (e) {
    // best-effort — in-memory copy is already updated.
    console.warn(`[store] failed to persist job ${entry.id} to MySQL:`, (e as Error).message?.slice(0, 120));
  }
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
  memJobs.set(id, entry);
  void writeJobToDb(entry);

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
          // Per-URL cookies: when the caller passes `cookiesPerUrl`
          // (an array aligned with urls[]), each URL receives ONLY its
          // own cookies — never the cookies of any other URL in the
          // batch. This is critical for multi-site batch jobs where
          // each site needs its own session token.
          // When `cookiesPerUrl` is present, it overrides any shared
          // `cookies` field on scrapeOpts.
          const opts = { ...(scrapeOpts as any) } as Record<string, unknown>;
          if (Array.isArray(opts.cookiesPerUrl) && opts.cookiesPerUrl.length === urls.length) {
            const perUrl = opts.cookiesPerUrl[idx];
            if (perUrl != null) opts.cookies = perUrl;
            else delete opts.cookies;
            delete opts.cookiesPerUrl;
          }
          const r = await scrapeUrl({ ...opts, url });
          entry.data[idx] = { url, success: r.success, data: r.data, error: r.error };
          if (!r.success && r.error) {
            entry.errors.push({ url, error: r.error });
          }
        } catch (e) {
          entry.data[idx] = { url, success: false, error: (e as Error).message };
          entry.errors.push({ url, error: (e as Error).message });
        }
        entry.completed += 1;
        // Persist progress after each URL finishes.
        void writeJobToDb(entry);
      }
    });

    await Promise.all(workers).catch(() => {});
    entry.status = cancelled ? 'failed' : 'completed';
    void writeJobToDb(entry);
  })();

  const pathSegment = type === 'batch' ? 'batch/scrape' : type;
  return { id, url: `${publicBaseUrl()}/${version}/${pathSegment}/${id}` };
}

/**
 * Start a BFS recursive crawl job. Starting from `seedUrl`, the crawler:
 *   1. Scrapes the seed page
 *   2. Extracts all same-domain links (or subdomain / external links)
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
    /** Sitemap recursion depth (how deep to follow sitemapindex files).
     *  Default 3, max 10. */
    sitemapDepth?: number;
    /** Explicit sitemap URL or link-list page URL. When provided, we
     *  fetch it and auto-detect: XML sitemap → parse as sitemap (with
     *  recursion); HTML page → extract all <a href> links, using
     *  sitemapPath's directory as the base URL. Auto-discovery
     *  (robots.txt + common paths) is skipped when sitemapPath
     *  produces URLs. */
    sitemapPath?: string;
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
    /** Override robots.txt (Firecrawl Enterprise feature). Honoured
     *  only when CRAWLER_ALLOW_ROBOTS_OVERRIDE=true. */
    ignoreRobotsTxt?: boolean;
    /** Whether to follow rel="nofollow" links. Default: false (respect). */
    followNofollow?: boolean;
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
  memJobs.set(id, entry);
  void writeJobToDb(entry);

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

    // ---- Pre-crawl sitemap auto-discovery ----
    // When `sitemap` is 'include' or 'only', we fetch robots.txt
    // Sitemap: declarations + common sitemap paths + <link rel="sitemap">
    // hints, then recursively follow sitemapindex files up to
    // `sitemapDepth` levels deep. The discovered URLs are merged with
    // on-page discovered URLs (or used exclusively when sitemap='only').
    // The crawler never needs the user to specify a sitemap path —
    // everything is auto-discovered. This mirrors Firecrawl's behaviour.
    if (opts.sitemap !== 'skip' && seedParsed) {
      try {
        const ua = (opts.scrapeOpts.userAgent as string) || process.env.CRAWLER_BRAND_NAME || 'NodeByte Crawl';
        // Default depth 5 — only counts sitemap-index recursion
        // (sitemapindex → sitemapindex → ... → urlset). Article internal
        // links do NOT consume sitemap depth: once a urlset is reached
        // and content URLs are extracted, the crawl's own `maxDepth`
        // (BFS depth) controls how deep article links are followed.
        // See discoverSitemaps in sitemap.ts for details.
        const smResult = await discoverSitemaps(seedUrl, ua, {
          depth: opts.sitemapDepth ?? 5,
          skipRobots: false,
          sitemapPath: opts.sitemapPath,
        });
        // Seed the queue with sitemap-discovered URLs that pass the
        // scope + filter checks. Sitemap URLs are at depth 0 (same
        // level as the seed) so they get scraped first.
        for (const e of smResult.entries) {
          if (cancelled) break;
          if (entry.data.length + queue.length >= opts.limit) break;
          if (!isFollowable(e.url)) continue;
          if (!isPathInScope(e.url)) continue;
          if (!matchesFilters(e.url)) continue;
          const key = dedupeKey(e.url);
          if (visited.has(key)) continue;
          // Don't add the seed URL twice (it's already in the queue).
          if (key === dedupeKey(seedUrl)) continue;
          queue.push({ url: e.url, depth: 0 });
          visited.add(key);
        }
        // Update total to reflect discovered sitemap URLs.
        entry.total = Math.min(queue.length, opts.limit);
        void writeJobToDb(entry);
      } catch {
        // best-effort — sitemap discovery failed, continue with BFS.
      }
    }
    // When sitemap='only', we DON'T follow on-page links (depth-1 BFS
    // is skipped — only sitemap-discovered URLs are scraped).
    const skipOnPageLinks = opts.sitemap === 'only';

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
        // Per-domain cookies: when `cookiesByDomain` is provided (a map
        // of hostname → cookie string or CookieInput[]), each scraped URL
        // receives the cookies matching its hostname (with sub-domain
        // fallback). This is critical for crawling a site where each
        // subdomain needs its own auth cookie (e.g. admin.example.com
        // vs shop.example.com).
        //
        // Lookup precedence (first non-empty wins):
        //   1. exact hostname match in cookiesByDomain
        //   2. longest parent subdomain match (e.g. shop.uk.example.com
        //      falls back to .uk.example.com if no exact match)
        //
        // When `cookiesByDomain` is provided, it OVERRIDES any shared
        // `cookies` field on scrapeOpts for that URL. The shared
        // `cookies` field still applies to URLs whose hostname is not
        // in the map (so you can mix shared + per-domain cookies).
        const scrapeCallOpts = { ...(opts.scrapeOpts as any) } as Record<string, unknown>;
        if (scrapeCallOpts.cookiesByDomain && typeof scrapeCallOpts.cookiesByDomain === 'object') {
          const byDomain = scrapeCallOpts.cookiesByDomain as Record<string, unknown>;
          let hostname = '';
          try { hostname = new URL(url).hostname; } catch { /* ignore */ }
          if (hostname) {
            // Try exact match first.
            let matched: unknown = byDomain[hostname];
            // Try progressively shorter parent subdomains.
            if (matched == null) {
              const parts = hostname.split('.');
              for (let i = 1; i < parts.length; i++) {
                const parent = parts.slice(i).join('.');
                if (byDomain[parent] != null) {
                  matched = byDomain[parent];
                  break;
                }
              }
            }
            if (matched != null && matched !== '') {
              scrapeCallOpts.cookies = matched;
            } else if (scrapeCallOpts.cookies != null) {
              // Keep shared cookies for unmatched hosts.
            } else {
              delete scrapeCallOpts.cookies;
            }
          }
        }
        const r = await scrapeUrl({
          ...scrapeCallOpts,
          url,
          formats: Array.from(new Set([...((scrapeCallOpts.formats as string[]) || ['markdown']), 'links'])),
          ignoreRobotsTxt: opts.ignoreRobotsTxt,
          followNofollow: opts.followNofollow,
        } as any);
        entry.data[idx] = { url, success: r.success, data: r.data, error: r.error };
        if (!r.success && r.error) entry.errors.push({ url, error: r.error });

        // Discover new URLs from the scraped page (if we got links).
        // Skip on-page link following when sitemap='only' (the queue is
        // already seeded exclusively from sitemap-discovered URLs).
        if (!skipOnPageLinks && r.success && r.data?.links && depth < opts.maxDepth) {
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
      // Persist progress after each URL finishes.
      void writeJobToDb(entry);
      // Optional inter-request delay (forces polite crawling).
      if (opts.delay && opts.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, opts.delay * 1000));
      }
    }

    // Trim data to the actual scraped count (in case we over-allocated).
    entry.total = entry.data.length;
    entry.status = cancelled ? 'failed' : 'completed';
    void writeJobToDb(entry);
  })();

  return { id, url: `${publicBaseUrl()}/${version}/crawl/${id}` };
}

/** Look up a job by ID. */
export async function getJob(id: string): Promise<JobEntry | undefined> {
  // First check the in-memory cache (always present, includes cancel handle).
  const mem = memJobs.get(id);
  if (mem && Date.now() <= mem.expiresAt) return mem;
  // Fall through to the DB for jobs that started on a previous process.
  return readJobFromDb(id);
}

/** Prune expired jobs - called periodically. */
export async function pruneExpiredJobs(): Promise<void> {
  const now = Date.now();
  // Prune in-memory.
  for (const [id, job] of memJobs) {
    if (now > job.expiresAt) {
      if (job.cancel) job.cancel();
      memJobs.delete(id);
    }
  }
  // Prune DB rows.
  const db = await getDb();
  if (!db) return;
  try {
    await db.job.deleteMany({ where: { expiresAt: { lt: new Date(now) } } });
  } catch {
    // best-effort
  }
}

// Run prune every minute.
setInterval(() => { void pruneExpiredJobs(); }, 60 * 1000).unref?.();
