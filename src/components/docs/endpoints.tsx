'use client';

import * as React from 'react';
import { ArrowRight, ChevronRight, Hash } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CodeBlock } from '@/components/code-block';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getEndpoints, METHOD_COLORS, type EndpointDef, type HttpMethod } from './data';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/i18n';

function MethodBadge({ method }: { method: HttpMethod }) {
  const c = METHOD_COLORS[method];
  return (
    <Badge
      variant="outline"
      className={cn('inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold', c.badge)}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', c.dot)} />
      {method}
    </Badge>
  );
}

function EndpointCard({ ep }: { ep: EndpointDef }) {
  const { t } = useI18n();
  return (
    <article
      id={ep.id}
      className="scroll-mt-24 overflow-hidden rounded-xl border border-zinc-200 bg-card shadow-sm dark:border-zinc-800"
    >
      {/* card header */}
      <header className="flex flex-col gap-3 border-b border-zinc-200 bg-zinc-50/50 p-5 dark:border-zinc-800 dark:bg-zinc-900/30 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <MethodBadge method={ep.method} />
          <code className="font-mono text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {ep.path}
          </code>
        </div>
        <a
          href={`#${ep.id}`}
          className="inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          <Hash className="h-3 w-3" />
          <span>{ep.id}</span>
        </a>
      </header>

      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{ep.summary}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{ep.description}</p>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('endpoints.param')}
            </h4>
            <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
              <Table>
                <TableHeader>
                  <TableRow className="bg-zinc-50 dark:bg-zinc-900/40">
                    <TableHead className="h-8 px-2 py-1.5 text-xs">{t('endpoints.param')}</TableHead>
                    <TableHead className="h-8 px-2 py-1.5 text-xs">{t('endpoints.type')}</TableHead>
                    <TableHead className="h-8 px-2 py-1.5 text-xs">{t('endpoints.required')}</TableHead>
                    <TableHead className="h-8 px-2 py-1.5 text-xs">{t('endpoints.default')}</TableHead>
                    <TableHead className="h-8 px-2 py-1.5 text-xs">{t('endpoints.description')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ep.params.map((p) => (
                    <TableRow key={p.name}>
                      <TableCell className="px-2 py-1.5">
                        <code className="font-mono text-xs font-medium text-zinc-900 dark:text-zinc-100">
                          {p.name}
                        </code>
                      </TableCell>
                      <TableCell className="px-2 py-1.5">
                        <code className="font-mono text-xs text-emerald-700 dark:text-emerald-300">
                          {p.type}
                        </code>
                      </TableCell>
                      <TableCell className="px-2 py-1.5">
                        {p.required ? (
                          <span className="inline-flex items-center rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-700 dark:text-rose-300">
                            {t('endpoints.required')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded bg-zinc-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-600 dark:text-zinc-300">
                            optional
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-1.5">
                        {p.default ? (
                          <code className="font-mono text-xs text-muted-foreground">{p.default}</code>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-1.5 text-xs text-muted-foreground">
                        {p.description}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('endpoints.requestExample')}
            </h4>
            <CodeBlock
              code={ep.requestExample}
              language="json"
              showLineNumbers={false}
            />
          </div>
          <div>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('endpoints.responseExample')}
            </h4>
            <CodeBlock code={ep.responseExample} language="json" />
          </div>
        </div>
      </div>
    </article>
  );
}

export function Endpoints({ baseUrl }: { baseUrl: string }) {
  const { t } = useI18n();
  const endpoints = React.useMemo(() => getEndpoints(baseUrl), [baseUrl]);
  const [active, setActive] = React.useState<string>(endpoints[0]?.id ?? '');

  // IntersectionObserver to highlight the active endpoint in the TOC.
  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      {
        rootMargin: '-80px 0px -55% 0px',
        threshold: [0, 0.25, 0.5, 1],
      },
    );

    const els = endpoints
      .map((e) => document.getElementById(e.id))
      .filter((el): el is HTMLElement => el !== null);
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [endpoints]);

  const onJump = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <section id="endpoints" className="border-y border-zinc-200 bg-background dark:border-zinc-800">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="mb-8 max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight">{t('endpoints.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('endpoints.subtitle')}
          </p>
        </div>

        {/* mobile TOC */}
        <div className="mb-6 lg:hidden">
          <Select value={active} onValueChange={onJump}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Jump to endpoint" />
            </SelectTrigger>
            <SelectContent>
              {endpoints.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  <span className="font-mono text-xs">{e.method}</span>
                  <span className="ml-2 font-mono text-xs">{e.path}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
          {/* desktop sticky TOC */}
          <aside className="hidden lg:block">
            <div className="sticky top-20 max-h-[calc(100vh-6rem)]">
              <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('endpoints.title')}
              </p>
              <ScrollArea className="h-[calc(100vh-8rem)]">
                <nav className="flex flex-col gap-0.5 pr-3">
                  {endpoints.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => onJump(e.id)}
                      className={cn(
                        'group flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                        active === e.id
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'text-muted-foreground hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100',
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          METHOD_COLORS[e.method].dot,
                          active === e.id ? 'opacity-100' : 'opacity-40',
                        )}
                      />
                      <span className="font-mono uppercase">{e.method}</span>
                      <span className="flex-1 truncate font-mono">{e.path}</span>
                      <ChevronRight
                        className={cn(
                          'h-3 w-3 transition-all',
                          active === e.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-50',
                        )}
                      />
                    </button>
                  ))}
                </nav>
              </ScrollArea>
            </div>
          </aside>

          {/* endpoint cards */}
          <div className="flex flex-col gap-5">
            {endpoints.map((ep) => (
              <EndpointCard key={ep.id} ep={ep} />
            ))}
            <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 p-5 text-sm text-muted-foreground dark:border-zinc-800 dark:bg-zinc-900/30">
              <div className="mb-1 flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-200">
                <ArrowRight className="h-3.5 w-3.5" />
                Backwards-compatible aliases
              </div>
              All <code className="font-mono text-xs">/v2/*</code> routes are also mounted at
              <code className="font-mono text-xs"> /v1/*</code>. Behaviour is identical — only the path prefix differs.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
