import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig: NextConfig = {
  // @legible/contracts is TypeScript source in the workspace.
  transpilePackages: ["@legible/contracts"],
  // The monorepo root, so Turbopack resolves the workspace package (and doesn't guess from lockfiles).
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  // No floating dev badge: the dashboard is recorded for the demo video.
  devIndicators: false,
};

export default nextConfig;
