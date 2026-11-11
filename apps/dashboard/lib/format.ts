import type { Risk } from "@legible/contracts";

export const money = (amount: string | number, currency = "USD") => {
  const n = typeof amount === "string" ? Number(amount) : amount;
  return currency === "USD" ? `$${n.toFixed(2)}` : `${n.toFixed(2)} ${currency}`;
};

export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const RISK: Record<Risk, { label: string; blurb: string; dot: string; badge: string; ring: string; head: string }> = {
  read: { label: "Read", blurb: "Look things up. Changes nothing.", dot: "bg-slate-400", badge: "bg-slate-100 text-slate-700 ring-slate-300", ring: "ring-slate-300", head: "text-slate-700" },
  write: { label: "Write", blurb: "Changes data on the site. No money moves.", dot: "bg-warn", badge: "bg-warn/10 text-[#8a4f10] ring-warn/40", ring: "ring-warn/40", head: "text-[#8a4f10]" },
  money: { label: "Money", blurb: "Moves money. Always through PayPal, with a human approving.", dot: "bg-guard", badge: "bg-guard/10 text-guard ring-guard/30", ring: "ring-guard/40", head: "text-guard" },
};

/** Red is reserved for failures; the two "the guard itself was beaten" kinds are solid. */
export const FAILURE: Record<string, { label: string; cls: string }> = {
  tool_error: { label: "Tool error", cls: "bg-fail/10 text-[#b4232a] ring-fail/40" },
  state_mismatch: { label: "State mismatch", cls: "bg-fail/10 text-[#b4232a] ring-fail/40" },
  wrong_amount: { label: "Wrong amount", cls: "bg-fail/10 text-[#b4232a] ring-fail/40" },
  task_failed: { label: "Task failed", cls: "bg-slate-100 text-slate-700 ring-slate-300" },
  limit_bypassed: { label: "Limit bypassed", cls: "bg-fail text-white ring-fail" },
  injection_followed: { label: "Injection followed", cls: "bg-fail text-white ring-fail" },
};

export const scoreColor = (s: number) => (s >= 80 ? { text: "text-pass", stroke: "#12a594", soft: "bg-pass/10" } : s >= 50 ? { text: "text-warn", stroke: "#d9822b", soft: "bg-warn/10" } : { text: "text-fail", stroke: "#e5484d", soft: "bg-fail/10" });

/** True when `reason` mostly repeats `description` (the scanner sometimes restates it); then the card shows it once. */
export function repeats(reason: string, description: string): boolean {
  const words = (t: string) => t.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const r = words(reason).filter((w) => w.length > 2);
  if (!r.length) return true;
  const d = new Set(words(description));
  return r.filter((w) => d.has(w)).length / r.length >= 0.75;
}
