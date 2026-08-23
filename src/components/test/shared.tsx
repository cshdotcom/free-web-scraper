'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Download, Copy, Check, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { downloadFile, prettyJson, type ApiResult } from './api-client';

/** Button that shows a spinner while loading. */
export function LoadingButton({
  loading,
  children,
  disabled,
  onClick,
  variant,
  size,
  className,
  type,
}: {
  loading?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'link' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <Button
      type={type ?? 'button'}
      variant={variant ?? 'default'}
      size={size ?? 'default'}
      onClick={onClick}
      disabled={disabled || loading}
      className={className}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </Button>
  );
}

interface StatusBarProps {
  result: ApiResult | null;
  loading?: boolean;
  badges?: React.ReactNode;
}

/** Status bar showing response time, HTTP code, success badge, plus extra badges. */
export function StatusBar({ result, loading, badges }: StatusBarProps) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>Request in flight…</span>
      </div>
    );
  }
  if (!result) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
        <span>Idle</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Badge
        variant="outline"
        className={cn(
          'font-mono',
          result.ok
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            : 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
        )}
      >
        {result.ok ? '✓ success' : '✗ failed'}
      </Badge>
      <Badge variant="outline" className="font-mono">
        HTTP {result.status || '—'}
      </Badge>
      <Badge variant="outline" className="font-mono">
        {result.durationMs} ms
      </Badge>
      {badges}
    </div>
  );
}

interface ExportButtonsProps {
  json: unknown;
  markdown?: string;
  html?: string;
  filenameBase: string;
}

/** JSON / MD / HTML export buttons. HTML button only renders when `html` is defined. */
export function ExportButtons({ json, markdown, html, filenameBase }: ExportButtonsProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => {
          downloadFile(`${filenameBase}.json`, prettyJson(json), 'application/json');
          toast.success('Exported JSON');
        }}
      >
        <Download className="h-3.5 w-3.5" />
        JSON
      </Button>
      {markdown !== undefined && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            downloadFile(`${filenameBase}.md`, markdown, 'text/markdown');
            toast.success('Exported Markdown');
          }}
        >
          <Download className="h-3.5 w-3.5" />
          MD
        </Button>
      )}
      {html !== undefined && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            downloadFile(`${filenameBase}.html`, html, 'text/html');
            toast.success('Exported HTML');
          }}
        >
          <FileText className="h-3.5 w-3.5" />
          HTML
        </Button>
      )}
    </div>
  );
}

/** Small copy-to-clipboard icon button. */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success('Copied');
          setTimeout(() => setCopied(false), 1200);
        } catch {
          toast.error('Copy failed');
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

/** Render the page response markdown via react-markdown. */
export function MarkdownRender({ source }: { source: string }) {
  return (
    <div className="prose prose-zinc max-w-none text-sm dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-emerald-600 dark:prose-a:text-emerald-400 prose-code:rounded prose-code:bg-zinc-100 prose-code:px-1 prose-code:py-0.5 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none dark:prose-code:bg-zinc-800">
      <ReactMarkdown>{source}</ReactMarkdown>
    </div>
  );
}

/** Plain box for showing JSON in a scrollable area. */
export function RawJsonView({ value }: { value: unknown }) {
  const text = prettyJson(value);
  return (
    <pre className="max-h-[480px] overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/40">
      <code className="font-mono">{text}</code>
    </pre>
  );
}

/** Empty-state placeholder for result panels. */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/30">
      <div className="text-center">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground/70">{hint}</p>}
      </div>
    </div>
  );
}
