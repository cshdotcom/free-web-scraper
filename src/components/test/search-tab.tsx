'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Search,
  Play,
  ExternalLink,
  Globe2,
  ShieldCheck,
  AlertTriangle,
  Languages,
  Server,
  FileText,
  ImageIcon,
} from 'lucide-react';
import { useTestConsole } from './store';
import { callApi, type ApiResult } from './api-client';
import { LoadingButton, StatusBar, ExportButtons, EmptyState } from './shared';
import { useI18n } from '@/components/i18n';

type SearchLang =
  | 'auto'
  | 'all'
  | 'en'
  | 'zh'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'pt'
  | 'ru'
  | 'it';

const LANG_OPTIONS: { value: SearchLang; labelKey: string; label: string }[] = [
  { value: 'auto', labelKey: 'langAuto', label: 'Auto-detect (recommended)' },
  { value: 'all', labelKey: 'langAll', label: 'All languages (mixed)' },
  { value: 'en', labelKey: 'langEn', label: 'English' },
  { value: 'zh', labelKey: 'langZh', label: 'Chinese (中文)' },
  { value: 'ja', labelKey: 'langJa', label: 'Japanese (日本語)' },
  { value: 'ko', labelKey: 'langKo', label: 'Korean (한국어)' },
  { value: 'fr', labelKey: 'langFr', label: 'French (Français)' },
  { value: 'de', labelKey: 'langDe', label: 'German (Deutsch)' },
  { value: 'es', labelKey: 'langEs', label: 'Spanish (Español)' },
  { value: 'pt', labelKey: 'langPt', label: 'Portuguese (Português)' },
  { value: 'ru', labelKey: 'langRu', label: 'Russian (Русский)' },
  { value: 'it', labelKey: 'langIt', label: 'Italian (Italiano)' },
];

const LANG_LABELS: Record<string, string> = {
  auto: 'Auto-detect',
  all: 'All languages',
  en: 'English',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  pt: 'Portuguese',
  ru: 'Russian',
  it: 'Italian',
};

interface SearchResultItem {
  url: string;
  title: string;
  snippet: string;
  hostName?: string;
  engine?: string;
  engines?: string[];
  score?: number;
  /** Source category: 'web' | 'news' | 'images'. */
  source?: 'web' | 'news' | 'images';
  /** Image-only fields (when source='images'). */
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  /** News-only fields (when source='news'). */
  publishedDate?: string;
}
interface SearchResponse {
  success: boolean;
  query?: string;
  total?: number;
  engines?: string[];
  /** Which source categories were queried. */
  sources?: string[];
  lang?: string;
  safe?: boolean;
  data?: SearchResultItem[];
  error?: string;
}

