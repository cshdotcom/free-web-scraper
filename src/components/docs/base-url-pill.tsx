'use client';

import * as React from 'react';
import { Check, Copy, Terminal } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface BaseUrlPillProps {
  baseUrl: string;
  className?: string;
}

/**
 * Pill that shows the public base URL with a copy button.
 * Defaults to whatever the server passed in (NEXT_PUBLIC_APP_URL
 * or fallback http://localhost:3000).
 */
export function BaseUrlPill({ baseUrl, className }: BaseUrlPillProps) {
  const [copied, setCopied] = React.useState(false);

  const onCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(baseUrl);
      setCopied(true);
      toast.success('Base URL copied');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Failed to copy');
    }
  }, [baseUrl]);

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 py-1 pl-3 pr-1.5 font-mono text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900',
        className,
      )}
    >
      <Terminal className="h-3.5 w-3.5 text-zinc-500" />
      <span className="text-zinc-700 dark:text-zinc-200">{baseUrl}</span>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-zinc-200 text-zinc-700 transition-colors hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        aria-label="Copy base URL"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
