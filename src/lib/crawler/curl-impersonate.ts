/**
 * Pre-request layer: curl-impersonate for TLS/JA3 fingerprint
 * impersonation.
 *
 * Many anti-bot systems (Cloudflare, Akamai, DataDome, PerimeterX)
 * inspect the TLS ClientHello fingerprint (JA3/JA4) to distinguish
 * real browsers from bots. Playwright's bundled Chromium has a
 * distinctive TLS fingerprint that these systems can detect and block
 * during the handshake phase — before any HTTP response is received.
 *
 * This module uses `curl-impersonate` (a modified curl binary with
 * BoringSSL) to send HTTPS requests with a real Chrome TLS fingerprint.
 * If the response is a static HTML page (no JS-rendered content needed),
 * we parse and return it directly — skipping the expensive Playwright
 * browser launch entirely.
 *
 * ## Flow
 *
 * 1. **curl-impersonate fetch** — send the request with Chrome TLS
 *    fingerprint + Chrome User-Agent + standard browser headers.
 *    Timeout: 15s.
 * 2. **Check response** — if HTTP 200 + HTML content-type + the page
 *    looks static (no heavy SPA framework), parse the HTML directly.
 * 3. **Fallback to Playwright** — if curl-impersonate fails (non-200,
 *    timeout, or the page requires JS rendering), fall through to the
 *    normal Playwright scrape flow.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execFileAsync = promisify(execFile);

/** Path to the curl-impersonate binary. */
function getCurlImpersonateBinary(): string | null {
  const candidates = [
    path.join(process.cwd(), 'node_modules', 'node-curl-impersonate', 'bin', 'curl-impersonate-chrome-linux-x86'),
    path.join(process.cwd(), 'app', 'node_modules', 'node-curl-impersonate', 'bin', 'curl-impersonate-chrome-linux-x86'),
    path.join(__dirname, '..', '..', '..', 'node_modules', 'node-curl-impersonate', 'bin', 'curl-impersonate-chrome-linux-x86'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).size > 0) {
        fs.chmodSync(p, 0o755);
        return p;
      }
    } catch { /* ignore */ }
  }
  return null;
}

export interface ImpersonateResult {
  success: boolean;
  status: number;
  headers: Record<string, string>;
  body: string;
  finalUrl: string;
  isStatic: boolean;
  error?: string;
}

export async function impersonateFetch(
  url: string,
  userAgent: string,
  opts: { cookies?: string; timeout?: number; headers?: Record<string, string> } = {},
): Promise<ImpersonateResult> {
  const binary = getCurlImpersonateBinary();
  if (!binary) {
    return { success: false, status: 0, headers: {}, body: '', finalUrl: url, isStatic: false, error: 'curl-impersonate binary not found' };
  }

  const timeout = opts.timeout ?? 15000;
  const args: string[] = [
    '-s', '-S', '-L',
    '-o', '-',
    '-D', '-',
    '--compressed',
    '--max-time', String(Math.ceil(timeout / 1000)),
    '-w', '\n---CURL_META---\n%{http_code}\n%{url_effective}\n%{content_type}',
    '-A', userAgent,
    '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    '-H', 'Accept-Language: en-US,en;q=0.9',
    '-H', 'Accept-Encoding: gzip, deflate, br',
    '-H', 'Cache-Control: no-cache',
    '-H', 'Sec-Fetch-Dest: document',
    '-H', 'Sec-Fetch-Mode: navigate',
    '-H', 'Sec-Fetch-Site: none',
    '-H', 'Sec-Fetch-User: ?1',
    '-H', 'Upgrade-Insecure-Requests: 1',
  ];
  if (opts.cookies) args.push('-b', opts.cookies);
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) args.push('-H', `${k}: ${v}`);
  }
  args.push(url);

  try {
    const { stdout } = await execFileAsync(binary, args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: timeout + 2000,
      env: { ...process.env, CURL_IMPERSONATE: 'chrome116' },
    });

    const metaIdx = stdout.lastIndexOf('\n---CURL_META---\n');
    let body = stdout;
    let httpCode = 200;
    let finalUrl = url;
    let contentType = '';

    if (metaIdx >= 0) {
      const metaPart = stdout.slice(metaIdx + '\n---CURL_META---\n'.length).trim();
      const metaLines = metaPart.split('\n');
      body = stdout.slice(0, metaIdx);
      if (metaLines[0]) httpCode = parseInt(metaLines[0], 10) || 200;
      if (metaLines[1]) finalUrl = metaLines[1];
      if (metaLines[2]) contentType = metaLines[2];
    }

    // Split headers from body.
    const headerEnd = body.indexOf('\r\n\r\n');
    let actualBody = body;
    let lastHeaders = '';
    if (headerEnd >= 0) {
      lastHeaders = body.slice(0, headerEnd);
      actualBody = body.slice(headerEnd + 4);
    } else {
      const nlEnd = body.indexOf('\n\n');
      if (nlEnd >= 0) {
        lastHeaders = body.slice(0, nlEnd);
        actualBody = body.slice(nlEnd + 2);
      }
    }

    // Handle redirects: take the last header block.
    const headerBlocks = lastHeaders.split(/\r?\n\r?\n/);
    const finalHeaderBlock = headerBlocks[headerBlocks.length - 1] || '';
    const headers: Record<string, string> = {};
    for (const line of finalHeaderBlock.split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }

    const isStatic = checkIsStatic(actualBody, httpCode, contentType || headers['content-type'] || '');

    return { success: httpCode >= 200 && httpCode < 400, status: httpCode, headers, body: actualBody, finalUrl, isStatic };
  } catch (e) {
    return { success: false, status: 0, headers: {}, body: '', finalUrl: url, isStatic: false, error: (e as Error).message.slice(0, 200) };
  }
}

function checkIsStatic(html: string, status: number, contentType: string): boolean {
  if (status < 200 || status >= 300) return false;
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) return false;
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '').trim();
  if (text.length < 200) return false;
  const spaMarkers = ['id="root"', 'id="app"', 'id="__next"', '__NEXT_DATA__', '__NUXT__', 'data-reactroot', 'ng-app', 'data-vue-app'];
  for (const m of spaMarkers) { if (html.includes(m)) return false; }
  if (/cf-challenge|Just a moment|Checking your browser|cf-mitigated/i.test(html)) return false;
  return true;
}
