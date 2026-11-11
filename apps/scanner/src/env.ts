import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo-root .env (values go to process.env only, never printed). */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  } catch {
    /* host environment */
  }
}

/** pnpm runs scripts in the package dir; resolve user paths against where the command was typed first. */
export function resolveInput(p: string): string {
  if (isAbsolute(p)) return p;
  const fromCaller = resolve(process.env.INIT_CWD ?? process.cwd(), p);
  return existsSync(fromCaller) ? fromCaller : resolve(process.cwd(), p);
}
export const resolveOutput = (p: string) => (isAbsolute(p) ? p : resolve(process.env.INIT_CWD ?? process.cwd(), p));

/** Site identity: `"legible": { siteId, siteName }` in the scanned package.json, else the folder name. */
export function siteDefaults(root: string): { id: string; name: string } {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    if (pkg.legible?.siteId) return { id: pkg.legible.siteId, name: pkg.legible.siteName ?? pkg.legible.siteId };
  } catch {
    /* no package.json */
  }
  return { id: basename(root), name: basename(root) };
}
