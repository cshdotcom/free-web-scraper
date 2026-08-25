/**
 * URL Guard — SSRF protection, URL validation, and response-size limits.
 *
 * Centralised safety checks for all crawler endpoints. Failures here
 * short-circuit the request with a 4xx response and a clear reason.
 *
 * ## Checks
 *
 * 1. **URL validation** — rejects `data:`, `file:`, `javascript:`,
 *    `ftp:`, `mailto:`, `blob:`, `view-source:`, etc. Only `http(s)://`
 *    is accepted. URL length capped at 8KB (rejects obvious abuse).
 * 2. **SSRF blocklist** — rejects URLs whose hostname resolves to a
 *    private/loopback/link-local/metadata IP. The check is DNS-aware
 *    (it actually resolves the hostname) and catches both literal IP
 *    hostnames (`http://127.0.0.1`) and DNS-rebinding attempts
 *    (`http://localhost.atlassian.com` → 127.0.0.1).
 * 3. **Cloud metadata endpoints** — explicit block for
 *    `169.254.169.254` (AWS/Azure/GCP metadata service) and
 *    `metadata.google.internal` to prevent cloud instance takeover.
 * 4. **Response-size limit** — caps the maximum body size for direct
 *    fetches (sitemap.xml, robots.txt, search-engine HTML pages).
 *    Defaults to 50 MB; configurable via CRAWLER_MAX_BODY_BYTES.
 *
 * ## Caching
 *
 * DNS resolutions are cached for 5 minutes per hostname to avoid
 * hammering the resolver on every request. Bad-hostname results
 * (NXDOMAIN) are cached for 30 seconds to allow quick retries.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Default maximum response body size (50 MB) when not configured. */
const DEFAULT_MAX_BODY_BYTES = 50 * 1024 * 1024;

/** Cache TTLs (ms). */
const DNS_CACHE_TTL = 5 * 60 * 1000;
const DNS_NXDOMAIN_TTL = 30 * 1000;

const dnsCache = new Map<string, { ips: string[] | null; expiresAt: number }>();

/** Whitelisted protocols. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Blocked protocols (explicit denylist for clarity). */
const BLOCKED_PROTOCOLS = new Set([
  'file:', 'data:', 'javascript:', 'ftp:', 'mailto:',
  'blob:', 'view-source:', 'about:', 'ws:', 'wss:',
]);

/** Maximum URL length (8KB) — reject obvious abuse / oversized query strings. */
const MAX_URL_LENGTH = 8192;

/** Private IP ranges (RFC 1918 + special-use) that we refuse to crawl. */
interface IpRange {
  start: bigint;
  end: bigint;
}

function ipv4ToBigInt(octets: number[]): bigint {
  return BigInt((octets[0] << 24) >>> 0) * 16777216n
    + BigInt(octets[1]) * 65536n
    + BigInt(octets[2]) * 256n
    + BigInt(octets[3]);
}

const PRIVATE_RANGES: IpRange[] = [
  // 10.0.0.0/8
  { start: ipv4ToBigInt([10, 0, 0, 0]), end: ipv4ToBigInt([10, 255, 255, 255]) },
  // 172.16.0.0/12
  { start: ipv4ToBigInt([172, 16, 0, 0]), end: ipv4ToBigInt([172, 31, 255, 255]) },
  // 192.168.0.0/16
  { start: ipv4ToBigInt([192, 168, 0, 0]), end: ipv4ToBigInt([192, 168, 255, 255]) },
  // 127.0.0.0/8 (loopback)
  { start: ipv4ToBigInt([127, 0, 0, 0]), end: ipv4ToBigInt([127, 255, 255, 255]) },
  // 169.254.0.0/16 (link-local, includes 169.254.169.254 metadata)
  { start: ipv4ToBigInt([169, 254, 0, 0]), end: ipv4ToBigInt([169, 254, 255, 255]) },
  // 100.64.0.0/10 (carrier-grade NAT)
  { start: ipv4ToBigInt([100, 64, 0, 0]), end: ipv4ToBigInt([100, 127, 255, 255]) },
  // 0.0.0.0/8 (this host)
  { start: ipv4ToBigInt([0, 0, 0, 0]), end: ipv4ToBigInt([0, 255, 255, 255]) },
  // 224.0.0.0/4 (multicast)
  { start: ipv4ToBigInt([224, 0, 0, 0]), end: ipv4ToBigInt([239, 255, 255, 255]) },
  // 240.0.0.0/4 (reserved)
  { start: ipv4ToBigInt([240, 0, 0, 0]), end: ipv4ToBigInt([255, 255, 255, 255]) },
];

