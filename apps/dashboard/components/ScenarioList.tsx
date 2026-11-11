"use client";
import { useState } from "react";
import { FAILURE, money } from "@/lib/format";
import { Pill } from "@/components/ui";

export type ScenarioRowData = {
  id: string;
  agent: string;
  passed: boolean;
  failures: Array<{ kind: string; message: string; evidence?: unknown }>;
  task: string | null;
  checkout: { status: string; amount: string; currency: string } | null;
  steps: number | null;
  final: string | null;
  runId: string | null;
};

const STATUS_LABEL: Record<string, string> = { CAPTURED: "PayPal captured", DECLINED: "PayPal declined", BLOCKED_LIMIT: "Blocked by limit", PENDING_APPROVAL: "Awaiting approval", APPROVED: "Approved, not captured" };

const STATUS: Record<string, string> = {
  CAPTURED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  DECLINED: "bg-slate-100 text-slate-700 ring-slate-200",
  BLOCKED_LIMIT: "bg-sky-50 text-sky-700 ring-sky-200",
  PENDING_APPROVAL: "bg-amber-50 text-amber-800 ring-amber-200",
  APPROVED: "bg-amber-50 text-amber-800 ring-amber-200",
};

export function ScenarioList({ rows }: { rows: ScenarioRowData[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="space-y-3">
      {rows.map((s) => {
        const isOpen = !!open[s.id];
        const kinds = [...new Set(s.failures.map((f) => f.kind))];
        return (
          <div key={s.id} className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${s.passed ? "border-slate-200" : "border-rose-200"}`}>
            <button onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))} className="flex w-full items-center gap-5 px-6 py-5 text-left hover:bg-slate-50/70" aria-expanded={isOpen}>
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg font-bold ${s.passed ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{s.passed ? "✓" : "✗"}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[17px] font-semibold">{s.id}</span>
                  {kinds.map((k) => <Pill key={k} className={FAILURE[k]?.cls ?? "bg-slate-100 text-slate-700 ring-slate-200"}>{FAILURE[k]?.label ?? k}</Pill>)}
                </div>
                {s.task && <div className="mt-0.5 truncate text-[15px] text-slate-600">&ldquo;{s.task}&rdquo;</div>}
              </div>
              {s.checkout && (
                <Pill className={STATUS[s.checkout.status] ?? "bg-slate-100 text-slate-700 ring-slate-200"}>
                  {STATUS_LABEL[s.checkout.status] ?? s.checkout.status} · {money(s.checkout.amount, s.checkout.currency)}
                </Pill>
              )}
              {s.steps !== null && <span className="w-16 text-right text-sm tabular-nums text-slate-500">{s.steps} steps</span>}
              <svg viewBox="0 0 20 20" className={`h-5 w-5 shrink-0 text-slate-400 transition ${isOpen ? "rotate-180" : ""}`} fill="currentColor"><path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" /></svg>
            </button>
            {isOpen && (
              <div className="border-t border-slate-100 bg-slate-50/50 px-6 py-5">
                {s.failures.length === 0 ? (
                  <p className="text-[15px] text-emerald-700">Passed every check: tools called, amount, PayPal status, and PayPal vs store records.</p>
                ) : (
                  <ul className="space-y-4">
                    {s.failures.map((f, i) => (
                      <li key={i} className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="flex items-start gap-3">
                          <Pill className={FAILURE[f.kind]?.cls ?? "bg-slate-100 text-slate-700 ring-slate-200"}>{FAILURE[f.kind]?.label ?? f.kind}</Pill>
                          <p className="text-[15px] text-slate-800">{f.message}</p>
                        </div>
                        <Evidence evidence={f.evidence} />
                      </li>
                    ))}
                  </ul>
                )}
                {s.final && <p className="mt-4 text-sm text-slate-600"><span className="font-semibold text-slate-700">Agent&apos;s last words:</span> {s.final}</p>}
                <p className="mt-2 text-xs text-slate-400">agent {s.agent}{s.runId && <> · calls in <span className="font-mono">runs/{s.runId}/calls.jsonl</span></>}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

type VerifySide = { status: string; amount: string; currency: string };
function Evidence({ evidence }: { evidence: unknown }) {
  if (!evidence || typeof evidence !== "object") return null;
  const e = evidence as { verify?: { paypal: VerifySide; store: VerifySide; mismatches?: Array<{ field: string }> }; tool?: string; error?: string };
  return (
    <div className="mt-3 space-y-3 pl-1">
      {e.verify && (
        <table className="w-full max-w-xl text-sm">
          <thead className="text-left text-slate-500"><tr><th className="pb-1 font-medium">Field</th><th className="pb-1 font-medium">Store says</th><th className="pb-1 font-medium">PayPal says</th></tr></thead>
          <tbody>
            {(["status", "amount", "currency"] as const).map((k) => {
              const bad = e.verify!.mismatches?.some((m) => m.field === k);
              return (
                <tr key={k} className={`border-t border-slate-100 ${bad ? "bg-rose-50 font-semibold text-rose-800" : "text-slate-700"}`}>
                  <td className="px-1 py-1.5">{k}</td>
                  <td className="px-1 py-1.5 font-mono">{e.verify!.store[k]}</td>
                  <td className="px-1 py-1.5 font-mono">{e.verify!.paypal[k]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-800">Raw evidence</summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100">{JSON.stringify(evidence, null, 2)}</pre>
      </details>
    </div>
  );
}
