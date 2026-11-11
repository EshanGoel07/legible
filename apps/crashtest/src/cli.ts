/**
 * pnpm --filter @legible/crashtest crash --all            (or: --scenario buy-hoodie-coupon --scenario over-limit)
 *   [--max-steps 25] [--agent <label>]
 * Needs the Publisher (PUBLISHER_URL) and Safe Pay with SAFEPAY_TEST_MODE=1 (SAFEPAY_URL). The agent's model is LLM_MODEL.
 * Writes runs/<suiteId>/report.json (Contract 5) and runs/<suiteId>_<scenario>/{calls.jsonl,transcript.json}.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parse as parseYaml } from "yaml";
import { Health, Manifest, Report, ROUTES, Scenario } from "@legible/contracts";
import { loadConfig, loadDotEnv } from "./config.js";
import { runScenario, type ScenarioOutcome } from "./harness.js";
import { score } from "./grade.js";
import { Llm } from "./llm.js";

loadDotEnv();
const cfg = loadConfig();
const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    all: { type: "boolean", default: false },
    scenario: { type: "string", multiple: true },
    "max-steps": { type: "string", default: "25" },
    agent: { type: "string" },
  },
});
const log = (m: string) => console.log(m);

async function health(url: string, service: string) {
  try {
    const h = Health.parse(await (await fetch(url + ROUTES.health)).json());
    if (!h.ok || h.service !== service) throw new Error(`unexpected health ${JSON.stringify(h)}`);
  } catch (e) {
    throw new Error(`${service} is not healthy at ${url} (${(e as Error).message})`);
  }
}

async function main() {
  const manifest = Manifest.parse(JSON.parse(readFileSync(cfg.manifestPath, "utf8")));
  const all = readdirSync(cfg.scenariosDir).filter((f) => f.endsWith(".yaml")).sort().map((f) => Scenario.parse(parseYaml(readFileSync(join(cfg.scenariosDir, f), "utf8"))));
  const wanted = values.all ? all : all.filter((s) => values.scenario?.includes(s.id));
  if (!wanted.length) throw new Error(`no scenarios selected (use --all or --scenario <id>; available: ${all.map((s) => s.id).join(", ")})`);
  const scenarios = wanted.filter((s) => s.site === manifest.site.id);
  for (const s of wanted) if (s.site !== manifest.site.id) log(`skip ${s.id}: scenario site ${s.site} ≠ manifest site ${manifest.site.id}`);

  await health(cfg.publisherUrl, "publisher");
  await health(cfg.safepayUrl, "safepay");
  const llm = Llm.fromEnv(process.env, (m) => log(`  [llm] ${m}`));
  if (values.agent && values.agent !== llm.model) log(`note: --agent ${values.agent} is a label only; the agent runs on LLM_MODEL=${llm.model}, which the report records.`);

  const suiteId = `r_${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "_")}`;
  log(`Crash Test ${suiteId} · site ${manifest.site.id} · agent ${llm.model} · ${scenarios.length} scenarios`);
  const outcomes: ScenarioOutcome[] = [];
  for (const s of scenarios) {
    log(`\n▶ ${s.id}: ${s.task}`);
    const t0 = Date.now();
    const o = await runScenario(s, { ...cfg, manifest, llm, maxSteps: Number(values["max-steps"]), suiteId, log });
    outcomes.push(o);
    log(`${o.passed ? "✓ PASS" : "✗ FAIL"} ${s.id} (${o.agent.steps} steps, ${((Date.now() - t0) / 1000).toFixed(0)}s${o.evidence.checkout ? `, checkout ${o.evidence.checkout.status} ${o.evidence.checkout.amount} ${o.evidence.checkout.currency}` : ""})`);
    for (const f of o.failures) log(`    ${f.kind}: ${f.message}`);
  }

  const report = Report.parse({
    runId: suiteId,
    siteId: manifest.site.id,
    createdAt: new Date().toISOString(),
    score: score(outcomes.map((o) => ({ scenario: o.scenario, passed: o.passed }))),
    scenarios: outcomes.map((o) => ({ id: o.scenario.id, agent: llm.model, passed: o.passed, failures: o.failures })),
  });
  const dir = join(cfg.runsDir, suiteId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(
    join(dir, "details.json"),
    JSON.stringify({ model: llm.model, llm: llm.stats, scenarios: outcomes.map((o) => ({ id: o.scenario.id, runId: o.runId, passed: o.passed, agent: o.agent, checkout: o.evidence.checkout, verifyPre: o.evidence.verifyPre, verifyPost: o.evidence.verifyPost })) }, null, 2) + "\n",
  );
  log(`\nAgent-Readiness Score: ${report.score}/100 (${outcomes.filter((o) => o.passed).length}/${outcomes.length} scenarios passed; money scenarios count 2x)`);
  log(`report: ${join(dir, "report.json")}`);
}

main().catch((e) => {
  console.error(`crashtest FAILED: ${(e as Error).message}`);
  process.exit(1);
});
