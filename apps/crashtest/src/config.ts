import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const fromRoot = (p: string) => (isAbsolute(p) ? p : resolve(REPO_ROOT, p));
const trim = (u: string) => u.replace(/\/+$/, "");

export function loadDotEnv(): void {
  try {
    process.loadEnvFile(resolve(REPO_ROOT, ".env"));
  } catch {
    /* host environment */
  }
}

export type CrashConfig = { publisherUrl: string; safepayUrl: string; manifestPath: string; runsDir: string; scenariosDir: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CrashConfig {
  return {
    publisherUrl: trim(env.PUBLISHER_URL ?? "http://localhost:3002"),
    safepayUrl: trim(env.SAFEPAY_URL ?? "http://localhost:3003"),
    manifestPath: fromRoot(env.MANIFEST_PATH ?? "fixtures/manifest.demo-store.json"),
    runsDir: fromRoot(env.RUNS_DIR ?? "runs"),
    scenariosDir: fromRoot(env.SCENARIOS_DIR ?? "fixtures/scenarios"),
  };
}
