'use client';

import * as React from 'react';
import { Key, Lock, ShieldCheck, Save, Eye, EyeOff, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useTestConsole } from './store';

export function ApiKeyBar() {
  const { apiKey, setApiKey, authStatus, canRun } = useTestConsole();
  const [draft, setDraft] = React.useState('');
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    setDraft(apiKey);
  }, [apiKey]);

  const onSave = () => {
    setApiKey(draft.trim());
  };

  const onClear = () => {
    setApiKey('');
    setDraft('');
  };

  const requiresAuth = authStatus?.requiresAuth ?? false;
  const loaded = authStatus !== null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-card p-5 shadow-sm dark:border-zinc-800">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-zinc-500" />
            <h3 className="text-sm font-semibold">API Key</h3>
            {loaded && !requiresAuth && (
              <Badge
                variant="outline"
                className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              >
                <ShieldCheck className="mr-1 h-3 w-3" />
                Auth disabled — testing is open
              </Badge>
            )}
            {loaded && requiresAuth && (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              >
                <Lock className="mr-1 h-3 w-3" />
                API key required
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              id="show-key"
              type="checkbox"
              checked={show}
              onChange={(e) => setShow(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-zinc-700"
            />
            <label htmlFor="show-key" className="text-xs text-muted-foreground">
              Show key
            </label>
          </div>
        </div>

        {/* API key input — ALWAYS visible, even when auth is disabled.
            Users may want to save their key for code examples or for when
            they deploy with auth enabled. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Input
              type={show ? 'text' : 'password'}
              placeholder="Paste your API key (e.g. nbc_key_…) — optional when auth is disabled"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSave();
              }}
              className="pr-9 font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              aria-label={show ? 'Hide key' : 'Show key'}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex gap-2">
            <Button onClick={onSave} size="sm" className="gap-1.5">
              <Save className="h-3.5 w-3.5" />
              Save key
            </Button>
            {apiKey && (
              <Button onClick={onClear} variant="outline" size="sm" className="gap-1.5">
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          The key is <strong>encrypted with AES-GCM</strong> and stored in a{' '}
          <code className="font-mono">cookie</code> in your browser. It is sent as{' '}
          <code className="font-mono">Authorization: Bearer &lt;key&gt;</code> on every
          test request, and auto-filled into the code examples above.
          {!requiresAuth && loaded && (
            <> Auth is currently disabled (<code className="font-mono">CRAWLER_API_KEYS</code> unset), so the key is optional for testing — but saving it now means the code examples will show your real key for copy-paste.</>
          )}
        </p>

        {requiresAuth && !canRun && (
          <Alert>
            <Key className="h-4 w-4" />
            <AlertTitle>Enter your API key to run tests</AlertTitle>
            <AlertDescription>
              Auth is enabled on this instance. Paste a key above and click{' '}
              <strong>Save key</strong> to unlock the test console.
            </AlertDescription>
          </Alert>
        )}

        {apiKey && (
          <p className="text-xs text-emerald-700 dark:text-emerald-300">
            ✓ Key saved — requests will include{' '}
            <code className="font-mono">Authorization: Bearer ••••</code> and code
            examples will use your real key.
          </p>
        )}
      </div>
    </div>
  );
}
