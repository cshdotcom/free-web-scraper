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
  const engines = Array.isArray(body.engines) && body.engines.length > 0
    ? body.engines
    : undefined;
  const requestedLang = typeof body.lang === 'string' && body.lang.trim() ? body.lang.trim() : 'auto';

  // Firecrawl `sources` array: 'web' | 'news' | 'images'.
  const sources: string[] = Array.isArray(body.sources) && body.sources.length > 0
    ? body.sources.filter((s: any) => typeof s === 'string' && ['web', 'news', 'images'].includes(s.toLowerCase()))
    : ['web'];

  const wantsNews = sources.includes('news');
  const wantsImages = sources.includes('images');
  const wantsWeb = sources.includes('web') || (!wantsNews && !wantsImages);

  // Domain filters: instead of injecting `site:` operators into the query
  // (which pollutes relevance scoring and breaks some engines), we pass
  // them to searchEngines as separate options. The search engines add
  // `site:` / `-site:` as URL params where supported, and we also
  // post-filter the results by domain in the route handler.
  const includeDomains: string[] = Array.isArray(body.includeDomains) ? body.includeDomains : [];
  const excludeDomains: string[] = Array.isArray(body.excludeDomains) ? body.excludeDomains : [];

  // tbs (time-based search): pass as a separate parameter, NOT mixed
  // into the query string. Engines that support it (Bing) will use it
  // as a URL param; others will ignore it.
  const tbs: string | undefined = typeof body.tbs === 'string' && body.tbs.trim() ? body.tbs.trim() : undefined;

  // The clean query string — no site: operators, no &tbs= appended.
  // This is what relevance scoring operates on.
  const cleanQuery: string = body.query.trim();

  // When includeDomains is set, append site: operators to the engine
  // query (Bing and SearXNG support this natively in the q= parameter).
  // When excludeDomains is set, append -site: operators.
  let engineQuery = cleanQuery;
  if (includeDomains.length > 0) {
    engineQuery = `${engineQuery} (${includeDomains.map((d) => `site:${d}`).join(' OR ')})`;
  } else if (excludeDomains.length > 0) {
    engineQuery = `${engineQuery} ${excludeDomains.map((d) => `-site:${d}`).join(' ')}`;
  }

  const { results: allResults, engines: usedEngines, resolvedLang } = await (async () => {
    const tasks: Array<Promise<{ source: string; results: any[]; engines: string[] }>> = [];
    if (wantsWeb) {
      tasks.push(searchEngines(engineQuery, { limit, engines, lang: requestedLang, source: 'web', tbs })
        .then((r) => ({ source: 'web', results: r.results, engines: r.engines })));
    }
    if (wantsNews) {
      tasks.push(searchEngines(engineQuery, { limit, lang: requestedLang, source: 'news', tbs })
        .then((r) => ({ source: 'news', results: r.results, engines: r.engines })));
    }
    if (wantsImages) {
      tasks.push(searchEngines(engineQuery, { limit, lang: requestedLang, source: 'images', tbs })
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

  // ---- Post-filter results by domain (belt-and-suspenders) ----
  // Even when engines support site: operators, results sometimes
  // include non-matching domains. We filter here to be sure.
  let filtered = allResults;
  if (includeDomains.length > 0) {
    const domains = includeDomains.map((d) => d.toLowerCase().replace(/^\*\./, ''));
    filtered = filtered.filter((r: any) => {
      try {
        const host = new URL(r.url).hostname.toLowerCase();
        return domains.some((d) => host === d || host.endsWith('.' + d));
      } catch { return false; }
    });
  }
  if (excludeDomains.length > 0) {
    const domains = excludeDomains.map((d) => d.toLowerCase().replace(/^\*\./, ''));
    filtered = filtered.filter((r: any) => {
      try {
        const host = new URL(r.url).hostname.toLowerCase();
        return !domains.some((d) => host === d || host.endsWith('.' + d));
      } catch { return true; }
    });
  }

  const safe = body.safe === true;

  // Optional scrapeOptions: when present, scrape each result URL and
  // merge the scraped content into the search result items. Skip
  // scraping when source='images' (no page to scrape, just an image URL).
  const scrapeOpts: Record<string, any> | undefined = body.scrapeOptions;
  let enriched: typeof filtered;
  if (scrapeOpts && typeof scrapeOpts === 'object' && !wantsImages) {
    const formats: string[] = Array.isArray(scrapeOpts.formats) ? scrapeOpts.formats : ['markdown'];
    enriched = await mapWithConcurrency(filtered, 3, async (item) => {
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
    enriched = filtered;
  }

  return jsonResponse({
    success: true,
    query: body.query,
    total: enriched.length,
    engines: usedEngines,
    sources,
    lang: resolvedLang || requestedLang,
    ...(safe !== undefined ? { safe } : {}),
    ...(tbs ? { tbs } : {}),
    data: enriched,
  });
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
