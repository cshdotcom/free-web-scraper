'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Globe, Settings2, ImageIcon, List, FileText, Code, Hash, Play } from 'lucide-react';
import { useTestConsole } from './store';
import { callApi, prettyJson, type ApiResult } from './api-client';
import {
  LoadingButton,
  StatusBar,
  ExportButtons,
  MarkdownRender,
  RawJsonView,
  EmptyState,
} from './shared';
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

interface ScrapeData {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: Array<{ url: string; text?: string } | string>;
  screenshot?: string;
  metadata?: Record<string, unknown>;
  strategy?: string;
}
interface ScrapeResponse {
  success: boolean;
  data?: ScrapeData;
  attempts?: number;
  error?: string;
}

function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}

export function ScrapeTab() {
  const { authHeaders } = useTestConsole();
  const { t } = useI18n();

  const [url, setUrl] = React.useState('https://example.com');
  const [formats, setFormats] = React.useState<Format[]>(['markdown', 'html', 'links']);
  const [onlyMainContent, setOnlyMainContent] = React.useState(true);
  const [includeTags, setIncludeTags] = React.useState('');
  const [excludeTags, setExcludeTags] = React.useState('');
  const [timeout, setTimeout_] = React.useState(45000);
  const [waitFor, setWaitFor] = React.useState(0);
  const [maxRetries, setMaxRetries] = React.useState(2);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  const [result, setResult] = React.useState<ApiResult<ScrapeResponse> | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [resultTab, setResultTab] = React.useState<string>('markdown');

  const toggleFormat = (f: Format) => {
    setFormats((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f],
    );
  };

  const onRun = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setResult(null);
    const body: Record<string, unknown> = {
      url: url.trim(),
      formats,
      onlyMainContent,
      timeout,
      waitFor,
      maxRetries,
    };
    const inc = includeTags
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const exc = excludeTags
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (inc.length) body.includeTags = inc;
    if (exc.length) body.excludeTags = exc;

    const r = await callApi<ScrapeResponse>(
      { method: 'POST', path: '/v2/scrape', body },
      authHeaders(),
    );
    setResult(r);
    setLoading(false);

    // Auto-switch to the first available sub-tab based on formats
    if (r.ok && r.data?.data) {
      const d = r.data.data;
      const order: { key: Format; tab: string }[] = [
        { key: 'markdown', tab: 'markdown' },
        { key: 'html', tab: 'html' },
        { key: 'links', tab: 'links' },
        { key: 'screenshot', tab: 'screenshot' },
      ];
      const first = order.find((o) => formats.includes(o.key) && d[o.key]);
      if (first) setResultTab(first.tab);
    }
  };

  const data: ScrapeData | undefined = result?.ok ? result.data?.data : undefined;
  const attempts = result?.ok ? result.data?.attempts : undefined;
  const strategy = data?.strategy;

  // Build a standalone HTML document for the "Export HTML" button.
  // - body = data.html (raw, already HTML) OR markdown wrapped in <pre> (escaped)
  // - title = data.metadata.title (escaped) OR 'Scraped page'
  // - undefined when there's no html AND no markdown to embed
  const exportHtml = React.useMemo(() => {
    if (!data) return undefined;
    const htmlBody = data.html?.trim();
    const mdBody = data.markdown?.trim();
    if (!htmlBody && !mdBody) return undefined;
    const titleRaw = data.metadata?.title;
    const title =
      typeof titleRaw === 'string' && titleRaw.trim() ? titleRaw : 'Scraped page';
    const body = htmlBody || (mdBody ? `<pre>${escapeHtml(mdBody)}</pre>` : '');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`;
  }, [data]);

  // Pick which sub-tabs to show based on formats selected
  const showTab = (key: Format) => formats.includes(key);
  const availableTabs = ALL_FORMATS.filter(showTab);

  // Keep the active result tab valid as formats change.
  const validResultTab =
    availableTabs.includes(resultTab as Format) || resultTab === 'metadata' || resultTab === 'raw'
      ? resultTab
      : availableTabs[0] ?? 'metadata';
  const activeResultTab = validResultTab as string;

  return (
    <div className="space-y-5">
      {/* URL + run */}
      <div className="rounded-xl border border-zinc-200 bg-card p-5 shadow-sm dark:border-zinc-800">
        <Label htmlFor="scrape-url" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {t('label.url')}
        </Label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              id="scrape-url"
              type="url"
              placeholder={t('misc.urlPlaceholder')}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRun();
              }}
              className="pl-9"
            />
          </div>
          <LoadingButton loading={loading} onClick={onRun} className="gap-1.5">
            <Play className="h-3.5 w-3.5" />
            {t('btn.scrape')}
          </LoadingButton>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            <Settings2 className="h-3.5 w-3.5" />
            {advancedOpen ? t('btn.hide') : t('btn.options')}
          </Button>
        </div>

        {/* Advanced options */}
        {advancedOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="overflow-hidden"
          >
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {/* Formats */}
              <div className="sm:col-span-2">
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
                        className={
                          'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ' +
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

              <div className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                <div>
                  <Label className="text-xs">{t('label.onlyMainContent')}</Label>
                  <p className="text-[10px] text-muted-foreground">
                    {t('label.onlyMainContentHint')}
                  </p>
                </div>
                <Switch checked={onlyMainContent} onCheckedChange={setOnlyMainContent} />
              </div>

              <div>
                <Label htmlFor="inc-tags" className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t('label.includeTagsHint')}
                </Label>
                <Input
                  id="inc-tags"
                  placeholder="article, main, .content"
                  value={includeTags}
                  onChange={(e) => setIncludeTags(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label htmlFor="exc-tags" className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t('label.excludeTagsHint')}
                </Label>
                <Input
                  id="exc-tags"
                  placeholder="nav, footer, .ads"
                  value={excludeTags}
                  onChange={(e) => setExcludeTags(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label htmlFor="timeout" className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t('label.timeoutMs')}
                </Label>
                <Input
                  id="timeout"
                  type="number"
                  value={timeout}
                  onChange={(e) => setTimeout_(Number(e.target.value) || 45000)}
                />
              </div>
              <div>
                <Label htmlFor="wait-for" className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t('label.waitForMs')}
                </Label>
                <Input
                  id="wait-for"
                  type="number"
                  value={waitFor}
                  onChange={(e) => setWaitFor(Number(e.target.value) || 0)}
                />
              </div>
              <div>
                <Label htmlFor="max-retries" className="mb-1 block text-xs font-medium text-muted-foreground">
                  {t('label.maxRetries')}
                </Label>
                <Input
                  id="max-retries"
                  type="number"
                  min={0}
                  max={5}
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(Number(e.target.value) || 0)}
                />
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusBar
          result={result}
          loading={loading}
          badges={
            strategy ? (
              <Badge variant="outline" className="font-mono">
                {fmt(t('status.strategyBadge'), { X: strategy })}
              </Badge>
            ) : null
          }
        />
        {result?.ok && result.data && (
          <ExportButtons
            json={result.data}
            markdown={data?.markdown}
            html={exportHtml}
            filenameBase="scrape-result"
          />
        )}
      </div>

      {/* Result */}
      <div>
        {attempts !== undefined && (
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="font-mono">
              {fmt(t('status.attemptsBadge'), { N: attempts })}
            </Badge>
            {data?.metadata?.url && (
              <span className="truncate">
                {t('status.source')} <code className="font-mono">{String(data.metadata.url)}</code>
              </span>
            )}
          </div>
        )}

        <Tabs value={activeResultTab} onValueChange={setResultTab}>
          <TabsList className="mb-3 h-auto flex-wrap">
            {showTab('markdown') && (
              <TabsTrigger value="markdown" className="gap-1.5">
                <FileText className="h-3.5 w-3.5" /> {t('label.markdown')}
              </TabsTrigger>
            )}
            {showTab('html') && (
              <TabsTrigger value="html" className="gap-1.5">
                <Code className="h-3.5 w-3.5" /> {t('label.html')}
              </TabsTrigger>
            )}
            {showTab('links') && (
              <TabsTrigger value="links" className="gap-1.5">
                <List className="h-3.5 w-3.5" /> {t('label.links')}
              </TabsTrigger>
            )}
            {showTab('screenshot') && (
              <TabsTrigger value="screenshot" className="gap-1.5">
                <ImageIcon className="h-3.5 w-3.5" /> {t('label.screenshot')}
              </TabsTrigger>
            )}
            <TabsTrigger value="metadata" className="gap-1.5">
              <Hash className="h-3.5 w-3.5" /> {t('label.metadata')}
            </TabsTrigger>
            <TabsTrigger value="raw" className="gap-1.5">
              <Code className="h-3.5 w-3.5" /> {t('label.raw')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="markdown">
            {data?.markdown ? (
              <div className="rounded-lg border border-zinc-200 bg-card p-4 dark:border-zinc-800">
                <MarkdownRender source={data.markdown} />
              </div>
            ) : (
              <EmptyState title={t('empty.noMarkdown')} hint={t('empty.noMarkdownHint')} />
            )}
          </TabsContent>
          <TabsContent value="html">
            {data?.html ? (
              <pre className="max-h-[480px] overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/40">
                <code className="font-mono whitespace-pre-wrap break-all">{data.html}</code>
              </pre>
            ) : (
              <EmptyState title={t('empty.noHtml')} hint={t('empty.noHtmlHint')} />
            )}
          </TabsContent>
          <TabsContent value="links">
            {data?.links?.length ? (
              <div className="max-h-[480px] overflow-auto rounded-lg border border-zinc-200 bg-card p-2 dark:border-zinc-800">
                <ul className="space-y-1">
                  {data.links.map((l, i) => {
                    // links can be either string URLs or {url, text} objects.
                    const linkUrl = typeof l === 'string' ? l : l.url;
                    const linkText = typeof l === 'string' ? l : (l.text || l.url);
                    return (
                      <li
                        key={`${linkUrl}-${i}`}
                        className="flex items-baseline gap-2 rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-900/40"
                      >
                        <span className="font-mono text-[10px] text-zinc-400">
                          {String(i + 1).padStart(3, '0')}
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
              </div>
            ) : (
              <EmptyState title={t('empty.noLinks')} hint={t('empty.noLinksHint')} />
            )}
          </TabsContent>
          <TabsContent value="screenshot">
            {data?.screenshot ? (
              <div className="overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/40">
                <img
                  src={data.screenshot}
                  alt="Page screenshot"
                  className="mx-auto max-w-full rounded shadow"
                />
              </div>
            ) : (
              <EmptyState title={t('empty.noScreenshot')} hint={t('empty.noScreenshotHint')} />
            )}
          </TabsContent>
          <TabsContent value="metadata">
            {data?.metadata && Object.keys(data.metadata).length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                <Table>
                  <TableBody>
                    {Object.entries(data.metadata).map(([k, v]) => (
                      <TableRow key={k}>
                        <TableCell className="w-1/3 bg-zinc-50 px-3 py-2 align-top font-mono text-xs font-medium dark:bg-zinc-900/40">
                          {k}
                        </TableCell>
                        <TableCell className="px-3 py-2 font-mono text-xs">
                          {typeof v === 'object' ? prettyJson(v) : String(v)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyState title={t('empty.noMetadata')} />
            )}
          </TabsContent>
          <TabsContent value="raw">
            <RawJsonView value={result?.data ?? null} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
