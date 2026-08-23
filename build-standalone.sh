#!/bin/bash
# ============================================================
# build-standalone.sh — produce a fully portable, self-contained
# package of NodeByte Crawl v2.0.
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="${ROOT}/dist"
PKG="${DIST}/nodebyte-crawl"

echo "[build] Cleaning previous build..."
rm -rf "${PKG}"
mkdir -p "${PKG}"

# 1. Build Next.js standalone
echo "[build] Building Next.js standalone app..."
cd "${ROOT}"
bun run build 2>&1 | tail -15

echo "[build] Copying Next.js standalone output..."
mkdir -p "${PKG}/app"
cp -r "${ROOT}/.next/standalone/." "${PKG}/app/"
cp -r "${ROOT}/.next/static" "${PKG}/app/.next/" 2>/dev/null
cp -r "${ROOT}/public" "${PKG}/app/" 2>/dev/null || true
cp "${ROOT}/.env.example" "${PKG}/app/.env.example" 2>/dev/null || true

# 2. Copy crawler-service
echo "[build] Copying crawler-service (with bundled browser)..."
mkdir -p "${PKG}/crawler-service"
cp -r "${ROOT}/mini-services/crawler-service/." "${PKG}/crawler-service/"
rm -f "${PKG}/crawler-service/setup-browsers.sh" 2>/dev/null || true

# 3. Write launcher
echo "[build] Writing start.sh launcher..."
cat > "${PKG}/start.sh" << 'LAUNCHER'
#!/bin/bash
# NodeByte Crawl v2.0 — standalone launcher
# Starts both the crawler-service (port 3004) and the Next.js app (port 3000).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[start] Launching crawler-service on :3004..."
cd "${DIR}/crawler-service"
export PLAYWRIGHT_BROWSERS_PATH="${DIR}/crawler-service/browsers"
(bun run dev > /tmp/nodebyte-crawler.log 2>&1 &)

sleep 3

echo "[start] Launching Next.js app on :3000..."
cd "${DIR}/app"
export NODE_ENV=production
export PORT=3000
export CRAWLER_SERVICE_URL=http://localhost:3004
node server.js &

echo ""
echo "[start] NodeByte Crawl is running:"
echo "  • Next.js app:        http://localhost:3000"
echo "  • Crawler service:    http://localhost:3004"
echo "  • API docs + test:    http://localhost:3000/  (merged page)"
echo "  • Firecrawl v2 API:   http://localhost:3000/v2/scrape"
echo "  • SearxNG search:     http://localhost:3000/search?q=...&format=json"
echo ""
echo "Press Ctrl+C to stop both services."
wait
LAUNCHER
chmod +x "${PKG}/start.sh"

# 4. Write README
cat > "${PKG}/README.md" << 'README'
# NodeByte Crawl v2.0 — Standalone Package

Firecrawl v2-compatible web scraping API. JavaScript-rendered. Multi-engine search. OpenWebUI compatible.

## Quick start

```bash
./start.sh
```

Open http://localhost:3000 — the page merges API documentation + interactive test console.

## What's inside

| Path | Purpose |
|------|---------|
| `app/server.js` | Next.js standalone server (port 3000) |
| `app/.next/` | Compiled Next.js app |
| `crawler-service/` | Bun + Hono + Playwright crawler (port 3004) |
| `crawler-service/browsers/` | Bundled Chromium — runs on any host |

## API endpoints (v2 primary, v1 back-compat)

- `POST /v2/scrape` — scrape a single URL to markdown/html/links/screenshot
- `POST /v2/scrape/batch` — synchronous batch scrape
- `POST /v2/batch/scrape` — async batch job (poll GET /v2/batch/scrape/:id)
- `POST /v2/crawl` — BFS recursive crawl (with maxDepth)
- `POST /v2/map` — site link map
- `POST /v2/search` — multi-engine web search (Bing + DDG + Brave + Mojeek + Startpage)
- `GET /search?q=&format=json` — **SearxNG-compatible** (for OpenWebUI)

## Configuration

See `app/.env.example` and `crawler-service/.env` for all options. Key settings:
- `CRAWLER_API_KEYS=key1,key2,key3` — comma-separated API keys (multi-key)
- `CRAWLER_SEARCH_ENGINES=bing,duckduckgo,brave,mojeek,startpage` — engines to aggregate
- `PLAYWRIGHT_BROWSERS_PATH=./browsers` — bundled browser path

## OpenWebUI integration

Set `SEARXNG_API_URL=http://localhost:3000/search` in OpenWebUI. If API keys are enabled, append `?key=<your-key>`.

## Requirements

- Node.js 18+ (Next.js standalone server)
- Bun 1.1+ (crawler-service)

The bundled Chromium runs on any Linux x64 host — no `playwright install` needed.
README

# 5. Report
echo ""
echo "[build] ============================================================"
echo "[build] NodeByte Crawl v2.0 standalone package built at: ${PKG}"
echo "[build] ============================================================"
du -sh "${PKG}" 2>/dev/null
du -sh "${PKG}/app" "${PKG}/crawler-service" "${PKG}/crawler-service/browsers" 2>/dev/null
echo ""
echo "[build] To run: cd ${PKG} && bash start.sh"
echo "[build] To zip: cd ${PKG}/.. && zip -r nodebyte-crawl-v2.zip nodebyte-crawl/"
