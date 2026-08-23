'use client';

import * as React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface CodeBlockProps {
  code: string;
  language: string;
  showLineNumbers?: boolean;
  className?: string;
  /** When true, renders a copy button on top-right. */
  copyable?: boolean;
  /** Optional title pill above the code block (e.g. "example.json"). */
  title?: string;
}

/**
 * Reusable dark-themed code block used across docs and examples.
 * Uses react-syntax-highlighter (Prism + one-dark). Always rendered
 * in dark mode for consistent code look across light/dark pages.
 */
export function CodeBlock({
  code,
  language,
  showLineNumbers = false,
  className,
  copyable = true,
  title,
}: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);

  const onCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Failed to copy');
    }
  }, [code]);

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-lg border border-zinc-800 bg-[#282c34] text-zinc-100',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-zinc-800/60 bg-zinc-900/40 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
          {title ?? language}
        </span>
        {copyable && (
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Copy code"
          >
            {copied ? (
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      <div className="overflow-x-auto text-sm">
        <SyntaxHighlighter
          language={language}
          style={oneDark}
          showLineNumbers={showLineNumbers}
          customStyle={{
            margin: 0,
            padding: '0.875rem 1rem',
            background: 'transparent',
            fontSize: '0.8125rem',
            lineHeight: 1.55,
          }}
          codeTagProps={{
            style: {
              fontFamily:
                'var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
            },
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
