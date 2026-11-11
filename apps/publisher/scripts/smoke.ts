/**
 * Live MCP smoke test, scripted agent (no LLM): pnpm --filter @legible/publisher smoke [-- --approve]
 * search → create cart → add hoodie M → coupon → checkout over MCP; --approve also approves in the Sandbox and verifies.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Checkout, ROUTES, RUN_HEADER, VerifyResult } from "@legible/contracts";
import { loadConfig, loadDotEnv } from "../src/config.js";

loadDotEnv();
const cfg = loadConfig();
const runId = `smoke_${Date.now()}`;
const c = new Client({ name: "legible-smoke", version: "0" });
await c.connect(new StreamableHTTPClientTransport(new URL(`${cfg.publisherUrl}/mcp`), { requestInit: { headers: { [RUN_HEADER]: runId } } }));

const call = async (name: string, args: Record<string, unknown>) => {
  const r: any = await c.callTool({ name, arguments: args });
  const t = r.content[0].text as string;
  console.log(`${r.isError ? "ERR" : "ok "} ${name} ${JSON.stringify(args)} → ${t.replace(/\s+/g, " ").slice(0, 160)}`);
  return r.isError ? null : JSON.parse(t);
};

console.log(`run ${runId} · tools: ${(await c.listTools()).tools.map((t) => t.name).join(", ")}`);
const found = await call("search_products", { q: "hoodie", maxPrice: 30 });
const cart = await call("create_cart", {});
await call("add_to_cart", { cartId: cart.cartId, productId: found.products[0].productId, size: "M", qty: 1 });
await call("apply_coupon", { cartId: cart.cartId, code: "DIWALI20" });
const co = await call("checkout", { cartId: cart.cartId });
if (co && process.argv.includes("--approve") && co.status === "PENDING_APPROVAL") {
  const p = (r: string) => cfg.safepayUrl + r.replace(/:(id|checkoutId)/, co.checkoutId);
  console.log(`verify before approval: ${JSON.stringify(VerifyResult.parse(await (await fetch(p(ROUTES.safepay.verify))).json()).mismatches)}`);
  console.log("approving in PayPal Sandbox…");
  const done = Checkout.parse(await (await fetch(p(ROUTES.safepay.testApprove), { method: "POST" })).json());
  const v = VerifyResult.parse(await (await fetch(p(ROUTES.safepay.verify))).json());
  console.log(`checkout ${done.status} ${done.amount} ${done.currency} · verify match ${v.match} (PayPal ${v.paypal.status} / store ${v.store.status})`);
}
console.log(`log: ${cfg.runsDir}/${runId}/calls.jsonl`);
await c.close();