/** Blocked literal hostnames (cloud metadata services). */
const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.aws.internal',
  '169.254.169.254',
  'metadata',
  'fd00.local',
]);

/**
 * Returns true when `ip` is in any private/blocked range. Handles IPv4
 * directly and rejects IPv6 site-local/loopback/link-local/multicast.
 */
function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) return true;
    const bi = ipv4ToBigInt(parts);
    return PRIVATE_RANGES.some((r) => bi >= r.start && bi <= r.end);
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    // ::1 (loopback), fe80::/10 (link-local), fc00::/7 (site-local ULA),
    // ff00::/8 (multicast), :: (unspecified).
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fe80:') || lower.startsWith('fe90:') || lower.startsWith('fea0:') || lower.startsWith('feb0:')) return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('ff')) return true;
    // IPv4-mapped IPv6: ::ffff:a.b.c.d
    const m = lower.match(/::ffff:([0-9.]+)$/);
    if (m) return isPrivateIp(m[1]);
    return false;
  }
  // Not a valid IP — return true to be safe (block).
  return true;
}

/** Resolve a hostname to its IPv4/IPv6 addresses, with caching. */
async function resolveHostname(hostname: string): Promise<string[] | null> {
  const cached = dnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ips;
  }
  try {
    const result = await dnsLookup(hostname, { all: true, verbatim: true });
    const ips = result.map((r) => r.address);
    dnsCache.set(hostname, { ips, expiresAt: Date.now() + DNS_CACHE_TTL });
    return ips;
  } catch {
    // NXDOMAIN or resolver failure — cache negative result briefly.
    dnsCache.set(hostname, { ips: null, expiresAt: Date.now() + DNS_NXDOMAIN_TTL });
    return null;
  }
}

/**
 * Result of a URL guard check. When `ok` is false, `reason` and
 * `statusCode` are populated for the API layer to surface to the client.
 */
export interface UrlGuardResult {
  ok: boolean;
  reason?: string;
  statusCode?: number;
  /** The validated URL (after stripping credentials, fragments, etc.). */
  normalizedUrl?: string;
}

/**
 * Validate a URL for crawler use. Performs the protocol check, length
 * check, and SSRF check (DNS resolution of the hostname).
 *
 * Returns `{ ok: false, reason, statusCode }` on failure, or
 * `{ ok: true, normalizedUrl }` on success.
 */
export async function guardUrl(rawUrl: string): Promise<UrlGuardResult> {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { ok: false, reason: 'Missing URL', statusCode: 400 };
  }
  if (rawUrl.length > MAX_URL_LENGTH) {
    return { ok: false, reason: `URL too long (max ${MAX_URL_LENGTH} bytes)`, statusCode: 414 };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: `Invalid URL: ${rawUrl.slice(0, 100)}`, statusCode: 400 };
  }

  // Protocol check
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    if (BLOCKED_PROTOCOLS.has(parsed.protocol)) {
      return {
        ok: false,
        reason: `Blocked protocol: ${parsed.protocol} — only http(s) is allowed`,
        statusCode: 400,
      };
    }
    return {
      ok: false,
      reason: `Unsupported protocol: ${parsed.protocol}`,
      statusCode: 400,
    };
  }

  // Hostname check
  const host = parsed.hostname.toLowerCase();
  if (!host) {
    return { ok: false, reason: 'Missing hostname', statusCode: 400 };
  }
  if (BLOCKED_HOSTNAMES.has(host)) {
    return {
      ok: false,
      reason: `Blocked hostname: ${host} (cloud metadata endpoint)`,
      statusCode: 403,
    };
  }

  // If hostname is already a literal IP, check directly without DNS.
  if (isIP(host)) {
    if (isPrivateIp(host)) {
      return {
        ok: false,
        reason: `SSRF blocked: ${host} is a private/loopback/metadata IP`,
        statusCode: 403,
      };
    }
  } else {
    // DNS-resolve the hostname and check ALL returned IPs. If ANY
    // resolves to a private IP, block (catches DNS-rebinding attacks
    // where the attacker's hostname resolves to 127.0.0.1).
    const ips = await resolveHostname(host);
    if (ips === null || ips.length === 0) {
      return {
        ok: false,
        reason: `DNS resolution failed for ${host} (NXDOMAIN or resolver error)`,
        statusCode: 502,
      };
    }
    for (const ip of ips) {
      if (isPrivateIp(ip)) {
        return {
          ok: false,
          reason: `SSRF blocked: ${host} resolves to private IP ${ip}`,
          statusCode: 403,
        };
      }
    }
  }

  // Normalize: strip credentials, drop fragment.
  parsed.hash = '';
  parsed.username = '';
  parsed.password = '';
  return { ok: true, normalizedUrl: parsed.toString() };
}

