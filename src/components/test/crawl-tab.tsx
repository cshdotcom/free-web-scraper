'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Globe, Play, Square, Loader2, CheckCircle2, Timer } from 'lucide-react';
import { useTestConsole } from './store';
import { callApi } from './api-client';
import { LoadingButton, ExportButtons, MarkdownRender, EmptyState } from './shared';

type Format = 'markdown' | 'html' | 'rawHtml' | 'links' | 'screenshot';
const ALL_FORMATS: Format[] = ['markdown', 'html', 'rawHtml', 'links', 'screenshot'];

/** Escape a plain string for safe inclusion in HTML text content (title, <pre>). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface CrawlPage {
  url: string;
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: Array<{ url: string; text?: string } | string>;
  screenshot?: string;
  metadata?: Record<string, unknown>;
}
interface CrawlStatus {
  success: boolean;
  status: 'pending' | 'scraping' | 'completed' | 'cancelled' | 'failed';
  total: number;
  completed: number;
  data?: CrawlPage[];
  expiresAt?: string;
  error?: string;
}

export function CrawlTab() {
  const { authHeaders } = useTestConsole();

  const [url, setUrl] = React.useState('https://example.com');
  const [maxDepth, setMaxDepth] = React.useState(2);
  const [limit, setLimit] = React.useState(20);
  const [includes, setIncludes] = React.useState('');
  const [excludes, setExcludes] = React.useState('*/login/*,*/admin/*');
  const [formats, setFormats] = React.useState<Format[]>(['markdown']);

  const [jobId, setJobId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<CrawlStatus | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleFormat = (f: Format) => {
    setFormats((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f],
    );
  };

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

  // Poll the crawl status every 2s until terminal.
  const poll = React.useCallback(
    (id: string) => {
      abortRef.current = new AbortController();
      const tick = async () => {
        const r = await callApi<CrawlStatus>(
          { method: 'GET', path: `/v2/crawl/${id}`, signal: abortRef.current!.signal },
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
          return; // stop polling
        }
        pollRef.current = setTimeout(tick, 2000);
      };
      tick();
    },
    [authHeaders],
  );

  // Cleanup on unmount.
  React.useEffect(() => stopPolling, []);

  const onStart = async () => {
    if (!url.trim()) return;
    setStarting(true);
    setError(null);
    setStatus(null);
    setJobId(null);

    // Never send an empty formats list — fall back to markdown so the crawl
    // is always valid even if the user toggled everything off.
    const selectedFormats = formats.length ? formats : (['markdown'] as Format[]);
    const body: Record<string, unknown> = {
      url: url.trim(),
      maxDepth,
      limit,
      scrapeOptions: { formats: selectedFormats, onlyMainContent: true },
    };
    const inc = includes.split(',').map((s) => s.trim()).filter(Boolean);
    const exc = excludes.split(',').map((s) => s.trim()).filter(Boolean);
    if (inc.length) body.includes = inc;
    if (exc.length) body.excludes = exc;

    const r = await callApi<{ success: boolean; id?: string; error?: string }>(
      { method: 'POST', path: '/v2/crawl', body },
      authHeaders(),
    );
    setStarting(false);
    if (!r.ok || !r.data?.id) {
      setError(r.error || 'Failed to start crawl');
      return;
    }
    setJobId(r.data.id);
    poll(r.data.id);
  };

  const onCancel = async () => {
    if (!jobId) return;
    setCancelling(true);
    stopPolling();
    await callApi<{ success: boolean }>(
      { method: 'DELETE', path: `/v2/crawl/${jobId}` },
      authHeaders(),
    );
    setCancelling(false);
    // Trigger one final poll so UI reflects cancelled state.
    if (jobId) poll(jobId);
  };

  const onReset = () => {
    stopPolling();
    setJobId(null);
    setStatus(null);
    setError(null);
  };

  const running =
    status?.status === 'pending' || status?.status === 'scraping';
  const pages = status?.data ?? [];
  const pct =
    status && status.total > 0
      ? Math.round((status.completed / status.total) * 100)
      : 0;

  // Combined MD export
  const combinedMd = React.useMemo(() => {
    if (!pages.length) return undefined;
    return pages
      .map((p) => `# ${p.url}\n\nSource: <${p.url}>\n\n${p.markdown || '(no markdown)'}`)
      .join('\n\n---\n\n');
  }, [pages]);

  // Combined standalone HTML export — `<!DOCTYPE html>...<body>${html}</body>`
  // where the body is built from each page's html (if present) or markdown
  // wrapped in a <pre> fallback.
  const combinedHtml = React.useMemo(() => {
    if (!pages.length) return undefined;
    const body = pages
      .map((p) => {
        const inner = p.html?.trim()
          ? p.html
          : p.markdown?.trim()
            ? `<pre>${escapeHtml(p.markdown)}</pre>`
            : '<p>(no content)</p>';
        return `<h2>${escapeHtml(p.url)}</h2><div>${inner}</div>`;
      })
      .join('\n');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Crawl results</title></head><body>${body}</body></html>`;
  }, [pages]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-zinc-200 bg-card p-5 shadow-sm dark:border-zinc-800">
        <Label htmlFor="crawl-url" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Seed URL
        </Label>
        <div className="relative">
          <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            id="crawl-url"
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="pl-9"
            disabled={!!jobId}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="crawl-depth" className="mb-1 block text-xs font-medium text-muted-foreground">
              maxDepth (1–5)
            </Label>
            <Input
              id="crawl-depth"
              type="number"
              min={1}
              max={5}
              value={maxDepth}
              onChange={(e) => setMaxDepth(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
              disabled={!!jobId}
            />
          </div>
          <div>
            <Label htmlFor="crawl-limit" className="mb-1 block text-xs font-medium text-muted-foreground">
              limit (1–50)
            </Label>
            <Input
              id="crawl-limit"
              type="number"
              min={1}
              max={50}
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              disabled={!!jobId}
            />
          </div>
          <div>
            <Label htmlFor="crawl-inc" className="mb-1 block text-xs font-medium text-muted-foreground">
              includes <span className="text-zinc-400">(comma-separated glob patterns)</span>
            </Label>
            <Input
              id="crawl-inc"
              placeholder="*/docs/*"
              value={includes}
              onChange={(e) => setIncludes(e.target.value)}
              className="font-mono text-xs"
              disabled={!!jobId}
            />
          </div>
          <div>
            <Label htmlFor="crawl-exc" className="mb-1 block text-xs font-medium text-muted-foreground">
              excludes <span className="text-zinc-400">(comma-separated glob patterns)</span>
            </Label>
            <Input
              id="crawl-exc"
              placeholder="*/login/*,*/admin/*"
              value={excludes}
              onChange={(e) => setExcludes(e.target.value)}
              className="font-mono text-xs"
              disabled={!!jobId}
            />
          </div>
        </div>

        {/* Formats selector — mirrors the Scrape tab pattern. */}
        <div className="mt-4">
          <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Formats
          </Label>
          <div className="flex flex-wrap gap-2">
            {ALL_FORMATS.map((f) => {
              const on = formats.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggleFormat(f)}
                  disabled={!!jobId}
                  className={
                    'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ' +
                    (on
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300 dark:hover:bg-zinc-800')
                  }
                  aria-pressed={on}
                >
                  <span
                    className={
                      'h-3 w-3 rounded-sm border ' +
                      (on
                        ? 'border-emerald-500 bg-emerald-500'
                        : 'border-zinc-300 dark:border-zinc-600')
                    }
                  >
                    {on && (
                      <svg viewBox="0 0 12 12" className="h-3 w-3 text-white">
                        <path
                          d="M2.5 6.5l2.5 2.5 4.5-5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  {f}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!jobId ? (
            <LoadingButton loading={starting} onClick={onStart} className="gap-1.5">
              <Play className="h-3.5 w-3.5" />
              Start crawl
            </LoadingButton>
          ) : (
            <>
              {running && (
                <Button variant="destructive" size="sm" onClick={onCancel} disabled={cancelling} className="gap-1.5">
                  {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                  Cancel
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={onReset}>
                Reset
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Job state */}
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
              ) : status.status === 'cancelled' ? (
                <Square className="h-4 w-4 text-zinc-500" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin text-amber-600 dark:text-amber-400" />
              )}
              <Badge variant="outline" className="font-mono">
                status: {status.status}
              </Badge>
              <Badge variant="outline" className="font-mono">
                {status.completed} / {status.total}
              </Badge>
              {running && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Timer className="h-3 w-3" /> polling every 2s
                </span>
              )}
            </div>
            <code className="truncate text-[11px] text-muted-foreground">id: {jobId}</code>
          </div>
          <Progress value={pct} className="h-2" />
          <div className="mt-1.5 text-right text-[11px] text-muted-foreground">{pct}%</div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {status?.status === 'completed' ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Crawl finished — {pages.length} pages scraped.
            </>
          ) : running ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600 dark:text-amber-400" />
              Crawling in progress…
            </>
          ) : (
            <>Idle</>
          )}
        </div>
        {status?.data && status.data.length > 0 && (
          <ExportButtons
            json={{ jobId, ...status }}
            markdown={combinedMd}
            html={combinedHtml}
            filenameBase="crawl-results"
          />
        )}
      </div>

      {/* Pages */}
      {pages.length > 0 ? (
        <div className="space-y-2">
          {pages.map((p, i) => (
            <details
              key={p.url + i}
              className="overflow-hidden rounded-lg border border-zinc-200 bg-card dark:border-zinc-800"
            >
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                <span className="font-mono text-xs text-emerald-700 dark:text-emerald-300">{p.url}</span>
                {p.metadata?.title && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    — {String(p.metadata.title)}
                  </span>
                )}
              </summary>
              <div className="space-y-3 border-t border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/30">
                {/* Markdown — default visible content */}
                {p.markdown ? (
                  <MarkdownRender source={p.markdown} />
                ) : formats.includes('markdown') ? (
                  <p className="text-xs text-muted-foreground">(no markdown)</p>
                ) : null}

                {/* HTML collapsible */}
                {formats.includes('html') && p.html && (
                  <details className="overflow-hidden rounded-md border border-zinc-200 bg-card dark:border-zinc-800">
                    <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900/40">
                      View HTML
                    </summary>
                    <pre className="max-h-96 overflow-auto bg-zinc-50 p-2 text-[11px] dark:bg-zinc-900/40">
                      <code className="font-mono whitespace-pre-wrap break-all">{p.html}</code>
                    </pre>
                  </details>
                )}

                {/* rawHtml collapsible */}
                {formats.includes('rawHtml') && p.rawHtml && (
                  <details className="overflow-hidden rounded-md border border-zinc-200 bg-card dark:border-zinc-800">
                    <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900/40">
                      View raw HTML
                    </summary>
                    <pre className="max-h-96 overflow-auto bg-zinc-50 p-2 text-[11px] dark:bg-zinc-900/40">
                      <code className="font-mono whitespace-pre-wrap break-all">{p.rawHtml}</code>
                    </pre>
                  </details>
                )}

                {/* Links collapsible */}
                {formats.includes('links') && p.links && p.links.length > 0 && (
                  <details className="overflow-hidden rounded-md border border-zinc-200 bg-card dark:border-zinc-800">
                    <summary className="cursor-pointer px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900/40">
                      Links ({p.links.length})
                    </summary>
                    <ul className="max-h-96 space-y-1 overflow-auto bg-zinc-50 p-2 dark:bg-zinc-900/40">
                      {p.links.map((l, li) => {
                        const linkUrl = typeof l === 'string' ? l : l.url;
                        const linkText = typeof l === 'string' ? l : (l.text || l.url);
                        return (
                          <li
                            key={`${linkUrl}-${li}`}
                            className="flex items-baseline gap-2 rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-900/40"
                          >
                            <span className="font-mono text-[10px] text-zinc-400">
                              {String(li + 1).padStart(3, '0')}
                            </span>
                            <a
                              href={linkUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="truncate font-mono text-xs text-emerald-700 hover:underline dark:text-emerald-300"
                              title={linkText}
                            >
                              {linkText || linkUrl}
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                )}

                {/* Screenshot */}
                {formats.includes('screenshot') && p.screenshot && (
                  <div className="overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/40">
                    <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Screenshot</p>
                    <img
                      src={p.screenshot}
                      alt={`Screenshot of ${p.url}`}
                      className="mx-auto max-w-full rounded shadow"
                    />
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      ) : (
        !running && (
          <EmptyState
            title="No crawl started"
            hint="Set a seed URL and depth, then click Start crawl."
          />
        )
      )}
    </div>
  );
}
