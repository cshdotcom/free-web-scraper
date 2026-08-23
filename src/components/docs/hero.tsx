import * as React from 'react';
import { Globe, Zap, Search, Shield } from 'lucide-react';
import { BaseUrlPill } from './base-url-pill';
import { cn } from '@/lib/utils';

interface HeroProps {
  baseUrl: string;
}

const BADGES = [
  { label: 'JS-Rendered', icon: Zap },
  { label: 'Firecrawl v2', icon: Globe },
  { label: 'Multi-Engine Search', icon: Search },
  { label: 'Stealth', icon: Shield },
];

export function Hero({ baseUrl }: HeroProps) {
  return (
    <section className="relative overflow-hidden border-b border-zinc-200 bg-gradient-to-b from-zinc-50 to-background dark:border-zinc-800 dark:from-zinc-950">
      {/* subtle grid backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.4] dark:opacity-[0.15]"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, black 40%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, black 40%, transparent 100%)',
        }}
      />
      <div className="relative mx-auto max-w-5xl px-6 py-16 sm:py-24">
        <div className="flex flex-col items-start gap-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs font-medium text-zinc-600 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            v2.0 · Firecrawl-compatible · OpenWebUI-compatible
          </div>

          <h1 className="text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-6xl">
            NodeByte <span className="text-emerald-600 dark:text-emerald-400">Crawl</span>
          </h1>

          <p className="max-w-2xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-300">
            Firecrawl v2-compatible web scraping API. JavaScript-rendered. Multi-engine
            search. OpenWebUI compatible.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {BADGES.map(({ label, icon: Icon }) => (
              <span
                key={label}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                {label}
              </span>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <BaseUrlPill baseUrl={baseUrl} />
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              All endpoints are relative to this URL.
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <a
              href="#quickstart"
              className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 shadow transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Get started
            </a>
            <a
              href="#endpoints"
              className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              API reference
            </a>
            <a
              href="#test-console"
              className="inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-700 shadow-sm transition-colors hover:bg-emerald-500/20 dark:text-emerald-300"
            >
              Try the console
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
