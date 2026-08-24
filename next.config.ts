import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  typescript: { ignoreBuildErrors: true },
  reactStrictMode: false,
  // These packages have native bindings or large binaries that Next.js
  // should NOT try to bundle — they must stay as external node_modules
  // so the standalone server can require() them at runtime.
  serverExternalPackages: ["playwright", "turndown", "hono"],
  // Force these packages to be copied into .next/standalone/node_modules
  // even if Next.js doesn't detect them via its import trace (e.g. when
  // they're imported dynamically or via a lib directory).
  outputFileTracingIncludes: {
    "/": [
      "./node_modules/playwright/**/*",
      "./node_modules/turndown/**/*",
      "./node_modules/@types/turndown/**/*",
      "./node_modules/playwright-core/**/*",
    ],
  },
};
export default nextConfig;
