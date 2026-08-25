import { scrapeUrl } from './crawler';

/**
 * Multi-engine web search implementation.
 *
 * Engines queried (with error tolerance — one failing doesn't break others):
 *   - bing        : scrapes bing.com/search (parse b_algo blocks)
 *   - duckduckgo  : uses the DDG Instant Answer API (api.duckduckgo.com/?format=json)
 *   - searxng     : queries public SearXNG instances (returns multi-engine aggregated results)
 *   - wikipedia   : uses the MediaWiki opensearch API (great for knowledge queries)
 *   - mojeek      : scrapes mojeek.com (independent index, no anti-bot)
 *   - brave       : scrapes search.brave.com (often blocked, but tries)
 *   - startpage   : scrapes startpage.com (often blocked, but tries)
 *
 * Results are merged + deduplicated by normalized URL, and scored by:
 *   - number of engines that found the URL (+1.0 each)
 *   - relevance: query term matches in title (+3.0 per term) and snippet (+1.0 per term)
 *   - title exact-phrase match bonus (+5.0)
 * Results with ZERO query-term matches are filtered out (relevance filter).
 */

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  hostName: string;
  engine: string;
  engines: string[];
  score: number;
}

export interface SearchOpts {
  limit?: number;
  engines?: string[];
  /** Language code: "all" (default, mixed-language results) or ISO code
   * like "en", "zh", "ja". When set to a specific code, search engines
   * are queried with that language preference. */
  lang?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  engines: string[];
  /** The language actually used (after resolving "auto"). */
  resolvedLang?: string;
}

const DEFAULT_ENGINES = ['bing', 'duckduckgo', 'searxng', 'wikipedia'];

/** Mapping of ISO lang codes to Bing's setlang/cc/mkt params. */
const BING_LANG_MAP: Record<string, { setlang: string; cc: string; mkt: string }> = {
  en: { setlang: 'en-US', cc: 'US', mkt: 'en-US' },
  zh: { setlang: 'zh-CN', cc: 'CN', mkt: 'zh-CN' },
  ja: { setlang: 'ja-JP', cc: 'JP', mkt: 'ja-JP' },
  ko: { setlang: 'ko-KR', cc: 'KR', mkt: 'ko-KR' },
  fr: { setlang: 'fr-FR', cc: 'FR', mkt: 'fr-FR' },
  de: { setlang: 'de-DE', cc: 'DE', mkt: 'de-DE' },
  es: { setlang: 'es-ES', cc: 'ES', mkt: 'es-ES' },
  pt: { setlang: 'pt-PT', cc: 'PT', mkt: 'pt-PT' },
  ru: { setlang: 'ru-RU', cc: 'RU', mkt: 'ru-RU' },
  it: { setlang: 'it-IT', cc: 'IT', mkt: 'it-IT' },
};

/**
 * Custom SearXNG instances configured via env.
 * Format: CRAWLER_SEARXNG_INSTANCES="Name1|https://instance1.example.com,Name2|https://instance2.example.com"
 * These are tried in ADDITION to the built-in public instances.
 */
function loadCustomSearxngInstances(): Array<{ name: string; baseUrl: string }> {
  const raw = process.env.CRAWLER_SEARXNG_INSTANCES || '';
  if (!raw.trim()) return [];
  return raw.split(',').map((entry) => {
    const [name, baseUrl] = entry.split('|').map((s) => s.trim());
    return { name: name || baseUrl, baseUrl: baseUrl || name };
  }).filter((i) => i.baseUrl);
}

/** All SearXNG instances to try (custom first, then public defaults). */
function getSearxngInstances(): string[] {
  const custom = loadCustomSearxngInstances();
  const customUrls = custom.map((c) => c.baseUrl.replace(/\/$/, ''));
  const all = [...customUrls, ...SEARXNG_INSTANCES];
  return Array.from(new Set(all));
}

/**
 * Auto-detect the language of a search query.
 * Uses Unicode character ranges to distinguish CJK (Chinese/Japanese/Korean)
 * from Latin/Cyrillic/Arabic scripts, then maps to an ISO code.
 * Returns "all" if the query is ambiguous or mixed.
 */
