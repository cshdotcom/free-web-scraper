/**
 * Shared doc data: endpoint definitions, env vars, code samples.
 *
 * Kept in a plain TS module (no React) so it can be imported by both
 * server and client components without hydration issues.
 */

export type HttpMethod = 'POST' | 'GET' | 'DELETE';

export interface EndpointParam {
  name: string;
  type: string;
  required: boolean;
  default?: string;
  description: string;
}

export interface EndpointDef {
  /** Anchor id (used by the TOC). */
  id: string;
  method: HttpMethod;
  path: string;
  /** Short one-line description. */
  summary: string;
  /** Longer description. */
  description: string;
  params: EndpointParam[];
  /** Request body example (JSON string). */
  requestExample: string;
  /** Response example (JSON string). */
  responseExample: string;
}

function buildEndpoints(baseUrl: string): EndpointDef[] {
  return [
  {
    id: 'scrape',
    method: 'POST',
    path: '/v2/scrape',
    summary: 'Scrape a single URL → markdown/html/links/screenshot.',
    description:
      'Renders the page with a headless Chromium, waits for network idle, ' +
      'then returns the content in any combination of formats. Use this for ' +
      'one-off scrapes where you need clean, JS-rendered output.',
    params: [
      { name: 'url', type: 'string', required: true, description: 'Absolute URL to scrape.' },
      {
        name: 'formats',
        type: 'string[]',
        required: false,
        default: '["markdown"]',
        description: 'Output formats. One or more of: markdown, html, rawHtml, links, screenshot.',
      },
      {
        name: 'onlyMainContent',
        type: 'boolean',
        required: false,
        default: 'true',
        description: 'Drop nav/footer/sidebar noise; keep main article body.',
      },
      {
        name: 'includeTags',
        type: 'string[]',
        required: false,
        default: '[]',
        description: 'CSS selectors to include (overrides main-content strategy).',
      },
      {
        name: 'excludeTags',
        type: 'string[]',
        required: false,
        default: '[]',
        description: 'CSS selectors to exclude from the output.',
      },
      {
        name: 'timeout',
        type: 'number',
        required: false,
        default: '45000',
        description: 'Navigation timeout (ms).',
      },
      {
        name: 'waitFor',
        type: 'number',
        required: false,
        default: '0',
        description: 'Extra ms to wait after load (for lazy content).',
      },
      {
        name: 'maxRetries',
        type: 'number',
        required: false,
        default: '2',
        description: 'Retries on 403/429/503/network errors (exponential backoff).',
      },
      {
        name: 'device',
        type: 'string',
        required: false,
        default: 'auto',
        description: "Device emulation: 'auto' (random desktop/mobile), 'desktop', or 'mobile'. Picks matching UA + viewport.",
      },
    ],
    requestExample: JSON.stringify(
      {
        url: 'https://example.com',
        formats: ['markdown', 'html', 'links'],
        onlyMainContent: true,
        timeout: 45000,
        maxRetries: 2,
        device: 'auto',
      },
      null,
      2,
    ),
    responseExample: JSON.stringify(
      {
        success: true,
        data: {
          markdown: '# Example Domain\n\nExample Domains...',
          html: '<html><body>...</body></html>',
          links: ['https://www.iana.org/domains/example'],
          metadata: {
            title: 'Example Domain',
            description: 'Example domain',
            url: 'https://example.com',
            statusCode: 200,
          },
          statusCode: 200,
          strategy: 'readability',
        },
        attempts: 1,
      },
      null,
      2,
    ),
  },
  {
    id: 'scrape-batch',
    method: 'POST',
    path: '/v2/scrape/batch',
    summary: 'Synchronous batch scrape (returns when all URLs are done).',
    description:
      'Scrape multiple URLs at once. Same options as /v2/scrape, applied to ' +
      'every URL. Concurrency is bounded by CRAWLER_MAX_CONCURRENCY. Use this ' +
      'for modest batches (< 20 URLs) where you can wait for all results.',
    params: [
      { name: 'urls', type: 'string[]', required: true, description: 'List of absolute URLs.' },
      {
        name: 'formats',
        type: 'string[]',
        required: false,
        default: '["markdown"]',
        description: 'Same as /v2/scrape.',
      },
      {
        name: 'onlyMainContent',
        type: 'boolean',
        required: false,
        default: 'true',
        description: 'Same as /v2/scrape.',
      },
      { name: 'includeTags', type: 'string[]', required: false, default: '[]', description: 'Same as /v2/scrape.' },
      { name: 'excludeTags', type: 'string[]', required: false, default: '[]', description: 'Same as /v2/scrape.' },
      { name: 'timeout', type: 'number', required: false, default: '45000', description: 'Per-URL timeout (ms).' },
      { name: 'maxRetries', type: 'number', required: false, default: '2', description: 'Per-URL retry count.' },
    ],
    requestExample: JSON.stringify(
      {
        urls: ['https://example.com', 'https://example.org'],
        formats: ['markdown'],
        onlyMainContent: true,
      },
      null,
      2,
    ),
    responseExample: JSON.stringify(
      {
        success: true,
        data: [
          {
            url: 'https://example.com',
            success: true,
            data: { markdown: '# Example Domain\n\n...', metadata: { title: 'Example Domain' } },
          },
          {
            url: 'https://example.org',
            success: true,
            data: { markdown: '# Example\n\n...', metadata: { title: 'Example' } },
          },
        ],
      },
      null,
      2,
    ),
  },
  {
    id: 'batch-scrape',
    method: 'POST',
    path: '/v2/batch/scrape',
    summary: 'Start an async batch job (returns immediately).',
    description:
      'Submit a large batch and get back a job id. Poll GET /v2/batch/scrape/:id ' +
      'until status is "completed". Results are kept for 30 minutes after completion.',
    params: [
      { name: 'urls', type: 'string[]', required: true, description: 'List of absolute URLs.' },
      {
        name: 'formats',
        type: 'string[]',
        required: false,
        default: '["markdown"]',
        description: 'Same as /v2/scrape.',
      },
      {
        name: 'onlyMainContent',
        type: 'boolean',
        required: false,
        default: 'true',
        description: 'Same as /v2/scrape.',
      },
      { name: 'includeTags', type: 'string[]', required: false, default: '[]', description: 'Same as /v2/scrape.' },
      { name: 'excludeTags', type: 'string[]', required: false, default: '[]', description: 'Same as /v2/scrape.' },
      { name: 'timeout', type: 'number', required: false, default: '45000', description: 'Per-URL timeout (ms).' },
      { name: 'maxRetries', type: 'number', required: false, default: '2', description: 'Per-URL retry count.' },
    ],
    requestExample: JSON.stringify(
      {
        urls: ['https://example.com', 'https://example.org', 'https://example.net'],
        formats: ['markdown'],
      },
      null,
      2,
    ),
    responseExample: JSON.stringify(
      {
        success: true,
        id: 'batch_01HFQ...',
        url: `${baseUrl}/v2/batch/scrape/batch_01HFQ...`,
      },
      null,
      2,
    ),
  },
  {
    id: 'batch-scrape-poll',
    method: 'GET',
    path: '/v2/batch/scrape/:id',
    summary: 'Poll an async batch job.',
    description:
      'Returns current status, completed/total counts, and (when complete) the ' +
      'scraped results for every URL in the batch. Safe to poll every 2 seconds.',
    params: [
      { name: 'id', type: 'string', required: true, description: 'Batch job id (returned by POST /v2/batch/scrape).' },
    ],
    requestExample: '// GET /v2/batch/scrape/batch_01HFQ...\n// no body',
    responseExample: JSON.stringify(
      {
        success: true,
        status: 'completed',
        total: 3,
        completed: 3,
        data: [
          {
            url: 'https://example.com',
            success: true,
            data: { markdown: '# Example Domain\n\n...', metadata: { title: 'Example Domain' } },
          },
        ],
        expiresAt: '2025-01-01T12:30:00.000Z',
      },
      null,
      2,
    ),
  },
  {
    id: 'crawl',
    method: 'POST',
    path: '/v2/crawl',
    summary: 'Start a BFS recursive crawl.',
    description:
      'Crawls a seed URL up to maxDepth levels deep, following same-origin links. ' +
      'Use includes/excludes to constrain the URL pattern. Returns a job id; poll ' +
      'GET /v2/crawl/:id for progress and results. Cancel with DELETE /v2/crawl/:id.',
    params: [
      { name: 'url', type: 'string', required: true, description: 'Seed URL.' },
      {
        name: 'maxDepth',
        type: 'number',
        required: false,
        default: '2',
        description: 'BFS recursion depth (1–5). 1 = only the seed page.',
      },
      {
        name: 'limit',
        type: 'number',
        required: false,
        default: '20',
        description: 'Maximum pages to scrape.',
      },
      {
        name: 'includes',
        type: 'string[]',
        required: false,
        default: '[]',
        description: 'Glob patterns that URLs must match to be crawled (e.g. ["*/docs/*"]).',
      },
      {
        name: 'excludes',
        type: 'string[]',
        required: false,
        default: '[]',
        description: 'Glob patterns to skip (e.g. ["*/login/*","*/archive/*"]).',
      },
      {
        name: 'scrapeOptions',
        type: 'object',
        required: false,
        default: '{ formats: ["markdown"], onlyMainContent: true, device: "auto" }',
        description: 'Same fields as /v2/scrape. Key options: formats (array of "markdown"|"html"|"rawHtml"|"links"|"screenshot"), onlyMainContent (bool), includeTags, excludeTags, timeout, waitFor, maxRetries, device ("auto"|"desktop"|"mobile").',
      },
    ],
    requestExample: JSON.stringify(
      {
        url: 'https://example.com',
        maxDepth: 2,
        limit: 20,
        includes: ['*'],
        excludes: ['*/login/*', '*/admin/*'],
        scrapeOptions: { formats: ['markdown'], onlyMainContent: true },
      },
      null,
      2,
    ),
    responseExample: JSON.stringify(
      {
        success: true,
        id: 'crawl_01HFQ...',
        url: `${baseUrl}/v2/crawl/crawl_01HFQ...`,
      },
      null,
      2,
    ),
  },
  {
    id: 'crawl-poll',
    method: 'GET',
    path: '/v2/crawl/:id',
    summary: 'Poll a crawl job.',
    description:
      'Returns the crawl status, completed/total counts, and the scraped pages ' +
      'when complete. Poll every 2 seconds until status === "completed".',
    params: [
      { name: 'id', type: 'string', required: true, description: 'Crawl job id.' },
    ],
    requestExample: '// GET /v2/crawl/crawl_01HFQ...',
    responseExample: JSON.stringify(
      {
        success: true,
        status: 'completed',
        total: 12,
        completed: 12,
        data: [
          {
            url: 'https://example.com',
            markdown: '# Example Domain\n\n...',
            metadata: { title: 'Example Domain' },
          },
        ],
        expiresAt: '2025-01-01T12:30:00.000Z',
      },
      null,
      2,
    ),
  },
  {
    id: 'crawl-cancel',
    method: 'DELETE',
    path: '/v2/crawl/:id',
    summary: 'Cancel a running crawl job.',
    description:
      'Marks the crawl as cancelled. Any in-flight page renders finish, but ' +
      'no new ones start. Subsequent polls return status: "cancelled".',
    params: [
      { name: 'id', type: 'string', required: true, description: 'Crawl job id to cancel.' },
    ],
    requestExample: '// DELETE /v2/crawl/crawl_01HFQ...',
    responseExample: JSON.stringify({ success: true, id: 'crawl_01HFQ...', status: 'cancelled' }, null, 2),
  },
  {
    id: 'map',
    method: 'POST',
    path: '/v2/map',
    summary: 'Map all links on a site (no scraping).',
    description:
      'Fast link-discovery pass: renders the seed page, extracts every <a href>, ' +
      'optionally filters by substring and includes subdomains. Much cheaper ' +
      'than a crawl when you just want the URL list.',
    params: [
      { name: 'url', type: 'string', required: true, description: 'Seed URL.' },
      {
        name: 'search',
        type: 'string',
        required: false,
        default: '""',
        description: 'Substring filter; only links containing this string are returned.',
      },
      {
        name: 'limit',
        type: 'number',
        required: false,
        default: '100',
        description: 'Max links to return.',
      },
      {
        name: 'includeSubdomains',
        type: 'boolean',
        required: false,
        default: 'false',
        description: 'Include links on subdomains of the seed host.',
      },
    ],
    requestExample: JSON.stringify(
      { url: 'https://example.com', search: 'docs', limit: 50, includeSubdomains: false },
      null,
      2,
    ),
    responseExample: JSON.stringify(
      {
        success: true,
        links: [
          'https://example.com/docs/intro',
          'https://example.com/docs/api',
          'https://example.com/docs/guides',
        ],
      },
      null,
      2,
    ),
  },
  {
    id: 'search',
    method: 'POST',
    path: '/v2/search',
    summary: 'Multi-engine web search (Firecrawl v2 format).',
    description:
      'Query Bing + DuckDuckGo + Brave + Mojeek + Startpage in parallel. ' +
      'Engine failures are tolerated — one blocked engine does not break the ' +
      'request. Results are merged, deduplicated, and ranked by score.',
    params: [
      { name: 'query', type: 'string', required: true, description: 'Search query.' },
      {
        name: 'limit',
        type: 'number',
        required: false,
        default: '20',
        description: 'Max results to return.',
      },
      {
        name: 'engines',
        type: 'string[]',
        required: false,
        default: '["bing","duckduckgo","brave","mojeek","startpage"]',
        description: 'Which engines to query. Subset of the default pool.',
      },
      {
        name: 'lang',
        type: 'string',
        required: false,
        default: 'auto',
        description:
          "Search language: 'auto' (detect query lang), 'all' (mixed), or ISO code (en, zh, ja, ko, fr, de, es, pt, ru, it).",
      },
    ],
    requestExample: JSON.stringify(
      { query: 'best rust web framework', limit: 10, engines: ['bing', 'duckduckgo', 'brave'], lang: 'auto' },
      null,
      2,
    ),
    responseExample: JSON.stringify(
      {
        success: true,
        query: 'best rust web framework',
        total: 10,
        engines: ['bing', 'duckduckgo', 'brave'],
        lang: 'en',
        data: [
          {
            url: 'https://example.com/rust-web',
            title: 'Best Rust Web Frameworks in 2025',
            snippet: 'Comparison of Axum, Actix, Rocket...',
            hostName: 'example.com',
            engine: 'bing',
            engines: ['bing', 'duckduckgo'],
            score: 2.5,
          },
        ],
      },
      null,
      2,
    ),
  },
  {
    id: 'searxng',
    method: 'GET',
    path: '/search?q=&format=json',
    summary: 'SearxNG-compatible endpoint (for OpenWebUI).',
    description:
      'Drop-in SearxNG replacement. OpenWebUI can point its SEARXNG_API_URL at ' +
      'this endpoint. Auth (if enabled) is via ?key=<token> OR standard ' +
      'Authorization / X-API-Key headers.',
    params: [
      { name: 'q', type: 'string', required: true, description: 'Search query.' },
      { name: 'format', type: 'string', required: false, default: 'json', description: 'Must be "json".' },
      { name: 'key', type: 'string', required: false, default: '""', description: 'API key (only if CRAWLER_API_KEYS is set).' },
    ],
    requestExample: '// GET /search?q=best+rust+web+framework&format=json&key=nbc_key_abc123',
    responseExample: JSON.stringify(
      {
        query: 'best rust web framework',
        number_of_results: 10,
        results: [
          {
            title: 'Best Rust Web Frameworks in 2025',
            url: 'https://example.com/rust-web',
            content: 'Comparison of Axum, Actix, Rocket...',
            engine: 'bing',
            score: 2.5,
          },
        ],
      },
      null,
      2,
    ),
  },
  ];
}

