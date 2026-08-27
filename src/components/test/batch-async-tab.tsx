'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Play, Loader2, CheckCircle2, Timer, ListChecks, Cookie, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTestConsole } from './store';
import { callApi } from './api-client';
import { LoadingButton, ExportButtons, MarkdownRender, EmptyState } from './shared';
import { useI18n } from '@/components/i18n';

/** Escape a plain string for safe inclusion in HTML text content (title, <pre>). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface BatchItem {
  url: string;
  success: boolean;
  data?: { markdown?: string; html?: string; metadata?: Record<string, unknown>; statusCode?: number };
  error?: string;
  statusCode?: number;
}
interface BatchStatus {
  success: boolean;
  status: 'pending' | 'scraping' | 'completed' | 'cancelled' | 'failed';
  total: number;
  completed: number;
  data?: BatchItem[];
  expiresAt?: string;
  error?: string;
}

function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}

export function BatchAsyncTab() {
  const { authHeaders } = useTestConsole();
  const { t } = useI18n();

  const [urls, setUrls] = React.useState(
    'https://example.com\nhttps://example.org\nhttps://example.net',
  );
  const [timeout, setTimeout_] = React.useState(45000);
  const [maxRetries, setMaxRetries] = React.useState(2);
  const [device, setDevice] = React.useState<'auto' | 'desktop' | 'mobile'>('auto');
  // Per-URL cookies (aligned with URL list by line index).
  const [perUrlCookies, setPerUrlCookies] = React.useState<string[]>(['', '', '']);
  const [cookiesOpen, setCookiesOpen] = React.useState(false);

  const [jobId, setJobId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<BatchStatus | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const urlList = React.useMemo(
    () => urls.split('\n').map((s) => s.trim()).filter(Boolean),
    [urls],
  );

  React.useEffect(() => {
    setPerUrlCookies((prev) => {
      const next = new Array(urlList.length).fill('');
      for (let i = 0; i < Math.min(prev.length, urlList.length); i++) next[i] = prev[i];
      if (prev.length === next.length && prev.every((v, i) => v === next[i])) return prev;
      return next;
    });
  }, [urlList.length]);

  const stopPolling = () => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  };

  const poll = React.useCallback(
    (id: string) => {
      abortRef.current = new AbortController();
      // Tolerate transient poll failures (network blip, gateway
      // timeout, slow response). Only surface an error after 10
      // consecutive failures (~20s of errors) — same logic as the
      // crawl-tab polling. Without this, a slow-responding batch
      // job would suddenly report "Poll failed — please reload"
      // even though the job is still making progress.
      let consecutiveFailures = 0;
      const tick = async () => {
        const r = await callApi<BatchStatus>(
          { method: 'GET', path: `/v2/batch/scrape/${id}`, signal: abortRef.current!.signal },
          authHeaders(),
        );
        if (abortRef.current?.signal.aborted) return;
        if (!r.ok) {
          consecutiveFailures += 1;
          if (consecutiveFailures >= 10) {
            setError(r.error || 'Polling failed for 20+ seconds — the backend may be unreachable');
            setStatus(null);
            return;
          }
          // Swallow transient failures and retry on the next tick.
          pollRef.current = setTimeout(tick, 2000);
          return;
        }
        consecutiveFailures = 0;
        setStatus(r.data);
        if (
          r.data?.status === 'completed' ||
          r.data?.status === 'cancelled' ||
          r.data?.status === 'failed'
        ) {
          return;
        }
        pollRef.current = setTimeout(tick, 2000);
      };
      tick();
    },
    [authHeaders],
  );

  React.useEffect(() => stopPolling, []);

  const onStart = async () => {
    const list = urls.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!list.length) return;
    setStarting(true);
    setError(null);
    setStatus(null);
    setJobId(null);

    const body: Record<string, unknown> = {
      urls: list,
      formats: ['markdown'],
      onlyMainContent: true,
      timeout,
      maxRetries,
      device,
    };

    // Per-URL cookies: when ANY cookie field is non-empty, send the
    // array aligned with `urls` (length must match).
    const hasAnyCookie = perUrlCookies.some((c) => c.trim().length > 0);
    if (hasAnyCookie && perUrlCookies.length === list.length) {
      body.cookies = perUrlCookies.map((c) => c.trim());
    }

    const r = await callApi<{ success: boolean; id?: string; error?: string }>(
      {
        method: 'POST',
        path: '/v2/batch/scrape',
        body,
      },
      authHeaders(),
    );
    setStarting(false);
    if (!r.ok || !r.data?.id) {
      setError(r.error || 'Failed to start batch');
      return;
    }
    setJobId(r.data.id);
    poll(r.data.id);
  };

  const onReset = () => {
    stopPolling();
    setJobId(null);
    setStatus(null);
    setError(null);
  };

  const running = status?.status === 'pending' || status?.status === 'scraping';
  const items = status?.data ?? [];
  const pct = status && status.total > 0 ? Math.round((status.completed / status.total) * 100) : 0;
  const combinedMd = React.useMemo(() => {
    if (!items.length) return undefined;
    return items
      .map((it) => `# ${it.url}\n\nSource: <${it.url}>\n\n${it.data?.markdown || t('empty.noMarkdownShorthand')}`)
      .join('\n\n---\n\n');
  }, [items, t]);

  // Combined standalone HTML export. For each result we embed its raw `html`
  // when available, otherwise fall back to the markdown wrapped in <pre>.
  const combinedHtml = React.useMemo(() => {
    if (!items.length) return undefined;
    const body = items
      .map((it) => {
        const html = it.data?.html?.trim();
        const md = it.data?.markdown?.trim();
        const inner = html
          ? html
          : md
            ? `<pre>${escapeHtml(md)}</pre>`
            : `<p>${escapeHtml(t('empty.noContent'))}</p>`;
        return `<h2>${escapeHtml(it.url)}</h2><div>${inner}</div>`;
      })
      .join('\n');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Batch results</title></head><body>${body}</body></html>`;
  }, [items, t]);

  const urlCount = urls.split('\n').filter((s) => s.trim()).length;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-zinc-200 bg-card p-5 shadow-sm dark:border-zinc-800">
        <Label htmlFor="ba-urls" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {t('label.urlsOnePerLine')}
        </Label>
        <Textarea
          id="ba-urls"
          rows={5}
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          placeholder="https://example.com&#10;https://example.org"
          className="font-mono text-xs"
          disabled={!!jobId}
        />

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="ba-timeout" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('label.timeoutMs')}
            </Label>
            <Input
              id="ba-timeout"
              type="number"
              value={timeout}
              onChange={(e) => setTimeout_(Number(e.target.value) || 45000)}
              disabled={!!jobId}
            />
          </div>
          <div>
            <Label htmlFor="ba-retries" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('label.maxRetries')}
            </Label>
            <Input
              id="ba-retries"
              type="number"
              min={0}
              max={5}
              value={maxRetries}
              onChange={(e) => setMaxRetries(Number(e.target.value) || 0)}
              disabled={!!jobId}
            />
          </div>
          <div>
            <Label htmlFor="ba-device" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('btn.device')}
            </Label>
            <Select
              value={device}
              onValueChange={(v) => setDevice(v as 'auto' | 'desktop' | 'mobile')}
              disabled={!!jobId}
            >
              <SelectTrigger id="ba-device" className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t('device.auto')}</SelectItem>
                <SelectItem value="desktop">{t('device.desktop')}</SelectItem>
                <SelectItem value="mobile">{t('device.mobile')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!jobId ? (
            <LoadingButton loading={starting} onClick={onStart} className="gap-1.5">
              <Play className="h-3.5 w-3.5" />
              {t('btn.startBatch')}
            </LoadingButton>
          ) : (
            <Button variant="outline" size="sm" onClick={onReset}>
              {t('btn.reset')}
            </Button>
          )}
          {!jobId && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => setCookiesOpen((v) => !v)}
            >
              <Cookie className="h-3.5 w-3.5" />
              {cookiesOpen ? t('btn.hide') : (t('label.cookies') || 'Cookies')}
            </Button>
          )}
          <Badge variant="outline" className="font-mono">
            {fmt(t('misc.Nurls'), { N: urlCount })}
          </Badge>
        </div>

        {cookiesOpen && !jobId && (
          <div className="mt-4 rounded-md border border-amber-200/60 bg-amber-50/40 p-3 dark:border-amber-800/50 dark:bg-amber-900/10">
            <Label className="mb-2 block text-xs font-medium text-amber-800 dark:text-amber-200">
              {t('label.perUrlCookies') || 'Per-URL cookies (one field per URL above, aligned by index)'}
            </Label>
            <p className="mb-2 text-[10px] text-muted-foreground">
              {t('label.perUrlCookiesHint') || 'Each URL receives ONLY its own cookies — no leakage between URLs in the batch. Leave a field empty to send no cookies for that URL.'}
            </p>
            <div className="max-h-64 overflow-y-auto rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/40">
              {urlList.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  {t('empty.addUrlFirst') || 'Add at least one URL above to enable per-URL cookie inputs.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {urlList.map((u, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span
                        className="mt-1.5 inline-block w-6 shrink-0 text-right font-mono text-[10px] text-muted-foreground"
                        title={`Cookie for URL #${i + 1}`}
                      >
                        #{i + 1}
                      </span>
                      <div className="flex-1">
                        <div className="mb-1 truncate font-mono text-[10px] text-muted-foreground">{u}</div>
                        <Input
                          type="text"
                          placeholder="session=abc; token=xyz"
                          value={perUrlCookies[i] ?? ''}
                          onChange={(e) =>
                            setPerUrlCookies((prev) => {
                              const next = [...prev];
                              while (next.length <= i) next.push('');
                              next[i] = e.target.value;
                              return next;
                            })
                          }
                          className="h-8 font-mono text-xs"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {jobId && status && (
        <div className="rounded-xl border border-zinc-200 bg-card p-4 shadow-sm dark:border-zinc-800">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {status.status === 'completed' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-amber-600 dark:text-amber-400" />
              )}
              <Badge variant="outline" className="font-mono">
                {fmt(t('misc.statusLabel'), { X: status.status })}
              </Badge>
              <Badge variant="outline" className="font-mono">
                {fmt(t('misc.Ncompleted'), { N: status.completed, M: status.total })}
              </Badge>
              {running && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Timer className="h-3 w-3" /> {t('status.pollingEvery2s')}
                </span>
              )}
            </div>
            <code className="truncate text-[11px] text-muted-foreground">
              {fmt(t('misc.idLabel'), { X: jobId })}
            </code>
          </div>
          <Progress value={pct} className="h-2" />
          <div className="mt-1.5 text-right text-[11px] text-muted-foreground">
            {fmt(t('misc.Npercent'), { N: pct })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {status?.status === 'completed' ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              {fmt(t('status.batchFinished'), { N: items.length })}
            </>
          ) : running ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600 dark:text-amber-400" />
              {t('status.batchInProgress')}
            </>
          ) : (
            <>{t('status.idle')}</>
          )}
        </div>
        {status?.data && status.data.length > 0 && (
          <ExportButtons
            json={{ jobId, ...status }}
            markdown={combinedMd}
            html={combinedHtml}
            filenameBase="batch-async-results"
          />
        )}
      </div>

      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((it, i) => (
            <details
              key={it.url + i}
              className="overflow-hidden rounded-lg border border-zinc-200 bg-card dark:border-zinc-800"
            >
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                <span className="font-mono text-xs text-emerald-700 dark:text-emerald-300">{it.url}</span>
                {it.data?.metadata?.title && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    — {String(it.data.metadata.title)}
                  </span>
                )}
                {(() => {
                  const sc =
                    it.data?.statusCode ??
                    it.statusCode ??
                    (typeof it.data?.metadata?.statusCode === 'number'
                      ? (it.data!.metadata!.statusCode as number)
                      : undefined);
                  if (sc === undefined) return null;
                  const tone =
                    sc >= 200 && sc < 300
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : sc >= 400 && sc < 600
                        ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                        : 'border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300';
                  return (
                    <Badge
                      variant="outline"
                      className={cn('ml-2 font-mono text-[10px]', tone)}
                    >
                      {fmt(t('result.pageStatus'), { N: sc })}
                    </Badge>
                  );
                })()}
              </summary>
              <div className="border-t border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/30">
                {it.success && it.data?.markdown ? (
                  <MarkdownRender source={it.data.markdown} />
                ) : (
                  <p className="text-xs text-rose-700 dark:text-rose-300">
                    {fmt(t('misc.errorPrefix'), { X: it.error || t('empty.noDataReturned') })}
                  </p>
                )}
              </div>
            </details>
          ))}
        </div>
      ) : (
        !running && (
          <EmptyState
            title={t('empty.noBatchStarted')}
            hint={t('empty.noBatchStartedHint')}
          />
        )
      )}

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ListChecks className="h-3.5 w-3.5" />
        {t('misc.tipAsyncBatch')}
      </div>
    </div>
  );
}
