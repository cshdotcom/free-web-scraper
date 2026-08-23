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
  const locked = requiresAuth && !canRun;

  return (
    <section
      id="test-console"
      className="border-t border-zinc-200 bg-gradient-to-b from-zinc-50/40 to-background dark:border-zinc-800 dark:from-zinc-950/40"
    >
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="mb-8 max-w-2xl">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            Interactive
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Test console</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Try every endpoint directly from this page. All requests go through the
            Next.js proxy routes — no CORS, no exposed ports. Save your API key above once,
            and it will be reused across all tabs.
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
              <p className="text-sm font-medium">Enter your API key to run tests</p>
              <p className="mt-1 text-xs text-muted-foreground">
                The console is locked until you save a valid key in the box above.
              </p>
            </div>
          </div>
        ) : (
          <Tabs defaultValue="scrape">
            <TabsList className="mb-5 h-auto flex-wrap">
              <TabItem value="scrape">Scrape</TabItem>
              <TabItem value="batch-sync">Batch (Sync)</TabItem>
              <TabItem value="crawl">Crawl</TabItem>
              <TabItem value="map">Map</TabItem>
              <TabItem value="search">Search</TabItem>
              <TabItem value="batch-async">Batch (Async)</TabItem>
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
