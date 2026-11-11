/**
 * Turns a Crash Test transcript into the timeline the report shows: tool calls, the limit gate,
 * the PayPal approval and the two Verify checks (before approval, after PayPal). Pure, no I/O.
 */
import { z } from "zod";
import type { Risk } from "@legible/contracts";
import type { TranscriptEntry } from "./data";

export type TraceTone = Risk | "fail" | "pass" | "neutral";
export type TraceStep = {
  kind: "tool" | "gate" | "paypal" | "verify";
  label: string;
  tone: TraceTone;
  /** Pretty-printed tool arguments (tool steps only) */
  args?: string;
  /** Tool result, PayPal outcome or Verify summary; clipped */
  detail?: string;
};

const Verify = z.object({ match: z.boolean(), mismatches: z.array(z.object({ field: z.string(), paypal: z.string(), store: z.string() })).default([]) });
const clip = (s: string, n = 900) => (s.length > n ? `${s.slice(0, n)}\n… [${s.length - n} more characters]` : s);

function verifyStep(when: string, raw: unknown): TraceStep | null {
  const v = Verify.safeParse(raw);
  if (!v.success) return null;
  return {
    kind: "verify",
    label: `Verify · ${when}`,
    tone: v.data.match ? "pass" : "fail",
    detail: v.data.match ? "Store and PayPal agree on status, amount and currency." : v.data.mismatches.map((m) => `${m.field}: store says ${m.store}, PayPal says ${m.paypal}`).join("\n"),
  };
}

export function buildTrace(entries: TranscriptEntry[], ctx: { riskByTool: Record<string, Risk>; verifyPre?: unknown; verifyPost?: unknown }): TraceStep[] {
  const out: TraceStep[] = [];
  for (const e of entries) {
    if (e.kind !== "tool" || !e.tool) continue;
    const risk = ctx.riskByTool[e.tool];
    out.push({ kind: "tool", label: e.tool, tone: e.isError ? "fail" : risk ?? "neutral", args: JSON.stringify(e.args ?? {}, null, 2), detail: clip(e.result ?? "") });

    if (risk === "money" && !e.isError) {
      let status: string | undefined;
      let message: string | undefined;
      try {
        const r = JSON.parse(e.result ?? "") as { status?: string; message?: string };
        status = r.status;
        message = r.message;
      } catch {
        /* result was clipped or not JSON */
      }
      if (status === "BLOCKED_LIMIT") out.push({ kind: "gate", label: "Limit gate · blocked", tone: "money", detail: message ?? "Over the spending limit. No PayPal order was created." });
    }

    if (e.note) {
      const pre = verifyStep("before approval", ctx.verifyPre);
      if (pre) out.push(pre);
      const label = /captured/i.test(e.note) ? "PayPal · approved, captured" : /DECLINED/.test(e.note) ? "PayPal · simulated decline" : "PayPal approval";
      out.push({ kind: "paypal", label, tone: "money", detail: e.note });
      const post = verifyStep("after PayPal", ctx.verifyPost);
      if (post) out.push(post);
    }
  }
  return out;
}