/**
 * Endpoints with responseExamples resolved against the given baseUrl.
 * Memoize at the call site — calling this repeatedly on every render is wasteful.
 */
export function getEndpoints(baseUrl: string): EndpointDef[] {
  return buildEndpoints(baseUrl);
}

export interface EnvVar {
  name: string;
  default: string;
  description: string;
}

export const ENV_VARS: EnvVar[] = [
  {
    name: 'CRAWLER_API_KEYS',
    default: '(unset)',
    description:
      'Comma-separated list of accepted API keys. Clients must present one via Authorization: Bearer or X-API-Key. Empty = auth disabled (open access).',
  },
  {
    name: 'CRAWLER_SERVICE_URL',
    default: 'http://localhost:3004',
    description: 'Internal crawler-service URL. The Next.js /v1/* and /v2/* routes proxy to this.',
  },
  {
    name: 'CRAWLER_USER_AGENT',
    default: 'NodeByte Crawl/2.0',
    description: 'Advertised user agent. The crawler also rotates a UA pool for anti-bot evasion.',
  },
  {
    name: 'CRAWLER_MAX_CONCURRENCY',
    default: '4',
    description: 'Max in-flight Playwright page renders. Higher = faster batch scraping, more RAM.',
  },
  {
    name: 'CRAWLER_TIMEOUT',
    default: '45000',
    description: 'Default navigation timeout (ms).',
  },
  {
    name: 'CRAWLER_CRAWL_MAX_DEPTH',
    default: '2',
    description: 'Default BFS depth for crawl jobs (1–5).',
  },
  {
    name: 'CRAWLER_MAX_RETRIES',
    default: '2',
    description: 'Max retries on 403/429/503/network errors (exponential backoff).',
  },
  {
    name: 'CRAWLER_STEALTH',
    default: 'true',
    description: 'Enable stealth anti-detection patches (navigator.webdriver removal, plugin spoofing).',
  },
  {
    name: 'CRAWLER_SEARCH_ENGINES',
    default: 'bing,duckduckgo,brave,mojeek,startpage',
    description: 'Engines to query for /v2/search and /search. One failing engine does not break the request.',
  },
  {
    name: 'CRAWLER_SEARCH_LIMIT',
    default: '20',
    description: 'Default max results per search query.',
  },
  {
    name: 'PLAYWRIGHT_BROWSERS_PATH',
    default: '(unset)',
    description: 'Path to a bundled Chromium dir. Leave empty to use Playwright-managed browser.',
  },
];

