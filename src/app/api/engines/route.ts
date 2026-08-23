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
 * The Next.js app reads its own copy of CRAWLER_SEARXNG_INSTANCES — this
 * is intentional, so the Search tab can show the user's custom instances
 * as selectable checkboxes WITHOUT a round-trip to the crawler service.
 * The crawler service reads the same env var on its side and uses the
 * custom instances when actually executing searches (see
 * `getSearxngInstances()` in mini-services/crawler-service/src/search.ts).
 *
 * Env format: `CRAWLER_SEARXNG_INSTANCES="Name1|https://base1,Name2|https://base2"`.
 */
export async function GET() {
  const defaultEngines = ['bing', 'duckduckgo', 'searxng', 'wikipedia'];

  // Parse custom SearXNG instances from the env var.
  // Format: "DisplayName|https://base-url,Other|https://other-url"
  const raw = process.env.CRAWLER_SEARXNG_INSTANCES || '';
  const customSearxng: Array<{ name: string; baseUrl: string }> = [];
  if (raw.trim()) {
    for (const entry of raw.split(',')) {
      const parts = entry.split('|').map((s) => s.trim());
      if (parts.length < 2) continue;
      const [name, baseUrl] = parts;
      if (!baseUrl) continue;
      customSearxng.push({
        name: name || baseUrl,
        baseUrl: baseUrl.replace(/\/$/, ''),
      });
    }
  }

  return NextResponse.json({
    engines: defaultEngines,
    customSearxng,
  });
}
