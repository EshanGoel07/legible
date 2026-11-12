/**
 * Server-only data layer: reads/writes the manifest (Contract 1) and Crash Test runs (Contract 5) on disk.
 * Every function takes a DashConfig so tests can point it at temp folders.
 */
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { Manifest, Report, Scenario } from "@legible/contracts";

export type DashConfig = {
  root: string;
  manifestPath: string;
  runsDir: string;
  scenariosDir: string;
  fixtureManifest: string;
  sampleReport: string;
  fixturesDir: string;
  publisherUrl: string;
};

/** Repo root = nearest folder with pnpm-workspace.yaml (next dev runs in apps/dashboard). */
export function findRoot(from = process.cwd()): string {
  let dir = resolve(/*turbopackIgnore: true*/ from);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) return resolve(/*turbopackIgnore: true*/ from);
    dir = up;
  }
}

let envLoaded = false;
/** Paths are read at runtime from env (runs/, the manifest), so they are deliberately invisible to Turbopack's file tracing. */
export function getConfig(env: Record<string, string | undefined> = process.env, root = findRoot()): DashConfig {
  if (!envLoaded && env === process.env) {
    envLoaded = true;
    try {
      process.loadEnvFile(join(/*turbopackIgnore: true*/ root, ".env")); // never overrides values already set (e.g. by pnpm demo)
    } catch {
      /* host environment */
    }
  }
  const p = (v: string) => (isAbsolute(v) ? v : resolve(/*turbopackIgnore: true*/ root, v));
  return {
    root,
    manifestPath: p(env.MANIFEST_PATH ?? "runs/manifest.json"),
    runsDir: p(env.RUNS_DIR ?? "runs"),
    scenariosDir: p(env.SCENARIOS_DIR ?? "fixtures/scenarios"),
    fixtureManifest: p("fixtures/manifest.demo-store.json"),
    sampleReport: p("fixtures/report.sample.json"),
    fixturesDir: p("fixtures"),
    publisherUrl: (env.PUBLISHER_URL ?? "http://localhost:3002").replace(/\/+$/, ""),
  };
}