export interface FeatureCard {
  icon: string;
  title: string;
  description: string;
}

export const FEATURES: FeatureCard[] = [
  {
    icon: 'Globe',
    title: 'JS Rendering (Playwright)',
    description:
      'Every scrape runs through a headless Chromium. SPA content, lazy-loaded lists, and dynamic dashboards all come back rendered — not the barebones initial HTML.',
  },
  {
    icon: 'Layers',
    title: 'Main Content Extraction',
    description:
      'Multi-strategy extractor tries Readability, falls back to Mozilla Readability, then heuristics. Strips nav, footer, cookie walls, and ad slots so you get the article body only.',
  },
  {
    icon: 'Code',
    title: 'Markdown Output (GFM)',
    description:
      'Turndown converts the cleaned DOM to GitHub-flavored markdown with tables, lists, code fences, and links — ready to feed into LLMs or store as docs.',
  },
  {
    icon: 'Zap',
    title: 'Concurrent Scraping',
    description:
      'Bounded by CRAWLER_MAX_CONCURRENCY so your batch jobs do not melt the CPU. Sync batch (/v2/scrape/batch) and async batch (/v2/batch/scrape) both backpressure correctly.',
  },
  {
    icon: 'Shield',
    title: 'Stealth & Anti-Bot',
    description:
      'Rotating UA pool, navigator.webdriver removal, plugin spoofing, exponential backoff on 403/429, and automatic cookie-consent dismissal before extraction.',
  },
  {
    icon: 'Search',
    title: 'Multi-Engine Search',
    description:
      'Queries Bing, DuckDuckGo, Brave, Mojeek, and Startpage in parallel. Engine failures are tolerated — one blocked engine never breaks the request.',
  },
];

