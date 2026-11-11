import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { Report, Scenario, type ToolCallLog, type VerifyResult } from "@legible/contracts";
import { grade, isMoneyScenario, score, type Evidence } from "../src/grade.js";
import { runAgent } from "../src/agent.js";

const dir = fileURLToPath(new URL("../../../fixtures/scenarios/", import.meta.url));
const S = Object.fromEntries(readdirSync(dir).map((f) => { const s = Scenario.parse(parseYaml(readFileSync(dir + f, "utf8"))); return [s.id, s]; }));

const call = (tool: string, ok = true, error: string | null = null): ToolCallLog => ({ runId: "r", ts: new Date().toISOString(), tool, input: {}, ok, output: null, error, ms: 1 });
const verify = (match: boolean, store = "pending", paypal = "PAYER_ACTION_REQUIRED"): VerifyResult => ({
  checkoutId: "chk", paypal: { status: paypal, amount: "28.20", currency: "USD" }, store: { status: store, amount: "28.20", currency: "USD" },
  match, mismatches: match ? [] : [{ field: "status", paypal, store }],
});
const happyCalls = ["search_products", "create_cart", "add_to_cart", "apply_coupon", "checkout"].map((t) => call(t));
const ev = (over: Partial<Evidence>): Evidence => ({
  runId: "r", calls: happyCalls, checkout: { checkoutId: "chk", status: "CAPTURED", amount: "28.20", currency: "USD" },
  verifyPre: verify(true), verifyPost: verify(true, "paid", "COMPLETED"), maxAmount: 100, agentError: null, ...over,
});
const kinds = (f: ReturnType<typeof grade>) => f.map((x) => x.kind).sort();

describe("grade", () => {
  it("happy path passes", () => expect(grade(S["buy-hoodie-coupon"], ev({}))).toEqual([]));

  it("BUG_COUPON_API: 500 on apply_coupon + paying full price → tool_error + wrong_amount", () => {
    const calls = [call("search_products"), call("create_cart"), call("add_to_cart"), call("apply_coupon", false, "HTTP 500 from POST /api/cart/c/coupon: boom"), call("checkout")];
    const f = grade(S["buy-hoodie-coupon"], ev({ calls, checkout: { checkoutId: "chk", status: "CAPTURED", amount: "34.00", currency: "USD" } }));
    expect(kinds(f)).toEqual(["tool_error", "wrong_amount"]);
  });

  it("BUG_COUPON_API: agent stops instead of paying → tool_error + task_failed", () => {
    const calls = [call("search_products"), call("create_cart"), call("add_to_cart"), call("apply_coupon", false, "HTTP 500 from …")];
    expect(kinds(grade(S["buy-hoodie-coupon"], ev({ calls, checkout: null, verifyPre: null, verifyPost: null })))).toEqual(["task_failed", "task_failed", "tool_error"]);
  });

  it("agent 4xx mistakes are not tool_errors", () => {
    const calls = [...happyCalls, call("add_to_cart", false, "HTTP 400 from POST …: size required")];
    expect(grade(S["buy-hoodie-coupon"], ev({ calls }))).toEqual([]);
  });

  it("BUG_PAID_EARLY: Verify before approval disagrees → state_mismatch", () => {
    const f = grade(S["hoodie-no-coupon"], ev({ calls: ["search_products", "create_cart", "add_to_cart", "checkout"].map((t) => call(t)), checkout: { checkoutId: "chk", status: "CAPTURED", amount: "34.00", currency: "USD" }, verifyPre: verify(false, "paid") }));
    expect(kinds(f)).toEqual(["state_mismatch"]);
    expect(f[0].message).toMatch(/before approval.*store paid vs PayPal PAYER_ACTION_REQUIRED/);
  });

  it("toolsNotCalled violated → task_failed", () => {
    expect(kinds(grade(S["hoodie-no-coupon"], ev({ checkout: { checkoutId: "c", status: "CAPTURED", amount: "34.00", currency: "USD" } })))).toEqual(["task_failed"]);
  });

  it("over-limit: BLOCKED_LIMIT passes; a captured over-limit payment is limit_bypassed (once)", () => {
    const blocked = { checkoutId: "c", status: "BLOCKED_LIMIT" as const, amount: "321.00", currency: "USD" };
    expect(grade(S["over-limit"], ev({ calls: [call("checkout")], checkout: blocked, verifyPre: null, verifyPost: null }))).toEqual([]);
    const f = grade(S["over-limit"], ev({ calls: [call("checkout")], checkout: { ...blocked, status: "CAPTURED" } }));
    expect(kinds(f)).toEqual(["limit_bypassed"]);
  });

  it("over-limit: agent never tries to pay → task_failed", () => {
    expect(kinds(grade(S["over-limit"], ev({ calls: [], checkout: null })))).toEqual(["task_failed"]);
  });

  it("declined-payment: DECLINED + store failed passes; CAPTURED fails", () => {
    const d = { checkoutId: "c", status: "DECLINED" as const, amount: "34.00", currency: "USD" };
    const calls = ["create_cart", "add_to_cart", "checkout"].map((t) => call(t));
    expect(grade(S["declined-payment"], ev({ calls, checkout: d, verifyPost: verify(true, "failed", "APPROVED") }))).toEqual([]);
    expect(kinds(grade(S["declined-payment"], ev({ calls, checkout: { ...d, status: "CAPTURED" } })))).toEqual(["task_failed"]);
  });

  it("agent/harness errors → task_failed", () => {
    expect(kinds(grade(S["buy-hoodie-coupon"], ev({ agentError: "hit the 25-step limit" })))).toEqual(["task_failed"]);
  });
});

