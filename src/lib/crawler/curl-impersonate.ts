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

  // Write output to a temp file instead of stdout to avoid issues with
  // binary content and header parsing. Use a separate temp file for
  // headers.
  const tmpDir = '/tmp';
  const bodyFile = path.join(tmpDir, `curl_imp_body_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const headerFile = path.join(tmpDir, `curl_imp_hdr_${Date.now()}_${Math.random().toString(36).slice(2)}`);

  const args: string[] = [
    '-s', '-S', '-L',
    '-o', bodyFile,
    '-D', headerFile,
    '--compressed',
    '--max-time', String(Math.ceil(timeout / 1000)),
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
    await execFileAsync(binary, args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: timeout + 2000,
      env: { ...process.env },
    });
  } catch (e) {
    // Even on error, curl may have written partial output.
    const err = e as Error;
    return {
      success: false,
      status: 0,
      headers: {},
      body: '',
      finalUrl: url,
      isStatic: false,
      error: err.message.slice(0, 200),
    };
  }

  // Read the body file.
  let body = '';
  try {
    body = fs.readFileSync(bodyFile, 'utf-8');
  } catch { /* ignore */ }
  try { fs.unlinkSync(bodyFile); } catch { /* ignore */ }

  // Read the header file.
  let headerContent = '';
  try {
    headerContent = fs.readFileSync(headerFile, 'utf-8');
  } catch { /* ignore */ }
  try { fs.unlinkSync(headerFile); } catch { /* ignore */ }

  // Parse headers. When following redirects, curl dumps multiple
  // header blocks separated by \r\n\r\n. Take the last one.
  const headerBlocks = headerContent.split(/\r?\n\r?\n/).filter((b) => b.trim());
  const lastHeaders = headerBlocks[headerBlocks.length - 1] || '';

  let httpCode = 200;
  let finalUrl = url;
  let contentType = '';
  const headers: Record<string, string> = {};

  for (const line of lastHeaders.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // HTTP status line: "HTTP/2 200" or "HTTP/1.1 200 OK"
    if (/^HTTP\//i.test(trimmed)) {
      const parts = trimmed.split(/\s+/);
      httpCode = parseInt(parts[1], 10) || 200;
      continue;
    }

    // Header: "Key: Value"
    const idx = trimmed.indexOf(':');
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim().toLowerCase();
      const val = trimmed.slice(idx + 1).trim();
      headers[key] = val;
      if (key === 'content-type') contentType = val;
      if (key === 'location') finalUrl = val;
    }
  }

  const isStatic = checkIsStatic(body, httpCode, contentType || headers['content-type'] || '');

  return {
    success: httpCode >= 200 && httpCode < 400,
    status: httpCode,
    headers,
    body,
    finalUrl: finalUrl || url,
    isStatic,
  };
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
