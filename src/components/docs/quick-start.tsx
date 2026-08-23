'use client';

import * as React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CodeBlock } from '@/components/code-block';
import {
  QUICK_START_LANGS,
  getQuickStartSamples,
  type QuickStartLang,
} from './data';
import { useTestConsole } from '@/components/test/store';

const STEPS = [
  {
    n: 1,
    title: 'Get an API key',
    body:
      'Set CRAWLER_API_KEYS in your .env.local (one or more comma-separated keys). Restart the app. Skip this if auth is disabled.',
  },
  {
    n: 2,
    title: 'Send a request',
    body:
      'POST /v2/scrape with your URL and the formats you want. Pass the key as Authorization: Bearer.',
  },
  {
    n: 3,
    title: 'Render the result',
    body:
      'Use data.markdown, data.html, data.links, or data.screenshot. Poll crawl/batch jobs every 2s until status is "completed".',
  },
];

const LANG_LABELS: Record<QuickStartLang, string> = {
  curl: 'curl',
  python: 'Python',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
};

interface QuickStartProps {
  baseUrl: string;
}

export function QuickStart({ baseUrl }: QuickStartProps) {
  const [lang, setLang] = React.useState<QuickStartLang>('curl');
  const { apiKey } = useTestConsole();

  // Resolve code samples against the auto-detected baseUrl and the
  // user's saved API key (if any). Memoised so we only re-resolve when
  // one of those inputs changes.
  const samples = React.useMemo(
    () => getQuickStartSamples(baseUrl, apiKey),
    [baseUrl, apiKey],
  );

  return (
    <section id="quickstart" className="mx-auto max-w-5xl scroll-mt-20 px-6 py-16">
      <div className="mb-8">
        <h2 className="text-2xl font-semibold tracking-tight">Quick start</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Three steps. Pick a language, copy the snippet, run it.
          {apiKey
            ? ' Your saved API key is inlined in the snippets — copy-paste ready.'
            : ' Save an API key in the console below to inline it automatically.'}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div
            key={s.n}
            className="rounded-xl border border-zinc-200 bg-card p-5 shadow-sm dark:border-zinc-800"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              {s.n}
            </div>
            <h3 className="mt-3 text-base font-medium">{s.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <Tabs value={lang} onValueChange={(v) => setLang(v as QuickStartLang)}>
          <TabsList className="mb-3 h-auto flex-wrap">
            {QUICK_START_LANGS.map((l) => (
              <TabsTrigger key={l} value={l} className="px-3 py-1.5">
                {LANG_LABELS[l]}
              </TabsTrigger>
            ))}
          </TabsList>
          {QUICK_START_LANGS.map((l) => (
            <TabsContent key={l} value={l} className="mt-0">
              <CodeBlock
                code={samples[l]}
                language={l === 'curl' ? 'bash' : l}
                title={`${LANG_LABELS[l]} · POST /v2/scrape`}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </section>
  );
}
