"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Manifest, Risk, Tool } from "@legible/contracts";
import type { HiddenRoute } from "@/lib/data";
import { RISK, money, repeats } from "@/lib/format";
import { Banner, Container, Eyebrow, Hero, Lock, Pill } from "@/components/ui";

type View = { manifest: Manifest; displayPath: string; source: "scan" | "fixture"; readOnly: boolean; readOnlyReason: string | null; hidden: HiddenRoute[]; model: string | null };
type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; approved: number; total: number; publisher: string[] | null } | { kind: "error"; message: string };

const ORDER: Risk[] = ["money", "write", "read"];
const LANE: Record<Risk, string> = { money: "border-guard/40 bg-guard/[0.04]", write: "border-line bg-white/50", read: "border-line bg-white/50" };

export function ToolsBoard({ view, publisherServing }: { view: View; publisherServing: string[] | null }) {
  const router = useRouter();
  const initial = useMemo(() => Object.fromEntries(view.manifest.tools.map((t) => [t.name, t.approved])), [view.manifest]);
  const [approved, setApproved] = useState<Record<string, boolean>>(initial);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const changed = view.manifest.tools.filter((t) => approved[t.name] !== initial[t.name]).length;
  const approvedCount = Object.values(approved).filter(Boolean).length;

  async function onSave() {
    setSave({ kind: "saving" });
    const next: Manifest = { ...view.manifest, tools: view.manifest.tools.map((t) => ({ ...t, approved: approved[t.name] })) };
    try {
      const r = await fetch("/api/manifest", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? `HTTP ${r.status}`);
      setSave({ kind: "saved", approved: b.approved.length, total: b.total, publisher: b.publisher?.approved ?? null });
      router.refresh();
    } catch (e) {
      setSave({ kind: "error", message: (e as Error).message });
    }
  }

  const setAll = (risk: Risk, value: boolean) =>
    setApproved((a) => ({ ...a, ...Object.fromEntries(view.manifest.tools.filter((t) => t.risk === risk).map((t) => [t.name, value])) }));

  const lanes = ORDER.map((risk) => ({ risk, tools: view.manifest.tools.filter((t) => t.risk === risk) })).filter((l) => l.tools.length);

  return (
    <div className="pb-28">
      <Hero>
        <div className="flex flex-wrap items-end justify-between gap-10 xl:flex-nowrap">
          <div>
            <Eyebrow className="text-white/55">Agent tools</Eyebrow>
            <h1 className="mt-3 text-[40px] font-semibold leading-[1.1] tracking-tight">What AI agents may do on {view.manifest.site.name}</h1>
            <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-white/65">
              The scanner read the site&apos;s code and sorted every action by risk. A human decides which ones agents get.
            </p>
            <p className="mt-5 font-mono text-sm text-white/45">
              manifest <span className="text-white/80">{view.displayPath}</span>
              {view.model && <> · scanned with <span className="text-white/80">{view.model}</span></>}
              {" · "}
              {publisherServing === null ? "MCP server offline" : `MCP server is serving ${publisherServing.length} tool${publisherServing.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="flex shrink-0 gap-10">
            <Stat label="Tools found" value={String(view.manifest.tools.length)} />
            <Stat label="Approved" value={`${approvedCount}/${view.manifest.tools.length}`} />
            <Stat label="Kept from agents" value={String(view.hidden.length)} />
          </div>
        </div>
      </Hero>

      <Container className="py-10">
        {view.readOnly && <Banner tone="warn" title="Read-only">{view.readOnlyReason}</Banner>}

        <PaymentFlow />

        <div className={`mt-8 grid items-start gap-6 ${lanes.length === 3 ? "xl:grid-cols-[1.25fr_1fr_1fr]" : lanes.length === 2 ? "xl:grid-cols-2" : ""}`}>
          {lanes.map(({ risk, tools }) => {
            const r = RISK[risk];
            return (
              <section key={risk} className={`rounded-2xl border p-5 ${LANE[risk]}`} aria-label={`${r.label} tools`}>
                <div className="flex items-start gap-3">
                  <span className={`mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white ${r.dot}`}>
                    {risk === "money" ? <Lock /> : <span className="font-mono text-sm font-semibold">{tools.length}</span>}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className={`text-xl font-semibold ${r.head}`}>{r.label}</h2>
                    <p className="text-[15px] leading-snug text-ink/65">{r.blurb}</p>
                  </div>
                </div>
                {!view.readOnly && (
                  <div className="mt-3 flex gap-2 text-sm">
                    <button onClick={() => setAll(risk, true)} className="rounded-md border border-line bg-white px-2.5 py-1 font-medium text-ink/70 hover:border-ink/40 hover:text-ink">Approve all</button>
                    <button onClick={() => setAll(risk, false)} className="rounded-md border border-line bg-white px-2.5 py-1 font-medium text-ink/70 hover:border-ink/40 hover:text-ink">Reject all</button>
                  </div>
                )}
                <div className="mt-4 space-y-4">
                  {tools.map((t, i) => (
                    <ToolCard key={t.name} index={i} tool={t} approved={approved[t.name]} disabled={view.readOnly} onToggle={() => setApproved((a) => ({ ...a, [t.name]: !a[t.name] }))} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {view.hidden.length > 0 && <HiddenRoutes routes={view.hidden} />}
      </Container>

      <SaveBar changed={changed} save={save} onSave={onSave} onDiscard={() => (setApproved(initial), setSave({ kind: "idle" }))} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[13px] font-medium uppercase tracking-[0.14em] text-white/55">{label}</div>
      <div className="mt-1 font-mono text-6xl font-semibold tabular-nums tracking-tight">{value}</div>
    </div>
  );
}

function ToolCard({ tool, approved, disabled, onToggle, index }: { tool: Tool; approved: boolean; disabled: boolean; onToggle: () => void; index: number }) {
  const r = RISK[tool.risk];
  const conf = tool.confidence;
  const review = (conf !== undefined && conf < 0.8) || tool.riskReason?.startsWith("Review");
  const callsTitle = tool.binding.kind === "http" ? `${tool.binding.method} ${tool.binding.path}` : `PayPal via Safe Pay · total from GET ${tool.binding.cartPath}`;
  const props = Object.entries((tool.inputSchema as { properties?: Record<string, { type?: string }> }).properties ?? {});
  const required = new Set(((tool.inputSchema as { required?: string[] }).required ?? []) as string[]);
  return (
    <article className={`rise flex flex-col rounded-xl border bg-white p-5 transition ${approved ? `border-transparent ring-1 ${r.ring}` : "border-dashed border-ink/25 opacity-75"}`} style={{ "--i": index } as React.CSSProperties}>
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h3 className="font-mono text-lg font-semibold text-ink">{tool.name}</h3>
          <Pill className={r.badge}>{tool.risk === "money" && <Lock className="h-3.5 w-3.5" />}{r.label}</Pill>
          {review && <Pill className="bg-warn/15 text-[#8a4f10] ring-warn/50">Review</Pill>}
        </div>
        <Toggle on={approved} disabled={disabled} onClick={onToggle} label={`Approve ${tool.name}`} />
      </div>
      <p className="mt-2 text-[15px] leading-snug text-ink/75">{tool.description}</p>

      {tool.risk === "money" && tool.limits && <LimitGate max={tool.limits.maxAmount} currency={tool.limits.currency} />}

      <dl className="mt-4 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted">Calls</dt>
        <dd className="flex min-w-0 items-center gap-2" title={callsTitle}>
          <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${tool.binding.kind === "http" ? "bg-slate-100 text-slate-700" : "bg-guard text-white"}`}>
            {tool.binding.kind === "http" ? tool.binding.method : "PAYPAL"}
          </span>
          <span className="truncate font-mono text-[13px] text-ink/85">{tool.binding.kind === "http" ? tool.binding.path : `via Safe Pay · total from ${tool.binding.cartPath}`}</span>
        </dd>
        <dt className="text-muted">Inputs</dt>
        <dd className="flex flex-wrap gap-1.5">
          {props.length ? props.map(([k, v]) => (
            <span key={k} className="rounded-md bg-paper px-1.5 py-0.5 font-mono text-[13px] text-ink/85">
              {k}
              {required.has(k) ? "*" : ""}
              <span className="text-muted">: {v.type ?? "any"}</span>
            </span>
          )) : <span className="text-muted">none</span>}
        </dd>
        {tool.source && (
          <>
            <dt className="text-muted">Source</dt>
            <dd className="font-mono text-[13px] text-ink/70">{tool.source.file}:{tool.source.line}</dd>
          </>
        )}
        {conf !== undefined && (
          <>
            <dt className="text-muted">Confidence</dt>
            <dd className="flex items-center gap-2">
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-ink/10">
                <div className={`h-full rounded-full ${conf >= 0.8 ? "bg-ink" : "bg-warn"}`} style={{ width: `${Math.round(conf * 100)}%` }} />
              </div>
              <span className="font-mono text-[13px] tabular-nums text-ink/85">{Math.round(conf * 100)}%</span>
            </dd>
          </>
        )}
      </dl>
      {tool.riskReason && (review || !repeats(tool.riskReason, tool.description)) && (
        <p className={`mt-3 border-t border-line pt-3 text-sm ${review ? "text-[#8a4f10]" : "text-muted"}`}>{tool.riskReason}</p>
      )}
    </article>
  );
}

