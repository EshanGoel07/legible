"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Manifest, Risk, Tool } from "@legible/contracts";
import type { HiddenRoute } from "@/lib/data";
import { RISK, money, repeats } from "@/lib/format";
import { Banner, Pill } from "@/components/ui";

type View = { manifest: Manifest; displayPath: string; source: "scan" | "fixture"; readOnly: boolean; readOnlyReason: string | null; hidden: HiddenRoute[]; model: string | null };
type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; approved: number; total: number; publisher: string[] | null } | { kind: "error"; message: string };

const ORDER: Risk[] = ["money", "write", "read"];

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

  return (
    <div className="pb-28">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Agent tools</h1>
          <p className="mt-2 max-w-3xl text-[17px] text-slate-600">
            What AI agents may do on <b className="text-slate-900">{view.manifest.site.name}</b>. The scanner read the site&apos;s code and sorted every action by risk.
            A human decides which ones agents get.
          </p>
        </div>
        <div className="flex shrink-0 gap-3">
          <Stat label="Tools found" value={view.manifest.tools.length} />
          <Stat label="Approved" value={`${approvedCount}/${view.manifest.tools.length}`} accent />
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-500">
        Manifest <code className="font-mono">{view.displayPath}</code>
        {view.model && <> · scanned with <code className="font-mono">{view.model}</code></>}
        {" · "}
        {publisherServing === null ? "MCP server offline" : `MCP server is serving ${publisherServing.length} tool${publisherServing.length === 1 ? "" : "s"}`}
      </p>

      <div className="mt-8">{view.readOnly && <Banner tone="warn" title="Read-only">{view.readOnlyReason}</Banner>}</div>

      {ORDER.map((risk) => {
        const tools = view.manifest.tools.filter((t) => t.risk === risk);
        if (!tools.length) return null;
        const r = RISK[risk];
        return (
          <section key={risk} className="mb-10">
            <div className="mb-4 flex items-center gap-3">
              <span className={`h-3 w-3 rounded-full ${r.dot}`} />
              <h2 className={`text-xl font-semibold ${r.head}`}>{r.label}</h2>
              <span className="text-[15px] text-slate-500">{r.blurb}</span>
              {!view.readOnly && (
                <div className="ml-auto flex gap-2 text-sm">
                  <button onClick={() => setAll(risk, true)} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-200/60 hover:text-slate-900">Approve all</button>
                  <button onClick={() => setAll(risk, false)} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-200/60 hover:text-slate-900">Reject all</button>
                </div>
              )}
            </div>
            <div className={`grid gap-5 ${risk === "money" ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"}`}>
              {tools.map((t) => (
                <ToolCard key={t.name} tool={t} approved={approved[t.name]} disabled={view.readOnly} onToggle={() => setApproved((a) => ({ ...a, [t.name]: !a[t.name] }))} />
              ))}
              {risk === "money" && <PaymentFlow />}
            </div>
          </section>
        );
      })}

      {view.hidden.length > 0 && <HiddenRoutes routes={view.hidden} />}

      <SaveBar changed={changed} save={save} onSave={onSave} onDiscard={() => (setApproved(initial), setSave({ kind: "idle" }))} />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className={`min-w-32 rounded-xl border px-4 py-3 ${accent ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"}`}>
      <div className={`text-xs font-medium uppercase tracking-wide ${accent ? "text-slate-300" : "text-slate-500"}`}>{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function ToolCard({ tool, approved, disabled, onToggle }: { tool: Tool; approved: boolean; disabled: boolean; onToggle: () => void }) {
  const r = RISK[tool.risk];
  const conf = tool.confidence;
  const review = (conf !== undefined && conf < 0.8) || tool.riskReason?.startsWith("Review");
  const callsTitle = tool.binding.kind === "http" ? `${tool.binding.method} ${tool.binding.path}` : `PayPal via Safe Pay · total from GET ${tool.binding.cartPath}`;
  const props = Object.entries((tool.inputSchema as { properties?: Record<string, { type?: string }> }).properties ?? {});
  const required = new Set(((tool.inputSchema as { required?: string[] }).required ?? []) as string[]);
  return (
    <article className={`flex flex-col rounded-2xl border bg-white p-5 shadow-sm transition ${approved ? `border-slate-200 ring-1 ${r.ring}` : "border-slate-200 opacity-80"}`}>
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h3 className="font-mono text-[17px] font-semibold text-slate-900">{tool.name}</h3>
          <Pill className={r.badge}>{r.label}</Pill>
          {review && <Pill className="bg-amber-100 text-amber-900 ring-amber-300">Review</Pill>}
        </div>
        <Toggle on={approved} disabled={disabled} onClick={onToggle} label={`Approve ${tool.name}`} />
      </div>
      <p className="mt-2 text-[15px] leading-snug text-slate-700">{tool.description}</p>

      {tool.risk === "money" && tool.limits && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/60 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">Safe Pay limits</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">
            {money(tool.limits.maxAmount, tool.limits.currency)} <span className="text-base font-normal text-slate-600">max per payment ({tool.limits.currency})</span>
          </div>
          <ul className="mt-2 space-y-0.5 text-sm text-slate-700">
            <li>Creates a PayPal order. The agent never sees card data.</li>
            <li>A human approves every payment in PayPal before money moves.</li>
            <li>Over the limit? Blocked before PayPal is called.</li>
          </ul>
        </div>
      )}

      <dl className="mt-4 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-slate-500">Calls</dt>
        <dd className="flex min-w-0 items-center gap-2" title={callsTitle}>
          <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${tool.binding.kind === "http" ? "bg-slate-100 text-slate-700" : "bg-rose-100 text-rose-700"}`}>
            {tool.binding.kind === "http" ? tool.binding.method : "PAYPAL"}
          </span>
          <span className="truncate font-mono text-[13px] text-slate-800">{tool.binding.kind === "http" ? tool.binding.path : `via Safe Pay · total from ${tool.binding.cartPath}`}</span>
        </dd>
        <dt className="text-slate-500">Inputs</dt>
        <dd className="flex flex-wrap gap-1.5">
          {props.length ? props.map(([k, v]) => (
            <span key={k} className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
              {k}
              {required.has(k) ? "*" : ""}
              <span className="text-slate-400">: {v.type ?? "any"}</span>
            </span>
          )) : <span className="text-slate-400">none</span>}
        </dd>
        {tool.source && (
          <>
            <dt className="text-slate-500">Source</dt>
            <dd className="font-mono text-slate-600">{tool.source.file}:{tool.source.line}</dd>
          </>
        )}
        {conf !== undefined && (
          <>
            <dt className="text-slate-500">Confidence</dt>
            <dd className="flex items-center gap-2">
              <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${conf >= 0.8 ? "bg-slate-800" : "bg-amber-500"}`} style={{ width: `${Math.round(conf * 100)}%` }} />
              </div>
              <span className="tabular-nums text-slate-700">{Math.round(conf * 100)}%</span>
            </dd>
          </>
        )}
      </dl>
      {tool.riskReason && (review || !repeats(tool.riskReason, tool.description)) && (
        <p className={`mt-3 border-t border-slate-100 pt-3 text-sm ${review ? "text-amber-800" : "text-slate-500"}`}>{tool.riskReason}</p>
      )}
    </article>
  );
}

