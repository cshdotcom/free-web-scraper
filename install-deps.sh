#!/bin/bash
# ============================================================
# install-deps.sh — install system shared libraries + multi-language
# fonts for Chromium. Run this if the browser fails to launch with
# "cannot open shared object file", OR if browser screenshots show
# "tofu boxes" (□□□) for non-Latin text (CJK, Cyrillic, Arabic, etc.).
# ============================================================
set -e

echo "[install-deps] Installing system libraries + multi-language fonts..."

# Common multi-language font packages (cover Latin, CJK, Cyrillic,
# Arabic, Hebrew, Thai, Vietnamese, Indic, Korean, Japanese, Chinese).
DEBIAN_FONTS="fonts-noto fonts-noto-cjk fonts-noto-cjk-extra fonts-noto-color-emoji fonts-noto-core fonts-wqy-zenhei fonts-wqy-microhei fonts-arabeyes fonts-kacst fonts-khmeros-core fonts-thai-tlwg fonts-lohit-deva fonts-lohit-beng-assamese fonts-lohit-guru fonts-lohit-taml fonts-lohit-orya fonts-lohit-knda fonts-sil-padauk fonts-sil-scheherazade fonts-ipafonts fonts-takao fonts-unfonts-core fonts-liberation"
RHEL_FONTS="google-noto-sans-cjk-ttc-fonts google-noto-cjk-fonts google-noto-emoji-color-fonts google-noto-sans-fonts wqy-zenhei-fonts wqy-microhei-fonts dejavu-sans-fonts liberation-fonts ipa-gothic-fonts ipa-mincho-fonts ipa-pgothic-fonts ipa-pmincho-fonts khmeros-fonts-all thai-fonts-all lohit-* fonts-arabic fonts-KACST"
ALPINE_FONTS="font-noto font-noto-cjk font-noto-emoji font-wqy-zenhei font-wqy-microhei font-ipa font-liberation font-dejavu font-arabic-mono font-mplus-outlined font-terminux"

if command -v apt-get >/dev/null 2>&1; then
  # Debian/Ubuntu
  apt-get update -qq
  apt-get install -y \
    libatk1.0-0t64 \
    libatk-bridge2.0-0t64 \
    libcups2t64 \
    libxkbcommon0 \
    libatspi2.0-0t64 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2t64 \
    libnss3 \
    libnspr4 \
    libdrm2 \
    libxshmfence1 \
    $DEBIAN_FONTS
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
    $RHEL_FONTS
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
    $RHEL_FONTS
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
    $ALPINE_FONTS
  echo "[install-deps] Done (apk)."
else
  echo "[install-deps] ERROR: Unknown package manager."
  echo "Required libraries:"
  echo "  libatk-1.0.so.0, libatk-bridge-2.0.so.0, libcups.so.2,"
  echo "  libxkbcommon.so.0, libatspi.so.0, libXcomposite.so.1,"
  echo "  libXdamage.so.1, libXfixes.so.3, libXrandr.so.2, libgbm.so.1,"
  echo "  libpango-1.0.so.0, libcairo.so.2, libasound.so.2, libnss3.so, libnspr4.so"
  echo "Recommended fonts: Noto Sans CJK (covers Chinese/Japanese/Korean),"
  echo "  Noto Sans Arabic, Noto Sans Devanagari, Noto Sans Thai, Noto Color Emoji,"
  echo "  Liberation Sans (Latin fallback), WenQuanYi (CJK fallback)"
  exit 1
fi

# Refresh the font cache so the new fonts are discoverable immediately.
if command -v fc-cache >/dev/null 2>&1; then
  echo "[install-deps] Refreshing font cache (this may take ~10s)..."
  fc-cache -f -v >/dev/null 2>&1 || true
fi

echo ""
echo "[install-deps] You can now run: bash start.sh"
echo "[install-deps] Browser screenshots should now render CJK, Cyrillic,"
echo "               Arabic, Hebrew, Thai, Indic, Korean text correctly."