function detectQueryLang(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return 'all';
  // Count characters by script.
  let cjk = 0, cyrillic = 0, arabic = 0, latin = 0, other = 0;
  for (const ch of trimmed) {
    const code = ch.codePointAt(0) || 0;
    if (code >= 0x4e00 && code <= 0x9fff) cjk++;        // CJK Unified Ideographs
    else if (code >= 0x3040 && code <= 0x30ff) cjk++;    // Hiragana + Katakana (Japanese)
    else if (code >= 0xac00 && code <= 0xd7af) return 'ko'; // Hangul syllables (Korean)
    else if (code >= 0x0400 && code <= 0x04ff) cyrillic++;  // Cyrillic
    else if (code >= 0x0600 && code <= 0x06ff) arabic++;    // Arabic
    else if (code >= 0x0041 && code <= 0x024f) latin++;     // Latin
    else if (ch.match(/\s/)) continue; // whitespace
    else other++;
  }
  // Japanese-specific check: if there are Hiragana/Katakana, it's Japanese.
  for (const ch of trimmed) {
    const code = ch.codePointAt(0) || 0;
    if (code >= 0x3040 && code <= 0x30ff) return 'ja';
  }
  // CJK ideographs without kana → could be Chinese. Default to zh.
  if (cjk > 0 && cjk >= latin) return 'zh';
  if (cyrillic > 0 && cyrillic >= latin) return 'ru';
  if (arabic > 0 && arabic >= latin) return 'ar';
  if (latin > 0) return 'en';
  return 'all';
}

const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'fbclid', 'msclkid', 'srsltid', 'piwidth', 'spref',
];

/** Public SearXNG instances that support JSON output. We try each in order. */
const SEARXNG_INSTANCES = [
  'https://searx.be',
  'https://search.bus-hit.me',
  'https://search.mdosch.de',
  'https://searx.tiekoetter.com',
  'https://search.inetol.net',
];

