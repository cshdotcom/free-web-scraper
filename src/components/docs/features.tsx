'use client';

import * as React from 'react';
import { Globe, Layers, Code, Zap, Shield, Search, type LucideIcon } from 'lucide-react';
import { FEATURES } from './data';
import { cn } from '@/lib/utils';
import { useI18n } from '@/components/i18n';

const ICONS: Record<string, LucideIcon> = {
  Globe,
  Layers,
  Code,
  Zap,
  Shield,
  Search,
};

// Map each FEATURES entry's icon name to an i18n key for the title and
// description. The data.ts file keeps the canonical English copy for SSR
// fallback; this map overrides it with the user's chosen language.
const I18N_KEYS: Record<string, { title: string; desc: string }> = {
  Globe: { title: 'features.jsRendering.title', desc: 'features.jsRendering.desc' },
  Layers: { title: 'features.mainContent.title', desc: 'features.mainContent.desc' },
  Code: { title: 'features.markdownOutput.title', desc: 'features.markdownOutput.desc' },
  Zap: { title: 'features.concurrent.title', desc: 'features.concurrent.desc' },
  Shield: { title: 'features.stealth.title', desc: 'features.stealth.desc' },
  Search: { title: 'features.multiEngine.title', desc: 'features.multiEngine.desc' },
};

export function Features() {
  const { t } = useI18n();
  return (
    <section id="features" className="border-y border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-950/40">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="mb-10 max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight">{t('features.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('features.subtitle')}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = ICONS[f.icon] ?? Globe;
            const keys = I18N_KEYS[f.icon];
            const title = keys ? t(keys.title) : f.title;
            const desc = keys ? t(keys.desc) : f.description;
            return (
              <div
                key={f.title}
                className={cn(
                  'group relative overflow-hidden rounded-xl border border-zinc-200 bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800',
                )}
              >
                <div className="absolute right-3 top-3 h-20 w-20 -translate-y-8 translate-x-8 rounded-full bg-emerald-500/5 blur-2xl transition-all group-hover:bg-emerald-500/10" />
                <div className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="relative mt-4 text-base font-medium">{title}</h3>
                <p className="relative mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
