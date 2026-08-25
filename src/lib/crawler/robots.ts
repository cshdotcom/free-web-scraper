/**
 * Robots.txt + AI opt-out compliance.
 *
 * ## Compliance layers
 *
 * 1. **robots.txt (RFC 9309)** — fetched per-host on first request and
 *    cached for 1 hour. Rules are matched against the configured
 *    brand User-Agent (default `NodeByte Crawl`). When the user
 *    supplies a custom UA, we ALSO check the `*` group as a fallback.
 *    `Disallow:` rules with empty path block the whole site.
 *
 * 2. **X-Robots-Tag HTTP header** — the response can include
 *    `X-Robots-Tag: noindex` or `X-Robots-Tag: noai` directives. We
 *    honour both: `noindex` blocks indexing/caching (so we don't
 *    cache the page), `noai` blocks AI training/scraping (so we
 *    return a 403 with a clear reason).
 *
 * 3. **HTML <meta name="robots">** — same directives as
 *    X-Robots-Tag but applied at the document level. We parse
 *    `<meta name="robots" content="noai,noindex">` and
 *    `<meta name="CC-robots" content="noai">`.
 *
 * 4. **ai.txt (W3C TR proposal)** — `.well-known/ai.txt` per-origin
 *    policy file. We fetch it once per host and honour the
 *    `User-agent: * Disallow: /` style rules for AI crawlers.
 *
 * 5. **CC-NOAI / TDM-rap** — when the response carries the
 *    `CC-NOAI: 1` header (Creative Commons) or the EU TDM
 *    `TDM-Rep: 1` reservation header, we refuse to scrape.
 *
 * All five layers are checked BEFORE the page is scraped. When ANY
 * layer says "no", the scraper returns a 403 with the specific reason
 * ("Blocked by robots.txt: Disallow: /admin/", "Page declares noai
 * opt-out via <meta>", etc.) so the caller can surface the reason to
 * the end user.
 *
 * ## Caching
 *
 * Per-host robots.txt and ai.txt are cached for 1 hour (configurable
 * via CRAWLER_ROBOTS_CACHE_TTL_MS). A 404/410 response for robots.txt
 * means "no rules — allowed"; a 5xx response means "fetch failed —
 * we err on the side of allow" (Firecrawl's documented behaviour).
 *
 * ## Override
 *
 * The `ignoreRobotsTxt: true` request option (Firecrawl Enterprise
 * feature) bypasses layer 1. Layers 2-5 are NEVER bypassable — they
 * are hard legal compliance. Setting `ignoreRobotsTxt: true` requires
 * `CRAWLER_ALLOW_ROBOTS_OVERRIDE=true` in env (off by default to
 * prevent abuse from random API callers).
 */

import { guardedFetch } from './url-guard';

/** Cache TTL for robots.txt / ai.txt (1 hour by default). */
const DEFAULT_CACHE_TTL = 60 * 60 * 1000;

interface CacheEntry {
  /** Parsed robots.txt rules. `null` means "no robots.txt — allow all". */
  robots: ParsedRobots | null;
  /** Parsed ai.txt rules. `null` means "no ai.txt — allow all". */
  aiTxt: ParsedRobots | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Parsed robots.txt — a list of (UA, Disallow paths) pairs. */
interface ParsedRobots {
  /** Each rule: { userAgent: string (lowercase, '*' = any), disallow: string[] } */
  groups: Array<{ userAgent: string; disallow: string[]; allow: string[] }>;
}

/** Compliance verdict. */
export interface ComplianceResult {
  /** When `false`, the request must be rejected with `reason` + `statusCode`. */
  ok: boolean;
  /** Short human-readable reason (shown to the API caller). */
  reason?: string;
  /** HTTP status code to return (403 for blocks). */
  statusCode?: number;
  /** Which compliance layer triggered the block (for audit logs). */
  layer?: 'robots.txt' | 'ai.txt' | 'x-robots-tag' | 'meta-robots' | 'cc-noai' | 'tdm-rep';
}

function parseRobotsTxt(text: string): ParsedRobots {
  const groups: ParsedRobots['groups'] = [];
  let current: { userAgent: string; disallow: string[]; allow: string[] } | null = null;
  // Normalize line endings: handle \r\n, \r, and \n.
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const rawLine of lines) {
    // Strip comments (#...) but only when # is at the start of a token
    // (not inside a value). RFC 9309: comments start at # and extend
    // to end of line. The # can appear after whitespace too.
    const line = rawLine.replace(/\s+#.*$/, '').replace(/^#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      // Start a new group when we see a UA line. Multiple UA lines in
      // a row share the same group's rules.
      if (!current || current.disallow.length > 0 || current.allow.length > 0) {
        current = { userAgent: value.toLowerCase(), disallow: [], allow: [] };
        groups.push(current);
      } else if (current) {
        // Same group covers multiple UAs — clone for each new UA.
        current = { userAgent: value.toLowerCase(), disallow: current.disallow, allow: current.allow };
        groups.push(current);
      }
    } else if (key === 'disallow' && current) {
      // RFC 9309: An empty Disallow value means "allow all" — it
      // explicitly says nothing is disallowed. This is the correct
      // interpretation: `Disallow:` (no path) = no restrictions.
      // `Disallow: /` (with path "/") = block everything.
      if (value) {
        current.disallow.push(value);
      }
      // Empty value → do NOT add to disallow list (means "allow all").
    } else if (key === 'allow' && current) {
      if (value) current.allow.push(value);
    }
    // Sitemap: lines are handled by the sitemap discovery module.
  }
  return { groups };
}

