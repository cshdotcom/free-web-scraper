#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="${ROOT}/dist"
PKG="${DIST}/nodebyte-crawl"

echo "[build] Cleaning previous build..."
rm -rf "${PKG}"
mkdir -p "${PKG}"

echo "[build] Building Next.js standalone (single port, includes crawler)..."
cd "${ROOT}"
bun run build 2>&1 | tail -15

echo "[build] Copying standalone output..."
mkdir -p "${PKG}/app"
cp -r "${ROOT}/.next/standalone/." "${PKG}/app/"
cp -r "${ROOT}/.next/static" "${PKG}/app/.next/" 2>/dev/null
cp -r "${ROOT}/public" "${PKG}/app/" 2>/dev/null || true
# Put .env.example in BOTH the app dir and the package root
cp "${ROOT}/.env.example" "${PKG}/app/.env.example" 2>/dev/null || true
cp "${ROOT}/.env.example" "${PKG}/.env.example" 2>/dev/null || true

echo "[build] Copying bundled browser..."
mkdir -p "${PKG}/browsers"
# Try mini-services first, then system cache
if [ -d "${ROOT}/mini-services/crawler-service/browsers" ]; then
  cp -r "${ROOT}/mini-services/crawler-service/browsers/." "${PKG}/browsers/"
elif [ -d "${HOME}/.cache/ms-playwright" ]; then
  cp -r "${HOME}/.cache/ms-playwright/chromium-1200" "${PKG}/browsers/" 2>/dev/null
  cp -r "${HOME}/.cache/ms-playwright/chromium_headless_shell-1200" "${PKG}/browsers/" 2>/dev/null
  cp -r "${HOME}/.cache/ms-playwright/ffmpeg-1011" "${PKG}/browsers/" 2>/dev/null
fi

echo "[build] Writing start.sh + SQL + install-deps..."
cp "${ROOT}/install-deps.sh" "${PKG}/install-deps.sh" 2>/dev/null || true
chmod +x "${PKG}/install-deps.sh" 2>/dev/null || true
cp "${ROOT}/prisma/nodebyte-crawl.sql" "${PKG}/nodebyte-crawl.sql" 2>/dev/null || true
cp "${ROOT}/prisma/schema.prisma" "${PKG}/prisma-schema.prisma" 2>/dev/null || true

cat > "${PKG}/start.sh" << 'LAUNCHER'
#!/bin/bash
# NodeByte Crawl — launcher
# Usage: bash start.sh
DIR="$(cd "$(dirname "$0")" && pwd)"

# Copy .env.example → .env on first run
[ ! -f "$DIR/.env" ] && [ -f "$DIR/.env.example" ] && cp "$DIR/.env.example" "$DIR/.env"

# Set browser path (so Playwright finds bundled Chromium)
export PLAYWRIGHT_BROWSERS_PATH="$DIR/browsers"

# Start. Node 20+ --env-file properly parses .env (handles spaces, quotes).
cd "$DIR/app"
if node --version 2>/dev/null | grep -qE '^v(2[0-9]|[3-9][0-9])'; then
  node --env-file="$DIR/.env" server.js
else
  # Older Node: source .env manually (quote values to handle spaces)
  if [ -f "$DIR/.env" ]; then
    while IFS='=' read -r key val; do
      case "$key" in
        ''|\#*) continue ;;
      esac
      export "$key=$val"
    done < "$DIR/.env"
  fi
  node server.js
fi
LAUNCHER
chmod +x "${PKG}/start.sh"

cat > "${PKG}/README.md" << 'README'
# NodeByte Crawl v3.8.4 — Standalone (Single Port)

One port serves docs + API. Bundled Chromium included.

Firecrawl v2 compatible. OpenWebUI/SearxNG compatible.

## Quick start

```bash
./start.sh
```
Open http://localhost:3000

## First run

start.sh will:
1. Copy `.env.example` → `.env` (if .env doesn't exist)
2. Load all variables from `.env`
3. Check for missing system libraries and auto-install (or prompt to run `install-deps.sh`)
4. Start the server

## If Chromium fails to launch

```bash
bash install-deps.sh
```
This installs the system shared libraries Chromium needs (libatk, libcups,
etc.) PLUS multi-language fonts (Noto CJK, Noto Arabic, Noto Devanagari,
Noto Thai, WenQuanYi, Liberation, IPA Japanese). After install, browser
screenshots render Chinese/Japanese/Korean/Arabic/Hebrew/Thai/Indic text
correctly — no more tofu boxes (□□□).

## Configuration

Edit `.env` — see `.env.example` for all options.

Key v3.8.1 additions:
- CRAWLER_ALLOW_ROBOTS_OVERRIDE — let clients override robots.txt
- CRAWLER_RESPECT_NOINDEX — honour noindex as AI opt-out (default off)
- CRAWLER_ROBOTS_CACHE_TTL_MS — per-host robots.txt cache TTL
- CRAWLER_MAX_BODY_BYTES — response size cap (default 50 MB)

## API (v2 primary, v1 back-compat, SearxNG compatible)

POST /v2/scrape, /v2/scrape/batch, /v2/batch/scrape, /v2/crawl, /v2/map, /v2/search, /v2/parse
GET  /v2/batch/scrape/:id, /v2/batch/scrape/:id/errors, /v2/crawl/:id, /v2/crawl/:id/errors
DELETE /v2/batch/scrape/:id, /v2/crawl/:id
GET  /search?q=&format=json (SearxNG/OpenWebUI compatible)

## New v3.8.1 features

- Sitemap auto-discovery in /v2/crawl (no manual path needed)
- robots.txt + 5 AI opt-out compliance layers (403 + blockedReason)
- SSRF protection (private IPs, cloud metadata, DNS-rebinding)
- Branding format (extract colors/fonts/logo/typography)
- Images format improved (width/height, picture source)
- Search sources: web/news/images (parallel, tagged with source)
- SearXNG: display configured name (not URL)
README

echo "[build] Done. Package size:"
du -sh "${PKG}"
du -sh "${PKG}/app" "${PKG}/browsers" 2>/dev/null
