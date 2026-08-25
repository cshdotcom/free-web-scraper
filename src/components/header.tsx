'use client';

import * as React from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useI18n } from '@/components/i18n';
import { Button } from '@/components/ui/button';
import { Globe, Terminal, Menu, X } from 'lucide-react';

interface HeaderProps {
  baseUrl: string;
}

export function Header({ baseUrl }: HeaderProps) {
  const { t } = useI18n();
  const [scrolled, setScrolled] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const NAV = [
    { href: '#quickstart', label: t('nav.quickStart') },
    { href: '#features', label: t('nav.features') },
    { href: '#endpoints', label: t('nav.endpoints') },
    { href: '#configuration', label: t('nav.config') },
    { href: '#openwebui', label: t('nav.openwebui') },
    { href: '#test-console', label: t('nav.console') },
  ];

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <header
        className={
          'sticky top-0 z-40 w-full border-b transition-colors ' +
          (scrolled
            ? 'border-zinc-200 bg-background/80 backdrop-blur-md dark:border-zinc-800'
            : 'border-transparent bg-background/0')
        }
      >
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <a href="#top" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600 text-zinc-50 shadow-sm">
              <Globe className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight">
              NodeByte <span className="text-emerald-600 dark:text-emerald-400">Crawl</span>
            </span>
          </a>

          <nav className="ml-4 hidden items-center gap-0.5 md:flex">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              >
                {n.label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="hidden gap-1.5 font-mono text-xs sm:inline-flex"
              onClick={() => {
                navigator.clipboard?.writeText(baseUrl).catch(() => undefined);
              }}
              title="Base URL"
            >
              <Terminal className="h-3.5 w-3.5" />
              {baseUrl.replace(/^https?:\/\//, '')}
            </Button>
            <LanguageToggle />
            <ThemeToggle />
            {/* Mobile hamburger menu button */}
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 md:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle navigation menu"
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile dropdown nav — shown when the hamburger is open */}
      {mobileOpen && (
        <div className="fixed inset-0 top-14 z-30 bg-background/95 backdrop-blur-sm md:hidden">
          <nav className="mx-auto max-w-5xl px-4 py-4">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                onClick={() => setMobileOpen(false)}
                className="block rounded-lg px-4 py-3 text-base font-medium text-foreground transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                {n.label}
              </a>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
