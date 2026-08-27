'use client';

import * as React from 'react';
import { Globe, Zap, Search, Shield } from 'lucide-react';
import { BaseUrlPill } from './base-url-pill';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/i18n';

interface HeroProps {
  baseUrl: string;
}

export function Hero({ baseUrl }: HeroProps) {
  const { t } = useI18n();
  const BADGES = [
    { label: t('hero.badge.jsRendered'), icon: Zap },
    { label: t('hero.badge.firecrawlV2'), icon: Globe },
    { label: t('hero.badge.multiEngine'), icon: Search },
    { label: t('hero.badge.stealth'), icon: Shield },
  ];

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
            v4.0.8 · Firecrawl-compatible · OpenWebUI-compatible
          </div>

          <h1 className="text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-6xl">
            NodeByte <span className="text-emerald-600 dark:text-emerald-400">Crawl</span>
          </h1>

          <p className="max-w-2xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-300">
            {t('hero.tagline')}
          </p>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <a
              href="https://github.com/cshdotcom/free-web-scraper"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 font-medium text-zinc-700 shadow-sm transition-colors hover:border-emerald-400 hover:text-emerald-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-emerald-600 dark:hover:text-emerald-300"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              {t('hero.github')}
            </a>
            <a
              href="https://github.com/cshdotcom/free-web-scraper/releases"
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 font-medium text-zinc-700 shadow-sm transition-colors hover:border-emerald-400 hover:text-emerald-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-emerald-600 dark:hover:text-emerald-300"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              {t('hero.download')}
            </a>
          </div>

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
              {t('hero.allEndpointsRelative')}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <a
              href="#quickstart"
              className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 shadow transition-colors hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {t('hero.getStarted')}
            </a>
            <a
              href="#endpoints"
              className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {t('hero.apiReference')}
            </a>
            <a
              href="#test-console"
              className="inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-700 shadow-sm transition-colors hover:bg-emerald-500/20 dark:text-emerald-300"
            >
              {t('hero.tryConsole')}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
