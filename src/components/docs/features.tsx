import * as React from 'react';
import { Globe, Layers, Code, Zap, Shield, Search, type LucideIcon } from 'lucide-react';
import { FEATURES } from './data';
import { cn } from '@/lib/utils';

const ICONS: Record<string, LucideIcon> = {
  Globe,
  Layers,
  Code,
  Zap,
  Shield,
  Search,
};

export function Features() {
  return (
    <section id="features" className="border-y border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-950/40">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="mb-10 max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight">What you get</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Production-grade features out of the box. Built on Playwright, Turndown,
            and a battle-hardened multi-engine search aggregator.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = ICONS[f.icon] ?? Globe;
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
                <h3 className="relative mt-4 text-base font-medium">{f.title}</h3>
                <p className="relative mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {f.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
