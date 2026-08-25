import { NextRequest } from 'next/server';
import { checkAuth, handleCors, jsonResponse } from '@/lib/crawler-auth';
import { searchEngines } from '@/lib/crawler/search';
import { scrapeUrl } from '@/lib/crawler/crawler';
import { mapWithConcurrency } from '@/lib/crawler/concurrency';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const cors = handleCors(request);
  if (cors) return cors;
  const authError = checkAuth(request);
  if (authError) return jsonResponse({ success: false, error: authError }, 401);
  let body: any;
  try { body = await request.json(); } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }
  if (!body?.query) return jsonResponse({ success: false, error: 'Missing required field: query' }, 400);

  const limit = typeof body.limit === 'number' ? body.limit : 50;
  // Native `engines` array (bing/duckduckgo/searxng/wikipedia/mojeek/...)
  // takes precedence; Firecrawl's `sources` array is accepted but not yet
  // mapped to specific engines (we treat it as a filter hint and fall back
  // to the default engine pool when empty).
  const engines = Array.isArray(body.engines) && body.engines.length > 0
    ? body.engines
    : undefined;
  const requestedLang = typeof body.lang === 'string' && body.lang.trim() ? body.lang.trim() : 'auto';

  // Firecrawl `sources` array: 'web' | 'news' | 'images'. When set,
  // we route to the appropriate engine pool and tag the result type.
  // 'web'   → standard search (default — bing/duckduckgo/searxng/wikipedia)
  // 'news'  → news-oriented search (uses Bing News + Google News via SearXNG)
  // 'images'→ image search (uses SearXNG + Bing Images)
  // Multiple sources can be requested in a single call. When omitted,
  // we default to ['web'].
  const sources: string[] = Array.isArray(body.sources) && body.sources.length > 0
    ? body.sources.filter((s: any) => typeof s === 'string' && ['web', 'news', 'images'].includes(s.toLowerCase()))
    : ['web'];

  // When `sources` includes 'news' or 'images', we modify the effective
  // query / engine selection accordingly.
  const wantsNews = sources.includes('news');
  const wantsImages = sources.includes('images');
  const wantsWeb = sources.includes('web') || (!wantsNews && !wantsImages);

  // Firecrawl domain filters: rewrite as `site:` / `-site:` operators that
  // are appended to the query. includeDomains and excludeDomains are
  // mutually exclusive in Firecrawl; if both are provided, we use only
  // the include list.
  let effectiveQuery: string = body.query;
  const includeDomains: string[] | undefined = Array.isArray(body.includeDomains) ? body.includeDomains : undefined;
  const excludeDomains: string[] | undefined = Array.isArray(body.excludeDomains) ? body.excludeDomains : undefined;
  if (includeDomains && includeDomains.length > 0) {
    effectiveQuery = `${effectiveQuery} (${includeDomains.map((d) => `site:${d}`).join(' OR ')})`;
  } else if (excludeDomains && excludeDomains.length > 0) {
    effectiveQuery = `${effectiveQuery} ${excludeDomains.map((d) => `-site:${d}`).join(' ')}`;
  }

  // Firecrawl `tbs` (time-based search) is forwarded as a query modifier
  // when set (e.g. "qdr:d" → past day). Many engines ignore it; we still
  // accept and forward it.
  const tbs: string | undefined = typeof body.tbs === 'string' ? body.tbs : undefined;
  if (tbs) {
    effectiveQuery = `${effectiveQuery}&tbs=${encodeURIComponent(tbs)}`;
  }

  const { results: allResults, engines: usedEngines, resolvedLang } = await (async () => {
    // When sources includes multiple types, run them in parallel and
    // tag each result with its source category.
    const tasks: Array<Promise<{ source: string; results: any[]; engines: string[] }>> = [];
    if (wantsWeb) {
      tasks.push(searchEngines(effectiveQuery, { limit, engines, lang: requestedLang, source: 'web' })
        .then((r) => ({ source: 'web', results: r.results, engines: r.engines })));
    }
    if (wantsNews) {
      tasks.push(searchEngines(effectiveQuery, { limit, lang: requestedLang, source: 'news' })
        .then((r) => ({ source: 'news', results: r.results, engines: r.engines })));
    }
    if (wantsImages) {
      tasks.push(searchEngines(effectiveQuery, { limit, lang: requestedLang, source: 'images' })
        .then((r) => ({ source: 'images', results: r.results, engines: r.engines })));
    }
    const settled = await Promise.allSettled(tasks);
    const allEngines = new Set<string>();
    const merged: any[] = [];
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue;
      s.value.engines.forEach((e) => allEngines.add(e));
      merged.push(...s.value.results);
    }
    return { results: merged, engines: Array.from(allEngines), resolvedLang: requestedLang };
  })();

  // Firecrawl `safe: true` filters explicit content. We do not have an
  // explicit content filter at the engine layer, so this is a no-op flag
  // acknowledged for API compatibility — it does NOT alter results.
  const safe = body.safe === true;

  // Optional scrapeOptions: when present, scrape each result URL and
  // merge the scraped content into the search result items. Skip
  // scraping when source='images' (no page to scrape, just an image URL).
  const scrapeOpts: Record<string, any> | undefined = body.scrapeOptions;
  let enriched: typeof allResults;
  if (scrapeOpts && typeof scrapeOpts === 'object' && !wantsImages) {
    const formats: string[] = Array.isArray(scrapeOpts.formats) ? scrapeOpts.formats : ['markdown'];
    enriched = await mapWithConcurrency(allResults, 3, async (item) => {
      try {
        const r = await scrapeUrl({
          url: item.url,
          formats,
          onlyMainContent: scrapeOpts.onlyMainContent ?? true,
          timeout: scrapeOpts.timeout ?? 30000,
          maxRetries: 1,
          location: scrapeOpts.location,
        });
        if (r.success && r.data) {
          return {
            ...item,
            ...(r.data.markdown ? { markdown: r.data.markdown } : {}),
            ...(r.data.html ? { html: r.data.html } : {}),
            ...(r.data.rawHtml ? { rawHtml: r.data.rawHtml } : {}),
            ...(r.data.links ? { links: r.data.links } : {}),
            ...(r.data.screenshot ? { screenshot: r.data.screenshot } : {}),
            ...(r.data.metadata ? { metadata: { ...item.metadata, ...r.data.metadata } } : {}),
          };
        }
        return item;
      } catch {
        return item;
      }
    });
  } else {
    enriched = allResults;
  }

  return jsonResponse({
    success: true,
    query: body.query,
    total: enriched.length,
    engines: usedEngines,
    sources,
    lang: resolvedLang || requestedLang,
    ...(safe !== undefined ? { safe } : {}),
    data: enriched,
  });
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
