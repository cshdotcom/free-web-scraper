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

echo "[build] Writing start.sh + install-deps.sh..."
cp "${ROOT}/install-deps.sh" "${PKG}/install-deps.sh"
chmod +x "${PKG}/install-deps.sh"

cat > "${PKG}/start.sh" << 'LAUNCHER'
#!/bin/bash
# ============================================================
# NodeByte Crawl v3.5 — single-port launcher
# Loads .env automatically, installs system deps if needed.
# ============================================================
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

# ---- 1. Load .env file ----
if [ ! -f "${DIR}/.env" ]; then
  if [ -f "${DIR}/.env.example" ]; then
    cp "${DIR}/.env.example" "${DIR}/.env"
    echo "[start] Created .env from .env.example — edit it to configure."
  elif [ -f "${DIR}/app/.env.example" ]; then
    cp "${DIR}/app/.env.example" "${DIR}/.env"
    echo "[start] Created .env from app/.env.example — edit it to configure."
  fi
fi

if [ -f "${DIR}/.env" ]; then
  set -a
  . "${DIR}/.env"
  set +a
  echo "[start] Loaded .env"
fi

# ---- 2. Defaults (env vars from .env take precedence) ----
: "${PORT:=3000}"
: "${NODE_ENV:=production}"
: "${PLAYWRIGHT_BROWSERS_PATH:="${DIR}/browsers"}"
export PORT NODE_ENV PLAYWRIGHT_BROWSERS_PATH

# ---- 3. Find browser binary ----
BROWSER_BIN=""
for candidate in \
  "${PLAYWRIGHT_BROWSERS_PATH}/chromium-1200/chrome-linux64/chrome" \
  "${PLAYWRIGHT_BROWSERS_PATH}/chromium-1200/chrome-linux/chrome" \
  "${PLAYWRIGHT_BROWSERS_PATH}/chromium-1228/chrome-linux64/chrome" \
  "${PLAYWRIGHT_BROWSERS_PATH}/chromium-1228/chrome-linux/chrome"; do
  if [ -x "$candidate" ]; then BROWSER_BIN="$candidate"; break; fi
done
if [ -n "$BROWSER_BIN" ]; then
  export CRAWLER_BROWSER_PATH="$BROWSER_BIN"
  echo "[start] Browser: $BROWSER_BIN"
else
  echo "[start] WARNING: No bundled browser found. Run: npx playwright install chromium"
fi

# ---- 4. Check system libraries ----
NEEDED_LIBS="libatk-1.0.so.0 libcups.so.2 libxkbcommon.so.0 libgbm.so.1 libnss3.so"
MISSING=""
for lib in $NEEDED_LIBS; do
  if ! ldconfig -p 2>/dev/null | grep -q "$lib"; then MISSING="$MISSING $lib"; fi
done
if [ -n "$MISSING" ]; then
  echo "[start] Missing system libraries: $MISSING"
  echo "[start] Run: bash ${DIR}/install-deps.sh"
  echo "[start] Attempting auto-install..."
  bash "${DIR}/install-deps.sh" 2>/dev/null || echo "[start] Auto-install failed. Run install-deps.sh manually (may need sudo)."
fi

# ---- 5. Start ----
echo ""
echo "[start] NodeByte Crawl v3.5 — port ${PORT}"
echo "[start]   Docs + API: http://localhost:${PORT}"
echo ""

cd "${DIR}/app"
exec node server.js
LAUNCHER
chmod +x "${PKG}/start.sh"

cat > "${PKG}/README.md" << 'README'
# NodeByte Crawl v3.5 — Standalone (Single Port)

One port serves docs + API. Bundled Chromium included.

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
This installs the system shared libraries Chromium needs (libatk, libcups, etc).

## Configuration

Edit `.env` — see `.env.example` for all options.

## API (v2 primary, v1 back-compat, SearxNG compatible)

POST /v2/scrape, /v2/scrape/batch, /v2/batch/scrape, /v2/crawl, /v2/map, /v2/search
GET  /search?q=&format=json (SearxNG/OpenWebUI compatible)
README

echo "[build] Done. Package size:"
du -sh "${PKG}"
du -sh "${PKG}/app" "${PKG}/browsers" 2>/dev/null
