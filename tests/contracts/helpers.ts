/**
 * Contract tests call REAL running services (start them with `pnpm demo`, which leaves them up) and parse every
 * response with the contract schema. A join whose services are down is skipped, not failed.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Health, ROUTES, StoreCart } from "@legible/contracts";

export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
try {
  process.loadEnvFile(join(ROOT, ".env"));
} catch {
  /* host env */
}
const u = (k: string, d: string) => (process.env[k] ?? d).replace(/\/+$/, "");
export const URLS = { store: u("STORE_URL", "http://localhost:3001"), publisher: u("PUBLISHER_URL", "http://localhost:3002"), safepay: u("SAFEPAY_URL", "http://localhost:3003") };
export const RUNS = resolve(ROOT, process.env.RUNS_DIR ?? "runs");

/** true when GET /health answers with a valid Health for that service. Top-level await in each test file. */
export async function up(base: string, service: Health["service"]): Promise<boolean> {
  try {
    const h = Health.parse(await (await fetch(base + ROUTES.health, { signal: AbortSignal.timeout(2000) })).json());
    return h.ok && h.service === service;
  } catch {
    return false;
  }
}

export async function json(method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> {
  const r = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

export const path = (route: string, params: Record<string, string>) => route.replace(/:(\w+)/g, (_m, k: string) => encodeURIComponent(params[k]));

/** A store cart with `qty` of a product (via the store's own API). */
export async function makeCart(productId = "hoodie-black", size = "M", qty = 1): Promise<StoreCart> {
  const { body: cart } = await json("POST", `${URLS.store}/api/cart`);
  const { body } = await json("POST", `${URLS.store}/api/cart/${cart.cartId}/items`, { productId, size, qty });
  return StoreCart.parse(body);
}

let rpcId = 0;
/** One MCP JSON-RPC request to the stateless Streamable HTTP endpoint. */
export async function mcp(method: string, params: Record<string, unknown>, runId?: string): Promise<any> {
  const r = await fetch(`${URLS.publisher}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(runId ? { "x-legible-run": runId } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const msg = await r.json();
  if (msg.error) throw new Error(`MCP ${method}: ${msg.error.message}`);
  return msg.result;
}

/** Newest runs/<suiteId>/report.json, if any. */
export function newestReport(): string | null {
  if (!existsSync(RUNS)) return null;
  const files = readdirSync(RUNS)
    .map((d) => join(RUNS, d, "report.json"))
    .filter((f) => existsSync(f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] ?? null;
}
export const readJson = (f: string) => JSON.parse(readFileSync(f, "utf8"));
