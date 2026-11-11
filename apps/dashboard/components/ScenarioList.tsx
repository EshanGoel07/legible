"use client";
import { useState } from "react";
import { FAILURE, money } from "@/lib/format";
import type { TraceStep, TraceTone } from "@/lib/trace";
import { Lock, Pill } from "@/components/ui";

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
  trace: TraceStep[] | null;
};

const STATUS_LABEL: Record<string, string> = { CAPTURED: "PayPal captured", DECLINED: "Simulated decline", BLOCKED_LIMIT: "Blocked by limit", PENDING_APPROVAL: "Awaiting approval", APPROVED: "Approved, not captured" };

/** Outcome of the payment. Guard blue = Safe Pay / PayPal did its job; never red (red means a failed check). */
const STATUS: Record<string, string> = {
  CAPTURED: "bg-guard/10 text-guard ring-guard/30",
  DECLINED: "bg-slate-100 text-slate-700 ring-slate-300",
  BLOCKED_LIMIT: "bg-guard text-white ring-guard",
  PENDING_APPROVAL: "bg-warn/10 text-[#8a4f10] ring-warn/40",
  APPROVED: "bg-warn/10 text-[#8a4f10] ring-warn/40",
};

const TONE: Record<TraceTone, { chip: string; dot: string }> = {
  read: { chip: "border-slate-300 bg-white text-slate-800", dot: "bg-slate-400" },
  neutral: { chip: "border-slate-300 bg-white text-slate-800", dot: "bg-slate-400" },
  write: { chip: "border-warn/50 bg-warn/10 text-[#8a4f10]", dot: "bg-warn" },
  money: { chip: "border-guard/40 bg-guard/10 text-guard", dot: "bg-guard" },
  fail: { chip: "border-fail/50 bg-fail/10 text-[#b4232a]", dot: "bg-fail" },
  pass: { chip: "border-pass/50 bg-pass/10 text-[#0b7568]", dot: "bg-pass" },
};

