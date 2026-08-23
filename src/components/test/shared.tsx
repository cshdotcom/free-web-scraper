'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Download, Copy, Check, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { downloadFile, prettyJson, type ApiResult } from './api-client';
import { useI18n } from '@/components/i18n';

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
  const { t } = useI18n();
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>{t('status.requestInFlight')}</span>
      </div>
    );
  }
  if (!result) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
        <span>{t('status.idle')}</span>
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
        {result.ok ? t('status.success') : t('status.failed')}
      </Badge>
      <Badge variant="outline" className="font-mono">
        {t('misc.httpN').replace('{N}', String(result.status || '—'))}
      </Badge>
      <Badge variant="outline" className="font-mono">
        {t('misc.Nms').replace('{N}', String(result.durationMs))}
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
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => {
          downloadFile(`${filenameBase}.json`, prettyJson(json), 'application/json');
          toast.success(t('misc.exportedJson'));
        }}
      >
        <Download className="h-3.5 w-3.5" />
        {t('btn.exportJson')}
      </Button>
      {markdown !== undefined && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            downloadFile(`${filenameBase}.md`, markdown, 'text/markdown');
            toast.success(t('misc.exportedMarkdown'));
          }}
        >
          <Download className="h-3.5 w-3.5" />
          {t('btn.exportMd')}
        </Button>
      )}
      {html !== undefined && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            downloadFile(`${filenameBase}.html`, html, 'text/html');
            toast.success(t('misc.exportedHtml'));
          }}
        >
          <FileText className="h-3.5 w-3.5" />
          {t('btn.exportHtml')}
        </Button>
      )}
    </div>
  );
}

/** Small copy-to-clipboard icon button. */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = React.useState(false);
  const btnLabel = label ?? t('btn.copy');
  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success(t('misc.copied'));
          setTimeout(() => setCopied(false), 1200);
        } catch {
          toast.error(t('misc.copyFailed'));
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? t('misc.copied') : btnLabel}
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