const isInside = (file: string, dir: string) => {
  const r = relative(dir, file);
  return r !== "" && !r.startsWith("..") && !isAbsolute(r);
};
const errMsg = (e: unknown) => (e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") : e instanceof Error ? e.message : String(e));

// ───────────────────────── manifest

/** What the scanner decided for every route (written next to the manifest as <name>.details.json). Loosely typed. */
const ScanDetails = z.object({
  model: z.string().optional(),
  routes: z.array(
    z.object({
      method: z.string(),
      path: z.string(),
      file: z.string(),
      line: z.number(),
      note: z.string().optional(),
      llm: z.object({ exposeReason: z.string().optional(), name: z.string().optional() }).passthrough().nullable().optional(),
      final: z.object({ expose: z.boolean(), name: z.string(), risk: z.string(), confidence: z.number() }).nullable(),
    }),
  ),
});
export type HiddenRoute = { method: string; path: string; source: string; risk: string; reason: string };

export type ManifestView =
  | { ok: true; manifest: Manifest; path: string; displayPath: string; source: "scan" | "fixture"; readOnly: boolean; readOnlyReason: string | null; hidden: HiddenRoute[]; model: string | null }
  | { ok: false; path: string; displayPath: string; error: string };

export function loadManifestView(cfg: DashConfig): ManifestView {
  const usingFixture = !existsSync(cfg.manifestPath);
  const path = usingFixture ? cfg.fixtureManifest : cfg.manifestPath;
  const displayPath = relative(cfg.root, path) || path;
  let manifest: Manifest;
  try {
    manifest = Manifest.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (e) {
    return { ok: false, path, displayPath, error: errMsg(e) };
  }
  const inFixtures = isInside(path, cfg.fixturesDir);
  const readOnlyReason = usingFixture
    ? `No scanned manifest at ${relative(cfg.root, cfg.manifestPath)} yet, so this is the sample manifest. Run pnpm demo (or the scanner) to scan the store.`
    : inFixtures
      ? "This is a fixture file; fixtures are read-only. Point MANIFEST_PATH at a scanned manifest to approve tools."
      : null;

  let hidden: HiddenRoute[] = [];
  let model: string | null = null;
  const detailsPath = path.replace(/\.json$/, "") + ".details.json";
  if (existsSync(detailsPath)) {
    try {
      const d = ScanDetails.parse(JSON.parse(readFileSync(detailsPath, "utf8")));
      model = d.model ?? null;
      hidden = d.routes
        .filter((r) => r.final && !r.final.expose)
        .map((r) => ({ method: r.method, path: r.path, source: `${r.file}:${r.line}`, risk: r.final!.risk, reason: hiddenReason(r.note, r.llm?.exposeReason) }));
    } catch {
      /* details are optional */
    }
  }
  return { ok: true, manifest, path, displayPath, source: usingFixture ? "fixture" : "scan", readOnly: usingFixture || inFixtures, readOnlyReason, hidden, model };
}

/** Plain-English reason a route was not exposed (the scanner's own note is engineer-speak). */
export function hiddenReason(note: string | undefined, modelReason: string | undefined): string {
  if (note && /only the payment service calls/i.test(note)) return "Internal: only the payment service (Safe Pay) calls it to record orders, so no agent may.";
  if (note && /safe ?pay/i.test(note)) return "Blocked by Legible's safety rule: it touches money but can't be routed through PayPal, so no agent may call it.";
  return modelReason ?? note ?? "Not exposed";
}

export class SaveError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Validates with Manifest.parse and writes atomically (tmp + rename) so the Publisher never reads half a file. */
export function saveManifest(cfg: DashConfig, input: unknown): Manifest {
  const parsed = Manifest.safeParse(input);
  if (!parsed.success) throw new SaveError(400, errMsg(parsed.error));
  if (!existsSync(cfg.manifestPath)) throw new SaveError(409, `no scanned manifest at ${relative(cfg.root, cfg.manifestPath)}; run the scanner first`);
  if (isInside(cfg.manifestPath, cfg.fixturesDir)) throw new SaveError(403, "fixture manifests are read-only");
  const current = Manifest.parse(JSON.parse(readFileSync(cfg.manifestPath, "utf8")));
  if (current.site.id !== parsed.data.site.id) throw new SaveError(409, `manifest is for site ${current.site.id}, not ${parsed.data.site.id}`);
  const tmp = `${cfg.manifestPath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(parsed.data, null, 2) + "\n");
  renameSync(tmp, cfg.manifestPath);
  return parsed.data;
}

/** What the running Publisher serves right now (GET PUBLISHER_URL/), or null if it is down. */
export async function publisherStatus(cfg: DashConfig): Promise<{ approved: string[]; notApproved: string[] } | null> {
  try {
    const r = await fetch(`${cfg.publisherUrl}/`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    if (!r.ok) return null;
    const b = (await r.json()) as { approved?: string[]; notApproved?: string[] };
    return { approved: (b.approved ?? []).map((s) => s.split(" ")[0]), notApproved: b.notApproved ?? [] };
  } catch {
    return null;
  }
}

// ───────────────────────── runs + reports

const RunDetails = z.object({
  model: z.string().optional(),
  scenarios: z.array(
    z.object({
      id: z.string(),
      runId: z.string(),
      agent: z.object({ steps: z.number(), stoppedBy: z.string(), final: z.string().nullable() }).passthrough().optional(),
      checkout: z.object({ checkoutId: z.string(), status: z.string(), amount: z.string(), currency: z.string() }).nullable().optional(),
      verifyPre: z.unknown().optional(),
      verifyPost: z.unknown().optional(),
    }),
  ),
});
export type RunDetails = z.infer<typeof RunDetails>;
const RunMeta = z.object({ bugs: z.enum(["on", "off"]).optional() }).passthrough();

export type Run = { id: string; report: Report; details: RunDetails | null; bugs: "on" | "off" | null };

export function listRuns(cfg: DashConfig): { runs: Run[]; errors: string[] } {
  const runs: Run[] = [];
  const errors: string[] = [];
  if (!existsSync(cfg.runsDir)) return { runs, errors };
  for (const id of readdirSync(cfg.runsDir)) {
    const dir = join(cfg.runsDir, id);
    const file = join(dir, "report.json");
    if (!existsSync(file) || !statSync(dir).isDirectory()) continue;
    try {
      const report = Report.parse(JSON.parse(readFileSync(file, "utf8")));
      const details = readOptional(join(dir, "details.json"), RunDetails);
      const meta = readOptional(join(dir, "demo.json"), RunMeta);
      runs.push({ id, report, details, bugs: meta?.bugs ?? null });
    } catch (e) {
      errors.push(`${id}/report.json: ${errMsg(e)}`);
    }
  }
  runs.sort((a, b) => b.report.createdAt.localeCompare(a.report.createdAt));
  return { runs, errors };
}

function readOptional<T>(file: string, schema: z.ZodType<T>): T | null {
  if (!existsSync(file)) return null;
  try {
    return schema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

export type Comparison = { before: Run; after: Run; labels: [string, string] };

/** Bugs ON vs bugs OFF (newest of each) if both exist, else the two newest runs. */
export function pickComparison(runs: Run[]): Comparison | null {
  const on = runs.find((r) => r.bugs === "on");
  const off = runs.find((r) => r.bugs === "off");
  if (on && off) return { before: on, after: off, labels: ["Store bugs ON", "Store bugs OFF"] };
  if (runs.length >= 2) return { before: runs[1], after: runs[0], labels: ["Previous run", "Latest run"] };
  return null;
}

export type ReportView =
  | { ok: true; source: "run" | "sample"; run: Run; runs: Run[]; errors: string[]; comparison: Comparison | null; tasks: Record<string, string> }
  | { ok: false; error: string; runs: Run[] };

export function loadReportView(cfg: DashConfig, runId?: string): ReportView {
  const { runs, errors } = listRuns(cfg);
  const tasks = scenarioTasks(cfg);
  if (runs.length) {
    const run = (runId && runs.find((r) => r.id === runId)) || runs[0];
    if (runId && run.id !== runId) errors.unshift(`run ${runId} not found; showing the newest run`);
    return { ok: true, source: "run", run, runs, errors, comparison: pickComparison(runs), tasks };
  }
  try {
    const report = Report.parse(JSON.parse(readFileSync(cfg.sampleReport, "utf8")));
    return { ok: true, source: "sample", run: { id: report.runId, report, details: null, bugs: null }, runs, errors, comparison: null, tasks };
  } catch (e) {
    return { ok: false, error: `no runs in ${relative(cfg.root, cfg.runsDir) || cfg.runsDir} and the sample report is unreadable: ${errMsg(e)}`, runs };
  }
}

export function scenarioTasks(cfg: DashConfig): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(cfg.scenariosDir)) return out;
  for (const f of readdirSync(cfg.scenariosDir).filter((x) => x.endsWith(".yaml"))) {
    try {
      const s = Scenario.parse(parseYaml(readFileSync(join(cfg.scenariosDir, f), "utf8")));
      out[s.id] = s.task;
    } catch {
      /* skip */
    }
  }
  return out;
}


// ───────────────────────── agent transcripts (Crash Test writes runs/<scenarioRunId>/transcript.json)

const TranscriptEntry = z.object({
  step: z.number(),
  kind: z.string(),
  tool: z.string().optional(),
  args: z.record(z.unknown()).optional(),
  isError: z.boolean().optional(),
  result: z.string().optional(),
  note: z.string().optional(),
  text: z.string().optional(),
});
export type TranscriptEntry = z.infer<typeof TranscriptEntry>;
const TranscriptFile = z.object({ agent: z.object({ transcript: z.array(TranscriptEntry) }) });

/** What the agent did, step by step, or null when the file is missing or unreadable (the report still renders). */
export function loadTranscript(cfg: DashConfig, scenarioRunId: string): TranscriptEntry[] | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(scenarioRunId) || scenarioRunId.includes("..")) return null;
  return readOptional(join(cfg.runsDir, scenarioRunId, "transcript.json"), TranscriptFile)?.agent.transcript ?? null;
}
