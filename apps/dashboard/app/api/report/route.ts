/** The report the Report page shows (newest run, ?run=<id>, or the sample). Report is Contract 5. */
import { getConfig, loadReportView } from "@/lib/data";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const run = new URL(req.url).searchParams.get("run") ?? undefined;
  const view = loadReportView(getConfig(), run);
  if (!view.ok) return Response.json({ error: view.error }, { status: 500 });
  return Response.json({ source: view.source, runId: view.run.id, bugs: view.run.bugs, report: view.run.report, runs: view.runs.map((r) => ({ id: r.id, score: r.report.score, bugs: r.bugs, createdAt: r.report.createdAt })) });
}
