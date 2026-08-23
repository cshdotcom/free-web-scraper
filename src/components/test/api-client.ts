'use client';

import { toast } from 'sonner';

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  durationMs: number;
  data: T | null;
  error?: string;
}

export interface ApiCallOptions {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
  /** extra headers (auth is added by caller) */
  headers?: Record<string, string>;
  /** abort signal */
  signal?: AbortSignal;
}

/**
 * Thin fetch wrapper used by every test-console tab. Measures wall time,
 * normalises errors, and surfaces a toast on failure. Always uses relative
 * paths so requests hit the Next.js proxy routes (no port in URL).
 */
export async function callApi<T = unknown>(
  opts: ApiCallOptions,
  authHeaders: Record<string, string>,
): Promise<ApiResult<T>> {
  const t0 = performance.now();
  try {
    const init: RequestInit = {
      method: opts.method,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
        ...authHeaders,
      },
      signal: opts.signal,
    };
    if (opts.body !== undefined && opts.method !== 'GET' && opts.method !== 'DELETE') {
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(opts.path, init);
    const durationMs = Math.round(performance.now() - t0);

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const errMsg =
        (parsed && typeof parsed === 'object' && 'error' in parsed
          ? String((parsed as { error?: unknown }).error)
          : undefined) ||
        (typeof parsed === 'string' ? parsed : undefined) ||
        `HTTP ${res.status} ${res.statusText}`;
      toast.error(`Request failed: ${errMsg}`);
      return { ok: false, status: res.status, durationMs, data: parsed as T | null, error: errMsg };
    }

    return { ok: true, status: res.status, durationMs, data: parsed as T };
  } catch (e) {
    const durationMs = Math.round(performance.now() - t0);
    const msg = e instanceof Error ? e.message : 'Network error';
    toast.error(`Network error: ${msg}`);
    return { ok: false, status: 0, durationMs, data: null, error: msg };
  }
}

/** Trigger a JSON/MD download in the browser. */
export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Pretty-print JSON for export / display. */
export function prettyJson(obj: unknown): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}
