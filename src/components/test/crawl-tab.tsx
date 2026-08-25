'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
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
import { Globe, Play, Square, Loader2, CheckCircle2, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTestConsole } from './store';
import { callApi } from './api-client';
import { LoadingButton, ExportButtons, MarkdownRender, EmptyState } from './shared';
import { useI18n } from '@/components/i18n';

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

interface CrawlPageData {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: Array<{ url: string; text?: string } | string>;
  screenshot?: string;
  metadata?: Record<string, unknown>;
  strategy?: string;
  statusCode?: number;
}
interface CrawlPage {
  url: string;
  success: boolean;
  error?: string;
  data?: CrawlPageData;
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

/** Format a string with {N} and {X} placeholders. */
function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}

export function CrawlTab() {
  const { authHeaders } = useTestConsole();
  const { t } = useI18n();

  const [url, setUrl] = React.useState('https://example.com');
  const [maxDepth, setMaxDepth] = React.useState(2);
  const [limit, setLimit] = React.useState(20);
  const [includes, setIncludes] = React.useState('');
  const [excludes, setExcludes] = React.useState('*/login/*,*/admin/*');
  const [formats, setFormats] = React.useState<Format[]>(['markdown']);
  const [device, setDevice] = React.useState<'auto' | 'desktop' | 'mobile'>('auto');
  // Sitemap auto-discovery: 'include' (default) | 'skip' | 'only'.
  // 'include' = auto-discover sitemaps via robots.txt + common paths +
  // <link rel="sitemap">, then recursively follow sitemapindex files
  // up to `sitemapDepth` levels deep. Merged with on-page discovered URLs.
  // 'skip' = ignore sitemap entirely; only on-page links are crawled.
  // 'only' = ONLY use sitemap URLs; no on-page link following.
  const [sitemap, setSitemap] = React.useState<'include' | 'skip' | 'only'>('include');
  const [sitemapDepth, setSitemapDepth] = React.useState(5);
  const [sitemapPath, setSitemapPath] = React.useState('');
  const [allowSubdomains, setAllowSubdomains] = React.useState(false);
  const [crawlEntireDomain, setCrawlEntireDomain] = React.useState(false);
  const [ignoreQueryParams, setIgnoreQueryParams] = React.useState(false);

  const [jobId, setJobId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<CrawlStatus | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const pollRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Global "active format" per-page toggle — applies to every page in the list.
  // Defaults to 'markdown'. The user can switch to html/rawHtml/links/screenshot
  // for any page that has the relevant content.
  const [activeFormat, setActiveFormat] = React.useState<Format>('markdown');

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
        // Ignore abort errors (triggered by stopPolling / new crawl / cancel).
        // The user doesn't need to see "Poll failed" when they intentionally
        // stopped the previous crawl.
        if (abortRef.current?.signal.aborted) return;
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
      tick().catch(() => {
        // Silently catch any unhandled rejection (e.g. AbortError).
      });
    },
    [authHeaders],
  );

  // Cleanup on unmount.
  React.useEffect(() => stopPolling, []);

  const onStart = async () => {
    if (!url.trim()) return;
    // Stop any previous poll + abort before starting a new crawl.
    stopPolling();
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
      sitemap,
      sitemapDepth,
      scrapeOptions: { formats: selectedFormats, onlyMainContent: true, device },
    };
    if (sitemapPath.trim()) body.sitemapPath = sitemapPath.trim();
    // Firecrawl-compatible path-filter aliases.
    const inc = includes.split(',').map((s) => s.trim()).filter(Boolean);
    const exc = excludes.split(',').map((s) => s.trim()).filter(Boolean);
    if (inc.length) body.includePaths = inc;
    if (exc.length) body.excludePaths = exc;
    if (allowSubdomains) body.allowSubdomains = true;
    if (crawlEntireDomain) body.crawlEntireDomain = true;
    if (ignoreQueryParams) body.ignoreQueryParameters = true;

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

  // Combined MD export — uses the NESTED data structure (p.data?.markdown).
  const combinedMd = React.useMemo(() => {
    if (!pages.length) return undefined;
    return pages
      .map((p) => {
        const md = p.data?.markdown || t('empty.noMarkdownShorthand');
        return `# ${p.url}\n\nSource: <${p.url}>\n\n${md}`;
      })
      .join('\n\n---\n\n');
  }, [pages, t]);

  // Combined standalone HTML export — `<!DOCTYPE html>...<body>${html}</body>`
  // where the body is built from each page's html (if present) or markdown
  // wrapped in a <pre> fallback. Now uses the NESTED data structure.
  const combinedHtml = React.useMemo(() => {
    if (!pages.length) return undefined;
    const body = pages
      .map((p) => {
        const html = p.data?.html?.trim();
        const md = p.data?.markdown?.trim();
        const inner = html
          ? html
          : md
            ? `<pre>${escapeHtml(md)}</pre>`
            : `<p>${escapeHtml(t('empty.noContent'))}</p>`;
        return `<h2>${escapeHtml(p.url)}</h2><div>${inner}</div>`;
      })
      .join('\n');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Crawl results</title></head><body>${body}</body></html>`;
  }, [pages, t]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-zinc-200 bg-card p-5 shadow-sm dark:border-zinc-800">
        <Label htmlFor="crawl-url" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {t('label.seedUrl')}
        </Label>
        <div className="relative">
          <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            id="crawl-url"
            type="url"
            placeholder={t('misc.urlPlaceholder')}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="pl-9"
            disabled={!!jobId}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="crawl-depth" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('label.maxDepth')}
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
              {t('label.limit')}
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
              {t('label.includesGlob')}
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
              {t('label.excludesGlob')}
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
          <div>
            <Label htmlFor="crawl-device" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('btn.device')}
            </Label>
            <Select
              value={device}
              onValueChange={(v) => setDevice(v as 'auto' | 'desktop' | 'mobile')}
              disabled={!!jobId}
            >
              <SelectTrigger id="crawl-device" className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t('device.auto')}</SelectItem>
                <SelectItem value="desktop">{t('device.desktop')}</SelectItem>
                <SelectItem value="mobile">{t('device.mobile')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="crawl-sitemap" className="mb-1 block text-xs font-medium text-muted-foreground">
              Sitemap (auto-discovery)
            </Label>
            <Select
              value={sitemap}
              onValueChange={(v) => setSitemap(v as 'include' | 'skip' | 'only')}
              disabled={!!jobId}
            >
              <SelectTrigger id="crawl-sitemap" className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="include">include (sitemap + on-page links)</SelectItem>
                <SelectItem value="skip">skip (only on-page links)</SelectItem>
                <SelectItem value="only">only (sitemap URLs only)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="crawl-sitemap-depth" className="mb-1 block text-xs font-medium text-muted-foreground">
              Sitemap depth (0–10, default 5)
            </Label>
            <Input
              id="crawl-sitemap-depth"
              type="number"
              min={0}
              max={10}
              value={sitemapDepth}
              onChange={(e) => setSitemapDepth(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
              disabled={!!jobId || sitemap === 'skip'}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="crawl-sitemap-path" className="mb-1 block text-xs font-medium text-muted-foreground">
              Sitemap path (auto-detect: sitemap XML or HTML link list)
            </Label>
            <Input
              id="crawl-sitemap-path"
              type="text"
              placeholder="https://example.com/sitemap.xml  OR  /blog/  (HTML link list page)"
              value={sitemapPath}
              onChange={(e) => setSitemapPath(e.target.value)}
              className="font-mono text-xs"
              disabled={!!jobId || sitemap === 'skip'}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              When set, the crawler fetches this URL and auto-detects: XML sitemap → parse as sitemap; HTML page → extract all &lt;a href&gt; links using this path&apos;s directory as the base URL. Auto-discovery (robots.txt + common paths) is skipped.
            </p>
          </div>
          <div className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <div>
              <Label className="text-xs">allowSubdomains</Label>
              <p className="text-[10px] text-muted-foreground">Follow subdomain links</p>
            </div>
            <Switch checked={allowSubdomains} onCheckedChange={setAllowSubdomains} disabled={!!jobId} />
          </div>
          <div className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <div>
              <Label className="text-xs">crawlEntireDomain</Label>
              <p className="text-[10px] text-muted-foreground">Siblings + parents</p>
            </div>
            <Switch checked={crawlEntireDomain} onCheckedChange={setCrawlEntireDomain} disabled={!!jobId} />
          </div>
          <div className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <div>
              <Label className="text-xs">ignoreQueryParameters</Label>
              <p className="text-[10px] text-muted-foreground">Dedupe ?a=1 vs ?a=2</p>
            </div>
            <Switch checked={ignoreQueryParams} onCheckedChange={setIgnoreQueryParams} disabled={!!jobId} />
          </div>
        </div>

        {/* Formats selector — mirrors the Scrape tab pattern. */}
        <div className="mt-4">
          <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {t('label.formats')}
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
              {t('btn.startCrawl')}
            </LoadingButton>
          ) : (
            <>
              {running && (
                <Button variant="destructive" size="sm" onClick={onCancel} disabled={cancelling} className="gap-1.5">
                  {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
                  {t('btn.cancel')}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={onReset}>
                {t('btn.reset')}
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
              {fmt(t('status.crawlFinished'), { N: pages.length })}
            </>
          ) : running ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600 dark:text-amber-400" />
              {t('status.crawlInProgress')}
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
            filenameBase="crawl-results"
          />
        )}
      </div>

      {/* Pages */}
      {pages.length > 0 ? (
        <div className="space-y-2">
          {pages.map((p, i) => {
            // Which formats does this page actually have content for?
            const data = p.data;
            const has: Record<Format, boolean> = {
              markdown: !!data?.markdown,
              html: !!data?.html,
              rawHtml: !!data?.rawHtml,
              links: !!(data?.links && data.links.length > 0),
              screenshot: !!data?.screenshot,
            };
            // Formats the user requested AND the page actually has.
            const availableFormats = ALL_FORMATS.filter(
              (f) => formats.includes(f) && has[f],
            );
            // Active format for this page = global activeFormat if available,
            // otherwise the first available format.
            const pageActive: Format | undefined = availableFormats.includes(activeFormat)
              ? activeFormat
              : availableFormats[0];

            return (
              <div
                key={p.url + i}
                className="overflow-hidden rounded-lg border border-zinc-200 bg-card dark:border-zinc-800"
              >
                {/* Page header — url + optional title from metadata */}
                <div className="flex items-start gap-2 border-b border-zinc-200 bg-zinc-50/60 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/30">
                  <span className="mt-0.5 font-mono text-[11px] text-zinc-400">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="block truncate font-mono text-xs text-emerald-700 hover:underline dark:text-emerald-300"
                      title={p.url}
                    >
                      {p.url}
                    </a>
                    {p.data?.metadata?.title && (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {String(p.data.metadata.title)}
                      </span>
                    )}
                  </div>
                  {(() => {
                    const sc =
                      p.data?.statusCode ??
                      (typeof p.data?.metadata?.statusCode === 'number'
                        ? (p.data!.metadata!.statusCode as number)
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
                        className={cn('shrink-0 font-mono text-[10px]', tone)}
                      >
                        {fmt(t('result.pageStatus'), { N: sc })}
                      </Badge>
                    );
                  })()}
                  {p.data?.strategy && (
                    <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                      {p.data.strategy}
                    </Badge>
                  )}
                </div>

                {/* Per-page format toggle buttons */}
                {availableFormats.length > 0 && (
                  <div className="flex flex-wrap gap-1 border-b border-zinc-200 bg-zinc-50/40 px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-900/20">
                    {availableFormats.map((f) => {
                      const on = pageActive === f;
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setActiveFormat(f)}
                          className={
                            'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ' +
                            (on
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                              : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-300 dark:hover:bg-zinc-800')
                          }
                          aria-pressed={on}
                        >
                          {t(`label.${f}`)}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Page body — only the active format's content */}
                <div className="space-y-3 bg-zinc-50/60 p-3 dark:bg-zinc-900/30">
                  {!data || !pageActive ? (
                    <p className="text-xs text-muted-foreground">
                      {t('empty.noMarkdownShorthand')}
                    </p>
                  ) : pageActive === 'markdown' ? (
                    data.markdown ? (
                      <MarkdownRender source={data.markdown} />
                    ) : (
                      <EmptyState
                        title={t('empty.noMarkdown')}
                        hint={t('empty.noMarkdownHint')}
                      />
                    )
                  ) : pageActive === 'html' ? (
                    <pre className="max-h-96 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-2 text-[11px] dark:border-zinc-800 dark:bg-zinc-900/40">
                      <code className="font-mono whitespace-pre-wrap break-all">{data.html}</code>
                    </pre>
                  ) : pageActive === 'rawHtml' ? (
                    <pre className="max-h-96 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-2 text-[11px] dark:border-zinc-800 dark:bg-zinc-900/40">
                      <code className="font-mono whitespace-pre-wrap break-all">{data.rawHtml}</code>
                    </pre>
                  ) : pageActive === 'links' ? (
                    data.links && data.links.length > 0 ? (
                      <ul className="max-h-96 space-y-1 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/40">
                        {data.links.map((l, li) => {
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
                    ) : (
                      <EmptyState
                        title={t('empty.noLinks')}
                        hint={t('empty.noLinksHint')}
                      />
                    )
                  ) : pageActive === 'screenshot' ? (
                    data.screenshot ? (
                      <div className="overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/40">
                        <img
                          src={data.screenshot}
                          alt={`Screenshot of ${p.url}`}
                          className="mx-auto max-w-full rounded shadow"
                        />
                      </div>
                    ) : (
                      <EmptyState
                        title={t('empty.noScreenshot')}
                        hint={t('empty.noScreenshotHint')}
                      />
                    )
                  ) : null}

                  {/* Error rendering for failed pages */}
                  {p.success === false && (
                    <p className="text-xs text-rose-700 dark:text-rose-300">
                      {fmt(t('misc.errorPrefix'), { X: p.error || t('empty.noDataReturned') })}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        !running && (
          <EmptyState
            title={t('empty.noCrawlStarted')}
            hint={t('empty.noCrawlStartedHint')}
          />
        )
      )}
    </div>
  );
}
