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
} from 'lucide-react';
import { useTestConsole } from './store';
import { callApi, type ApiResult } from './api-client';
import { LoadingButton, StatusBar, ExportButtons, EmptyState } from './shared';

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

const LANG_OPTIONS: { value: SearchLang; label: string }[] = [
  { value: 'auto', label: 'Auto-detect (recommended)' },
  { value: 'all', label: 'All languages (mixed)' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese (中文)' },
  { value: 'ja', label: 'Japanese (日本語)' },
  { value: 'ko', label: 'Korean (한국어)' },
  { value: 'fr', label: 'French (Français)' },
  { value: 'de', label: 'German (Deutsch)' },
  { value: 'es', label: 'Spanish (Español)' },
  { value: 'pt', label: 'Portuguese (Português)' },
  { value: 'ru', label: 'Russian (Русский)' },
  { value: 'it', label: 'Italian (Italiano)' },
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
}
interface SearchResponse {
  success: boolean;
  query?: string;
  total?: number;
  engines?: string[];
  lang?: string;
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

export function SearchTab() {
  const { authHeaders } = useTestConsole();

  const [query, setQuery] = React.useState('best rust web framework 2025');
  const [limit, setLimit] = React.useState(50);
  const [engines, setEngines] = React.useState<Engine[]>([...ALL_ENGINES]);
  const [lang, setLang] = React.useState<SearchLang>('auto');
  const [scrapeResults, setScrapeResults] = React.useState(false);

  const [result, setResult] = React.useState<ApiResult<SearchResponse> | null>(null);
  const [loading, setLoading] = React.useState(false);

  const toggleEngine = (e: Engine) => {
    setEngines((prev) =>
      prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e],
    );
  };

  const onRun = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResult(null);
    const body: Record<string, unknown> = {
      query: query.trim(),
      limit,
      engines,
      lang,
    };
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
          Query
        </Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            id="search-query"
            type="text"
            placeholder="best rust web framework"
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
              Engines
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
            </div>
          </div>
          <div>
            <Label htmlFor="search-limit" className="mb-1 block text-xs font-medium text-muted-foreground">
              limit
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
              Language
            </Label>
            <Select value={lang} onValueChange={(v) => setLang(v as SearchLang)}>
              <SelectTrigger id="search-lang" className="w-full">
                <SelectValue placeholder="Language" />
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
              <Label className="text-xs">scrapeResults</Label>
              <p className="text-[10px] text-muted-foreground">Reserved for future use.</p>
            </div>
            <Switch checked={scrapeResults} onCheckedChange={setScrapeResults} />
          </div>
        </div>

        <div className="mt-4">
          <LoadingButton loading={loading} onClick={onRun} className="gap-1.5">
            <Play className="h-3.5 w-3.5" />
            Search
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
          <span className="text-muted-foreground">Engines:</span>
          {result.data.lang && (
            <Badge
              variant="outline"
              className="gap-1 border-transparent bg-zinc-500/15 text-zinc-700 dark:text-zinc-300"
              title={`Resolved language: ${result.data.lang}`}
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
                    {meta.label} (failed)
                  </Badge>
                );
              })}
            </>
          )}
          {result.data.total !== undefined && (
            <Badge variant="outline" className="ml-auto font-mono">
              {result.data.total} results
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
            title="No results yet"
            hint="Type a query, pick engines, and click Search."
          />
        )
      )}
    </div>
  );
}
