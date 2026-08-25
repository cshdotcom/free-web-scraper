import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/engines
 *
 * Returns the list of available search engines, including any custom
 * SearXNG instances the operator has configured via
 * CRAWLER_SEARXNG_INSTANCES in `.env.local` (server-side only).
 *
 * Response shape:
 *   {
 *     engines: ['bing', 'duckduckgo', 'searxng', 'wikipedia'],
 *     customSearxng: [{ name: 'My Searx', baseUrl: 'https://...' }, ...]
 *   }
 *
 * Env format: `CRAWLER_SEARXNG_INSTANCES="Name1|https://base1,Name2|https://base2"`.
 *
 * URL-only entries are supported — when the user omits the `Name|` prefix,
 * we derive the name from the URL hostname so the frontend always shows
 * a human-readable name (NOT the raw URL).
 */
export async function GET() {
  const defaultEngines = ['bing', 'duckduckgo', 'searxng', 'wikipedia'];

  // Parse custom SearXNG instances from the env var.
  // Format: "DisplayName|https://base-url,Other|https://other-url"
  // OR "https://base-url" (URL-only — name derived from hostname)
  const raw = process.env.CRAWLER_SEARXNG_INSTANCES || '';
  const customSearxng: Array<{ name: string; baseUrl: string }> = [];
  if (raw.trim()) {
    for (const entry of raw.split(',')) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const pipeIdx = trimmed.indexOf('|');
      let name: string;
      let baseUrl: string;
      if (pipeIdx >= 0) {
        // "Name|URL" form
        name = trimmed.slice(0, pipeIdx).trim();
        baseUrl = trimmed.slice(pipeIdx + 1).trim();
      } else {
        // URL-only form — derive a friendly name from the hostname
        baseUrl = trimmed;
        try {
          const u = new URL(baseUrl);
          // Strip leading "searx." / "searxng." / "www." prefixes for readability.
          name = u.hostname.replace(/^(searxng?|www)\./i, '');
          if (!name) name = u.hostname;
        } catch {
          // Not a valid URL — skip this entry entirely
          continue;
        }
      }
      if (!baseUrl) continue;
      // Final validation: must be http(s)://
      if (!/^https?:\/\//i.test(baseUrl)) continue;
      if (!name) name = baseUrl;
      // Dedupe by baseUrl
      if (customSearxng.some((c) => c.baseUrl === baseUrl.replace(/\/$/, ''))) continue;
      customSearxng.push({
        name,
        baseUrl: baseUrl.replace(/\/$/, ''),
      });
    }
  }

  return NextResponse.json({
    engines: defaultEngines,
    customSearxng,
  });
}
