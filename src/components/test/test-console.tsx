'use client';

import * as React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiKeyBar } from './api-key-bar';
import { useTestConsole } from './store';
import { ScrapeTab } from './scrape-tab';
import { BatchSyncTab } from './batch-sync-tab';
import { CrawlTab } from './crawl-tab';
import { MapTab } from './map-tab';
import { SearchTab } from './search-tab';
import { BatchAsyncTab } from './batch-async-tab';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/i18n';

interface TabTriggerProps {
  value: string;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}

function TabItem({ value, children, disabled, title }: TabTriggerProps) {
  return (
    <TabsTrigger
      value={value}
      disabled={disabled}
      className={cn('gap-1.5 data-[state=disabled]:opacity-50')}
      title={title}
    >
      {children}
    </TabsTrigger>
  );
}

export function TestConsole() {
  const { canRun, requiresAuth } = useTestConsole();
  const { t } = useI18n();
  const locked = requiresAuth && !canRun;

  return (
    <section
      id="test-console"
      className="border-t border-zinc-200 bg-gradient-to-b from-zinc-50/40 to-background dark:border-zinc-800 dark:from-zinc-950/40"
    >
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="mb-8 max-w-2xl">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            {t('console.interactive')}
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">{t('console.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('console.subtitle')}
          </p>
        </div>

        <div className="mb-5">
          <ApiKeyBar />
        </div>

        {locked ? (
          <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/30">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300">
                <Lock className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium">{t('console.locked')}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('console.lockedHint')}
              </p>
            </div>
          </div>
        ) : (
          <Tabs defaultValue="scrape">
            <TabsList className="mb-5 h-auto flex-wrap">
              <TabItem value="scrape">{t('tab.scrape')}</TabItem>
              <TabItem value="batch-sync">{t('tab.batchSync')}</TabItem>
              <TabItem value="crawl">{t('tab.crawl')}</TabItem>
              <TabItem value="map">{t('tab.map')}</TabItem>
              <TabItem value="search">{t('tab.search')}</TabItem>
              <TabItem value="batch-async">{t('tab.batchAsync')}</TabItem>
            </TabsList>
            <TabsContent value="scrape" className="mt-0">
              <ScrapeTab />
            </TabsContent>
            <TabsContent value="batch-sync" className="mt-0">
              <BatchSyncTab />
            </TabsContent>
            <TabsContent value="crawl" className="mt-0">
              <CrawlTab />
            </TabsContent>
            <TabsContent value="map" className="mt-0">
              <MapTab />
            </TabsContent>
            <TabsContent value="search" className="mt-0">
              <SearchTab />
            </TabsContent>
            <TabsContent value="batch-async" className="mt-0">
              <BatchAsyncTab />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </section>
  );
}
