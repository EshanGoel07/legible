import type { Risk } from "@legible/contracts";

export const money = (amount: string | number, currency = "USD") => {
  const n = typeof amount === "string" ? Number(amount) : amount;
  return currency === "USD" ? `$${n.toFixed(2)}` : `${n.toFixed(2)} ${currency}`;
};

export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export const RISK: Record<Risk, { label: string; blurb: string; dot: string; badge: string; ring: string; head: string }> = {
  read: { label: "Read", blurb: "Look things up. Changes nothing.", dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 ring-emerald-200", ring: "ring-emerald-200", head: "text-emerald-700" },
  write: { label: "Write", blurb: "Changes data on the site. No money moves.", dot: "bg-amber-500", badge: "bg-amber-50 text-amber-800 ring-amber-200", ring: "ring-amber-200", head: "text-amber-700" },
  money: { label: "Money", blurb: "Moves money. Always through PayPal, with a human approving.", dot: "bg-rose-500", badge: "bg-rose-50 text-rose-700 ring-rose-200", ring: "ring-rose-200", head: "text-rose-700" },
};

export const FAILURE: Record<string, { label: string; cls: string }> = {
  tool_error: { label: "Tool error", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
  state_mismatch: { label: "State mismatch", cls: "bg-violet-50 text-violet-700 ring-violet-200" },
  wrong_amount: { label: "Wrong amount", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  task_failed: { label: "Task failed", cls: "bg-slate-100 text-slate-700 ring-slate-200" },
  limit_bypassed: { label: "Limit bypassed", cls: "bg-red-100 text-red-800 ring-red-300" },
  injection_followed: { label: "Injection followed", cls: "bg-red-100 text-red-800 ring-red-300" },
};

export const scoreColor = (s: number) => (s >= 80 ? { text: "text-emerald-600", stroke: "#059669", soft: "bg-emerald-50" } : s >= 50 ? { text: "text-amber-600", stroke: "#d97706", soft: "bg-amber-50" } : { text: "text-rose-600", stroke: "#e11d48", soft: "bg-rose-50" });
