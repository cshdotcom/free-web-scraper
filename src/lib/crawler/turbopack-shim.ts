/**
 * Module-resolution shim for Turbopack standalone builds.
 *
 * Turbopack has a known bug (as of Next.js 16.x) where packages
 * auto-detected as "external" (because they have native binaries,
 * bin fields, or are in serverExternalPackages) are referenced
 * in the server bundle by an internal chunk-id hash like
 * "playwright-9b51c99ca474dcf1" instead of the real package name
 * "playwright". The standalone Node.js runtime then fails with
 *   "Cannot find package 'playwright-9b51c99ca474dcf1'"
 *
 * This shim installs a require hook that rewrites those hashes
 * back to the real package names. It must be loaded BEFORE any
 * code that imports the affected packages — typically the first
 * thing the standalone server.js requires.
 *
 * Loaded from start.sh via NODE_OPTIONS="--require <this-file>".
 */

const Module = require('module');
const originalResolve = Module._resolveFilename;

/** Map of Turbopack-chunk-id prefixes → real package names.
 *  Each entry matches chunk-ids that start with the prefix.
 *  When a require('playwright-XXXX') call comes in, we rewrite
 *  it to require('playwright'). */
const HASH_PREFIX_MAP: Record<string, string> = {
  'playwright-': 'playwright',
  'playwright-core-': 'playwright-core',
  'turndown-': 'turndown',
  '@mixmark-io/domino-': '@mixmark-io/domino',
  'hono-': 'hono',
};

// Install the hook. We do this once at module load time.
// @ts-ignore — Module._resolveFilename is a Node internal.
Module._resolveFilename = function (request: string, parent: any, isMain: boolean, options: any): string {
  if (typeof request === 'string') {
    for (const prefix of Object.keys(HASH_PREFIX_MAP)) {
      if (request.startsWith(prefix) && request !== HASH_PREFIX_MAP[prefix]) {
        // Rewrite e.g. "playwright-9b51c99ca474dcf1" → "playwright".
        const realName = HASH_PREFIX_MAP[prefix];
        // eslint-disable-next-line no-console
        console.log(`[shim] rewriting require('${request}') → require('${realName}')`);
        try {
          return originalResolve.call(this, realName, parent, isMain, options);
        } catch (e) {
          // Fall through to the original resolve (which will fail with
          // a clear error message about the real package name).
          // eslint-disable-next-line no-console
          console.warn(`[shim] require('${realName}') failed: ${(e as Error).message}`);
        }
      }
    }
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

// Export a marker so callers can verify the shim loaded.
module.exports = {
  loaded: true,
  HASH_PREFIX_MAP,
};