const ENGINE_LABELS: Record<string, { label: string; color: string }> = {
  bing: { label: 'Bing', color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  duckduckgo: { label: 'DuckDuckGo', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  searxng: { label: 'SearXNG', color: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300' },
  wikipedia: { label: 'Wikipedia', color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
};

// Keep in sync with the backend DEFAULT_ENGINES (bing, duckduckgo, searxng,
// wikipedia). Mojeek / Startpage / Brave were removed because they
// persistently fail to anti-bot scraping.
const ALL_ENGINES = ['bing', 'duckduckgo', 'searxng', 'wikipedia'] as const;
type Engine = (typeof ALL_ENGINES)[number];

interface CustomSearxngInstance {
  name: string;
  baseUrl: string;
}
interface EnginesApiResponse {
  engines: string[];
  customSearxng: CustomSearxngInstance[];
}

function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}

export function SearchTab() {
  const { authHeaders } = useTestConsole();
  const { t } = useI18n();

  const [query, setQuery] = React.useState('best rust web framework 2025');
  const [limit, setLimit] = React.useState(50);
  const [engines, setEngines] = React.useState<string[]>([...ALL_ENGINES]);
  const [customSearxng, setCustomSearxng] = React.useState<CustomSearxngInstance[]>([]);
  const [lang, setLang] = React.useState<SearchLang>('auto');
  const [scrapeResults, setScrapeResults] = React.useState(false);
  // Firecrawl-compatible `sources`: 'web' | 'news' | 'images'.
  // Multiple can be selected at once. When any are selected, the
  // `engines` array is ignored — the backend routes based on `sources`.
  // When NONE are selected, the backend defaults to ['web'] (and
  // respects the `engines` array).
  const [sources, setSources] = React.useState<string[]>([]);

  const [result, setResult] = React.useState<ApiResult<SearchResponse> | null>(null);
  const [loading, setLoading] = React.useState(false);

  // Fetch available engines (including custom SearXNG instances from env).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/engines');
        if (!res.ok) return;
        const json = (await res.json()) as EnginesApiResponse;
        if (!cancelled && Array.isArray(json.customSearxng)) {
          setCustomSearxng(json.customSearxng);
        }
      } catch {
        // ignore — leave list empty
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleEngine = (e: string) => {
    setEngines((prev) =>
      prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e],
    );
  };

  const toggleSource = (s: string) => {
    setSources((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  };

  const onRun = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResult(null);
    const body: Record<string, unknown> = {
      query: query.trim(),
      limit,
      lang,
    };
    // When sources are explicitly selected, send them and skip the
    // per-engine selection (the backend routes based on sources).
    // Otherwise send the engines array (legacy behaviour).
    if (sources.length > 0) {
      body.sources = sources;
    } else {
      body.engines = engines;
    }
    // scrapeResults is a UI affordance — passed through to the crawler, which
    // currently ignores it (kept here so future schema additions are non-breaking).
    if (scrapeResults) body.scrapeResults = true;

    const r = await callApi<SearchResponse>(
      { method: 'POST', path: '/v2/search', body },
      authHeaders(),
    );
    setResult(r);
    setLoading(false);
  };

  const items = result?.ok && result.data?.data ? result.data.data : [];
  const returnedEngines = result?.ok && result.data?.engines ? result.data.engines : [];
  const failedEngines = engines.filter((e) => !returnedEngines.includes(e));
  const combinedMd = React.useMemo(() => {
    if (!items.length) return undefined;
    return `# Search: ${query}\n\n${items
      .map(
        (r, i) =>
          `## ${i + 1}. ${r.title}\n\nURL: ${r.url}\n\n${r.snippet}\n\n**Score**: ${r.score ?? '-'} · **Engines**: ${(r.engines ?? [r.engine]).filter(Boolean).join(', ')}\n`,
      )
      .join('\n\n---\n\n')}`;
  }, [items, query]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-zinc-200 bg-card p-5 shadow-sm dark:border-zinc-800">
        <Label htmlFor="search-query" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {t('label.searchQuery')}
        </Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            id="search-query"
            type="text"
            placeholder={t('misc.queryPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRun();
            }}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_120px_190px_auto]">
          <div>
            <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t('label.engines')}
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_ENGINES.map((e) => {
                const on = engines.includes(e);
                const meta = ENGINE_LABELS[e];
                return (
                  <button
                    key={e}
                    type="button"
                    onClick={() => toggleEngine(e)}
                    className={
                      'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ' +
                      (on
                        ? `${meta.color} border-transparent`
                        : 'border-zinc-200 bg-zinc-50 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400')
                    }
                    aria-pressed={on}
                  >
                    {meta.label}
                  </button>
                );
              })}
              {/* Custom SearXNG instances from CRAWLER_SEARXNG_INSTANCES env var */}
              {customSearxng.map((c) => {
                const id = `searxng:${c.name}`;
                const on = engines.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleEngine(id)}
                    title={c.baseUrl}
                    className={
                      'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ' +
                      (on
                        ? 'border-zinc-500/40 bg-zinc-500/15 text-zinc-700 dark:text-zinc-300'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400')
                    }
                    aria-pressed={on}
                  >
                    <Server className="h-3 w-3" />
                    {c.name}
                  </button>
                );
              })}
            </div>
            {customSearxng.length > 0 && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                {t('misc.searxngCustomLabel')} — {customSearxng.length}
              </p>
            )}
          </div>
          {/* Firecrawl-compatible sources selector: 'web' | 'news' | 'images'.
              When ANY source is selected, the engines array is ignored. */}
          <div>
            <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t('label.sources') || 'Sources'}
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {(['web', 'news', 'images'] as const).map((s) => {
                const on = sources.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSource(s)}
                    className={
                      'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ' +
                      (on
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-zinc-200 bg-zinc-50 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400')
                    }
                    aria-pressed={on}
                  >
                    {s === 'web' && <Globe2 className="h-3 w-3" />}
                    {s === 'news' && <FileText className="h-3 w-3" />}
                    {s === 'images' && <ImageIcon className="h-3 w-3" />}
                    {s}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {sources.length === 0
                ? (t('misc.sourcesEmptyHint') || 'No source selected → engines array used (default web).')
                : `${t('misc.sourcesSelectedHint') || 'Selected → engines array ignored, routed by source.'}`}
            </p>
          </div>
          <div>
            <Label htmlFor="search-limit" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('label.limitGeneric')}
            </Label>
            <Input
              id="search-limit"
              type="number"
              min={1}
              max={50}
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            />
          </div>
          <div>
            <Label htmlFor="search-lang" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('label.language')}
            </Label>
            <Select value={lang} onValueChange={(v) => setLang(v as SearchLang)}>
              <SelectTrigger id="search-lang" className="w-full">
                <SelectValue placeholder={t('label.language')} />
              </SelectTrigger>
              <SelectContent>
                {LANG_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <div>
              <Label className="text-xs">{t('label.scrapeResults')}</Label>
              <p className="text-[10px] text-muted-foreground">{t('label.scrapeResultsHint')}</p>
            </div>
            <Switch checked={scrapeResults} onCheckedChange={setScrapeResults} />
          </div>
        </div>

        <div className="mt-4">
          <LoadingButton loading={loading} onClick={onRun} className="gap-1.5">
            <Play className="h-3.5 w-3.5" />
            {t('btn.search')}
          </LoadingButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusBar result={result} loading={loading} />
        {result?.ok && result.data && (
          <ExportButtons
            json={result.data}
            markdown={combinedMd}
            filenameBase="search-results"
          />
        )}
      </div>

      {/* Engine status */}
      {result?.ok && result.data && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50/60 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900/30">
          <Globe2 className="h-3.5 w-3.5 text-zinc-500" />
          <span className="text-muted-foreground">{t('label.engines')}:</span>
          {result.data.lang && (
            <Badge
              variant="outline"
              className="gap-1 border-transparent bg-zinc-500/15 text-zinc-700 dark:text-zinc-300"
              title={fmt(t('misc.resolvedLanguage'), { X: result.data.lang })}
            >
              <Languages className="h-3 w-3" />
              {LANG_LABELS[result.data.lang] ?? result.data.lang}
            </Badge>
          )}
          {returnedEngines.map((e) => {
            const meta = ENGINE_LABELS[e] ?? { label: e, color: 'bg-zinc-500/15 text-zinc-700' };
            return (
              <Badge
                key={e}
                variant="outline"
                className={`gap-1 border-transparent ${meta.color}`}
              >
                <ShieldCheck className="h-3 w-3" />
                {meta.label}
              </Badge>
            );
          })}
          {failedEngines.length > 0 && (
            <>
              <span className="ml-2 text-muted-foreground">·</span>
              {failedEngines.map((e) => {
                const meta = ENGINE_LABELS[e] ?? { label: e, color: '' };
                return (
                  <Badge
                    key={e}
                    variant="outline"
                    className="gap-1 border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    {fmt(t('misc.engineFailed'), { X: meta.label })}
                  </Badge>
                );
              })}
            </>
          )}
          {result.data.total !== undefined && (
            <Badge variant="outline" className="ml-auto font-mono">
              {fmt(t('misc.resultsN'), { N: result.data.total })}
            </Badge>
          )}
        </div>
      )}

      {/* Results list */}
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((r, i) => {
            const enginesList = (r.engines ?? (r.engine ? [r.engine] : [])).filter(Boolean);
            return (
              <div
                key={r.url + i}
                className="rounded-lg border border-zinc-200 bg-card p-3 shadow-sm transition-colors hover:bg-zinc-50/60 dark:border-zinc-800 dark:hover:bg-zinc-900/40"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-medium text-zinc-900 hover:underline dark:text-zinc-100"
                      >
                        {r.title || r.url}
                      </a>
                      {r.score !== undefined && (
                        <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                          score: {r.score.toFixed(2)}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <ExternalLink className="h-3 w-3" />
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="truncate font-mono text-emerald-700 hover:underline dark:text-emerald-300"
                      >
                        {r.url}
                      </a>
                      {r.hostName && (
                        <span className="ml-2 truncate">· {r.hostName}</span>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {r.snippet}
                    </p>
                    {enginesList.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        {enginesList.map((e) => {
                          const meta = ENGINE_LABELS[e] ?? { label: e, color: '' };
                          return (
                            <Badge
                              key={e}
                              variant="outline"
                              className={`px-1.5 py-0 text-[10px] font-medium ${meta.color} border-transparent`}
                            >
                              {meta.label}
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        !loading && (
          <EmptyState
            title={t('empty.noResultsYet')}
            hint={t('empty.noResultsYetHint')}
          />
        )
      )}
    </div>
  );
}
