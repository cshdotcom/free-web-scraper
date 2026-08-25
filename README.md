# NodeByte Crawl

> Open-source Firecrawl v2-compatible web scraping API. JavaScript-rendered. Multi-engine search. OpenWebUI compatible.

[![Deploy](https://img.shields.io/badge/deploy-ready-emerald)]()
[![Firecrawl v2](https://img.shields.io/badge/Firecrawl-v2%20compatible-blue)]()
[![OpenWebUI](https://img.shields.io/badge/OpenWebUI-compatible-emerald)]()
[![Version](https://img.shields.io/badge/version-3.8.0-emerald)]()

## Features

### Core scraping (Firecrawl v2 compatible)

- **JavaScript Rendering** — Real headless Chromium via Playwright captures SPAs and dynamic content
- **Main Content Extraction** — Multi-strategy (explicit selectors + text-density scoring + Readability-style heuristics)
- **Markdown Output** — Clean GFM with code blocks, tables, links. No mojibake. Now with proper prose styling in the test console (light + dark themes).
- **Concurrent Scraping** — Bounded parallelism for batch URLs (configurable)
- **Stealth & Anti-Bot** — UA rotation, `navigator.webdriver` removal, cookie-banner auto-dismissal, retry with exponential backoff on 403/429/503
- **BFS Recursive Crawling** — Configurable `maxDepth` (1-5) + `limit` + include/exclude patterns + `allowSubdomains` + `crawlEntireDomain` + `sitemap` enum + `ignoreQueryParameters` + `delay` + `maxConcurrency`
- **Lazy-Load Image Triggering** — Scrolls the page and forces `loading="lazy"` → `eager` so all images load
- **Firecrawl v2 Compatible** — Drop-in replacement for the Firecrawl SDK. `/v2/scrape`, `/v2/scrape/batch`, `/v2/batch/scrape`, `/v2/crawl`, `/v2/map`, `/v2/search`, `/v2/parse`

### Scrape options (Firecrawl v2 parity)

| Option | Type | Description |
|--------|------|-------------|
| `url` | string | URL to scrape (required) |
| `formats` | string[] \| object[] | `markdown`, `html`, `rawHtml`, `links`, `images`, `screenshot`, or objects like `{ type: "screenshot", fullPage, quality, viewport }` and `{ type: "attributes", selectors: [{selector, attribute}] }` |
| `onlyMainContent` | boolean | Drop nav/footer/sidebar noise (default true) |
| `includeTags` / `excludeTags` | string[] | CSS selectors to include/exclude |
| `timeout` | number | Navigation timeout ms (min 1000) |
| `waitFor` | number | Extra wait after load (ms) |
| `maxRetries` | number | Retries on 403/429/503/network errors |
| `mobile` | boolean | Mobile device emulation shortcut |
| `actions` | object[] | Up to 50 browser actions: `wait`, `click`, `write`, `press`, `scroll`, `screenshot`, `pdf`, `executeJavascript`, `scrape` |
| `location` | object | `{ country: "US", languages: ["en"] }` — sets browser locale, timezone, Accept-Language |
| `headers` | object | Custom HTTP headers merged with defaults |
| `maxAge` | number | Cache hint in ms (accepted for compatibility) |
| `cookies` | string \| CookieInput[] | Cookie string or array (NodeByte extension) |
| `device` | "auto" \| "desktop" \| "mobile" | Device emulation with UA + viewport + touch (NodeByte extension) |
| `userAgent` | string | Custom UA override (NodeByte extension) |

### Multi-Engine Search

- **Multi-Engine Search** — Bing + DuckDuckGo + SearXNG (meta-search) + Wikipedia. One engine failing doesn't break others. Auto language detection.
- **Search with scrape** — Pass `scrapeOptions` to scrape each result URL and merge markdown/html/links/screenshot/metadata into each result.
- **Domain filters** — `includeDomains` / `excludeDomains` (mutually exclusive; internally add `site:` / `-site:` operators).
- **Time filters** — `tbs` parameter (`qdr:d`, `qdr:w`, `qdr:m`, `qdr:y`, `sbd:1`).
- **Safe search** — `safe: true` (acknowledged for compatibility).
- **Location** — `location` string (forwarded to engines that support regional filtering).

### Map (link discovery)

- **Sitemap enum** — `sitemap: "include"` (default) | `"skip"` | `"only"`. Also accepts the legacy `ignoreSitemap: true` alias.
- **Rich link objects** — When the sitemap provides `<title>` / `<description>` for a URL, the response carries `{ url, title, description }` objects instead of bare strings.
- **Subdomain support** — `includeSubdomains: true` to also follow links on subdomains of the seed host.

### Batch scrape

- **Synchronous** — `/v2/scrape/batch` blocks until all URLs are done (max 50 URLs).
- **Asynchronous** — `/v2/batch/scrape` returns a job id immediately (max 1000 URLs); poll `/v2/batch/scrape/:id` for results, `:id/errors` for failures, or `DELETE :id` to cancel.
- **Per-job concurrency** — `maxConcurrency` cap per batch job.
- **Error endpoint** — Dedicated `GET /v2/batch/scrape/:id/errors` returns per-URL failures.

### Crawl

- **Async crawl** — `/v2/crawl` returns a job id; poll `/v2/crawl/:id`, inspect `/v2/crawl/:id/errors`, or `DELETE /v2/crawl/:id` to cancel.
- **Firecrawl crawl options** — `includePaths`, `excludePaths`, `regexOnFullURL`, `allowSubdomains`, `allowExternalLinks`, `crawlEntireDomain`, `sitemap`, `ignoreQueryParameters`, `delay`, `maxConcurrency`, `maxDiscoveryDepth`.
- **Native aliases** — `includes` / `excludes` (NodeByte shortcuts for `includePaths` / `excludePaths`).
- **Limit cap** — 10,000 (Firecrawl default). The config default is 50 to protect RAM — raise per request if needed.

### Document parsing

- **`/v2/parse`** — Accept a public document URL (PDF / DOCX / XLSX / PPTX) and return the rendered content as markdown + metadata. Local file uploads are not supported by the open-source runtime — pass a public URL instead. AI-backed parser options (`pages`, `blocks`, `pageMarkers`) are accepted for forward compatibility.

### OpenWebUI integration

- **OpenWebUI Compatible** — `GET /search?q=&format=json` in SearxNG format. Set `SEARXNG_API_URL` in OpenWebUI.

### Operational

- **Multi-API-Key** — `CRAWLER_API_KEYS=key1,key2,key3` (comma-separated)
- **Encrypted Cookie Storage** — API key stored with AES-GCM encryption in a browser cookie (not plaintext localStorage)
- **Bundled Chromium** — 613 MB browser binary included in the standalone package. Runs on any Linux x64 host — no `playwright install` needed.
- **i18n** — English / Chinese documentation toggle
- **Dark Mode** — Full dark theme support

## Quick start

```bash
# Clone
git clone https://github.com/cshdotcom/free-web-scraper.git
cd free-web-scraper

# Install
bun install
cd mini-services/crawler-service && bun install && cd ..

# Start the crawler service (port 3004)
cd mini-services/crawler-service && bun run dev

# In another terminal, start the Next.js app (port 3000)
bun run dev
```

Open http://localhost:3000 — the page merges API documentation + an interactive test console.

## API endpoints (v2 primary, v1 back-compat)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v2/scrape` | Scrape a single URL → markdown/html/rawHtml/links/images/screenshot |
| POST | `/v2/scrape/batch` | Synchronous batch scrape (max 50 URLs) |
| POST | `/v2/batch/scrape` | Start async batch job (max 1000 URLs) |
| GET | `/v2/batch/scrape/:id` | Poll async batch job |
| DELETE | `/v2/batch/scrape/:id` | Cancel async batch job |
| GET | `/v2/batch/scrape/:id/errors` | Per-URL errors for a batch job |
| POST | `/v2/crawl` | BFS recursive crawl (maxDepth 1-5) |
| GET | `/v2/crawl/:id` | Poll crawl job |
| DELETE | `/v2/crawl/:id` | Cancel crawl job |
| GET | `/v2/crawl/:id/errors` | Per-URL errors for a crawl job |
| POST | `/v2/map` | Map site links (sitemap enum: include \| skip \| only) |
| POST | `/v2/search` | Multi-engine web search (lang=auto/all/en/zh/ja...; scrapeOptions, includeDomains, excludeDomains, tbs, safe) |
| POST | `/v2/parse` | Parse a document URL into markdown + metadata |
| GET | `/search?q=&format=json` | **SearxNG-compatible** (for OpenWebUI) |

## Configuration

See `.env.example` for all options. Key settings:
- `CRAWLER_API_KEYS=key1,key2,key3` — comma-separated API keys
- `CRAWLER_SEARCH_LANG=auto` — auto-detect query language
- `CRAWLER_SEARXNG_INSTANCES=Name|https://your-searxng.example.com` — custom SearXNG instances
- `CRAWLER_MAX_CONCURRENCY=4` — parallel page renders
- `CRAWLER_STEALTH=true` — anti-bot patches
- `CRAWLER_CRAWL_MAX_DEPTH=2` — default BFS depth (1-5)
- `CRAWLER_DEFAULT_CRAWL_LIMIT=50` — default crawl limit (raise per request up to 10000)

## OpenWebUI integration

1. Set `SEARXNG_API_URL=http://localhost:3000/search` in OpenWebUI
2. If API keys are enabled, append `?key=<your-key>`

## Standalone package

Download the latest release ZIP (includes bundled Chromium — 282 MB compressed, 706 MB extracted):
1. Unzip
2. Run `bash start.sh`
3. Open http://localhost:3000

## Tech stack

- **Next.js 16** (App Router, standalone output)
- **Bun + Hono** (crawler mini-service)
- **Playwright** (headless Chromium)
- **Turndown** (HTML → Markdown)
- **Tailwind CSS 4 + shadcn/ui** (UI)
- **react-markdown** (markdown rendering in the test console)
- **next-themes** (dark mode)
- **i18n** (EN/ZH)

## License

MIT
