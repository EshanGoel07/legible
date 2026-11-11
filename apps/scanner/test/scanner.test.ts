import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { Manifest } from "@legible/contracts";
import { discoverRoutes, toManifestPath, type DiscoveredRoute } from "../src/discover.js";
import { classify, ruleRisk } from "../src/classify.js";
import { buildManifest, findCartRoute } from "../src/build.js";
import { DESCRIBE_TOOL, type RouteDescription } from "../src/describe.js";
import { Llm, type ChatClient } from "../src/llm.js";
import { score } from "../src/eval.js";
import truth from "../eval/ground-truth.demo-store.json" with { type: "json" };

const STORE = fileURLToPath(new URL("../../../demo/store", import.meta.url));
const site = { id: "demo-store", name: "Demo", baseUrl: "http://localhost:3001" };
const limits = { currency: "USD", maxAmount: 100 };

describe("stage 1 discover", () => {
  const { routes, skipped } = discoverRoutes(STORE);
  it("finds every demo-store route, resolving ROUTES constants, skipping /health", () => {
    const got = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(got).toEqual(truth.routes.map((r) => `${r.method} ${r.path}`).sort());
    expect(skipped).toEqual([]);
  });
  it("records file, line, handler and referenced declarations", () => {
    const items = routes.find((r) => r.path === "/api/cart/:cartId/items")!;
    expect(items).toMatchObject({ file: "src/routes/cart.ts", line: 25 });
    expect(items.handlerSource).toContain("AddItemBody.parse");
    expect(items.context.join("\n")).toContain("const AddItemBody");
  });
  it("converts Express params to manifest params", () => expect(toManifestPath("/a/:cartId/b/:x")).toBe("/a/{cartId}/b/{x}"));
});

const route = (method: DiscoveredRoute["method"], path: string, handlerSource = "() => {}"): DiscoveredRoute => ({ method, path, file: "src/x.ts", line: 1, comment: "", handlerSource, context: [] });
const desc = (over: Partial<RouteDescription>): RouteDescription => ({ expose: true, exposeReason: "x", name: "tool_x", description: "Does a thing.", inputs: [], risk: "read", riskReason: "r", confidence: 0.9, ...over });

describe("stage 3 classify", () => {
  it("rules: money words → money, GET → read, else write", () => {
    expect(ruleRisk(route("POST", "/api/cart/:cartId/checkout")).risk).toBe("money");
    expect(ruleRisk(route("POST", "/x", "() => fetch(safepayUrl)")).risk).toBe("money");
    expect(ruleRisk(route("GET", "/api/products")).risk).toBe("read");
    expect(ruleRisk(route("POST", "/api/cart")).risk).toBe("write");
  });
  it("agreement keeps confidence; disagreement takes the cautious tier and lowers confidence", () => {
    expect(classify(route("GET", "/p"), { risk: "read", riskReason: "r", confidence: 0.9 })).toMatchObject({ risk: "read", confidence: 0.9, agreed: true });
    const c = classify(route("GET", "/api/orders/:id"), { risk: "read", riskReason: "r", confidence: 0.9 });
    expect(c).toMatchObject({ risk: "money", confidence: 0.54, agreed: false });
    expect(c.riskReason).toMatch(/^Review:/);
  });
});

describe("build manifest", () => {
  const routes = [route("GET", "/api/cart/:cartId"), route("POST", "/api/cart/:cartId/checkout"), route("POST", "/api/orders"), route("GET", "/api/products")];
  const described = [
    desc({ name: "get_cart", inputs: [{ name: "cartId", in: "path", type: "string", required: true }] }),
    desc({ name: "pay_cart", risk: "money", inputs: [{ name: "bogus", in: "path", type: "string", required: true }] }),
    desc({ expose: false, risk: "money" }),
    desc({ name: "search_products", inputs: [{ name: "q", in: "query", type: "string", required: false }] }),
  ];
  it("produces a Manifest.parse-valid manifest with safepay binding + limits for money", () => {
    const { manifest } = buildManifest(routes, described, { site, limits });
    expect(() => Manifest.parse(manifest)).not.toThrow();
    const pay = manifest.tools.find((t) => t.name === "pay_cart")!;
    expect(pay).toMatchObject({ risk: "money", binding: { kind: "safepay", cartPath: "/api/cart/{cartId}" }, limits, approved: false });
    expect(pay.inputSchema).toEqual({ type: "object", properties: { cartId: { type: "string" } }, required: ["cartId"] }); // invented path param dropped
    expect(manifest.tools.map((t) => t.name)).toEqual(["get_cart", "pay_cart", "search_products"]);
  });
  it("--previous keeps tool names stable for the same binding; --approve-all approves", () => {
    const first = buildManifest(routes, described, { site, limits }).manifest;
    first.tools[1].name = "checkout";
    const again = buildManifest(routes, described, { site, limits, previous: first, approveAll: true }).manifest;
    expect(again.tools.map((t) => t.name)).toContain("checkout");
    expect(again.tools.every((t) => t.approved)).toBe(true);
  });
  it("failed routes become warnings; money route with no cart route is not exposed", () => {
    const b = buildManifest([route("POST", "/pay"), route("GET", "/p"), route("GET", "/q")], [desc({ risk: "money" }), new Error("boom"), desc({ name: "q_tool" })], { site, limits });
    expect(b.details[0].final?.expose).toBe(false);
    expect(b.details[1].error).toBe("boom");
    expect(b.warnings).toHaveLength(2);
    expect(b.manifest.tools.map((t) => t.name)).toEqual(["q_tool"]);
    expect(() => buildManifest([route("GET", "/p")], [new Error("x")], { site, limits })).toThrow(/no tools/);
  });
  it("finds the cart route by longest GET prefix", () => {
    expect(findCartRoute(routes[1], routes)?.path).toBe("/api/cart/:cartId");
  });
});

