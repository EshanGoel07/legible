import type { Risk } from "@legible/contracts";
import { getConfig, loadManifestView, loadReportView, loadTranscript, type Comparison, type Run } from "@/lib/data";
import { buildTrace } from "@/lib/trace";
import { RunPicker } from "@/components/RunPicker";
import { ScenarioList, type ScenarioRowData } from "@/components/ScenarioList";
import { Banner, Container, ErrorCard, Eyebrow, Hero } from "@/components/ui";
import { scoreColor, when } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run: runId } = await searchParams;
  const cfg = getConfig();
  const view = loadReportView(cfg, runId);
  if (!view.ok) return <ErrorCard title="No report to show" message={view.error} hint="Run pnpm demo to create one." />;
  const { run, comparison } = view;
  const r = run.report;
  const failed = r.scenarios.filter((s) => !s.passed).length;
  const agent = r.scenarios[0]?.agent;

  const manifest = loadManifestView(cfg);
  const riskByTool: Record<string, Risk> = manifest.ok ? Object.fromEntries(manifest.manifest.tools.map((t) => [t.name, t.risk])) : {};

  const rows: ScenarioRowData[] = r.scenarios.map((s) => {
    const d = run.details?.scenarios.find((x) => x.id === s.id);
    const transcript = d?.runId ? loadTranscript(cfg, d.runId) : null;
    const trace = transcript ? buildTrace(transcript, { riskByTool, verifyPre: d?.verifyPre, verifyPost: d?.verifyPost }) : null;
    return { ...s, task: view.tasks[s.id] ?? null, checkout: d?.checkout ?? null, steps: d?.agent?.steps ?? null, final: d?.agent?.final ?? null, runId: d?.runId ?? null, trace: trace?.length ? trace : null };
  });

  const inComparison = comparison && (comparison.before.id === run.id || comparison.after.id === run.id);

  return (
    <div>
      <Hero>
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div>
            <Eyebrow className="text-white/55">Agent-Readiness Report</Eyebrow>
            <h1 className="mt-3 text-[44px] font-semibold leading-[1.1] tracking-tight">
              {failed ? <><span className="text-fail">{failed} of {r.scenarios.length}</span> scenarios failed</> : <>All <span className="text-pass">{r.scenarios.length}</span> scenarios passed</>}
            </h1>
            <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-white/65">
              An AI agent ran real shopping tasks through the MCP server and paid through PayPal Sandbox. Every payment was checked against PayPal and the store&apos;s database.
            </p>
            <dl className="mt-7 grid max-w-xl grid-cols-[6rem_minmax(0,1fr)] gap-x-4 gap-y-2 font-mono text-sm">
              <dt className="text-white/45">site</dt><dd className="text-white/90">{r.siteId}</dd>
              {agent && <><dt className="text-white/45">agent</dt><dd className="text-white/90">{agent}</dd></>}
              {run.bugs && <><dt className="text-white/45">store bugs</dt><dd className={run.bugs === "on" ? "font-semibold text-fail" : "font-semibold text-pass"}>{run.bugs.toUpperCase()}</dd></>}
              <dt className="text-white/45">run</dt><dd className="text-white/90">{run.id} <span className="text-white/45">· {when(r.createdAt)}</span></dd>
              <dt className="text-white/45">scoring</dt><dd className="text-white/90">money scenarios count double</dd>
            </dl>
            {view.runs.length > 0 && (
              <div className="mt-7 max-w-md">
                <RunPicker runs={view.runs.map((x) => ({ id: x.id, score: x.report.score, bugs: x.bugs, createdAt: when(x.report.createdAt) }))} current={run.id} />
              </div>
            )}
          </div>

          <div className="flex flex-col items-center gap-8 lg:items-end">
            {(!comparison || !inComparison) && <ScoreRing score={r.score} />}
            {comparison ? <Compare c={comparison} currentId={run.id} compact={!inComparison} /> : <NoCompare />}
          </div>
        </div>
      </Hero>

      <Container className="py-10">
        {view.source === "sample" && <Banner tone="info" title="Sample report">No Crash Test runs yet, so this is the example from fixtures. Run <code className="font-mono">pnpm demo</code> to create a real one.</Banner>}
        {view.errors.map((e) => <Banner key={e} tone="warn" title="Skipped a run">{e}</Banner>)}

        <div className="mb-5 flex items-baseline gap-4">
          <h2 className="text-2xl font-semibold tracking-tight">Scenarios</h2>
          <span className="font-mono text-sm text-muted">{r.scenarios.length - failed} passed · {failed} failed</span>
        </div>
        <ScenarioList rows={rows} />
      </Container>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const c = scoreColor(score);
  const R = 64;
  const len = 2 * Math.PI * R;
  return (
    <div className="relative h-56 w-56 shrink-0" role="img" aria-label={`Agent-Readiness Score ${score} out of 100`}>
      <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
        <circle cx="80" cy="80" r={R} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="12" />
        <circle cx="80" cy="80" r={R} fill="none" stroke={c.stroke} strokeWidth="12" strokeLinecap="round" strokeDasharray={len} className="ring-sweep" style={{ "--len": len, "--off": len * (1 - score / 100) } as React.CSSProperties} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className={`countup font-mono text-7xl font-semibold tabular-nums tracking-tight ${c.text}`} style={{ "--to": score } as React.CSSProperties} />
          <div className="font-mono text-sm text-white/50">/ 100</div>
        </div>
      </div>
    </div>
  );
}