/**
 * Synchronous, fast pre-check that runs BEFORE the async DNS lookup.
 * Use this when you only want to reject obvious malformed/blocked URLs
 * without paying the DNS round-trip cost (e.g. for batch URLs).
 *
 * For full SSRF protection, use `guardUrl()` instead.
 */
export function guardUrlFast(rawUrl: string): UrlGuardResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { ok: false, reason: 'Missing URL', statusCode: 400 };
  }
  if (rawUrl.length > MAX_URL_LENGTH) {
    return { ok: false, reason: `URL too long (max ${MAX_URL_LENGTH} bytes)`, statusCode: 414 };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: `Invalid URL: ${rawUrl.slice(0, 100)}`, statusCode: 400 };
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      reason: `Unsupported protocol: ${parsed.protocol}`,
      statusCode: 400,
    };
  }
  const host = parsed.hostname.toLowerCase();
  if (!host) return { ok: false, reason: 'Missing hostname', statusCode: 400 };
  if (BLOCKED_HOSTNAMES.has(host)) {
    return {
      ok: false,
      reason: `Blocked hostname: ${host} (cloud metadata endpoint)`,
      statusCode: 403,
    };
  }
  // Literal-IP check (fast path).
  if (isIP(host) && isPrivateIp(host)) {
    return {
      ok: false,
      reason: `SSRF blocked: ${host} is a private/loopback/metadata IP`,
      statusCode: 403,
    };
  }
  return { ok: true, normalizedUrl: rawUrl };
}

/** Maximum response body size in bytes (env-configurable). */
export function maxBodyBytes(): number {
  const env = parseInt(process.env.CRAWLER_MAX_BODY_BYTES || '', 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_MAX_BODY_BYTES;
}

/**
 * Fetch a URL with response-size enforcement. Aborts the request as
 * soon as the Content-Length (or accumulated body) exceeds
 * `maxBodyBytes()`. Returns null on any error or size violation.
 *
 * Used by sitemap/robots.txt/search-engine scrapers that don't go
 * through Playwright.
 */
export async function guardedFetch(
  url: string,
  init?: RequestInit,
  opts: { maxBytes?: number } = {},
): Promise<{ text: string; status: number; headers: Headers } | null> {
  const cap = opts.maxBytes ?? maxBodyBytes();
  try {
    const resp = await fetch(url, {
      ...init,
      redirect: 'follow',
      signal: init?.signal ?? AbortSignal.timeout(15000),
    });
    // Check Content-Length up front when present.
    const cl = parseInt(resp.headers.get('content-length') || '', 10);
    if (Number.isFinite(cl) && cl > cap) return null;
    // Read the body, aborting when we exceed the cap.
    const reader = resp.body?.getReader();
    if (!reader) {
      const text = await resp.text();
      if (text.length > cap) return null;
      return { text, status: resp.status, headers: resp.headers };
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) return null;
      chunks.push(value);
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.byteLength;
    }
    return {
      text: new TextDecoder('utf-8', { fatal: false }).decode(buf),
      status: resp.status,
      headers: resp.headers,
    };
  } catch {
    return null;
  }
}