describe("score", () => {
  it("money scenarios count 2x", () => {
    expect(isMoneyScenario(S["over-limit"])).toBe(true);
    const plain = Scenario.parse({ id: "browse", site: "demo-store", task: "Find the cheapest hoodie", expect: { toolsCalled: ["search_products"] } });
    expect(score([{ scenario: S["over-limit"], passed: true }, { scenario: plain, passed: false }])).toBe(67);
    expect(score([{ scenario: S["over-limit"], passed: false }, { scenario: plain, passed: true }])).toBe(33);
  });
  it("produces a Report.parse-valid report", () => {
    const f = grade(S["buy-hoodie-coupon"], ev({ verifyPre: verify(false, "paid") }));
    expect(() => Report.parse({ runId: "r", siteId: "demo-store", createdAt: new Date().toISOString(), score: 50, scenarios: [{ id: "x", agent: "m", passed: false, failures: f }] })).not.toThrow();
  });
});

describe("agent loop", () => {
  const tools = [{ name: "search_products", inputSchema: { type: "object" } }, { name: "checkout", inputSchema: { type: "object" } }];
  it("executes tool calls, feeds results + harness notes back, stops on an answer", async () => {
    const seen: unknown[][] = [];
    const replies = [
      { content: null, tool_calls: [{ id: "1", type: "function", function: { name: "search_products", arguments: '{"q":"hoodie"}' } }] },
      { content: "", tool_calls: [{ id: "2", type: "function", function: { name: "checkout", arguments: '{"cartId":"c1"}' } }] },
      { content: "Bought it.", tool_calls: [] },
    ];
    const run = await runAgent("buy a hoodie", {
      chat: async (m) => (seen.push(structuredClone(m)), replies.shift()!),
      tools,
      callTool: async (name, args) => ({ text: JSON.stringify({ name, args }), isError: false }),
      afterTool: async (name) => (name === "checkout" ? "Payment update: captured." : null),
    });
    expect(run).toMatchObject({ steps: 3, stoppedBy: "answer", final: "Bought it." });
    const last = seen[2] as any[];
    expect(last.at(-1)).toMatchObject({ role: "tool", tool_call_id: "2" });
    expect(last.at(-1).content).toContain("Payment update: captured.");
    expect(run.transcript.map((t) => t.kind)).toEqual(["tool", "tool", "answer"]);
  });
  it("bad JSON arguments become a tool error, not a crash; max steps enforced", async () => {
    const run = await runAgent("x", {
      chat: async () => ({ content: null, tool_calls: [{ id: "1", type: "function", function: { name: "search_products", arguments: "{oops" } }] }),
      tools,
      callTool: async () => ({ text: "never", isError: false }),
      maxSteps: 3,
    });
    expect(run.stoppedBy).toBe("max_steps");
    expect(run.transcript[0]).toMatchObject({ isError: true });
  });
  it("provider rejects the model's tool args (Groq 400): the model is told why and retries, max 2 times", async () => {
    const reject = () => Object.assign(new Error("400 Tool call validation failed: parameters for tool search_products did not match schema: errors: [`/maxPrice`: expected number, but got null]"), { status: 400 });
    const seen: any[][] = [];
    const replies: Array<() => any> = [
      () => { throw reject(); },
      () => ({ content: null, tool_calls: [{ id: "1", type: "function", function: { name: "search_products", arguments: '{"q":"hoodie"}' } }] }),
      () => ({ content: "Done.", tool_calls: [] }),
    ];
    const run = await runAgent("x", { chat: async (m) => (seen.push(structuredClone(m)), replies.shift()!()), tools, callTool: async () => ({ text: "{}", isError: false }) });
    expect(run).toMatchObject({ stoppedBy: "answer", final: "Done." });
    expect(seen[1].at(-1)).toMatchObject({ role: "user" });
    expect(seen[1].at(-1).content).toMatch(/Omit optional parameters instead of sending null/);

    const always = await runAgent("x", { chat: async () => { throw reject(); }, tools, callTool: async () => ({ text: "", isError: false }) });
    expect(always).toMatchObject({ stoppedBy: "error", steps: 3 });
  });

  it("LLM errors stop the run with stoppedBy=error", async () => {
    const run = await runAgent("x", { chat: async () => { throw new Error("429 forever"); }, tools, callTool: async () => ({ text: "", isError: false }) });
    expect(run).toMatchObject({ stoppedBy: "error", error: "429 forever" });
  });
});
