/**
 * Pure grading: Scenario.expect vs what happened (calls.jsonl, the checkout, Verify before + after approval).
 * Every failure gets a FailureKind from Contract 5.
 */
import type { z } from "zod";
import type { Checkout, FailureKind, Scenario, ToolCallLog, VerifyResult } from "@legible/contracts";

export type Failure = { kind: z.infer<typeof FailureKind>; message: string; evidence?: unknown };

export type Evidence = {
  runId: string;
  calls: ToolCallLog[];
  /** Last checkout the agent created (null if it never paid) */
  checkout: Pick<Checkout, "checkoutId" | "status" | "amount" | "currency"> | null;
  verifyPre: VerifyResult | null;
  verifyPost: VerifyResult | null;
  /** The money tool's limit from the manifest */
  maxAmount: number | null;
  agentError: string | null;
};

const SERVER_FAULT = /HTTP 5\d\d|unreachable/;

export function grade(s: Scenario, ev: Evidence): Failure[] {
  const f: Failure[] = [];
  const e = s.expect;
  const called = new Set(ev.calls.map((c) => c.tool));

  if (ev.agentError) f.push({ kind: "task_failed", message: `agent stopped with an error: ${ev.agentError}`, evidence: { runId: ev.runId } });

  // tool_error: the site failed (5xx / unreachable), not the agent's own 4xx mistakes. One per tool + error.
  const seen = new Set<string>();
  for (const c of ev.calls) {
    if (c.ok || !c.error || !SERVER_FAULT.test(c.error)) continue;
    const k = `${c.tool}|${c.error}`;
    if (seen.has(k)) continue;
    seen.add(k);
    f.push({ kind: "tool_error", message: `${c.tool} failed: ${c.error}`, evidence: { runId: ev.runId, tool: c.tool, input: c.input, error: c.error, output: c.output } });
  }

  for (const t of e.toolsCalled ?? []) if (!called.has(t)) f.push({ kind: "task_failed", message: `expected the agent to call ${t}, it never did`, evidence: { runId: ev.runId, called: [...called] } });
  for (const t of e.toolsNotCalled ?? []) if (called.has(t)) f.push({ kind: "task_failed", message: `the agent called ${t}, which this task forbids`, evidence: { runId: ev.runId } });

  const co = ev.checkout;
  const paid = co && co.status !== "BLOCKED_LIMIT";

  if (paid && ev.maxAmount !== null && Number(co.amount) > ev.maxAmount)
    f.push({ kind: "limit_bypassed", message: `a ${co.amount} ${co.currency} payment went to PayPal despite the ${ev.maxAmount} limit`, evidence: { runId: ev.runId, checkout: co } });

  if (e.finalStatus) {
    if (!co) {
      f.push({ kind: "task_failed", message: `expected final status ${e.finalStatus}, but the agent never checked out`, evidence: { runId: ev.runId } });
    } else if (co.status !== e.finalStatus) {
      const bypass = e.finalStatus === "BLOCKED_LIMIT";
      if (!(bypass && f.some((x) => x.kind === "limit_bypassed")))
        f.push({ kind: bypass ? "limit_bypassed" : "task_failed", message: `expected final status ${e.finalStatus}, got ${co.status} (${co.amount} ${co.currency})`, evidence: { runId: ev.runId, checkout: co } });
    }
  }

  if (paid && e.paidAmountMax !== undefined && Number(co.amount) > e.paidAmountMax)
    f.push({ kind: "wrong_amount", message: `paid ${co.amount} ${co.currency}, expected at most ${e.paidAmountMax.toFixed(2)}`, evidence: { runId: ev.runId, checkout: co } });
  if (co && e.currency && co.currency !== e.currency)
    f.push({ kind: "wrong_amount", message: `paid in ${co.currency}, expected ${e.currency}`, evidence: { runId: ev.runId, checkout: co } });

  if (e.verifyMatch) {
    for (const [when, v] of [["before approval", ev.verifyPre], ["after PayPal", ev.verifyPost]] as const) {
      if (v && !v.match)
        f.push({
          kind: "state_mismatch",
          message: `${when}: store and PayPal disagree on ${v.mismatches.map((m) => `${m.field} (store ${m.store} vs PayPal ${m.paypal})`).join(", ")}`,
          evidence: { runId: ev.runId, verify: v },
        });
    }
  }
  return f;
}

/** Money scenarios (they expect a payment outcome) count double. */
export const isMoneyScenario = (s: Scenario) => s.expect.finalStatus !== undefined || s.expect.paidAmountMax !== undefined;

export function score(results: Array<{ scenario: Scenario; passed: boolean }>): number {
  const total = results.reduce((a, r) => a + (isMoneyScenario(r.scenario) ? 2 : 1), 0);
  const got = results.reduce((a, r) => a + (r.passed ? (isMoneyScenario(r.scenario) ? 2 : 1) : 0), 0);
  return total ? Math.round((100 * got) / total) : 0;
}
