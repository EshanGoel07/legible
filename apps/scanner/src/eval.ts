/**
 * Scanner eval against hand-labelled ground truth.
 *   pnpm --filter @legible/scanner eval [--truth eval/ground-truth.demo-store.json] [--no-cache]
 * Runs the real pipeline (LLM answers cached by prompt hash; --no-cache forces fresh calls), then prints:
 * tool precision/recall/F1 (expose decision), risk-tier accuracy (pipeline vs rules-only vs LLM-only), name match.
 * Writes runs/eval/<site>.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { AnswerCache } from "./cache.js";
import { ruleRisk } from "./classify.js";
import { loadDotEnv, resolveInput, resolveOutput, siteDefaults } from "./env.js";
import { Llm } from "./llm.js";
import { scan } from "./pipeline.js";
import type { RouteDetail } from "./build.js";

const Truth = z.object({
  site: z.string(),
  root: z.string(),
  routes: z.array(z.object({ method: z.string(), path: z.string(), expose: z.boolean(), name: z.string().optional(), risk: z.enum(["read", "write", "money"]) })),
});

export type EvalMetrics = ReturnType<typeof score>;

/** Pure scoring so it can be unit-tested. */
export function score(truth: z.infer<typeof Truth>, details: RouteDetail[], discovered: Array<{ method: string; path: string; handlerSource: string }>) {
  const key = (m: string, p: string) => `${m} ${p}`;
  const byKey = new Map(details.map((d) => [key(d.method, d.path), d]));
  const discByKey = new Map(discovered.map((d) => [key(d.method, d.path), d]));
  let tp = 0, fp = 0, fn = 0, tn = 0, riskOk = 0, riskN = 0, riskTpOk = 0, ruleOk = 0, llmOk = 0, nameOk = 0, found = 0;
  const confRight: number[] = [], confWrong: number[] = [];
  const rows = truth.routes.map((t) => {
    const d = byKey.get(key(t.method, t.path));
    const disc = discByKey.get(key(t.method, t.path));
    if (disc) found++;
    const predExpose = d?.final?.expose ?? false;
    if (t.expose && predExpose) tp++;
    else if (!t.expose && predExpose) fp++;
    else if (t.expose && !predExpose) fn++;
    else tn++;
    const rule = disc ? ruleRisk({ method: t.method as "GET", path: t.path, handlerSource: disc.handlerSource }).risk : null;
    if (rule === t.risk) ruleOk++;
    if (d?.llm?.risk === t.risk) llmOk++;
    const predRisk = d?.final?.risk ?? null;
    if (predRisk) {
      riskN++;
      const ok = predRisk === t.risk;
      if (ok) riskOk++;
      if (ok && predExpose === t.expose) confRight.push(d!.final!.confidence);
      else confWrong.push(d!.final!.confidence);
      if (t.expose && predExpose && ok) riskTpOk++;
    }
    if (t.expose && predExpose && d?.final?.name === t.name) nameOk++;
    return { route: key(t.method, t.path), truth: t, pred: d?.final ?? null, rule, llmRisk: d?.llm?.risk ?? null, agreed: d?.classified?.agreed ?? null, error: d?.error ?? null };
  });
  const n = truth.routes.length;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  return {
    n,
    discoveryRecall: found / n,
    tool: { tp, fp, fn, tn, precision, recall, f1 },
    risk: { pipeline: riskN ? riskOk / riskN : 0, pipelineOnTruePositives: tp ? riskTpOk / tp : 0, rulesOnly: ruleOk / n, llmOnly: llmOk / n },
    nameExact: tp ? nameOk / tp : 0,
    meanConfidence: { correct: mean(confRight), wrong: mean(confWrong) },
    rows,
  };
}