/** The spending limit as a gate: payments up to the limit go to PayPal for human approval; anything past it never reaches PayPal. */
function LimitGate({ max, currency }: { max: number; currency: string }) {
  return (
    <div className="mt-4 rounded-xl border border-guard/30 bg-guard/[0.05] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-mono text-[13px] font-medium uppercase tracking-[0.14em] text-guard">Safe Pay limit gate</div>
        <div className="text-sm text-ink/60">max per payment ({currency})</div>
      </div>
      <div className="mt-1 font-mono text-4xl font-semibold tracking-tight text-ink">{money(max, currency)}</div>

      <div className="mt-4 flex h-9 overflow-hidden rounded-lg border border-ink/15 font-mono text-[13px] font-medium">
        <div className="flex w-[64%] items-center gap-1.5 bg-guard px-3 text-white"><Lock className="h-3.5 w-3.5 shrink-0" /><span className="truncate">PayPal · human approves</span></div>
        <div className="w-1 bg-ink" />
        <div className="hatch flex flex-1 items-center justify-center bg-fail/5 px-2 text-[#b4232a]">blocked</div>
      </div>
      <div className="mt-1 flex font-mono text-xs text-muted">
        <span className="w-[64%]">{money(0, currency)}</span>
        <span className="-ml-6 font-semibold text-ink">{money(max, currency)}</span>
        <span className="ml-auto">over the limit</span>
      </div>

      <ul className="mt-3 space-y-0.5 text-sm text-ink/75">
        <li>Creates a PayPal order. The agent never sees card data.</li>
        <li>A human approves every payment in PayPal before money moves.</li>
        <li>Over the limit? Blocked before PayPal is called.</li>
      </ul>
    </div>
  );
}

