'use client';

import * as React from 'react';
import { Hero } from './hero';
import { QuickStart } from './quick-start';
import { Features } from './features';
import { Endpoints } from './endpoints';
import { Configuration } from './configuration';
import { OpenWebUI } from './openwebui';

interface DocsPageProps {
  baseUrl: string;
}

/**
 * Client wrapper that composes all the documentation sections.
 * Receives the auto-detected baseUrl from the client page and passes
 * it down to every section that needs to inline the domain in code samples.
 */
export function DocsPage({ baseUrl }: DocsPageProps) {
  return (
    <div className="flex flex-col">
      <Hero baseUrl={baseUrl} />
      <QuickStart baseUrl={baseUrl} />
      <Features />
      <Endpoints baseUrl={baseUrl} />
      <Configuration />
      <OpenWebUI baseUrl={baseUrl} />
    </div>
  );
}
