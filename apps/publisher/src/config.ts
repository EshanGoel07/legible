/** Publisher config from env. Relative paths (MANIFEST_PATH, RUNS_DIR) resolve against the repo root. */
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PUBLISHER_VERSION = "0.1.0";
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export type PublisherConfig = { port: number; publisherUrl: string; storeUrl: string; safepayUrl: string; manifestPath: string; runsDir: string };

export function loadDotEnv(): void {
  try {
    process.loadEnvFile(resolve(REPO_ROOT, ".env"));
  } catch {
    /* host environment */
  }
}

const fromRoot = (p: string) => (isAbsolute(p) ? p : resolve(REPO_ROOT, p));
const trim = (u: string) => u.replace(/\/+$/, "");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PublisherConfig {
  const publisherUrl = trim(env.PUBLISHER_URL ?? "http://localhost:3002");
  return {
    port: Number(env.PORT ?? (new URL(publisherUrl).port || 3002)),
    publisherUrl,
    storeUrl: trim(env.STORE_URL ?? "http://localhost:3001"),
    safepayUrl: trim(env.SAFEPAY_URL ?? "http://localhost:3003"),
    manifestPath: fromRoot(env.MANIFEST_PATH ?? "fixtures/manifest.demo-store.json"),
    runsDir: fromRoot(env.RUNS_DIR ?? "runs"),
  };
}
