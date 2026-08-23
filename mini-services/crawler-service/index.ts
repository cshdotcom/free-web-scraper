import { app } from './src/routes.js';
import { config, getBrowser } from './src/config.js';

const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
  // Multi-engine search requests can take 20-40s with Playwright
  // scraping 5 engines in parallel; the default 10s idleTimeout
  // would kill them mid-flight. Bump to 2 minutes.
  idleTimeout: 120,
});

console.log(`[${config.brandName}] HTTP server listening on http://localhost:${config.port}`);
console.log(`[${config.brandName}] maxConcurrency=${config.maxConcurrency}, defaultTimeout=${config.defaultTimeout}ms`);
if (config.apiKeys.length > 0) {
  console.log(`[${config.brandName}] API key authentication is ENABLED (${config.apiKeys.length} key(s) accepted)`);
} else {
  console.log(`[${config.brandName}] API key authentication is DISABLED (open access)`);
}

// Pre-warm the browser so the first request isn't slow.
getBrowser()
  .then(() => console.log(`[${config.brandName}] Browser warmed up and ready.`))
  .catch((e) => console.error(`[${config.brandName}] Failed to warm up browser:`, e?.message ?? e));

// Graceful shutdown.
const shutdown = async (sig: string) => {
  console.log(`[${config.brandName}] Received ${sig}, shutting down...`);
  server.stop(true);
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
