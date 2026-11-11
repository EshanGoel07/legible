import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Checkout, CreateCheckoutRequest, Health, Manifest, ROUTES, RUN_HEADER, StoreCart, ToolCallLog } from "@legible/contracts";
import { createApp, MCP_PATH } from "../src/app.js";
import { fillPath } from "../src/bindings.js";
import fixture from "../../../fixtures/manifest.demo-store.json" with { type: "json" };

const servers: Server[] = [];
const listen = (app: express.Express) =>
  new Promise<string>((resolve) => {
    const s = app.listen(0, () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`));
    servers.push(s);
  });
afterAll(() => servers.forEach((s) => s.close()));

const cart = (total: string) => StoreCart.parse({ cartId: "c1", items: [{ productId: "hoodie-black", size: "M", qty: 1, unitPrice: "29.00" }], subtotal: "29.00", shipping: "5.00", discount: "0.00", total, currency: "USD", coupon: null });
let cartTotal = "34.00";
const storeHits: string[] = [];
const safepayBodies: unknown[] = [];
const tmp = mkdtempSync(join(tmpdir(), "publisher-test-"));
const manifestPath = join(tmp, "manifest.json");
const runsDir = join(tmp, "runs");
let base = "";

beforeAll(async () => {
  const store = express();
  store.use(express.json());
  store.use((req, _res, next) => (storeHits.push(`${req.method} ${req.originalUrl} ${JSON.stringify(req.body ?? {})}`), next()));
  store.get("/api/products", (req, res) => res.json({ products: [], q: req.query.q }));
  store.post("/api/cart/:cartId/coupon", (_req, res) => res.status(500).json({ error: "internal_error", message: "boom" }));
  store.post("/api/cart/:cartId/items", (req, res) => res.json({ ok: true, cartId: req.params.cartId, body: req.body }));
  store.get(ROUTES.store.cart, (_req, res) => res.json(cart(cartTotal)));
  const storeUrl = await listen(store);

  const sp = express();
  sp.use(express.json());
  sp.post(ROUTES.safepay.checkouts, (req, res) => {
    const b = CreateCheckoutRequest.parse(req.body);
    safepayBodies.push(b);
    const blocked = Number(b.amount) > b.maxAmount;
    res.json(Checkout.parse({ checkoutId: "chk_1", paypalOrderId: blocked ? null : "PP1", approvalUrl: blocked ? null : "https://www.sandbox.paypal.com/checkoutnow?token=PP1", status: blocked ? "BLOCKED_LIMIT" : "PENDING_APPROVAL", amount: b.amount, currency: b.currency }));
  });
  const safepayUrl = await listen(sp);

  const m = Manifest.parse(structuredClone(fixture));
  m.tools.find((t) => t.name === "create_cart")!.approved = false; // one unapproved tool
  writeFileSync(manifestPath, JSON.stringify(m));
  base = await listen(createApp({ port: 0, publisherUrl: "http://x", storeUrl, safepayUrl, manifestPath, runsDir }));
});

async function client(runId?: string) {
  const c = new Client({ name: "test", version: "0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(base + MCP_PATH), { requestInit: { headers: runId ? { [RUN_HEADER]: runId } : {} } }));
  return c;
}
const text = (r: any) => r.content[0].text as string;
const logs = (runId: string) => readFileSync(join(runsDir, runId, "calls.jsonl"), "utf8").trim().split("\n").map((l) => ToolCallLog.parse(JSON.parse(l)));

describe("publisher", () => {
  it("GET /health returns Health", async () => {
    expect(Health.parse(await (await fetch(base + "/health")).json()).service).toBe("publisher");
  });

  it("lists only approved tools, money tools flagged", async () => {
    const tools = (await (await client()).listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(["add_to_cart", "apply_coupon", "checkout", "get_product", "search_products"]);
    expect(tools.find((t) => t.name === "checkout")!.description).toMatch(/MONEY/);
  });

  it("http binding: GET → query string, POST → path params filled + JSON body; logs ToolCallLog", async () => {
    const c = await client("r_http");
    const r1 = await c.callTool({ name: "search_products", arguments: { q: "hoodie", maxPrice: 30 } });
    expect(JSON.parse(text(r1))).toMatchObject({ q: "hoodie" });
    expect(storeHits).toContain("GET /api/products?q=hoodie&maxPrice=30 {}");
    const r2 = await c.callTool({ name: "add_to_cart", arguments: { cartId: "c1", productId: "hoodie-black", size: "M", qty: 1 } });
    expect(JSON.parse(text(r2)).body).toEqual({ productId: "hoodie-black", size: "M", qty: 1 });
    const l = logs("r_http");
    expect(l.map((x) => [x.tool, x.ok])).toEqual([["search_products", true], ["add_to_cart", true]]);
    expect(l[0].runId).toBe("r_http");
  });

  it("store errors become isError results and ok:false logs with the status", async () => {
    const c = await client("r_err");
    const r = await c.callTool({ name: "apply_coupon", arguments: { cartId: "c1", code: "DIWALI20" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/HTTP 500.*boom/);
    expect(logs("r_err")[0]).toMatchObject({ tool: "apply_coupon", ok: false, output: { error: "internal_error" } });
  });

  it("unapproved and unknown tools are refused and logged", async () => {
    const c = await client("r_deny");
    expect(text(await c.callTool({ name: "create_cart", arguments: {} }))).toMatch(/not approved/);
    expect(text(await c.callTool({ name: "drop_tables", arguments: {} }))).toMatch(/unknown tool/);
    expect(logs("r_deny").every((x) => !x.ok)).toBe(true);
  });

  it("safepay binding: reads the cart total and creates a Safe Pay checkout with the manifest limit + runId", async () => {
    cartTotal = "28.20";
    const c = await client("r_pay");
    const out = JSON.parse(text(await c.callTool({ name: "checkout", arguments: { cartId: "c1" } })));
    expect(out).toMatchObject({ checkoutId: "chk_1", status: "PENDING_APPROVAL", amount: "28.20", currency: "USD" });
    expect(out.approvalUrl).toMatch(/sandbox\.paypal\.com/);
    expect(safepayBodies.at(-1)).toEqual({ siteId: "demo-store", cartId: "c1", amount: "28.20", currency: "USD", maxAmount: 100, runId: "r_pay" });
    expect(logs("r_pay")[0]).toMatchObject({ tool: "checkout", ok: true });
  });

  it("over the limit: Safe Pay's BLOCKED_LIMIT is passed through to the agent", async () => {
    cartTotal = "321.00";
    const out = JSON.parse(text(await (await client("r_lim")).callTool({ name: "checkout", arguments: { cartId: "c1" } })));
    expect(out).toMatchObject({ status: "BLOCKED_LIMIT", approvalUrl: null });
    expect(out.message).toMatch(/over this site's limit/);
  });

  it("missing run header logs under 'adhoc'; bad run ids are not used as folder names", async () => {
    await (await client()).callTool({ name: "search_products", arguments: {} });
    await (await client("../../etc")).callTool({ name: "search_products", arguments: {} });
    expect(logs("adhoc").length).toBe(2);
  });

  it("re-reads the manifest when it changes (approval applies without restart)", async () => {
    const m = Manifest.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
    m.tools.find((t) => t.name === "create_cart")!.approved = true;
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(manifestPath, JSON.stringify(m));
    expect((await (await client()).listTools()).tools.map((t) => t.name)).toContain("create_cart");
  });

  it("fillPath encodes params and requires them", () => {
    expect(fillPath("/api/cart/{cartId}/items", { cartId: "a/b", qty: 1 })).toEqual({ path: "/api/cart/a%2Fb/items", rest: { qty: 1 } });
    expect(() => fillPath("/api/cart/{cartId}", {})).toThrow(/cartId/);
  });
});
