'use client';

import * as React from 'react';
import { Plug, ExternalLink } from 'lucide-react';
import { CodeBlock } from '@/components/code-block';
import { useI18n } from '@/components/i18n';

interface OpenWebUIProps {
  baseUrl: string;
}

function buildSampleEnv(baseUrl: string): string {
  return `# In your OpenWebUI .env file:
SEARXNG_API_URL=${baseUrl}/search

# If CRAWLER_API_KEYS is set on the crawler side,
# append ?key=<your-key>:
# SEARXNG_API_URL=${baseUrl}/search?key=nbc_key_abc123`;
}

const SAMPLE_RESPONSE = `{
  "query": "best rust web framework",
  "number_of_results": 10,
  "results": [
    {
      "title": "Best Rust Web Frameworks in 2025",
      "url": "https://example.com/rust-web",
      "content": "Comparison of Axum, Actix, Rocket...",
      "engine": "bing",
      "score": 2.5
    }
  ]
}`;

export function OpenWebUI({ baseUrl }: OpenWebUIProps) {
  const { t } = useI18n();
  return (
    <section
      id="openwebui"
      className="border-y border-zinc-200 bg-background dark:border-zinc-800"
    >
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="mb-8 max-w-2xl">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <Plug className="h-3 w-3" />
            {t('openwebui.title')}
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {t('openwebui.subtitle')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The <code className="font-mono text-xs">GET /search</code> endpoint speaks the
            SearxNG JSON protocol. Point OpenWebUI at it and your AI chat gets live web search
            across Bing, DuckDuckGo, SearXNG, and Wikipedia — with one failing engine
            never breaking the request.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 dark:border-emerald-500/20">
            <h3 className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
              {t('openwebui.title')}
            </h3>
            <ol className="mt-3 space-y-2.5 text-sm text-zinc-700 dark:text-zinc-300">
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  1
                </span>
                <span>
                  Set <code className="font-mono text-xs">SEARXNG_API_URL</code> in your OpenWebUI
                  <code className="font-mono text-xs"> .env</code> to point at this service.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  2
                </span>
                <span>
                  If you enabled API keys on the crawler side, append
                  <code className="font-mono text-xs"> ?key=&lt;your-key&gt;</code> to the URL.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  3
                </span>
                <span>
                  Restart OpenWebUI. The web-search tool now hits this service in SearxNG
                  format.
                </span>
              </li>
            </ol>

            <div className="mt-4">
              <CodeBlock code={buildSampleEnv(baseUrl)} language="bash" title=".env (OpenWebUI)" />
            </div>

            <a
              href="https://docs.openwebui.com/features/web-search/"
              target="_blank"
              rel="noreferrer noopener"
              className="mt-4 inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline dark:text-emerald-300"
            >
              OpenWebUI web-search docs
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div className="space-y-3">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('endpoints.title')}
              </h3>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
                <span className="inline-flex items-center gap-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  GET
                </span>
                <code className="font-mono text-xs">/search?q=&lt;query&gt;&amp;format=json&amp;key=&lt;api-key&gt;</code>
              </div>
            </div>
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('endpoints.responseExample')}
              </h3>
              <CodeBlock code={SAMPLE_RESPONSE} language="json" title="searxng.json" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