async function main() {
  loadDotEnv();
  const { values } = parseArgs({
    options: {
      truth: { type: "string", default: fileURLToPath(new URL("../eval/ground-truth.demo-store.json", import.meta.url)) },
      "no-cache": { type: "boolean", default: false },
      concurrency: { type: "string", default: process.env.SCAN_CONCURRENCY ?? "2" },
    },
  });
  const truthPath = resolveInput(values.truth!);
  const truth = Truth.parse(JSON.parse(readFileSync(truthPath, "utf8")));
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const root = resolve(repoRoot, truth.root);
  const log = (m: string) => console.error(`[eval] ${m}`);
  const llm = Llm.fromEnv(process.env, log);
  const cache = new AnswerCache(values["no-cache"] ? null : resolveOutput(process.env.SCANNER_CACHE_DIR ?? "runs/.scanner-cache"));
  const site = siteDefaults(root);
  const result = await scan(root, llm, {
    site: { ...site, baseUrl: "http://localhost:3001" },
    limits: { currency: "USD", maxAmount: 100 },
    concurrency: Number(values.concurrency),
    cache,
    log,
  });
  const m = score(truth, result.details, result.discovered.routes);

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const out: string[] = [];
  out.push(`\nScanner eval · site ${truth.site} · ${m.n} labelled routes · model ${llm.model}`);
  out.push(`LLM calls ${llm.stats.calls} (forced-tool ok ${llm.stats.forcedToolOk}, JSON fallbacks ${llm.stats.jsonFallbacks}, retries ${llm.stats.retries}) · cache hits ${cache.hits} · ${(result.ms / 1000).toFixed(1)}s\n`);
  out.push(`| route | truth | predicted | rules | LLM | conf | ok |`);
  out.push(`|---|---|---|---|---|---|---|`);
  for (const r of m.rows) {
    const t = `${r.truth.expose ? r.truth.name : "–"} ${r.truth.risk}`;
    const p = r.pred ? `${r.pred.expose ? r.pred.name : "–"} ${r.pred.risk}` : `ERROR`;
    const ok = r.pred && r.pred.expose === r.truth.expose && r.pred.risk === r.truth.risk ? "✓" : "✗";
    out.push(`| ${r.route} | ${t} | ${p} | ${r.rule ?? "–"} | ${r.llmRisk ?? "–"} | ${r.pred?.confidence ?? "–"} | ${ok} |`);
  }
  out.push("");
  out.push(`| metric | value |`);
  out.push(`|---|---|`);
  out.push(`| discovery recall (stage 1, deterministic) | ${pct(m.discoveryRecall)} |`);
  out.push(`| tool precision | ${pct(m.tool.precision)} (TP ${m.tool.tp}, FP ${m.tool.fp}) |`);
  out.push(`| tool recall | ${pct(m.tool.recall)} (FN ${m.tool.fn}) |`);
  out.push(`| tool F1 | ${pct(m.tool.f1)} |`);
  out.push(`| risk-tier accuracy, pipeline (all routes) | ${pct(m.risk.pipeline)} |`);
  out.push(`| risk-tier accuracy, pipeline (exposed tools) | ${pct(m.risk.pipelineOnTruePositives)} |`);
  out.push(`| risk-tier accuracy, rules only | ${pct(m.risk.rulesOnly)} |`);
  out.push(`| risk-tier accuracy, LLM only | ${pct(m.risk.llmOnly)} |`);
  out.push(`| tool name exact match (raw LLM names) | ${pct(m.nameExact)} |`);
  out.push(`| mean confidence: correct / wrong | ${m.meanConfidence.correct?.toFixed(2) ?? "–"} / ${m.meanConfidence.wrong?.toFixed(2) ?? "–"} |`);
  console.log(out.join("\n"));

  const file = resolveOutput(`runs/eval/${truth.site}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), model: llm.model, llm: llm.stats, cacheHits: cache.hits, metrics: m }, null, 2) + "\n");
  console.error(`[eval] wrote ${file}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(`[eval] FAILED: ${(e as Error).message}`);
    process.exit(1);
  });
}