/** Quick-start code samples for the language tabs.
 *
 * Templates use `{BASE_URL}` and `{API_KEY}` placeholders. `resolveBaseUrl`
 * swaps `{BASE_URL}` for the actual detected domain, and (optionally)
 * `{API_KEY}` for either the user's saved key (so they can copy-paste a
 * working command) or the language-native env-var reference. */
export type QuickStartLang = 'curl' | 'python' | 'javascript' | 'typescript';

export const QUICK_START_LANGS: QuickStartLang[] = ['curl', 'python', 'javascript', 'typescript'];

export const QUICK_START_TEMPLATES: Record<QuickStartLang, string> = {
  curl: `# Source & docs: https://github.com/cshdotcom/free-web-scraper
curl -X POST {BASE_URL}/v2/scrape \\
  -H "Authorization: Bearer {API_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://example.com",
    "formats": ["markdown", "links"],
    "onlyMainContent": true
  }'`,
  python: `import os, requests

url = "{BASE_URL}/v2/scrape"
headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}
payload = {
    "url": "https://example.com",
    "formats": ["markdown", "links"],
    "onlyMainContent": True,
}

resp = requests.post(url, headers=headers, json=payload, timeout=60)
data = resp.json()
print(data["data"]["markdown"])`,
  javascript: `const res = await fetch("{BASE_URL}/v2/scrape", {
  method: "POST",
  headers: {
    "Authorization": \`Bearer {API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    url: "https://example.com",
    formats: ["markdown", "links"],
    onlyMainContent: true,
  }),
});

const { data } = await res.json();
console.log(data.markdown);`,
  typescript: `const res = await fetch("{BASE_URL}/v2/scrape", {
  method: "POST",
  headers: {
    Authorization: \`Bearer {API_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    url: "https://example.com",
    formats: ["markdown", "links"] as const,
    onlyMainContent: true,
  }),
});

const json = (await res.json()) as {
  success: boolean;
  data: { markdown?: string };
};
console.log(json.data.markdown);`,
};