/** One horizontal pipeline: who touches a payment, in order. */
function PaymentFlow() {
  const steps: Array<{ title: string; sub: string; tone: "plain" | "guard" | "human" | "pass" }> = [
    { title: "Agent", sub: "calls checkout with only a cart id", tone: "plain" },
    { title: "MCP server", sub: "approved tools only; every call logged", tone: "plain" },
    { title: "Limit gate", sub: "over the limit is blocked; PayPal is never called", tone: "guard" },
    { title: "PayPal order", sub: "Orders v2, intent CAPTURE; agent gets an approval link", tone: "guard" },
    { title: "Human approves", sub: "in PayPal; no card data ever reaches the agent", tone: "human" },
    { title: "Capture", sub: "Safe Pay captures once", tone: "guard" },
    { title: "Verify", sub: "PayPal's record is checked against the store", tone: "pass" },
  ];
  const node = { plain: "border-ink/25 bg-white text-ink", guard: "border-guard bg-guard text-white", human: "border-ink bg-ink text-white", pass: "border-pass bg-pass text-white" };
  return (
    <section className="rounded-2xl border border-line bg-white p-6" aria-label="How an agent payment works">
      <Eyebrow className="text-muted">How an agent payment works</Eyebrow>
      <ol className="mt-5 grid grid-cols-7">
        {steps.map((s, i) => (
          <li key={s.title} className="rise relative pr-4" style={{ "--i": i } as React.CSSProperties}>
            {i < steps.length - 1 && (
              <svg className="absolute left-10 right-0 top-[18px] h-1 w-[calc(100%-2.5rem)] overflow-visible text-ink/35" aria-hidden="true">
                <line x1="6" y1="2" x2="100%" y2="2" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" className="flow" />
              </svg>
            )}
            <span className={`relative grid h-10 w-10 place-items-center rounded-full border-2 font-mono text-[15px] font-semibold ${node[s.tone]}`}>
              {s.tone === "guard" ? <Lock /> : s.tone === "pass" ? "=" : i + 1}
            </span>
            <div className="mt-3 text-[17px] font-semibold text-ink">{s.title}</div>
            <div className="mt-0.5 text-sm leading-snug text-ink/65">{s.sub}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Toggle({ on, disabled, onClick, label }: { on: boolean; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}
      className={`group mt-0.5 flex shrink-0 items-center gap-2 rounded-full text-sm font-semibold disabled:cursor-not-allowed ${on ? "text-ink" : "text-muted"}`}>
      <span className={`relative h-7 w-12 rounded-full transition ${on ? "bg-ink" : "bg-ink/20"} ${disabled ? "opacity-60" : ""}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
      </span>
      <span className="w-[4.5rem] text-left">{on ? "Approved" : "Off"}</span>
    </button>
  );
}

function HiddenRoutes({ routes }: { routes: HiddenRoute[] }) {
  return (
    <section className="mt-8 rounded-2xl border border-line bg-white p-6">
      <h2 className="text-xl font-semibold">Kept away from agents <span className="font-mono font-normal text-muted">({routes.length})</span></h2>
      <p className="mt-1 text-[15px] text-ink/65">Routes the scanner found but did not expose: internal, web-page-only, or a money action that can&apos;t go through PayPal.</p>
      <table className="mt-4 w-full text-[15px]">
        <thead className="text-left font-mono text-[13px] uppercase tracking-[0.14em] text-muted">
          <tr><th className="pb-2 font-medium">Route</th><th className="pb-2 font-medium">Risk</th><th className="pb-2 font-medium">Why</th><th className="pb-2 font-medium">Source</th></tr>
        </thead>
        <tbody>
          {routes.map((r) => (
            <tr key={`${r.method} ${r.path}`} className="border-t border-line align-top">
              <td className="py-2.5 pr-4 font-mono text-ink">{r.method} {r.path}</td>
              <td className="py-2.5 pr-4"><Pill className={RISK[r.risk as Risk]?.badge ?? "bg-slate-100 text-slate-700 ring-slate-300"}>{RISK[r.risk as Risk]?.label ?? r.risk}</Pill></td>
              <td className="py-2.5 pr-4 text-ink/70">{r.reason}</td>
              <td className="py-2.5 font-mono text-sm text-muted">{r.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SaveBar({ changed, save, onSave, onDiscard }: { changed: number; save: SaveState; onSave: () => void; onDiscard: () => void }) {
  if (!changed && save.kind !== "saved" && save.kind !== "error") return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-ink text-white">
      <div className="mx-auto flex max-w-[1440px] items-center gap-4 px-10 py-4">
        {save.kind === "error" ? (
          <div className="flex-1 text-[17px] text-fail"><b>Not saved.</b> {save.message}</div>
        ) : changed ? (
          <div className="flex-1 text-[17px] text-white/80"><b className="text-white">{changed}</b> unsaved change{changed === 1 ? "" : "s"}. Saving writes the manifest; the MCP server picks it up on its next request, no restart.</div>
        ) : save.kind === "saved" ? (
          <div className="flex-1 text-[17px] text-pass">
            <b>Saved.</b> {save.approved}/{save.total} tools approved.{" "}
            {save.publisher === null ? "The MCP server is offline; it will serve these when it starts." : <>MCP server now serves <b>{save.publisher.length}</b> tool{save.publisher.length === 1 ? "" : "s"}.</>}
          </div>
        ) : null}
        {changed > 0 && (
          <>
            <button onClick={onDiscard} className="rounded-lg px-4 py-2.5 text-[15px] font-medium text-white/70 hover:bg-white/10 hover:text-white">Discard</button>
            <button onClick={onSave} disabled={save.kind === "saving"} className="rounded-lg bg-white px-5 py-2.5 text-[15px] font-semibold text-ink hover:bg-white/90 disabled:opacity-60">
              {save.kind === "saving" ? "Saving…" : "Save manifest"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