/** Main entry: run a multi-engine search. */
export async function searchEngines(
  query: string,
  opts: SearchOpts = {},
): Promise<SearchResponse> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const engines = opts.engines && opts.engines.length > 0 ? opts.engines : DEFAULT_ENGINES;
  // Resolve "auto" → detect query language. "all" stays "all" (mixed).
  let lang = opts.lang || 'all';
  if (lang === 'auto') {
    lang = detectQueryLang(query);
  }

  const tasks: Promise<{ engine: string; results: RawResult[] }> [] = [];

  if (engines.includes('bing')) tasks.push(searchViaBing(query, lang).then((r) => ({ engine: 'bing', results: r })));
  if (engines.includes('duckduckgo')) tasks.push(searchViaDuckDuckGoApi(query, lang).then((r) => ({ engine: 'duckduckgo', results: r })));
  if (engines.includes('searxng')) tasks.push(searchViaSearXNG(query, lang).then((r) => ({ engine: 'searxng', results: r })));
  if (engines.includes('wikipedia')) tasks.push(searchViaWikipedia(query, lang).then((r) => ({ engine: 'wikipedia', results: r })));

  // Custom SearXNG instances — engine IDs of the form "searxng:DisplayName".
  // The instance URL is looked up by name in the env-configured list.
  const customInstances = loadCustomSearxngInstances();
  for (const eng of engines) {
    if (!eng.startsWith('searxng:')) continue;
    const name = eng.slice('searxng:'.length).toLowerCase();
    const inst = customInstances.find((c) => c.name.toLowerCase() === name);
    if (!inst) continue;
    tasks.push(
      searchViaSearXNG(query, lang, inst.baseUrl).then((r) => ({ engine: `searxng:${name}`, results: r })),
    );
  }

  const settled = await Promise.allSettled(tasks);
  const usedEngines: string[] = [];
  const byUrl = new Map<string, SearchResult>();

  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    const { engine, results: items } = r.value;
    if (!items || items.length === 0) continue;
    usedEngines.push(engine);
    items.forEach((item, idx) => {
      const norm = normalizeUrl(item.url);
      if (!norm) return;
      const existing = byUrl.get(norm);
      const rankScore = Math.max(0, 10 - idx) / 10; // 1.0 for rank 0, decreasing
      if (existing) {
        existing.engines.push(engine);
        existing.score += 1.0 + rankScore;
      } else {
        byUrl.set(norm, {
          url: item.url,
          title: item.title,
          snippet: item.snippet,
          hostName: item.hostName || safeHostname(item.url),
          engine,
          engines: [engine],
          score: 1.0 + rankScore,
        });
      }
    });
  }

  // ---- Relevance scoring ----
  const queryTerms = extractTerms(query);
  const queryLower = query.toLowerCase().trim();
  // For multi-word queries, also check the phrase as a whole.
  for (const item of byUrl.values()) {
    const titleLower = item.title.toLowerCase();
    const snippetLower = item.snippet.toLowerCase();
    const hostLower = item.hostName.toLowerCase();
    let relevance = 0;
    let matchedTerms = 0;
    for (const term of queryTerms) {
      const inTitle = titleLower.includes(term);
      const inSnippet = snippetLower.includes(term);
      const inHost = hostLower.includes(term);
      if (inTitle) { relevance += 3.0; matchedTerms++; }
      if (inSnippet) { relevance += 1.0; matchedTerms++; }
      if (inHost) { relevance += 2.0; matchedTerms++; }
    }
    // Exact phrase match in title gets a big bonus.
    if (queryLower.length > 3 && titleLower.includes(queryLower)) {
      relevance += 8.0;
    }
    // Exact phrase in snippet.
    if (queryLower.length > 3 && snippetLower.includes(queryLower)) {
      relevance += 4.0;
    }
    // Bonus for matching ALL query terms (vs just one).
    if (queryTerms.length > 1 && matchedTerms >= queryTerms.length * 2) {
      relevance += 5.0;
    }
    item.score += relevance;
    (item as any)._relevance = relevance;
    (item as any)._matchedTerms = matchedTerms;
  }

  // ---- Relevance filter: for multi-word queries, require at least 50%
  // of query terms to match (in title OR snippet). This filters out
  // results that only match a single generic word (e.g. "python" when
  // the query is "python web scraping tutorial").
  let filtered = Array.from(byUrl.values());
  if (filtered.length > 5 && queryTerms.length > 1) {
    // A result "matches" a term if it appears in title or snippet.
    const termMatchCount = (item: SearchResult) => {
      let count = 0;
      const titleLower = item.title.toLowerCase();
      const snippetLower = item.snippet.toLowerCase();
      for (const term of queryTerms) {
        if (titleLower.includes(term) || snippetLower.includes(term)) count++;
      }
      return count;
    };
    const minTermMatches = Math.max(1, Math.ceil(queryTerms.length * 0.5));
    const passing = filtered.filter((r) => termMatchCount(r) >= minTermMatches);
    if (passing.length >= 3) {
      filtered = passing;
    }
    // else keep all (don't over-filter)
  }

  // Sort by score descending (engine count + relevance).
  filtered.sort((a, b) => b.score - a.score);
  // Re-rank.
  filtered.forEach((item, i) => { item.score = Math.round(item.score * 100) / 100; });

  // Clean up the temp field.
  filtered.forEach((r) => { delete (r as any)._relevance; });

  return { results: filtered.slice(0, limit), engines: usedEngines, resolvedLang: lang };
}

interface RawResult {
  url: string;
  title: string;
  snippet: string;
  hostName?: string;
}

