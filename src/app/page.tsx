'use client';

import * as React from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import { I18nProvider } from '@/components/i18n';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { DocsPage } from '@/components/docs/docs-page';
import { TestConsole } from '@/components/test/test-console';
import { TestConsoleProvider } from '@/components/test/store';

/**
 * Fallback base URL used during SSR and the very first client paint.
 * After mount, the actual value is read from `window.location.origin` so
 * code samples always reflect the real domain the user is visiting.
 */
const FALLBACK_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.CRAWLER_PUBLIC_URL ||
  'http://localhost:3000';

export default function Home() {
  // Initial state uses the env-var fallback (or localhost:3000) so the SSR
  // HTML and the first client render are byte-identical — no hydration
  // mismatch. We swap to `window.location.origin` in the mount effect.
  const [baseUrl, setBaseUrl] = React.useState<string>(FALLBACK_BASE_URL);

  React.useEffect(() => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      const origin = window.location.origin;
      // Avoid a needless state update (and re-render) if origin already matches.
      setBaseUrl((prev) => (prev === origin ? prev : origin));
    }
  }, []);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <I18nProvider>
        <div
          id="top"
          className="flex min-h-screen flex-col bg-background text-foreground"
        >
          <Header baseUrl={baseUrl} />
          <main className="flex-1">
            {/*
              TestConsoleProvider wraps both DocsPage (so QuickStart can read
              the saved API key from the store) and TestConsole itself.
            */}
            <TestConsoleProvider>
              <DocsPage baseUrl={baseUrl} />
              <TestConsole />
            </TestConsoleProvider>
          </main>
          <Footer />
        </div>
      </I18nProvider>
    </ThemeProvider>
  );
}
