'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Globe, Play, Link2, ListTree } from 'lucide-react';
import { useTestConsole } from './store';
import { callApi, type ApiResult } from './api-client';
import { LoadingButton, StatusBar, ExportButtons, EmptyState, CopyButton } from './shared';
import { useI18n } from '@/components/i18n';

/** A link entry from /v2/map. Can be either:
 *  - a bare string (backward compat)
 *  - an object {url, title?, description?} (when sitemap entries have metadata)
 */
type MapLink = string | { url: string; title?: string; description?: string };

interface MapResponse {
  success: boolean;
  links?: MapLink[];
  error?: string;
}

function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  );
}

/** Normalize a link entry to just its URL string. */
function linkUrl(l: MapLink): string {
  return typeof l === 'string' ? l : l.url;
}

/** Get the title for a link entry, if available. */
function linkTitle(l: MapLink): string | undefined {
  return typeof l === 'string' ? undefined : l.title;
}

export function MapTab() {
  const { authHeaders } = useTestConsole();
  const { t } = useI18n();

  const [url, setUrl] = React.useState('https://example.com');
  const [search, setSearch] = React.useState('');
  const [limit, setLimit] = React.useState(100);
  const [includeSubdomains, setIncludeSubdomains] = React.useState(false);
  // Sitemap discovery options (same as crawl tab).
  const [sitemapDepth, setSitemapDepth] = React.useState(5);
  const [sitemapLimit, setSitemapLimit] = React.useState(0);
  const [sitemapPath, setSitemapPath] = React.useState('');

  const [result, setResult] = React.useState<ApiResult<MapResponse> | null>(null);
  const [loading, setLoading] = React.useState(false);

  const onRun = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setResult(null);
    const body: Record<string, unknown> = {
      url: url.trim(),
      limit,
      includeSubdomains,
    };
    if (search.trim()) body.search = search.trim();
    // Sitemap options.
    body.sitemapDepth = sitemapDepth;
    body.sitemapLimit = sitemapLimit;
    if (sitemapPath.trim()) body.sitemapPath = sitemapPath.trim();
    const r = await callApi<MapResponse>(
      { method: 'POST', path: '/v2/map', body },
      authHeaders(),
    );
    setResult(r);
    setLoading(false);
  };

  const links: MapLink[] = result?.ok && result.data?.links ? result.data.links : [];
  const combinedMd = React.useMemo(() => {
    if (!links.length) return undefined;
    return `# Links from ${url}\n\n${links.map((l) => `- ${linkUrl(l)}`).join('\n')}`;
  }, [links, url]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-zinc-200 bg-card p-5 shadow-sm dark:border-zinc-800">
        <Label htmlFor="map-url" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {t('label.url')}
        </Label>
        <div className="relative">
          <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            id="map-url"
            type="url"
            placeholder={t('misc.urlPlaceholder')}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="pl-9"
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRun();
            }}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="map-search" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('label.searchSubstring')}
            </Label>
            <Input
              id="map-search"
              placeholder="docs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <div>
            <Label htmlFor="map-limit" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('label.limitGeneric')}
            </Label>
            <Input
              id="map-limit"
              type="number"
              min={1}
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <div>
              <Label className="text-xs">{t('label.includeSubdomains')}</Label>
              <p className="text-[10px] text-muted-foreground">{t('label.includeSubdomainsHint')}</p>
            </div>
            <Switch checked={includeSubdomains} onCheckedChange={setIncludeSubdomains} />
          </div>
        </div>

        {/* Sitemap discovery options (same as crawl tab) */}
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="map-sitemap-depth" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('label.sitemapDepth') || 'Sitemap depth (0–10, default 5)'}
            </Label>
            <Input
              id="map-sitemap-depth"
              type="number"
              min={0}
              max={10}
              value={sitemapDepth}
              onChange={(e) => setSitemapDepth(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
              className="text-xs"
            />
          </div>
          <div>
            <Label htmlFor="map-sitemap-limit" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('label.sitemapLimit') || 'Sitemap URL limit (0 = unlimited)'}
            </Label>
            <Input
              id="map-sitemap-limit"
              type="number"
              min={0}
              value={sitemapLimit}
              onChange={(e) => setSitemapLimit(Math.max(0, Number(e.target.value) || 0))}
              className="text-xs"
            />
          </div>
          <div>
            <Label htmlFor="map-sitemap-path" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('label.sitemapPath') || 'Sitemap path'}
            </Label>
            <Input
              id="map-sitemap-path"
              type="text"
              placeholder="/sitemap.xml"
              value={sitemapPath}
              onChange={(e) => setSitemapPath(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
        </div>

        <div className="mt-4">
          <LoadingButton loading={loading} onClick={onRun} className="gap-1.5">
            <Play className="h-3.5 w-3.5" />
            {t('btn.mapLinks')}
          </LoadingButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusBar result={result} loading={loading} />
          {links.length > 0 && (
            <Badge variant="outline" className="font-mono">
              <ListTree className="mr-1 h-3 w-3" />
              {fmt(t('misc.Nlinks'), { N: links.length })}
            </Badge>
          )}
        </div>
        {result?.ok && result.data && (
          <ExportButtons
            json={result.data}
            markdown={combinedMd}
            filenameBase="map-links"
          />
        )}
      </div>

      {links.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-card dark:border-zinc-800">
          <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-900/40">
            <span className="text-xs font-medium text-muted-foreground">
              {t('label.discoveredLinks')}
            </span>
            <CopyButton value={links.map(linkUrl).join('\n')} label={t('btn.copyAll')} />
          </div>
          <div className="max-h-[420px] overflow-auto">
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {links.map((l, i) => {
                const u = linkUrl(l);
                const title = linkTitle(l);
                return (
                  <li
                    key={u + i}
                    className="flex items-baseline gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
                  >
                    <span className="font-mono text-[10px] text-zinc-400">
                      {String(i + 1).padStart(3, '0')}
                    </span>
                    <Link2 className="h-3 w-3 shrink-0 text-zinc-400" />
                    <div className="flex-1 min-w-0">
                      <a
                        href={u}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="truncate font-mono text-xs text-emerald-700 hover:underline dark:text-emerald-300"
                      >
                        {u}
                      </a>
                      {title && (
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {title}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : (
        !loading && (
          <EmptyState title={t('empty.noLinksYet')} hint={t('empty.noLinksYetHint')} />
        )
      )}
    </div>
  );
}
