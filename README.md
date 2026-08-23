# NodeByte Crawl

> Open-source Firecrawl v2-compatible web scraping API. JavaScript-rendered. Multi-engine search. OpenWebUI compatible.

[![Deploy](https://img.shields.io/badge/deploy-ready-emerald)]()
[![Firecrawl v2](https://img.shields.io/badge/Firecrawl-v2%20compatible-blue)]()
[![OpenWebUI](https://img.shields.io/badge/OpenWebUI-compatible-emerald)]()

## Features

- **JavaScript Rendering** — Real headless Chromium via Playwright captures SPAs and dynamic content
- **Main Content Extraction** — Multi-strategy (explicit selectors + text-density scoring + Readability-style heuristics)
- **Markdown Output** — Clean GFM with code blocks, tables, links. No mojibake.
- **Concurrent Scraping** — Bounded parallelism for batch URLs (configurable)
- **Stealth & Anti-Bot** — UA rotation, `navigator.webdriver` removal, cookie-banner auto-dismissal, retry with exponential backoff on 403/429/503
- **Multi-Engine Search** — Bing + DuckDuckGo + SearXNG (meta-search) + Wikipedia. One engine failing doesn't break others. Auto language detection.
- **BFS Recursive Crawling** — Configurable `maxDepth` (1-5) + `limit` + include/exclude patterns
- **Lazy-Load Image Triggering** — Scrolls the page and forces `loading="lazy"` → `eager` so all images load
- **Firecrawl v2 Compatible** — Drop-in replacement for the Firecrawl SDK. `/v2/scrape`, `/v2/batch/scrape`, `/v2/crawl`, `/v2/map`, `/v2/search`
- **OpenWebUI Compatible** — `GET /search?q=&format=json` in SearxNG format. Set `SEARXNG_API_URL` in OpenWebUI.
- **Multi-API-Key** — `CRAWLER_API_KEYS=key1,key2,key3` (comma-separated)
- **Encrypted Cookie Storage** — API key stored with AES-GCM encryption in a browser cookie (not plaintext localStorage)
- **Bundled Chromium** — 613 MB browser binary included in the standalone package. Runs on any Linux x64 host — no `playwright install` needed.
- **i18n** — English / Chinese documentation toggle
- **Dark Mode** — Full dark theme support

## Quick start

```bash
# Clone
git clone https://github.com/NodeByte-CN/free-web-scraper.git
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
| POST | `/v2/scrape` | Scrape a single URL → markdown/html/links/screenshot |
| POST | `/v2/scrape/batch` | Synchronous batch scrape |
| POST | `/v2/batch/scrape` | Start async batch job |
| GET | `/v2/batch/scrape/:id` | Poll async batch job |
| POST | `/v2/crawl` | BFS recursive crawl (maxDepth 1-5) |
| GET | `/v2/crawl/:id` | Poll crawl job |
| DELETE | `/v2/crawl/:id` | Cancel crawl job |
| POST | `/v2/map` | Map site links |
| POST | `/v2/search` | Multi-engine web search (lang=auto/all/en/zh/ja...) |
| GET | `/search?q=&format=json` | **SearxNG-compatible** (for OpenWebUI) |

## Configuration

See `.env.example` for all options. Key settings:
- `CRAWLER_API_KEYS=key1,key2,key3` — comma-separated API keys
- `CRAWLER_SEARCH_LANG=auto` — auto-detect query language
- `CRAWLER_SEARXNG_INSTANCES=Name|https://your-searxng.example.com` — custom SearXNG instances
- `CRAWLER_MAX_CONCURRENCY=4` — parallel page renders
- `CRAWLER_STEALTH=true` — anti-bot patches

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
- **next-themes** (dark mode)
- **i18n** (EN/ZH)

## License

MIT
