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
cp "${ROOT}/.env.example" "${PKG}/app/.env.example" 2>/dev/null || true

echo "[build] Copying bundled browser..."
mkdir -p "${PKG}/browsers"
if [ -d "${ROOT}/mini-services/crawler-service/browsers" ]; then
  cp -r "${ROOT}/mini-services/crawler-service/browsers/." "${PKG}/browsers/"
fi

echo "[build] Writing start.sh..."
cat > "${PKG}/start.sh" << 'LAUNCHER'
#!/bin/bash
# NodeByte Crawl v3.0 — single-port launcher
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "[start] NodeByte Crawl v3.0 — single port :${PORT:-3000}"
cd "${DIR}/app"
export NODE_ENV=production
export PORT="${PORT:-3000}"
export PLAYWRIGHT_BROWSERS_PATH="${DIR}/browsers"
node server.js
LAUNCHER
chmod +x "${PKG}/start.sh"

cat > "${PKG}/README.md" << 'README'
# NodeByte Crawl v3.0 — Standalone (Single Port)

One port serves both the docs page AND the API. No separate crawler-service.

## Quick start

```bash
./start.sh
```
Open http://localhost:3000

## API (v2 primary, v1 back-compat, SearxNG compatible)

POST /v2/scrape, /v2/scrape/batch, /v2/batch/scrape, /v2/crawl, /v2/map, /v2/search
GET  /search?q=&format=json (SearxNG/OpenWebUI compatible)
README

echo "[build] Done. Package size:"
du -sh "${PKG}"
du -sh "${PKG}/app" "${PKG}/browsers" 2>/dev/null