/** The before → after moment: two scores, then every scenario flipping. */
function Compare({ c, currentId, compact }: { c: Comparison; currentId: string; compact: boolean }) {
  const ids = [...new Set([...c.before.report.scenarios.map((s) => s.id), ...c.after.report.scenarios.map((s) => s.id)])];
  const passed = (run: Run, id: string) => run.report.scenarios.find((s) => s.id === id)?.passed;
  return (
    <section className="w-full max-w-[640px]" aria-label="Before and after">
      <div className="flex items-end justify-between gap-6">
        <Big label={c.labels[0]} run={c.before} current={c.before.id === currentId} compact={compact} delay={0} />
        <svg viewBox="0 0 64 24" className={`mb-8 shrink-0 text-white/40 ${compact ? "h-5 w-12" : "h-7 w-20"}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 12h56" strokeDasharray="4 4" className="flow" /><path d="M52 5l8 7-8 7" />
        </svg>
        <Big label={c.labels[1]} run={c.after} current={c.after.id === currentId} compact={compact} delay={500} />
      </div>
      <ul className="mt-6 divide-y divide-white/10 border-y border-white/10">
        {ids.map((id, i) => (
          <li key={id} className="rise flex items-center gap-4 py-2.5 font-mono text-[15px]" style={{ "--i": i + 4 } as React.CSSProperties}>
            <span className="min-w-0 flex-1 truncate text-white/85">{id}</span>
            <Mark ok={passed(c.before, id)} />
            <span className="text-white/30" aria-hidden="true">→</span>
            <Mark ok={passed(c.after, id)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Mark({ ok }: { ok: boolean | undefined }) {
  if (ok === undefined) return <span className="w-16 text-center text-white/30">–</span>;
  return (
    <span className={`inline-flex w-16 items-center justify-center gap-1.5 rounded-md py-0.5 text-sm font-semibold ${ok ? "bg-pass/15 text-pass" : "bg-fail/15 text-fail"}`}>
      {ok ? "✓ pass" : "✗ fail"}
    </span>
  );
}

function Big({ label, run, current, compact, delay }: { label: string; run: Run; current: boolean; compact: boolean; delay: number }) {
  const c = scoreColor(run.report.score);
  return (
    <a href={`/report?run=${encodeURIComponent(run.id)}`} className="group block" aria-label={`${label}: ${run.report.score} out of 100`}>
      <div className="flex items-center gap-2 font-mono text-[13px] font-medium uppercase tracking-[0.14em] text-white/55 group-hover:text-white">
        {label}
        {current && <span className="rounded bg-white/15 px-1.5 py-0.5 text-[11px] tracking-normal text-white">viewing</span>}
      </div>
      <div className={`countup font-mono font-semibold tabular-nums leading-none tracking-tighter ${compact ? "mt-1 text-6xl" : "mt-2 text-[152px]"} ${c.text}`} style={{ "--to": run.report.score, "--delay": `${delay}ms` } as React.CSSProperties} />
    </a>
  );
}

function NoCompare() {
  return (
    <section className="w-full max-w-[640px] rounded-xl border border-dashed border-white/20 p-6 text-center">
      <div className="font-semibold text-white/85">Before and after</div>
      <p className="mx-auto mt-1 max-w-sm text-sm text-white/55">Run <code className="font-mono text-white/80">pnpm demo</code> and <code className="font-mono text-white/80">pnpm demo --bugs off</code> to compare the store with and without its bugs.</p>
    </section>
  );
}