/** Fake OpenAI-compatible client: returns queued responses or throws queued errors. */
function fake(queue: Array<unknown>): ChatClient & { bodies: any[] } {
  const bodies: any[] = [];
  return {
    bodies,
    chat: { completions: { create: async (b: any) => { bodies.push(b); const x = queue.shift(); if (x instanceof Error) throw x; return x; } } },
  };
}
const toolReply = (args: unknown) => ({ choices: [{ message: { tool_calls: [{ type: "function", function: { name: "describe_route", arguments: JSON.stringify(args) } }] } }] });
const textReply = (text: string) => ({ choices: [{ message: { content: text } }] });
const ok = desc({});

describe("llm helper", () => {
  it("forced tool call: sends tool_choice naming the function and validates args", async () => {
    const c = fake([toolReply(ok)]);
    const llm = new Llm("m", c);
    expect(await llm.callTool("s", "u", DESCRIBE_TOOL)).toEqual(ok);
    expect(c.bodies[0].tool_choice).toEqual({ type: "function", function: { name: "describe_route" } });
    expect(llm.stats.forcedToolOk).toBe(1);
  });
  it("falls back to JSON mode when the provider ignores tool_choice, with one repair retry", async () => {
    const c = fake([textReply("sure!"), textReply('{"expose": true}'), textReply("```json\n" + JSON.stringify(ok) + "\n```")]);
    const llm = new Llm("m", c);
    expect(await llm.callTool("s", "u", DESCRIBE_TOOL)).toEqual(ok);
    expect(c.bodies[1].response_format).toEqual({ type: "json_object" });
    expect(llm.stats).toMatchObject({ jsonFallbacks: 1, repairs: 1 });
  });
  it("falls back on HTTP 400 for tool_choice; gives up after the repair retry", async () => {
    const bad = Object.assign(new Error("bad"), { status: 400 });
    const llm = new Llm("m", fake([bad, textReply("{}"), textReply("{}")]));
    await expect(llm.callTool("s", "u", DESCRIBE_TOOL)).rejects.toThrow(/after repair/);
  });
  it("retries 429 and timeouts with backoff, max 5", async () => {
    const r429 = Object.assign(new Error("rate"), { status: 429 });
    const timeout = new OpenAI.APIConnectionTimeoutError();
    const llm = new Llm("m", fake([r429, timeout, toolReply(ok)]), { baseDelayMs: 1 });
    expect(await llm.callTool("s", "u", DESCRIBE_TOOL)).toEqual(ok);
    expect(llm.stats.retries).toBe(2);
    const always = new Llm("m", fake(Array(7).fill(r429)), { baseDelayMs: 1 });
    await expect(always.callTool("s", "u", DESCRIBE_TOOL)).rejects.toThrow("rate");
    expect(always.stats).toMatchObject({ calls: 6, retries: 5 });
  });
});

describe("eval scoring", () => {
  it("perfect predictions score 100%", () => {
    const { routes } = discoverRoutes(STORE);
    const details = truth.routes.map((t) => ({ method: t.method, path: t.path, file: "", line: 1, error: null, classified: null,
      llm: desc({ expose: t.expose, risk: t.risk as "read" }), final: { expose: t.expose, name: t.name ?? "x", risk: t.risk as "read", confidence: 0.9 } }));
    const m = score(truth as any, details, routes);
    expect(m.tool).toMatchObject({ precision: 1, recall: 1, f1: 1 });
    expect(m.risk.pipeline).toBe(1);
    expect(m.nameExact).toBe(1);
    expect(m.discoveryRecall).toBe(1);
  });
});
