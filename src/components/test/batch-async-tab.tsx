'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Play, Loader2, CheckCircle2, Timer, ListChecks } from 'lucide-react';
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
  data?: { markdown?: string; html?: string; metadata?: Record<string, unknown> };
  error?: string;
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

  const [jobId, setJobId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<BatchStatus | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const tick = async () => {
        const r = await callApi<BatchStatus>(
          { method: 'GET', path: `/v2/batch/scrape/${id}`, signal: abortRef.current!.signal },
          authHeaders(),
        );
        if (!r.ok) {
          setError(r.error || 'Poll failed');
          setStatus(null);
          return;
        }
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

    const r = await callApi<{ success: boolean; id?: string; error?: string }>(
      {
        method: 'POST',
        path: '/v2/batch/scrape',
        body: { urls: list, formats: ['markdown'], onlyMainContent: true, timeout, maxRetries },
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
          <Badge variant="outline" className="font-mono">
            {fmt(t('misc.Nurls'), { N: urlCount })}
          </Badge>
        </div>
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