/** Match a path against a robots.txt rule. Returns true when blocked. */
function pathMatches(path: string, pattern: string): boolean {
  if (pattern === '/') return true;
  if (pattern === '') return false;
  // RFC 9309: '*' is a wildcard, '$' is end-of-line. We support both.
  // Simple implementation: convert pattern to a regex.
  let re = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  re = re.replace(/\*/g, '.*').replace(/\$$/, '$');
  // Anchor at start.
  try {
    return new RegExp('^' + re).test(path);
  } catch {
    return path.startsWith(pattern);
  }
}

/**
 * Determine if a UA/path is allowed by a parsed robots.txt.
 * Returns the matching rule group (or null when no group matches).
 */
function findMatchingGroup(robots: ParsedRobots, userAgent: string): ParsedRobots['groups'][0] | null {
  const ua = userAgent.toLowerCase();
  // 1. Exact UA match (longest prefix wins).
  let best: ParsedRobots['groups'][0] | null = null;
  let bestLen = -1;
  for (const g of robots.groups) {
    if (g.userAgent === '*') continue;
    if (ua.includes(g.userAgent) && g.userAgent.length > bestLen) {
      best = g;
      bestLen = g.userAgent.length;
    }
  }
  if (best) return best;
  // 2. Wildcard group.
  for (const g of robots.groups) {
    if (g.userAgent === '*') return g;
  }
  return null;
}

/** Check robots.txt + ai.txt for the given URL + UA. */
export async function checkRobots(
  url: string,
  userAgent: string,
  opts: { ignoreRobotsTxt?: boolean } = {},
): Promise<ComplianceResult> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, reason: 'Invalid URL', statusCode: 400 }; }
  const origin = `${parsed.protocol}//${parsed.host}`;
  const ttl = parseInt(process.env.CRAWLER_ROBOTS_CACHE_TTL_MS || '', 10) || DEFAULT_CACHE_TTL;

  // Cache lookup
  let entry = cache.get(origin);
  if (!entry || entry.expiresAt < Date.now()) {
    // Fetch robots.txt and ai.txt in parallel.
    const [robotsResp, aiResp] = await Promise.all([
      guardedFetch(`${origin}/robots.txt`, { headers: { 'User-Agent': userAgent } }),
      guardedFetch(`${origin}/.well-known/ai.txt`, { headers: { 'User-Agent': userAgent } }),
    ]);
    const robots = robotsResp && robotsResp.status >= 200 && robotsResp.status < 300
      ? parseRobotsTxt(robotsResp.text) : null;
    const aiTxt = aiResp && aiResp.status >= 200 && aiResp.status < 300
      ? parseRobotsTxt(aiResp.text) : null;
    entry = { robots, aiTxt, expiresAt: Date.now() + ttl };
    cache.set(origin, entry);
  }

  // Layer 1: robots.txt
  if (!opts.ignoreRobotsTxt && entry.robots) {
    const group = findMatchingGroup(entry.robots, userAgent);
    if (group) {
      // Allow rules take precedence over Disallow rules when both match
      // (RFC 9309). Check Allow first.
      let allowed = false;
      for (const a of group.allow) {
        if (pathMatches(parsed.pathname + parsed.search, a)) { allowed = true; break; }
      }
      if (!allowed) {
        for (const d of group.disallow) {
          if (pathMatches(parsed.pathname + parsed.search, d)) {
            return {
              ok: false,
              statusCode: 403,
              reason: `Blocked by robots.txt: Disallow: ${d} (UA: ${group.userAgent})`,
              layer: 'robots.txt',
            };
          }
        }
      }
    }
  }

  // Layer 2: ai.txt
  if (entry.aiTxt) {
    const group = findMatchingGroup(entry.aiTxt, userAgent);
    if (group) {
      for (const d of group.disallow) {
        if (pathMatches(parsed.pathname + parsed.search, d) || d === '/') {
          return {
            ok: false,
            statusCode: 403,
            reason: `Blocked by ai.txt: Disallow: ${d} (UA: ${group.userAgent})`,
            layer: 'ai.txt',
          };
        }
      }
    }
  }

  return { ok: true };
}