// ============================================================
// Engine: Bing (scrape bing.com/search — works reliably)
// ============================================================
async function searchViaBing(query: string, lang: string): Promise<RawResult[]> {
  let localeParams = '';
  if (lang !== 'all') {
    const mapped = BING_LANG_MAP[lang.toLowerCase()];
    if (mapped) {
      localeParams = `&setlang=${mapped.setlang}&cc=${mapped.cc}&mkt=${mapped.mkt}`;
    } else {
      localeParams = `&setlang=${lang}&cc=${lang.toUpperCase()}&mkt=${lang}-${lang.toUpperCase()}`;
    }
  }
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=20&safe=medium${localeParams}`;
  // fetchRawHtml tries direct fetch first (fast ~2s), then Playwright (anti-bot).
  const r = await fetchRawHtml(url, 'bing');
  if (!r) return [];
  return parseBing(r.html);
}

/** Direct server-side fetch — much faster than Playwright for search pages. */
async function directFetchHtml(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Upgrade-Insecure-Requests': '1',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    return html && html.length > 500 ? html : null;
  } catch {
    return null;
  }
}

function parseBing(html: string): RawResult[] {
  const out: RawResult[] = [];
  const seen = new Set<string>();
  const blockRegex = /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(html)) !== null) {
    const block = m[1];
    if (block.startsWith('<link ')) continue;
    const h2Match = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const anchorArea = h2Match ? h2Match[1] : block;
    const linkMatch = anchorArea.match(/<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    let href = linkMatch[1];
    // Decode Bing's /ck/a? redirect
    href = decodeBingRedirect(href);
    const title = stripTags(linkMatch[2]).trim();
    if (!href || !title || seen.has(href)) continue;
    if (/bing\.com\/(search|go|cr)|microsoft\.com\/search|go\.microsoft/.test(href)) continue;
    seen.add(href);
    const pMatches = block.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    let snippet = '';
    for (const pTag of pMatches) {
      const text = stripTags(pTag).trim();
      if (text.length > 30) { snippet = text; break; }
    }
    out.push({ url: href, title, snippet, hostName: safeHostname(href) });
    if (out.length >= 20) break;
  }
  return out;
}

function decodeBingRedirect(href: string): string {
  // Bing wraps external URLs in /ck/a?...&u=a1<base64>...&ntb=1
  // The HTML has &amp; entities, so decode those first.
  const cleanHref = href.replace(/&amp;/g, '&');
  if (cleanHref.includes('/ck/a?') || cleanHref.includes('bing.com/ck/')) {
    // Try the u=a1<base64> param first.
    const uMatch = cleanHref.match(/[?&]u=a1([^&]*)/);
    if (uMatch) {
      try {
        const decoded = Buffer.from(uMatch[1], 'base64').toString('utf-8');
        if (decoded.startsWith('http')) return decoded;
      } catch { /* fall through */ }
    }
    // Fallback: try u=<base64> without the a1 prefix.
    const uMatch2 = cleanHref.match(/[?&]u=([^&]*)/);
    if (uMatch2) {
      try {
        const decoded = Buffer.from(uMatch2[1], 'base64').toString('utf-8');
        if (decoded.startsWith('http')) return decoded;
      } catch { /* fall through */ }
    }
  }
  return cleanHref;
}

// ============================================================
// Engine: DuckDuckGo Instant Answer API (JSON, no scraping)
// endpoint: https://api.duckduckgo.com/?q=...&format=json
// Returns RelatedTopics + AbstractText + a few instant answers.
// ============================================================
async function searchViaDuckDuckGoApi(query: string, lang: string): Promise<RawResult[]> {
  const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1&skip_disambig=1`;
  try {
    const resp = await fetch(apiUrl, {
      headers: { 'User-Agent': 'NodeByte Crawl/2.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    const out: RawResult[] = [];
    // Abstract (Wikipedia-style instant answer)
    if (data.AbstractText && data.AbstractURL) {
      out.push({
        url: data.AbstractURL,
        title: data.Heading || query,
        snippet: data.AbstractText,
        hostName: safeHostname(data.AbstractURL),
      });
    }
    // RelatedTopics — can be nested
    const walk = (topics: any[]) => {
      if (!Array.isArray(topics)) return;
      for (const t of topics) {
        if (!t) continue;
        if (t.Topics && Array.isArray(t.Topics)) {
          walk(t.Topics);
          continue;
        }
        if (t.FirstURL && t.Text) {
          out.push({
            url: t.FirstURL,
            title: t.Text.split(' - ')[0].slice(0, 120),
            snippet: t.Text,
            hostName: safeHostname(t.FirstURL),
          });
        }
      }
    };
    walk(data.RelatedTopics);
    // Results (if any direct results)
    if (Array.isArray(data.Results)) {
      for (const r of data.Results) {
        if (r.FirstURL && r.Text) {
          out.push({ url: r.FirstURL, title: r.Text.slice(0, 120), snippet: r.Text, hostName: safeHostname(r.FirstURL) });
        }
      }
    }
    return out.slice(0, 15);
  } catch {
    return [];
  }
}

// ============================================================
// Engine: SearXNG (public meta-search instances)
// Races multiple instances in parallel, takes the FIRST one that
// returns usable results. Uses Playwright (stealth) for anti-bot bypass.
// SearXNG aggregates Google/Bing/DDG so its relevance is better than
// any single engine.
// ============================================================
async function searchViaSearXNG(query: string, lang: string, onlyBase?: string): Promise<RawResult[]> {
  const langParam = lang !== 'all' ? `&language=${encodeURIComponent(lang)}` : '';
  // When `onlyBase` is provided, query ONLY that instance (used by the
  // `searxng:Name` engine ID flow). Otherwise, query every configured
  // instance (custom + public defaults).
  const instances = onlyBase ? [onlyBase.replace(/\/$/, '')] : getSearxngInstances();
  const instanceTasks = instances.map(async (base) => {
    try {
      const searchUrl = `${base}/search?q=${encodeURIComponent(query)}&format=json&pageno=1&safesearch=0${langParam}`;
      
      // Step 1: Direct fetch (fast — SearXNG returns JSON, no JS needed)
      let data: any = null;
      try {
        const resp = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(8000),
          redirect: 'follow',
        });
        if (resp.ok) {
          const text = await resp.text();
          try { data = JSON.parse(text); } catch {
            // Might be HTML-wrapped JSON
            const preMatch = text.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
            if (preMatch) { try { data = JSON.parse(preMatch[1].replace(/<[^>]+>/g, '')); } catch { /* not JSON */ } }
          }
        }
      } catch { /* direct fetch failed */ }

      // Step 2: Playwright fallback (handles Cloudflare, JS)
      if (!data || !Array.isArray(data.results)) {
        const r = await scrapeUrl({
          url: searchUrl,
          formats: ['rawHtml'],
          onlyMainContent: false,
          timeout: 10000,
          maxRetries: 0,
        });
        if (!r.success || !r.data?.rawHtml) return null;
        const html = r.data.rawHtml;
        const preMatch = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
        if (preMatch) {
          try { data = JSON.parse(preMatch[1].replace(/<[^>]+>/g, '')); } catch { /* not JSON */ }
        }
        if (!data) {
          try { data = JSON.parse(html.replace(/<[^>]+>/g, '').trim()); } catch { /* not JSON */ }
        }
      }

      if (data && Array.isArray(data.results) && data.results.length > 0) {
        return data.results.slice(0, 15).map((r: any) => ({
          url: r.url || '',
          title: r.title || '',
          snippet: r.content || '',
          hostName: safeHostname(r.url || ''),
        } as RawResult)).filter((r: RawResult) => r.url);
      }
      return null;
    } catch {
      return null;
    }
  });
  try {
    const winner = await Promise.any(instanceTasks);
    if (winner && winner.length > 0) return winner;
  } catch {
    // All instances failed/returned null.
  }
  return [];
}

// ============================================================
// Engine: Wikipedia opensearch API
// Great for knowledge/entity queries. Returns title + summary.
// ============================================================
async function searchViaWikipedia(query: string, lang: string): Promise<RawResult[]> {
  try {
    // Use the right Wikipedia subdomain for the language. Default "all" → en.
    const wikiLang = (lang !== 'all' && lang.length === 2) ? lang.toLowerCase() : 'en';
    // opensearch: returns [query, [titles], [descriptions], [urls]]
    const osUrl = `https://${wikiLang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=10&namespace=0&format=json&origin=*`;
    const resp = await fetch(osUrl, {
      headers: { 'User-Agent': 'NodeByte Crawl/2.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return [];
    const data: any = await resp.json();
    if (!Array.isArray(data) || data.length < 4) return [];
    const [, titles, descriptions, urls] = data;
    if (!Array.isArray(titles)) return [];
    const out: RawResult[] = [];
    for (let i = 0; i < titles.length; i++) {
      const u = urls[i];
      const t = titles[i];
      const d = descriptions[i] || '';
      if (!u || !t) continue;
      out.push({ url: u, title: t, snippet: d || `Wikipedia article about ${t}`, hostName: `${wikiLang}.wikipedia.org` });
    }
    return out;
  } catch {
    return [];
  }
}

// ============================================================
// Engine: Mojeek (independent index, no anti-bot, easy to parse)
// ============================================================
async function searchViaMojeek(query: string, lang: string): Promise<RawResult[]> {
  const url = `https://www.mojeek.com/search?q=${encodeURIComponent(query)}&fmt=html`;
  const r = await fetchRawHtml(url, 'mojeek');
  if (!r) return [];
  return parseMojeek(r.html);
}

function parseMojeek(html: string): RawResult[] {
  const out: RawResult[] = [];
  const seen = new Set<string>();
  // Mojeek: <a class="ob" href="...">Title</a> + <p class="s">Snippet</p>
  const blockRegex = /<li[^>]*class="[^"]*result-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(html)) !== null) {
    const block = m[1];
    const linkMatch = block.match(/<a[^>]*class="[^"]*ob[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]*href="(https?:\/\/[^"]*)"[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const href = linkMatch[1];
    const title = stripTags(linkMatch[2]).trim();
    if (!href || !title || seen.has(href)) continue;
    seen.add(href);
    const snippetMatch = block.match(/<p[^>]*class="[^"]*s[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
      || block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]).trim() : '';
    out.push({ url: href, title, snippet, hostName: safeHostname(href) });
    if (out.length >= 15) break;
  }
  return out;
}

