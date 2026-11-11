/**
 * Stage 3 — Classify risk: deterministic rules first, the LLM's tier confirms.
 * Agreement keeps the model's confidence; disagreement takes the MORE cautious tier and lowers confidence,
 * so the dashboard flags it for human review.
 */
import type { Risk } from "@legible/contracts";
import type { DiscoveredRoute } from "./discover.js";

const MONEY_WORDS = /\b(pay|payments?|orders?|checkouts?|paypal|safepay|capture|refunds?|charge|invoices?)\b/i;
const SEVERITY: Record<Risk, number> = { read: 0, write: 1, money: 2 };
export const DISAGREEMENT_FACTOR = 0.6;

export type RuleVerdict = { risk: Risk; reason: string };

/** Money words in the path or the handler → money; GET → read; anything else → write. */
export function ruleRisk(r: Pick<DiscoveredRoute, "method" | "path" | "handlerSource">): RuleVerdict {
  // Split camelCase so identifiers like safepayUrl / createOrder count as words.
  const text = `${r.path.replace(/[/:]/g, " ")} ${r.handlerSource}`.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  const hit = text.match(MONEY_WORDS);
  if (hit) return { risk: "money", reason: `mentions "${hit[0]}"` };
  if (r.method === "GET") return { risk: "read", reason: "GET" };
  return { risk: "write", reason: `${r.method} without payment terms` };
}

export type Classified = { risk: Risk; confidence: number; agreed: boolean; riskReason: string; rule: RuleVerdict };

export function classify(route: DiscoveredRoute, llm: { risk: Risk; riskReason: string; confidence: number }): Classified {
  const rule = ruleRisk(route);
  if (rule.risk === llm.risk) return { risk: llm.risk, confidence: round(llm.confidence), agreed: true, riskReason: llm.riskReason, rule };
  const risk = SEVERITY[rule.risk] > SEVERITY[llm.risk] ? rule.risk : llm.risk;
  return {
    risk,
    confidence: round(llm.confidence * DISAGREEMENT_FACTOR),
    agreed: false,
    riskReason: `Review: rules said ${rule.risk} (${rule.reason}), model said ${llm.risk} (${llm.riskReason}); using ${risk}.`,
    rule,
  };
}

const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