export function ScenarioList({ rows }: { rows: ScenarioRowData[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="space-y-4">
      {rows.map((s) => {
        const isOpen = !!open[s.id];
        const kinds = [...new Set(s.failures.map((f) => f.kind))];
        return (
          <div key={s.id} className={`overflow-hidden rounded-2xl border bg-white ${s.passed ? "border-line" : "border-fail/40"}`}>
            <button onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))} className="flex w-full items-center gap-6 px-7 py-6 text-left hover:bg-paper/60" aria-expanded={isOpen}>
              <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-full text-2xl font-bold text-white ${s.passed ? "bg-pass" : "bg-fail"}`} aria-label={s.passed ? "Passed" : "Failed"}>{s.passed ? "✓" : "✗"}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="font-mono text-xl font-semibold">{s.id}</span>
                  {kinds.map((k) => <Pill key={k} className={FAILURE[k]?.cls ?? "bg-slate-100 text-slate-700 ring-slate-300"}>{FAILURE[k]?.label ?? k}</Pill>)}
                </div>
                {s.task && <div className="mt-1 text-[17px] text-ink/70">&ldquo;{s.task}&rdquo;</div>}
                {s.trace && <MiniTrace steps={s.trace} />}
              </div>
              {s.checkout && (
                <span className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-[15px] font-semibold ring-1 ring-inset ${STATUS[s.checkout.status] ?? "bg-slate-100 text-slate-700 ring-slate-300"}`}>
                  {(s.checkout.status === "BLOCKED_LIMIT" || s.checkout.status === "CAPTURED") && <Lock />}
                  {STATUS_LABEL[s.checkout.status] ?? s.checkout.status}
                  <span className="font-mono">{money(s.checkout.amount, s.checkout.currency)}</span>
                </span>
              )}
              {s.steps !== null && <span className="w-20 shrink-0 text-right font-mono text-sm tabular-nums text-muted">{s.steps} steps</span>}
              <svg viewBox="0 0 20 20" className={`h-6 w-6 shrink-0 text-muted transition ${isOpen ? "rotate-180" : ""}`} fill="currentColor" aria-hidden="true"><path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" /></svg>
            </button>
            {isOpen && (
              <div className="space-y-6 border-t border-line bg-paper/50 px-7 py-6">
                {s.trace && <Trace steps={s.trace} />}
                {s.failures.length === 0 ? (
                  <p className="text-[15px] font-medium text-[#0b7568]">Passed every check: tools called, amount, PayPal status, and PayPal vs store records.</p>
                ) : (
                  <ul className="space-y-4">
                    {s.failures.map((f, i) => (
                      <li key={i} className="rounded-xl border border-line bg-white p-5">
                        <div className="flex items-start gap-3">
                          <Pill className={FAILURE[f.kind]?.cls ?? "bg-slate-100 text-slate-700 ring-slate-300"}>{FAILURE[f.kind]?.label ?? f.kind}</Pill>
                          <p className="text-[15px] text-ink/90">{f.message}</p>
                        </div>
                        <Evidence evidence={f.evidence} />
                      </li>
                    ))}
                  </ul>
                )}
                {s.final && <p className="text-[15px] text-ink/75"><span className="font-semibold text-ink">Agent&apos;s last words:</span> {s.final}</p>}
                <p className="font-mono text-[13px] text-muted">agent {s.agent}{s.runId && <> · calls in runs/{s.runId}/calls.jsonl</>}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One-line path of what the agent did, visible without expanding. */
function MiniTrace({ steps }: { steps: TraceStep[] }) {
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[13px] text-ink/60">
      {steps.map((st, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && <span className="mr-0.5 text-ink/25" aria-hidden="true">›</span>}
          <span className={`h-2 w-2 rounded-full ${TONE[st.tone].dot}`} />
          <span className={st.tone === "fail" ? "font-semibold text-[#b4232a]" : ""}>{st.label}</span>
        </span>
      ))}
    </div>
  );
}

/** The agent's run as a timeline: click a step for its arguments and result. */
function Trace({ steps }: { steps: TraceStep[] }) {
  const [sel, setSel] = useState<number | null>(null);
  const cur = sel === null ? null : steps[sel];
  return (
    <div>
      <div className="font-mono text-[13px] font-medium uppercase tracking-[0.14em] text-muted">Agent trace</div>
      <ol className="mt-3 flex flex-wrap items-center gap-y-3">
        {steps.map((st, i) => {
          const t = TONE[st.tone];
          return (
            <li key={i} className="rise flex items-center" style={{ "--i": i } as React.CSSProperties}>
              {i > 0 && <span className="mx-1.5 h-px w-5 bg-ink/25" aria-hidden="true" />}
              <button onClick={() => setSel(sel === i ? null : i)} aria-pressed={sel === i}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 font-mono text-sm font-medium transition hover:-translate-y-0.5 ${t.chip} ${sel === i ? "ring-2 ring-ink/70" : ""}`}>
                {st.kind === "tool" ? <span className="text-xs opacity-60">{i + 1}</span> : st.kind === "verify" ? <span aria-hidden="true">{st.tone === "pass" ? "=" : "≠"}</span> : <Lock className="h-3.5 w-3.5" />}
                {st.label}
              </button>
            </li>
          );
        })}
      </ol>
      {cur && (
        <div className="mt-3 grid gap-3 rounded-xl bg-ink p-4 font-mono text-[13px] leading-relaxed text-white/85 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          {cur.args !== undefined && (
            <div className="min-w-0">
              <div className="mb-1 text-white/45">arguments</div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap">{cur.args}</pre>
            </div>
          )}
          <div className={`min-w-0 ${cur.args === undefined ? "lg:col-span-2" : ""}`}>
            <div className="mb-1 text-white/45">{cur.kind === "tool" ? "result" : cur.label}</div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap">{cur.detail || "(empty)"}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

type VerifySide = { status: string; amount: string; currency: string };
function Evidence({ evidence }: { evidence: unknown }) {
  if (!evidence || typeof evidence !== "object") return null;
  const e = evidence as { verify?: { paypal: VerifySide; store: VerifySide; mismatches?: Array<{ field: string }> }; tool?: string; error?: string };
  return (
    <div className="mt-4 space-y-3">
      {e.verify && <Ledger verify={e.verify} />}
      {e.tool && e.error && !e.verify && (
        <div className="rounded-lg bg-fail/10 px-4 py-3 font-mono text-sm text-[#b4232a]"><span className="font-semibold">{e.tool}</span> → {e.error}</div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer select-none text-muted hover:text-ink">Raw evidence</summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-ink p-4 font-mono text-[13px] leading-relaxed text-white/85">{JSON.stringify(evidence, null, 2)}</pre>
      </details>
    </div>
  );
}

/** Two facing columns: what the store's database says vs what PayPal's record says. */
function Ledger({ verify }: { verify: { paypal: VerifySide; store: VerifySide; mismatches?: Array<{ field: string }> } }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="grid grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)] bg-paper font-mono text-[13px] font-medium uppercase tracking-[0.14em] text-muted">
        <div className="px-5 py-2.5">Store says</div>
        <div />
        <div className="flex items-center gap-1.5 px-5 py-2.5 text-guard"><Lock className="h-3.5 w-3.5" />PayPal says</div>
      </div>
      {(["status", "amount", "currency"] as const).map((k) => {
        const bad = verify.mismatches?.some((m) => m.field === k);
        return (
          <div key={k} className={`grid grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)] items-center border-t border-line ${bad ? "bg-fail/10" : "bg-white"}`}>
            <div className="px-5 py-3">
              <div className="font-mono text-xs text-muted">{k}</div>
              <div className={`break-all font-mono font-semibold ${bad ? "text-2xl text-[#b4232a]" : "text-lg text-ink"}`}>{verify.store[k]}</div>
            </div>
            <div className={`text-center font-mono font-bold ${bad ? "text-5xl text-fail" : "text-2xl text-pass"}`} aria-label={bad ? "does not match" : "matches"}>{bad ? "≠" : "="}</div>
            <div className="px-5 py-3">
              <div className="font-mono text-xs text-muted">{k}</div>
              <div className={`break-all font-mono font-semibold ${bad ? "text-2xl text-[#b4232a]" : "text-lg text-ink"}`}>{verify.paypal[k]}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
