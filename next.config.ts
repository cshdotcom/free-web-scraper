import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  typescript: { ignoreBuildErrors: true },
  reactStrictMode: false,
  // These packages have native bindings or large binaries that Next.js
  // should NOT try to bundle — they must stay as external node_modules
  // so the standalone server can require() them at runtime.
  //
  // NOTE: Turbopack (as of Next.js 16.x) has a known bug where
  // serverExternalPackages are referenced in the server bundle by an
  // internal chunk-id hash (e.g. "playwright-9b51c99ca474dcf1")
  // instead of the real package name. The standalone Node.js runtime
  // then fails with "Cannot find package 'playwright-9b51c99ca474dcf1'".
  //
  // Workaround: keep serverExternalPackages populated (so Turbopack
  // externalises these correctly AND copies them to standalone
  // node_modules), AND load a small require-hook shim (turbopack-shim.js
  // copied by build-standalone.sh) via NODE_OPTIONS that rewrites
  // the chunk-id back to the real package name at runtime.
  //
  // The shim is installed by start.sh:
  //   NODE_OPTIONS="--require $DIR/turbopack-shim.js" node server.js
  serverExternalPackages: ["playwright", "playwright-core", "turndown", "@mixmark-io/domino", "hono"],
  // Force these packages to be copied into .next/standalone/node_modules
  // even if Next.js doesn't detect them via its import trace (e.g. when
  // they're imported dynamically or via a lib directory).
  outputFileTracingIncludes: {
    "/": [
      "./node_modules/playwright/**/*",
      "./node_modules/playwright-core/**/*",
      "./node_modules/@mixmark-io/domino/**/*",
      "./node_modules/turndown/**/*",
    ],
  },
};
export default nextConfig;
