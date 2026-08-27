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
# Next.js 16 + Turbopack puts the standalone server.js under
# .next/standalone/<source-dir>/server.js — i.e. it preserves the
# source directory name. When the build is run from a directory
# called 'repo' (our local checkout), the standalone output has
# a nested 'repo/' subdir containing server.js + .next. This
# breaks start.sh which expects server.js at app/server.js.
#
# Fix: detect the nested source-dir (single subdirectory containing
# server.js) and FLATTEN it — copy its contents up to the top of
# the standalone tree so the layout matches the documented
# .next/standalone/server.js structure.
STANDALONE_DIR="${ROOT}/.next/standalone"
NESTED_SOURCE_DIR=""
if [ ! -f "${STANDALONE_DIR}/server.js" ]; then
  # Look for the first subdirectory containing server.js.
  for d in "${STANDALONE_DIR}"/*/; do
    if [ -f "${d}server.js" ]; then
      NESTED_SOURCE_DIR="${d%/}"
      break
    fi
  done
  if [ -n "${NESTED_SOURCE_DIR}" ]; then
    echo "[build] Detected nested source dir: $(basename "${NESTED_SOURCE_DIR}")/ — flattening..."
    # Move server.js, .next, and any other top-level files from the
    # nested dir up to the standalone root. node_modules at the
    # standalone root is the shared one; the nested dir may also have
    # its own node_modules which we leave alone (it's empty in our
    # builds — the standalone trace puts everything in the root
    # node_modules).
    cp -r "${NESTED_SOURCE_DIR}/server.js" "${STANDALONE_DIR}/server.js"
    # Merge the nested .next directory into the root .next directory
    # (root may not exist yet; create it).
    mkdir -p "${STANDALONE_DIR}/.next"
    cp -r "${NESTED_SOURCE_DIR}/.next/." "${STANDALONE_DIR}/.next/" 2>/dev/null || true
    # Also merge public if present in the nested dir.
    [ -d "${NESTED_SOURCE_DIR}/public" ] && cp -r "${NESTED_SOURCE_DIR}/public/." "${STANDALONE_DIR}/public/" 2>/dev/null || true
  fi
fi

mkdir -p "${PKG}/app"
cp -r "${STANDALONE_DIR}/." "${PKG}/app/"
# Copy the static + public dirs explicitly too (the standalone trace
# doesn't always include them — the start.sh expects them at
# app/.next/static and app/public).
cp -r "${ROOT}/.next/static" "${PKG}/app/.next/" 2>/dev/null || true
cp -r "${ROOT}/public" "${PKG}/app/" 2>/dev/null || true
# Remove the now-redundant nested source dir from the package so
# start.sh's `node app/server.js` doesn't get confused.
if [ -n "${NESTED_SOURCE_DIR}" ] && [ -d "${PKG}/app/$(basename "${NESTED_SOURCE_DIR}")" ]; then
  rm -rf "${PKG}/app/$(basename "${NESTED_SOURCE_DIR}")"
  echo "[build] Removed redundant nested source dir from package"
fi
# Verify server.js is now at the top of the package.
if [ -f "${PKG}/app/server.js" ]; then
  echo "[build] ✓ app/server.js exists ($(stat -c%s "${PKG}/app/server.js") bytes)"
else
  echo "[build] ✗ ERROR: app/server.js is missing after flatten! Build will fail to start."
  exit 1
fi
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

echo "[build] Copying bundled fonts (CJK + Latin + Emoji)..."
mkdir -p "${PKG}/fonts"
# Copy essential multi-language fonts so browser screenshots render
# CJK/Cyrillic/Arabic/Hebrew/Thai text correctly WITHOUT requiring
# the user to run install-deps.sh first. These fonts are loaded by
# Chromium via the FONTCONFIG_PATH env var set in start.sh.
FONT_DIRS=(
  "/usr/share/fonts/truetype/chinese/NotoSansSC[wght].ttf"
  "/usr/share/fonts/truetype/chinese/LiberationSans-Regular.ttf"
  "/usr/share/fonts/truetype/chinese/LiberationMono-Regular.ttf"
  "/usr/share/fonts/truetype/chinese/LiberationSerif-Regular.ttf"
  "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"
  "/usr/share/fonts/truetype/emoji/NotoColorEmoji.ttf"
  "/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf"
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
  "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
)
for font in "${FONT_DIRS[@]}"; do
  if [ -f "$font" ]; then
    cp "$font" "${PKG}/fonts/" 2>/dev/null && echo "  ✓ $(basename $font)"
  fi
done
# Also try the Noto Sans SC static (non-variable) if available
if [ -f "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc" ]; then
  cp "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc" "${PKG}/fonts/" 2>/dev/null && echo "  ✓ NotoSansCJK-Regular.ttc"
fi
echo "  Total fonts: $(du -sh ${PKG}/fonts/ 2>/dev/null | cut -f1)"

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

# Set bundled fonts path so Chromium can find CJK/Latin/Emoji fonts
# WITHOUT requiring the user to install system font packages. The
# fonts/ directory contains Noto Sans SC, WenQuanYi Zen Hei, Noto
# Color Emoji, Liberation Sans, and DejaVu — covering CJK, Latin,
# Cyrillic, and Emoji rendering.
#
# Chromium uses fontconfig to find fonts. We set FONTCONFIG_FILE to
# our custom fonts.conf which includes both our bundled fonts
# directory AND the system fonts directory. We also set
# FONTCONFIG_PATH as a fallback.
if [ -d "$DIR/fonts" ]; then
  # Generate fonts.conf if not already present.
  if [ ! -f "$DIR/fonts/fonts.conf" ]; then
    cat > "$DIR/fonts/fonts.conf" << 'FONTSCONF'
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <!-- Our bundled fonts directory -->
  <dir>FONTDIR</dir>
  <!-- Font cache directory (writable) -->
  <cachedir>CACHEDIR</cachedir>
  <!-- System font directories (when available) -->
  <dir>/usr/share/fonts</dir>
  <dir>/usr/local/share/fonts</dir>
  <dir>~/.fonts</dir>
  <!-- System cache -->
  <cachedir>/var/cache/fontconfig</cachedir>
  <cachedir>~/.cache/fontconfig</cachedir>
  <!-- Include system config if it exists -->
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <!-- Configuration -->
  <config>
    <rescan>
      <int>30</int>
    </rescan>
  </config>
</fontconfig>
FONTSCONF
    # Replace FONTDIR and CACHEDIR with actual paths.
    sed -i "s|FONTDIR|$DIR/fonts|g" "$DIR/fonts/fonts.conf"
    sed -i "s|CACHEDIR|$DIR/fonts/cache|g" "$DIR/fonts/fonts.conf"
    mkdir -p "$DIR/fonts/cache"
  fi
  # Point fontconfig to our custom config.
  export FONTCONFIG_FILE="$DIR/fonts/fonts.conf"
  export FONTCONFIG_PATH="$DIR/fonts"
  # Rebuild font cache for our bundled fonts.
  if command -v fc-cache >/dev/null 2>&1; then
    fc-cache -f "$DIR/fonts" >/dev/null 2>&1 || true
  fi
fi

# Start. Node 20+ --env-file properly parses .env (handles spaces, quotes).
cd "$DIR/app"
# Sanity check: server.js must exist at the expected path.
# Next.js 16 + Turbopack standalone output sometimes puts server.js
# under a nested source-dir (e.g. app/repo/server.js). The build script
# should flatten this, but if it didn't, give the user a clear error
# instead of letting Node.js emit a cryptic MODULE_NOT_FOUND.
if [ ! -f "server.js" ]; then
  echo "ERROR: server.js not found at $PWD/server.js"
  echo ""
  echo "The standalone package layout has changed (likely a Next.js version"
  echo "mismatch). Please re-run build-standalone.sh from the source repo"
  echo "to regenerate the package with the correct layout."
  echo ""
  echo "Current directory contents:"
  ls -la
  # As a fallback, search for server.js in nested subdirs.
  FOUND=$(find . -maxdepth 3 -name server.js -not -path "./node_modules/*" | head -1)
  if [ -n "$FOUND" ]; then
    echo ""
    echo "Found server.js at: $FOUND"
    echo "Trying to run it from its location..."
    cd "$(dirname "$FOUND")"
    if node --version 2>/dev/null | grep -qE '^v(2[0-9]|[3-9][0-9])'; then
      node --env-file="$DIR/.env" "$(basename "$FOUND")"
    else
      node "$(basename "$FOUND")"
    fi
    exit $?
  fi
  exit 1
fi
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
# NodeByte Crawl v4.0.7 — Standalone (Single Port)

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
