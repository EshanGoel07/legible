import { getConfig, loadReportView, type Comparison, type Run } from "@/lib/data";
import { RunPicker } from "@/components/RunPicker";
import { ScenarioList, type ScenarioRowData } from "@/components/ScenarioList";
import { Banner, ErrorCard, Pill } from "@/components/ui";
import { scoreColor, when } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run: runId } = await searchParams;
  const view = loadReportView(getConfig(), runId);
  if (!view.ok) return <ErrorCard title="No report to show" message={view.error} hint="Run pnpm demo to create one." />;
  const { run, comparison } = view;
  const r = run.report;
  const failed = r.scenarios.filter((s) => !s.passed).length;
  const agent = r.scenarios[0]?.agent;

  const rows: ScenarioRowData[] = r.scenarios.map((s) => {
    const d = run.details?.scenarios.find((x) => x.id === s.id);
    return { ...s, task: view.tasks[s.id] ?? null, checkout: d?.checkout ?? null, steps: d?.agent?.steps ?? null, final: d?.agent?.final ?? null, runId: d?.runId ?? null };
  });

  return (
    <div>
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Agent-Readiness Report</h1>
          <p className="mt-2 text-[17px] text-slate-600">An AI agent ran real shopping tasks through the MCP server and paid through PayPal Sandbox. Every payment was checked against PayPal and the store&apos;s database.</p>
        </div>
        {view.runs.length > 0 && <RunPicker runs={view.runs.map((x) => ({ id: x.id, score: x.report.score, bugs: x.bugs, createdAt: when(x.report.createdAt) }))} current={run.id} />}
      </div>

      <div className="mt-8">
        {view.source === "sample" && <Banner tone="info" title="Sample report">No Crash Test runs yet, so this is the example from fixtures. Run <code className="font-mono">pnpm demo</code> to create a real one.</Banner>}
        {view.errors.map((e) => <Banner key={e} tone="warn" title="Skipped a run">{e}</Banner>)}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <section className="flex items-center gap-8 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <ScoreRing score={r.score} />
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Agent-Readiness Score</div>
            <div className="mt-1 text-2xl font-semibold">{failed ? `${failed} of ${r.scenarios.length} scenarios failed` : `All ${r.scenarios.length} scenarios passed`}</div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <Pill className="bg-slate-100 text-slate-700 ring-slate-200">site {r.siteId}</Pill>
              {agent && <Pill className="bg-slate-100 text-slate-700 ring-slate-200">agent {agent}</Pill>}
              {run.bugs && <Pill className={run.bugs === "on" ? "bg-rose-50 text-rose-700 ring-rose-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}>store bugs {run.bugs.toUpperCase()}</Pill>}
            </div>
            <div className="mt-3 space-y-0.5 text-sm text-slate-500">
              <div>{when(r.createdAt)} · money scenarios count double</div>
              <div className="font-mono text-xs text-slate-400">{run.id}</div>
            </div>
          </div>
        </section>
        {comparison ? <CompareCard c={comparison} /> : <NoCompare />}
      </div>

      <h2 className="mb-4 mt-10 text-xl font-semibold">Scenarios</h2>
      <ScenarioList rows={rows} />
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const c = scoreColor(score);
  const R = 64;
  const len = 2 * Math.PI * R;
  return (
    <div className="relative h-44 w-44 shrink-0">
      <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
        <circle cx="80" cy="80" r={R} fill="none" stroke="#e2e8f0" strokeWidth="14" />
        <circle cx="80" cy="80" r={R} fill="none" stroke={c.stroke} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${(score / 100) * len} ${len}`} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className={`text-6xl font-bold tabular-nums tracking-tight ${c.text}`}>{score}</div>
          <div className="text-sm font-medium text-slate-500">/ 100</div>
        </div>
      </div>
    </div>
  );
}

function CompareCard({ c }: { c: Comparison }) {
  const ids = [...new Set([...c.before.report.scenarios.map((s) => s.id), ...c.after.report.scenarios.map((s) => s.id)])];
  const passed = (run: Run, id: string) => run.report.scenarios.find((s) => s.id === id)?.passed;
  const Mark = ({ ok }: { ok: boolean | undefined }) => (ok === undefined ? <span className="text-slate-300">–</span> : ok ? <span className="font-bold text-emerald-600">✓</span> : <span className="font-bold text-rose-600">✗</span>);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Before and after</div>
      <div className="mt-3 flex items-center gap-6">
        <Big label={c.labels[0]} run={c.before} />
        <svg viewBox="0 0 24 24" className="h-8 w-8 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        <Big label={c.labels[1]} run={c.after} />
      </div>
      <table className="mt-5 w-full text-sm">
        <thead className="text-left text-slate-500"><tr><th className="pb-1 font-medium">Scenario</th><th className="pb-1 text-center font-medium">{c.labels[0]}</th><th className="pb-1 text-center font-medium">{c.labels[1]}</th></tr></thead>
        <tbody>
          {ids.map((id) => (
            <tr key={id} className="border-t border-slate-100">
              <td className="py-1.5 font-mono text-slate-700">{id}</td>
              <td className="py-1.5 text-center"><Mark ok={passed(c.before, id)} /></td>
              <td className="py-1.5 text-center"><Mark ok={passed(c.after, id)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Big({ label, run }: { label: string; run: Run }) {
  const c = scoreColor(run.report.score);
  return (
    <a href={`/report?run=${encodeURIComponent(run.id)}`} className="group">
      <div className="text-sm text-slate-500 group-hover:text-slate-800">{label}</div>
      <div className={`text-5xl font-bold tabular-nums ${c.text}`}>{run.report.score}</div>
    </a>
  );
}

function NoCompare() {
  return (
    <section className="grid place-items-center rounded-2xl border border-dashed border-slate-300 bg-white/50 p-8 text-center">
      <div>
        <div className="font-semibold text-slate-700">Before and after</div>
        <p className="mt-1 max-w-sm text-sm text-slate-500">Run <code className="font-mono">pnpm demo</code> and <code className="font-mono">pnpm demo --bugs off</code> to compare the store with and without its bugs.</p>
      </div>
    </section>
  );
}
