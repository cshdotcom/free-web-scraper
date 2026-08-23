import * as React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Terminal } from 'lucide-react';
import { ENV_VARS } from './data';

export function Configuration() {
  return (
    <section
      id="configuration"
      className="border-y border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-950/40"
    >
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="mb-8 max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight">Configuration</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            All environment variables read by the crawler service and the Next.js proxy.
            Set them in <code className="font-mono">.env.local</code> (Next.js app) and
            <code className="font-mono"> mini-services/crawler-service/.env</code>.
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-card shadow-sm dark:border-zinc-800">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50 dark:bg-zinc-900/40">
                <TableHead className="h-9 px-3 text-xs uppercase tracking-wider">Variable</TableHead>
                <TableHead className="h-9 px-3 text-xs uppercase tracking-wider">Default</TableHead>
                <TableHead className="h-9 px-3 text-xs uppercase tracking-wider">Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ENV_VARS.map((v) => (
                <TableRow key={v.name}>
                  <TableCell className="px-3 py-2.5 align-top">
                    <div className="flex items-center gap-2">
                      <Terminal className="h-3.5 w-3.5 text-zinc-400" />
                      <code className="font-mono text-xs font-medium text-zinc-900 dark:text-zinc-100">
                        {v.name}
                      </code>
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2.5 align-top">
                    <Badge variant="outline" className="font-mono text-[10px] font-normal">
                      {v.default}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                    {v.description}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}
