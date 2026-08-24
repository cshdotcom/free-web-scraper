#!/bin/bash
# ============================================================
# install-deps.sh — install system shared libraries for Chromium
# Handles Ubuntu 24.04+ package name changes (t64 suffix).
# ============================================================

echo "[install-deps] Installing system libraries required by Chromium..."

if command -v apt-get >/dev/null 2>&1; then
  # Debian/Ubuntu — try t64 variants (Ubuntu 24.04+) first, fall back to regular
  apt-get update -qq 2>/dev/null

  # Function: try to install a package, trying t64 variant first
  try_install() {
    apt-get install -y "$1" 2>/dev/null && return 0
    apt-get install -y "$1t64" 2>/dev/null && return 0
    echo "  [warn] Could not install $1 (may already be present or not needed)"
    return 0
  }

  try_install libatk1.0-0
  try_install libatk-bridge2.0-0
  try_install libcups2
  try_install libxkbcommon0
  try_install libatspi2.0-0
  try_install libxcomposite1
  try_install libxdamage1
  try_install libxfixes3
  try_install libxrandr2
  try_install libgbm1
  try_install libpango-1.0-0
  try_install libcairo2
  try_install libasound2
  try_install libnss3
  try_install libnspr4
  try_install libdrm2
  try_install libxshmfence1
  apt-get install -y fonts-liberation fonts-noto-cjk fonts-noto-color-emoji 2>/dev/null || true

  echo "[install-deps] Done (apt-get)."

elif command -v yum >/dev/null 2>&1; then
  yum install -y atk at-spi2-atk cups-libs libxkbcommon at-spi2-core \
    libXcomposite libXdamage libXfixes libXrandr mesa-libgbm \
    pango cairo alsa-lib nss nspr libdrm libXScrnSaver liberation-fonts 2>/dev/null || true
    google-noto-sans-cjk-fonts google-noto-color-emoji-fonts
  echo "[install-deps] Done (yum)."

elif command -v dnf >/dev/null 2>&1; then
  dnf install -y atk at-spi2-atk cups-libs libxkbcommon at-spi2-core \
    libXcomposite libXdamage libXfixes libXrandr mesa-libgbm \
    pango cairo alsa-lib nss nspr libdrm libXScrnSaver liberation-fonts 2>/dev/null || true
    google-noto-sans-cjk-fonts google-noto-color-emoji-fonts
  echo "[install-deps] Done (dnf)."

elif command -v apk >/dev/null 2>&1; then
  apk add --no-cache at-spi2-core at-spi2-atk cups-libs libxkbcommon \
    libxcomposite libxdamage libxfixes libxrandr mesa-gbm pango cairo \
    alsa-lib nss nspr libdrm ttf-freefont 2>/dev/null || true
  echo "[install-deps] Done (apk)."

else
  echo "[install-deps] ERROR: Unknown package manager."
  echo "Required libraries (install manually):"
  echo "  libatk-1.0.so.0, libatk-bridge-2.0.so.0, libcups.so.2,"
  echo "  libxkbcommon.so.0, libatspi.so.0, libXcomposite.so.1,"
  echo "  libXdamage.so.1, libXfixes.so.3, libXrandr.so.2, libgbm.so.1,"
  echo "  libpango-1.0.so.0, libcairo.so.2, libasound.so.2, libnss3.so, libnspr4.so"
  exit 1
fi

echo ""
echo "[install-deps] You can now run: bash start.sh"
