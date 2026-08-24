#!/bin/bash
# ============================================================
# install-deps.sh — install system shared libraries for Chromium
# Run this if the browser fails to launch with "cannot open shared object file"
# ============================================================
set -e

echo "[install-deps] Installing system libraries required by Chromium..."

if command -v apt-get >/dev/null 2>&1; then
  # Debian/Ubuntu
  apt-get update -qq
  apt-get install -y \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libnss3 \
    libnspr4 \
    libdrm2 \
    libxshmfence1 \
    fonts-liberation
  echo "[install-deps] Done (apt-get)."
elif command -v yum >/dev/null 2>&1; then
  # RHEL/CentOS/Fedora (yum)
  yum install -y \
    atk \
    at-spi2-atk \
    cups-libs \
    libxkbcommon \
    at-spi2-core \
    libXcomposite \
    libXdamage \
    libXfixes \
    libXrandr \
    mesa-libgbm \
    pango \
    cairo \
    alsa-lib \
    nss \
    nspr \
    libdrm \
    libXScrnSaver \
    liberation-fonts
  echo "[install-deps] Done (yum)."
elif command -v dnf >/dev/null 2>&1; then
  # Fedora (dnf)
  dnf install -y \
    atk \
    at-spi2-atk \
    cups-libs \
    libxkbcommon \
    at-spi2-core \
    libXcomposite \
    libXdamage \
    libXfixes \
    libXrandr \
    mesa-libgbm \
    pango \
    cairo \
    alsa-lib \
    nss \
    nspr \
    libdrm \
    libXScrnSaver \
    liberation-fonts
  echo "[install-deps] Done (dnf)."
elif command -v apk >/dev/null 2>&1; then
  # Alpine
  apk add --no-cache \
    at-spi2-core \
    at-spi2-atk \
    cups-libs \
    libxkbcommon \
    libxcomposite \
    libxdamage \
    libxfixes \
    libxrandr \
    mesa-gbm \
    pango \
    cairo \
    alsa-lib \
    nss \
    nspr \
    libdrm \
    ttf-freefont
  echo "[install-deps] Done (apk)."
else
  echo "[install-deps] ERROR: Unknown package manager."
  echo "Required libraries:"
  echo "  libatk-1.0.so.0, libatk-bridge-2.0.so.0, libcups.so.2,"
  echo "  libxkbcommon.so.0, libatspi.so.0, libXcomposite.so.1,"
  echo "  libXdamage.so.1, libXfixes.so.3, libXrandr.so.2, libgbm.so.1,"
  echo "  libpango-1.0.so.0, libcairo.so.2, libasound.so.2, libnss3.so, libnspr4.so"
  exit 1
fi

echo ""
echo "[install-deps] You can now run: bash start.sh"
