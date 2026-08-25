'use client';

import * as React from 'react';
import { Globe } from 'lucide-react';
import { useI18n } from '@/components/i18n';

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="mt-auto border-t border-zinc-200 bg-zinc-50/60 py-6 dark:border-zinc-800 dark:bg-zinc-950/40">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-6 text-xs text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-emerald-600/90 text-zinc-50">
            <Globe className="h-3 w-3" />
          </span>
          <span>
            <strong className="font-medium text-zinc-900 dark:text-zinc-100">NodeByte Crawl</strong>
            {' · '}{t('footer.text').split(' · ').slice(1).join(' · ')}
          </span>
        </div>
        <span className="text-muted-foreground/70">
          v3.8.4 · Powered by Playwright + Hono
        </span>
      </div>
    </footer>
  );
}