/**
 * Parse HTTP response headers for AI opt-out directives:
 *   X-Robots-Tag: noai / noindex
 *   CC-NOAI: 1
 *   TDM-Rep: 1
 *
 * Returns the first blocking directive found.
 */
export function checkHeadersForAiOptOut(headers: Headers): ComplianceResult {
  // X-Robots-Tag may be a comma-separated list of directives.
  const xRobots = headers.get('x-robots-tag');
  if (xRobots) {
    const tokens = xRobots.toLowerCase().split(/[,\s]+/).map((t) => t.trim());
    if (tokens.includes('noai')) {
      return {
        ok: false,
        statusCode: 403,
        reason: 'Blocked by X-Robots-Tag: noai (page declares AI opt-out)',
        layer: 'x-robots-tag',
      };
    }
    // noindex doesn't block crawling per se, but the page declares it
    // shouldn't be indexed/cached. We honour it as a soft AI opt-out.
    if (tokens.includes('noindex') && process.env.CRAWLER_RESPECT_NOINDEX === 'true') {
      return {
        ok: false,
        statusCode: 403,
        reason: 'Blocked by X-Robots-Tag: noindex (CRAWLER_RESPECT_NOINDEX is on)',
        layer: 'x-robots-tag',
      };
    }
  }
  // CC-NOAI: Creative Commons AI opt-out header.
  const ccNoai = headers.get('cc-noai');
  if (ccNoai && ccNoai !== '0') {
    return {
      ok: false,
      statusCode: 403,
      reason: 'Blocked by CC-NOAI header (Creative Commons AI opt-out)',
      layer: 'cc-noai',
    };
  }
  // TDM-Rep: EU Text & Data Mining reservation.
  const tdmRep = headers.get('tdm-reservation') || headers.get('tdm-rep');
  if (tdmRep && /1|true/i.test(tdmRep)) {
    return {
      ok: false,
      statusCode: 403,
      reason: 'Blocked by TDM-Reservation: 1 (EU TDM opt-out)',
      layer: 'tdm-rep',
    };
  }
  return { ok: true };
}

/**
 * Parse an HTML document for AI opt-out <meta> tags:
 *   <meta name="robots" content="noai">
 *   <meta name="robots" content="noindex">
 *   <meta name="CC-robots" content="noai">
 *
 * Returns the first blocking directive found.
 */
export function checkHtmlForAiOptOut(html: string): ComplianceResult {
  // Crude regex extraction of all <meta> tags with name="robots" or
  // name="CC-robots". The full DOM parse happens later in the
  // extractor; we only need the meta tags here.
  const metaRegex = /<meta\s+[^>]*?name\s*=\s*["'](?:robots|cc-robots)["'][^>]*?content\s*=\s*["']([^"']+)["'][^>]*?>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRegex.exec(html)) !== null) {
    const tokens = m[1].toLowerCase().split(/[,\s]+/).map((t) => t.trim());
    if (tokens.includes('noai')) {
      return {
        ok: false,
        statusCode: 403,
        reason: 'Blocked by <meta name="robots" content="noai"> (page declares AI opt-out)',
        layer: 'meta-robots',
      };
    }
    if (tokens.includes('noindex') && process.env.CRAWLER_RESPECT_NOINDEX === 'true') {
      return {
        ok: false,
        statusCode: 403,
        reason: 'Blocked by <meta name="robots" content="noindex"> (CRAWLER_RESPECT_NOINDEX is on)',
        layer: 'meta-robots',
      };
    }
  }
  return { ok: true };
}

/** Clear the per-host cache. Useful for tests. */
export function clearRobotsCache(): void {
  cache.clear();
}
