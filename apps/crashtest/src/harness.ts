/**
 * One scenario: new runId → MCP client (x-legible-run) → agent loop → on PENDING_APPROVAL: Verify, approve via
 * Safe Pay's test route (a simulated decline via PayPal negative testing when the scenario expects DECLINED), Verify again → grade from calls.jsonl + Verify.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Checkout, ROUTES, RUN_HEADER, ToolCallLog, VerifyResult, type Manifest, type Scenario } from "@legible/contracts";
import { runAgent, type AgentRun, type ToolResult } from "./agent.js";
import { grade, type Evidence, type Failure } from "./grade.js";
import type { Llm } from "./llm.js";

export type HarnessCtx = { publisherUrl: string; safepayUrl: string; runsDir: string; manifest: Manifest; llm: Pick<Llm, "chat">; maxSteps: number; suiteId: string; log: (m: string) => void };
export type ScenarioOutcome = { scenario: Scenario; runId: string; passed: boolean; failures: Failure[]; evidence: Evidence; agent: Omit<AgentRun, "transcript"> };

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${new URL(url).pathname} → HTTP ${res.status} ${JSON.stringify(body)}`);
  return body;
}

export async function runScenario(scenario: Scenario, ctx: HarnessCtx): Promise<ScenarioOutcome> {
  const runId = `${ctx.suiteId}_${scenario.id}`;
  const sp = (route: string, id: string) => ctx.safepayUrl + route.replace(/:(id|checkoutId)/, encodeURIComponent(id));
  const moneyTools = new Set(ctx.manifest.tools.filter((t) => t.risk === "money").map((t) => t.name));
  const maxAmount = ctx.manifest.tools.find((t) => t.risk === "money")?.limits?.maxAmount ?? null;
  const ev: Evidence = { runId, calls: [], checkout: null, verifyPre: null, verifyPost: null, maxAmount, agentError: null };
  const harnessErrors: string[] = [];

  const client = new Client({ name: "legible-crashtest", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${ctx.publisherUrl}/mcp`), { requestInit: { headers: { [RUN_HEADER]: runId } } }));
  const tools = (await client.listTools()).tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown> }));

  const callTool = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
    const r: any = await client.callTool({ name, arguments: args });
    return { text: r.content?.map((c: any) => c.text ?? "").join("\n") ?? "", isError: !!r.isError };
  };

  /** The human-in-the-loop step, automated for the test only: the sandbox buyer approves; a "decline" is PayPal's negative-testing mock on the capture. */
  const afterTool = async (name: string, _args: Record<string, unknown>, result: ToolResult): Promise<string | null> => {
    if (!moneyTools.has(name) || result.isError) return null;
    let out: any;
    try {
      out = JSON.parse(result.text);
    } catch {
      return null;
    }
    if (!out?.checkoutId) return null;
    ev.checkout = { checkoutId: out.checkoutId, status: out.status, amount: out.amount, currency: out.currency };
    if (out.status !== "PENDING_APPROVAL") return null;
    try {
      ev.verifyPre = VerifyResult.parse(await getJson(sp(ROUTES.safepay.verify, out.checkoutId)));
      const decline = scenario.expect.finalStatus === "DECLINED";
      ctx.log(decline ? `  PayPal Sandbox: simulated decline (PayPal negative testing) of ${out.amount} ${out.currency}…` : `  PayPal Sandbox: approving ${out.amount} ${out.currency} as the test buyer…`);
      const done = Checkout.parse(await getJson(sp(ROUTES.safepay.testApprove, out.checkoutId) + (decline ? "?outcome=decline" : ""), { method: "POST" }));
      ev.checkout = { checkoutId: done.checkoutId, status: done.status, amount: done.amount, currency: done.currency };
      ev.verifyPost = VerifyResult.parse(await getJson(sp(ROUTES.safepay.verify, out.checkoutId)));
      return done.status === "CAPTURED"
        ? `Payment update: the human approved in PayPal and the payment was captured (${done.amount} ${done.currency}). The order is paid.`
        : `Payment update: PayPal finished with status ${done.status}. No money was taken.`;
    } catch (e) {
      const msg = (e as Error).message;
      harnessErrors.push(msg.includes("HTTP 404") && msg.includes("test/approve") ? `Safe Pay test approval unavailable (start Safe Pay with SAFEPAY_TEST_MODE=1): ${msg}` : msg);
      return `Payment update: approval could not be completed (${msg.slice(0, 120)}).`;
    }
  };

  let run: AgentRun;
  try {
    run = await runAgent(scenario.task, { chat: (m, t) => ctx.llm.chat(m, t), tools, callTool, afterTool, maxSteps: ctx.maxSteps, log: (m) => ctx.log(`  ${m}`) });
  } finally {
    await client.close().catch(() => {});
  }

  const callsFile = join(ctx.runsDir, runId, "calls.jsonl");
  ev.calls = existsSync(callsFile) ? readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean).map((l) => ToolCallLog.parse(JSON.parse(l))) : [];
  ev.agentError = [run.error, run.stoppedBy === "max_steps" ? `hit the ${ctx.maxSteps}-step limit` : null, ...harnessErrors.map((h) => `harness: ${h}`)].filter(Boolean).join("; ") || null;

  const failures = grade(scenario, ev);
  mkdirSync(join(ctx.runsDir, runId), { recursive: true });
  writeFileSync(join(ctx.runsDir, runId, "transcript.json"), JSON.stringify({ scenario, runId, agent: run, evidence: { ...ev, calls: undefined }, failures }, null, 2) + "\n");
  const { transcript: _t, ...agent } = run;
  return { scenario, runId, passed: failures.length === 0, failures, evidence: ev, agent };
}