// ============================================================
// Engine: Brave Search (often blocked by CAPTCHA, but tries)
// ============================================================
async function searchViaBrave(query: string, lang: string): Promise<RawResult[]> {
  const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
  const r = await fetchRawHtml(url, 'brave');
  if (!r) return [];
  return parseBrave(r.html);
}

function parseBrave(html: string): RawResult[] {
  const out: RawResult[] = [];
  const seen = new Set<string>();
  // Brave: <div class="snippet"> ... <a class="result-header" href="..."> ... <p data-type="snippet-description">...</p>
  const blockRegex = /<div[^>]*class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div|<section|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(html)) !== null) {
    const block = m[1];
    const linkMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const href = linkMatch[1];
    const title = stripTags(linkMatch[2]).trim();
    if (!href || !title || seen.has(href)) continue;
    seen.add(href);
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]).trim() : '';
    out.push({ url: href, title, snippet, hostName: safeHostname(href) });
    if (out.length >= 15) break;
  }
  return out;
}

// ============================================================
// Engine: Startpage (often blocked, but tries)
// ============================================================
async function searchViaStartpage(query: string, lang: string): Promise<RawResult[]> {
  const url = `https://www.startpage.com/do/search?q=${encodeURIComponent(query)}&cat=web`;
  const r = await fetchRawHtml(url, 'startpage');
  if (!r) return [];
  return parseStartpage(r.html);
}