/**
 * Default placeholder used in each language when the user has NOT saved
 * an API key. Each entry mirrors the language's native env-var access pattern.
 */
const DEFAULT_API_KEY_TOKEN: Record<QuickStartLang, string> = {
  curl: '$NBC_API_KEY',
  python: `os.environ['NBC_API_KEY']`,
  javascript: '${process.env.NBC_API_KEY}',
  typescript: '${process.env.NBC_API_KEY!}',
};

/** Replace all `{BASE_URL}` placeholders in a code template. */
export function resolveBaseUrl(baseUrl: string, template: string): string {
  // Use a split-join to avoid `string.replaceAll` regex pitfalls when baseUrl
  // contains `$` (it doesn't here, but be safe).
  return template.split('{BASE_URL}').join(baseUrl);
}

/**
 * Resolve a quick-start sample for the given language, baseUrl, and
 * (optionally) the user's saved API key.
 *
 * - When `apiKey` is empty/undefined: `{API_KEY}` is replaced with the
 *   language-native env-var reference (e.g. `$NBC_API_KEY` for curl).
 * - When `apiKey` is set: `{API_KEY}` is replaced with the literal key
 *   value, so the resulting snippet is copy-paste-runnable as-is.
 */
export function resolveQuickStartSample(
  lang: QuickStartLang,
  baseUrl: string,
  apiKey?: string,
): string {
  const key = apiKey?.trim() || DEFAULT_API_KEY_TOKEN[lang];
  const withUrl = resolveBaseUrl(baseUrl, QUICK_START_TEMPLATES[lang]);
  return withUrl.split('{API_KEY}').join(key);
}

/**
 * Resolve all four quick-start samples at once.
 * Returns a Record keyed by language for easy lookup in the UI.
 */
export function getQuickStartSamples(
  baseUrl: string,
  apiKey?: string,
): Record<QuickStartLang, string> {
  const out = {} as Record<QuickStartLang, string>;
  for (const lang of QUICK_START_LANGS) {
    out[lang] = resolveQuickStartSample(lang, baseUrl, apiKey);
  }
  return out;
}

/** Color classes per HTTP method (Tailwind-safe). */
export const METHOD_COLORS: Record<HttpMethod, { badge: string; dot: string }> = {
  POST: {
    badge: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  GET: {
    badge: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  DELETE: {
    badge: 'bg-rose-500/10 text-rose-700 border-rose-500/30 dark:text-rose-300',
    dot: 'bg-rose-500',
  },
};