function PaymentFlow() {
  const steps = [
    ["Agent calls checkout", "through the MCP server, with only a cart id"],
    ["Safe Pay checks the limit", "over the limit is blocked; PayPal is never called"],
    ["PayPal order created", "Orders v2, intent CAPTURE; the agent gets an approval link"],
    ["A human approves in PayPal", "no card data ever reaches the agent"],
    ["Captured, then verified", "Safe Pay captures once and checks PayPal against the store"],
  ];
  return (
    <aside className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">How an agent payment works</div>
      <ol className="mt-4 space-y-4">
        {steps.map(([title, sub], i) => (
          <li key={title} className="flex gap-4">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-900 text-sm font-semibold text-white">{i + 1}</span>
            <div>
              <div className="text-[15px] font-semibold text-slate-900">{title}</div>
              <div className="text-sm text-slate-600">{sub}</div>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function Toggle({ on, disabled, onClick, label }: { on: boolean; disabled: boolean; onClick: () => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}
      className={`group mt-0.5 flex shrink-0 items-center gap-2 rounded-full text-sm font-medium disabled:cursor-not-allowed ${on ? "text-emerald-700" : "text-slate-500"}`}>
      <span className={`relative h-7 w-12 rounded-full transition ${on ? "bg-emerald-500" : "bg-slate-300"} ${disabled ? "opacity-60" : ""}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-6" : "left-1"}`} />
      </span>
      <span className="w-[4.5rem] text-left">{on ? "Approved" : "Off"}</span>
    </button>
  );
}

function HiddenRoutes({ routes }: { routes: HiddenRoute[] }) {
  return (
    <section className="mb-10 rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold">Kept away from agents <span className="font-normal text-slate-500">({routes.length})</span></h2>
      <p className="mt-1 text-[15px] text-slate-600">Routes the scanner found but did not expose: internal, web-page-only, or a money action that can&apos;t go through PayPal.</p>
      <table className="mt-4 w-full text-sm">
        <thead className="text-left text-slate-500">
          <tr><th className="pb-2 font-medium">Route</th><th className="pb-2 font-medium">Risk</th><th className="pb-2 font-medium">Why</th><th className="pb-2 font-medium">Source</th></tr>
        </thead>
        <tbody>
          {routes.map((r) => (
            <tr key={`${r.method} ${r.path}`} className="border-t border-slate-100 align-top">
              <td className="py-2 pr-4 font-mono text-slate-800">{r.method} {r.path}</td>
              <td className="py-2 pr-4"><Pill className={RISK[r.risk as Risk]?.badge ?? "bg-slate-100 text-slate-700 ring-slate-200"}>{RISK[r.risk as Risk]?.label ?? r.risk}</Pill></td>
              <td className="py-2 pr-4 text-slate-600">{r.reason}</td>
              <td className="py-2 font-mono text-slate-500">{r.source}</td>
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
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-8 py-4">
        {save.kind === "error" ? (
          <div className="flex-1 text-[15px] text-rose-700"><b>Not saved.</b> {save.message}</div>
        ) : changed ? (
          <div className="flex-1 text-[15px] text-slate-700"><b>{changed}</b> unsaved change{changed === 1 ? "" : "s"}. Saving writes the manifest; the MCP server picks it up on its next request, no restart.</div>
        ) : save.kind === "saved" ? (
          <div className="flex-1 text-[15px] text-emerald-700">
            <b>Saved.</b> {save.approved}/{save.total} tools approved.{" "}
            {save.publisher === null ? "The MCP server is offline; it will serve these when it starts." : <>MCP server now serves <b>{save.publisher.length}</b> tool{save.publisher.length === 1 ? "" : "s"}.</>}
          </div>
        ) : null}
        {changed > 0 && (
          <>
            <button onClick={onDiscard} className="rounded-lg px-4 py-2.5 text-[15px] font-medium text-slate-600 hover:bg-slate-100">Discard</button>
            <button onClick={onSave} disabled={save.kind === "saving"} className="rounded-lg bg-slate-900 px-5 py-2.5 text-[15px] font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60">
              {save.kind === "saving" ? "Saving…" : "Save manifest"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
