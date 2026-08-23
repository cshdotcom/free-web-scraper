'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Settings2, Play, Globe, ListChecks, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useTestConsole } from './store';
import { callApi, type ApiResult } from './api-client';
import { LoadingButton, StatusBar, ExportButtons, MarkdownRender, EmptyState } from './shared';
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

interface BatchItemData {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  screenshot?: string;
  metadata?: Record<string, unknown>;
}
interface BatchItem {
  url: string;
  success: boolean;
  data?: BatchItemData;
  error?: string;
}
interface BatchResponse {
  success: boolean;
  data?: BatchItem[];
  error?: string;
}

function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}

export function BatchSyncTab() {
  const { authHeaders } = useTestConsole();
  const { t } = useI18n();

  const [urls, setUrls] = React.useState(
    'https://example.com\nhttps://example.org',
  );
  const [formats, setFormats] = React.useState<Format[]>(['markdown']);
  const [onlyMainContent, setOnlyMainContent] = React.useState(true);
  const [includeTags, setIncludeTags] = React.useState('');
  const [excludeTags, setExcludeTags] = React.useState('');
  const [timeout, setTimeout_] = React.useState(45000);
  const [maxRetries, setMaxRetries] = React.useState(2);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  const [result, setResult] = React.useState<ApiResult<BatchResponse> | null>(null);
  const [loading, setLoading] = React.useState(false);

  const toggleFormat = (f: Format) => {
    setFormats((prev) =>
      prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f],
    );
  };

  const onRun = async () => {
    const list = urls
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) return;
    setLoading(true);
    setResult(null);

    const body: Record<string, unknown> = {
      urls: list,
      formats,
      onlyMainContent,
      timeout,
      maxRetries,
    };
    const inc = includeTags.split(',').map((s) => s.trim()).filter(Boolean);
    const exc = excludeTags.split(',').map((s) => s.trim()).filter(Boolean);
    if (inc.length) body.includeTags = inc;
    if (exc.length) body.excludeTags = exc;

    const r = await callApi<BatchResponse>(
      { method: 'POST', path: '/v2/scrape/batch', body },
      authHeaders(),
    );
    setResult(r);
    setLoading(false);
  };

  const items = result?.ok && result.data?.data ? result.data.data : [];

  // Combined markdown for export
  const combinedMd = React.useMemo(() => {
    if (!items.length) return undefined;
    return items
      .map((it) => {
        const md = it.data?.markdown || fmt(t('misc.errorPrefix'), { X: it.url });
        return `# ${it.url}\n\nSource: <${it.url}>\n\n${md}`;
      })
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
        <Label htmlFor="batch-urls" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {t('label.urlsOnePerLine')}
        </Label>
        <Textarea
          id="batch-urls"
          value={urls}
          onChange={(e) => setUrls(e.target.value)}
          rows={5}
          placeholder="https://example.com&#10;https://example.org&#10;https://example.net"
          className="font-mono text-xs"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <LoadingButton loading={loading} onClick={onRun} className="gap-1.5">
            <Play className="h-3.5 w-3.5" />
            {t('btn.scrapeAll')}
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
          <Badge variant="outline" className="font-mono">
            {fmt(t('misc.Nurls'), { N: urlCount })}
          </Badge>
        </div>

        {advancedOpen && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">{t('label.formats')}</Label>
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
                          (on ? 'border-emerald-500 bg-emerald-500' : 'border-zinc-300 dark:border-zinc-600')
                        }
                      >
                        {on && (
                          <svg viewBox="0 0 12 12" className="h-3 w-3 text-white">
                            <path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
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
                <p className="text-[10px] text-muted-foreground">{t('label.onlyMainContentHint')}</p>
              </div>
              <Switch checked={onlyMainContent} onCheckedChange={setOnlyMainContent} />
            </div>
            <div>
              <Label htmlFor="bs-inc-tags" className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('label.includeTags')}
              </Label>
              <Input
                id="bs-inc-tags"
                placeholder="article, main"
                value={includeTags}
                onChange={(e) => setIncludeTags(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label htmlFor="bs-exc-tags" className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('label.excludeTags')}
              </Label>
              <Input
                id="bs-exc-tags"
                placeholder="nav, footer"
                value={excludeTags}
                onChange={(e) => setExcludeTags(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label htmlFor="bs-timeout" className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('label.timeoutMs')}
              </Label>
              <Input
                id="bs-timeout"
                type="number"
                value={timeout}
                onChange={(e) => setTimeout_(Number(e.target.value) || 45000)}
              />
            </div>
            <div>
              <Label htmlFor="bs-retries" className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('label.maxRetries')}
              </Label>
              <Input
                id="bs-retries"
                type="number"
                min={0}
                max={5}
                value={maxRetries}
                onChange={(e) => setMaxRetries(Number(e.target.value) || 0)}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusBar result={result} loading={loading} />
        {result?.ok && result.data && (
          <ExportButtons
            json={result.data}
            markdown={combinedMd}
            html={combinedHtml}
            filenameBase="batch-sync"
          />
        )}
      </div>

      {/* Results list */}
      <div>
        {loading ? (
          <EmptyState title={t('status.scrapingBatch')} hint={t('status.scrapingBatchHint')} />
        ) : items.length ? (
          <Accordion type="multiple" defaultValue={[items[0]?.url ?? '']}>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div
                  key={it.url + i}
                  className="overflow-hidden rounded-lg border border-zinc-200 bg-card dark:border-zinc-800"
                >
                  <AccordionItem value={it.url || `item-${i}`} className="border-b-0">
                    <AccordionTrigger className="px-3 py-2 hover:no-underline">
                      <div className="flex items-center gap-2 pr-2 text-left">
                        {it.success ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                        )}
                        <span className="font-mono text-xs text-zinc-700 dark:text-zinc-200">
                          {it.url}
                        </span>
                        {it.data?.metadata?.title && (
                          <span className="truncate text-xs text-muted-foreground">
                            — {String(it.data.metadata.title)}
                          </span>
                        )}
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3 pt-0">
                      {it.success && it.data?.markdown ? (
                        <div className="rounded-md border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/30">
                          <MarkdownRender source={it.data.markdown} />
                        </div>
                      ) : (
                        <p className="text-xs text-rose-700 dark:text-rose-300">
                          {fmt(t('misc.errorPrefix'), { X: it.error || t('empty.noDataReturned') })}
                        </p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                </div>
              ))}
            </div>
          </Accordion>
        ) : (
          <EmptyState
            title={t('empty.noResultsYetBatch')}
            hint={t('empty.noResultsYetBatchHint')}
          />
        )}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ListChecks className="h-3.5 w-3.5" />
        {t('misc.tipSyncBatch')}
        <strong className="mx-1">{t('tab.batchAsync')}</strong>.
      </div>
    </div>
  );
}
