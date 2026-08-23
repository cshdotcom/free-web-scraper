import { config } from './config.js';
import { scrapeUrl, type ScrapeData } from './crawler.js';

/**
 * In-memory job store for asynchronous crawl/batch scrape jobs.
 *
 * Each job has:
 *  - id (prefixed with crawl_ or batch_)
 *  - status: 'scraping' | 'completed' | 'failed'
 *  - total / completed counters for progress reporting
 *  - data: array of per-URL scrape results as they finish
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
): { id: string; url: string } {
  const id = makeId(type);
  const entry: JobEntry = {
    id,
    type,
    status: 'scraping',
    total: urls.length,
    completed: 0,
    data: [],
    createdAt: Date.now(),
    expiresAt: Date.now() + config.jobTtlMs,
  };
  jobs.set(id, entry);

  // Kick off the background processing. We don't await here so the
  // request can return immediately with the job ID.
  void (async () => {
    let cancelled = false;
    entry.cancel = () => { cancelled = true; };

    // Process URLs sequentially with a small concurrency window so the
    // browser pool doesn't get overwhelmed. We use chunked parallelism.
    const concurrency = Math.min(2, config.maxConcurrency);
    let cursor = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (cursor < urls.length && !cancelled) {
        const idx = cursor++;
        const url = urls[idx];
        try {
          const r = await scrapeUrl({ ...(scrapeOpts as any), url });
          entry.data[idx] = { url, success: r.success, data: r.data, error: r.error };
        } catch (e) {
          entry.data[idx] = { url, success: false, error: (e as Error).message };
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
 *   2. Extracts all same-domain links
 *   3. Scrapes each discovered link (depth 2)
 *   4. Repeats up to `maxDepth` levels, capped at `limit` total pages
 *
 * The `total` field is updated dynamically as new URLs are discovered.
 */
export function startCrawlJob(
  seedUrl: string,
  opts: {
    maxDepth: number;
    limit: number;
    includePatterns?: string[];
    excludePatterns?: string[];
    scrapeOpts: Record<string, unknown>;
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

    const matchesFilters = (url: string): boolean => {
      if (opts.includePatterns && opts.includePatterns.length > 0) {
        const ok = opts.includePatterns.some((p: string) => {
          try { return new RegExp(p).test(url); } catch { return url.includes(p); }
        });
        if (!ok) return false;
      }
      if (opts.excludePatterns && opts.excludePatterns.length > 0) {
        const blocked = opts.excludePatterns.some((p: string) => {
          try { return new RegExp(p).test(url); } catch { return url.includes(p); }
        });
        if (blocked) return false;
      }
      return true;
    };

    while (queue.length > 0 && !cancelled && entry.data.length < opts.limit) {
      const { url, depth } = queue.shift()!;
      const norm = url.replace(/#.*$/, '').replace(/\/$/, '');
      if (visited.has(norm)) continue;
      visited.add(norm);
      if (norm !== seedUrl.replace(/\/$/, '') && !matchesFilters(url)) continue;

      // Grow the total as we discover new URLs to scrape.
      entry.total = Math.min(visited.size + queue.length, opts.limit);
      // Make sure data array can hold this index.
      const idx = entry.data.length;
      entry.data[idx] = { url, success: false };

      try {
        const r = await scrapeUrl({
          ...(opts.scrapeOpts as any),
          url,
          formats: Array.from(new Set([...(opts.scrapeOpts.formats as string[] || []), 'links'])),
        });
        entry.data[idx] = { url, success: r.success, data: r.data, error: r.error };

        // Discover new URLs from the scraped page (if we got links).
        if (r.success && r.data?.links && depth < opts.maxDepth) {
          for (const link of r.data.links) {
            const linkNorm = link.url.replace(/#.*$/, '').replace(/\/$/, '');
            if (visited.has(linkNorm)) continue;
            // Same-domain filter (or subdomain if configured).
            try {
              const linkUrl = new URL(link.url);
              if (seedParsed && linkUrl.hostname !== seedParsed.hostname) continue;
            } catch { continue; }
            if (!matchesFilters(link.url)) continue;
            if (entry.data.length + queue.length >= opts.limit) break;
            queue.push({ url: link.url, depth: depth + 1 });
          }
        }
      } catch (e) {
        entry.data[idx] = { url, success: false, error: (e as Error).message };
      }
      entry.completed += 1;
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
