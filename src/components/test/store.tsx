'use client';

import * as React from 'react';
import {
  encryptAndStoreCookie,
  decryptCookie,
  clearCookie,
} from '@/lib/crypto-storage';

export interface AuthStatus {
  requiresAuth: boolean;
  publicBaseUrl: string;
  brand: string;
  version: string;
}

/**
 * Short cookie name. The value stored in the cookie is AES-GCM-encrypted
 * (see src/lib/crypto-storage.ts) — never plaintext.
 */
const COOKIE_NAME = 'nbc-key';

interface TestCtxValue {
  apiKey: string;
  setApiKey: (v: string) => void;
  clearApiKey: () => void;
  /** True once we've finished the initial cookie-read on mount. Lets the
   *  UI distinguish "no key saved" from "still loading the key" so we don't
   *  flash a locked state to a user who actually has a saved key. */
  apiKeyReady: boolean;
  authStatus: AuthStatus | null;
  setAuthStatus: (s: AuthStatus | null) => void;
  /** True if the server requires an API key for requests. */
  requiresAuth: boolean;
  /** Computed: 1 if the user can run a request right now. */
  canRun: boolean;
  /** Build the Authorization header object (or empty if not needed). */
  authHeaders: () => Record<string, string>;
}

const TestCtx = React.createContext<TestCtxValue | null>(null);

export function TestConsoleProvider({ children }: { children: React.ReactNode }) {
  const [apiKey, setApiKeyState] = React.useState<string>('');
  const [apiKeyReady, setApiKeyReady] = React.useState<boolean>(false);
  const [authStatus, setAuthStatus] = React.useState<AuthStatus | null>(null);

  // Load saved key from the encrypted cookie on mount.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await decryptCookie(COOKIE_NAME);
      if (!cancelled && saved) setApiKeyState(saved);
      if (!cancelled) setApiKeyReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch auth status from the public /api/status endpoint on mount.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/status');
        if (!res.ok) return;
        const json = (await res.json()) as AuthStatus;
        if (!cancelled) setAuthStatus(json);
      } catch {
        /* ignore — leave authStatus null */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setApiKey = React.useCallback((v: string) => {
    setApiKeyState(v);
    // Fire-and-forget; the cookie write happens in the background.
    // Empty string ⇒ clear the cookie so we don't leave a stale encrypted
    // empty value lying around.
    if (v.trim()) {
      void encryptAndStoreCookie(COOKIE_NAME, v.trim());
    } else {
      void clearCookie(COOKIE_NAME);
    }
  }, []);

  const clearApiKey = React.useCallback(() => {
    setApiKeyState('');
    void clearCookie(COOKIE_NAME);
  }, []);

  const requiresAuth = authStatus?.requiresAuth ?? false;
  // canRun only flips to "no" once we've finished loading the saved key
  // (so we don't lock the user out during the brief cookie-decrypt window).
  const canRun =
    !requiresAuth || (apiKeyReady && apiKey.trim().length > 0);

  const authHeaders = React.useCallback((): Record<string, string> => {
    if (!requiresAuth) return {};
    const k = apiKey.trim();
    if (!k) return {};
    return { Authorization: `Bearer ${k}` };
  }, [requiresAuth, apiKey]);

  const value = React.useMemo(
    () => ({
      apiKey,
      setApiKey,
      clearApiKey,
      apiKeyReady,
      authStatus,
      setAuthStatus,
      requiresAuth,
      canRun,
      authHeaders,
    }),
    [
      apiKey,
      setApiKey,
      clearApiKey,
      apiKeyReady,
      authStatus,
      setAuthStatus,
      requiresAuth,
      canRun,
      authHeaders,
    ],
  );

  return <TestCtx.Provider value={value}>{children}</TestCtx.Provider>;
}

export function useTestConsole(): TestCtxValue {
  const ctx = React.useContext(TestCtx);
  if (!ctx) throw new Error('useTestConsole must be used within TestConsoleProvider');
  return ctx;
}