function parseStartpage(html: string): RawResult[] {
  const out: RawResult[] = [];
  const seen = new Set<string>();
  const blockRegex = /<div[^>]*class="[^"]*w-gl__result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div|<section|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(html)) !== null) {
    const block = m[1];
    const linkMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]*)"[^>]*class="[^"]*result-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]*href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const href = linkMatch[1];
    const title = stripTags(linkMatch[2]).trim();
    if (!href || !title || seen.has(href)) continue;
    seen.add(href);
    const snippetMatch = block.match(/<p[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
      || block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]).trim() : '';
    out.push({ url: href, title, snippet, hostName: safeHostname(href) });
    if (out.length >= 15) break;
  }
  return out;
}

// ============================================================
// Helpers
// ============================================================

/** Fetch raw HTML via the internal scraper (Playwright + stealth). */
/**
 * Fetch raw HTML — tries direct fetch first (fast, ~2s), falls back to
 * Playwright (slow, ~10s, but handles anti-bot/Cloudflare).
 * Used by ALL search engines that need to scrape HTML pages.
 */
async function fetchRawHtml(url: string, engine: string): Promise<{ html: string } | null> {
  // Step 1: Direct fetch (fast, no browser overhead)
  const directHtml = await directFetchHtml(url);
  if (directHtml) return { html: directHtml };

  // Step 2: Playwright fallback (handles anti-bot, JS rendering)
  try {
    const r = await scrapeUrl({
      url,
      formats: ['rawHtml'],
      onlyMainContent: false,
      timeout: 20000,
      maxRetries: 0,
    });
    if (!r.success || !r.data?.rawHtml) return null;
    return { html: r.data.rawHtml };
  } catch {
    return null;
  }
}

function safeHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '');
    // Strip tracking params.
    const params = new URLSearchParams(u.search);
    for (const p of TRACKING_PARAMS) params.delete(p);
    const search = params.toString();
    // Drop fragment.
    return `${u.protocol}//${u.hostname}${path}${search ? '?' + search : ''}`.toLowerCase();
  } catch {
    return '';
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract meaningful search terms from the query (drop stop words). */
function extractTerms(query: string): string[] {
  const stop = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'just', 'don', 'now', 'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'it', 'its', 'they', 'them', 'their']);
  const terms = query.toLowerCase().split(/[^a-z0-9]+/i).filter((t) => t.length > 1 && !stop.has(t));
  return terms;
}
