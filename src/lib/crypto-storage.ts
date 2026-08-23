/**
 * Encrypted cookie storage for sensitive values (e.g. API keys).
 *
 * Uses the Web Crypto API (`crypto.subtle`) with AES-GCM. The AES key is
 * derived from a fixed app passphrase + fixed salt via PBKDF2 — this is
 * obfuscation, not bullet-proof security. The goal is to ensure the value
 * is not plainly readable in the browser cookie jar (DevTools → Application
 * → Cookies) while still being fully round-trippable in the same browser.
 *
 * Each encryption call generates a fresh random 12-byte IV which is
 * prepended to the ciphertext and base64-encoded together, so the stored
 * cookie is `base64(iv || ciphertext)`.
 *
 * All functions are SSR-safe (no-op when `window` is undefined).
 */

const APP_PASSPHRASE = 'nodebyte-crawl-v2-static-key';
const APP_SALT = 'nodebyte-crawl-v2-static-salt';
const PBKDF2_ITERATIONS = 100_000;
const IV_BYTE_LENGTH = 12;

let cachedCryptoKey: CryptoKey | null = null;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.document !== 'undefined';
}

/**
 * Derives (and caches) the AES-GCM CryptoKey from the app passphrase.
 * Caching is safe because the key never changes and the underlying
 * CryptoKey object is not exportable.
 */
async function getCryptoKey(): Promise<CryptoKey> {
  if (cachedCryptoKey) return cachedCryptoKey;

  const encoder = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(APP_PASSPHRASE),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  cachedCryptoKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(APP_SALT),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );

  return cachedCryptoKey;
}

/** Read a named cookie from `document.cookie`. Returns the raw (encoded) value, or null. */
function readCookie(name: string): string | null {
  if (!isBrowser()) return null;
  const escaped = name.replace(/([.$?*|{}()[\]/+^])/g, '\\$1');
  const match = document.cookie.match(
    new RegExp('(?:^|; )' + escaped + '=([^;]*)'),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

/** Write a cookie with the given max-age (in days), path=/, SameSite=Lax. */
function writeCookie(name: string, value: string, maxAgeDays: number): void {
  if (!isBrowser()) return;
  const maxAgeSeconds = Math.max(1, Math.floor(maxAgeDays * 24 * 60 * 60));
  document.cookie =
    `${name}=${encodeURIComponent(value)}; max-age=${maxAgeSeconds}; path=/; SameSite=Lax`;
}

/** Expire a cookie immediately by setting max-age=0. */
function expireCookie(name: string): void {
  if (!isBrowser()) return;
  document.cookie = `${name}=; max-age=0; path=/; SameSite=Lax`;
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encrypt `value` with AES-GCM and store the result (base64 of iv||ciphertext)
 * in a cookie named `name`. The cookie lives for `maxAgeDays` (default 30).
 *
 * SSR: no-op when not in a browser.
 */
export async function encryptAndStoreCookie(
  name: string,
  value: string,
  maxAgeDays = 30,
): Promise<void> {
  if (!isBrowser()) return;
  try {
    const key = await getCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
    const encoder = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(value),
    );

    const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.byteLength);

    const b64 = bufferToBase64(combined.buffer);
    writeCookie(name, b64, maxAgeDays);
  } catch (err) {
    // Best-effort: log and continue. Never throw into caller —
    // the API key bar shouldn't crash the page over a cookie write.
    console.warn('[crypto-storage] encryptAndStoreCookie failed:', err);
  }
}

/**
 * Read the cookie named `name`, base64-decode it, split off the IV,
 * decrypt the rest with AES-GCM, and return the original plaintext.
 * Returns null if the cookie is missing or decryption fails (e.g. wrong key,
 * tampered value, malformed base64).
 *
 * SSR: returns null.
 */
export async function decryptCookie(name: string): Promise<string | null> {
  if (!isBrowser()) return null;
  const b64 = readCookie(name);
  if (!b64) return null;
  try {
    const combined = base64ToUint8Array(b64);
    if (combined.length <= IV_BYTE_LENGTH) return null;
    const iv = combined.slice(0, IV_BYTE_LENGTH);
    const ciphertext = combined.slice(IV_BYTE_LENGTH);

    const key = await getCryptoKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext,
    );
    const decoder = new TextDecoder();
    return decoder.decode(plaintext);
  } catch (err) {
    console.warn('[crypto-storage] decryptCookie failed:', err);
    return null;
  }
}

/**
 * Clear (expire) the cookie named `name`.
 * SSR: no-op.
 */
export async function clearCookie(name: string): Promise<void> {
  if (!isBrowser()) return;
  expireCookie(name);
}
