/**
 * pnpm --filter @legible/scanner scan <siteDir> [--out runs/manifest.json] [--previous manifest.json]
 *   [--approve-all] [--site-id x] [--site-name x] [--base-url url] [--currency USD] [--max-amount 100]
 * Writes the manifest (Manifest.parse-valid) and <out>.details.json (every route's decision, for the eval/dashboard).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { Manifest } from "@legible/contracts";
import { loadDotEnv, resolveInput, resolveOutput, siteDefaults } from "./env.js";
import { Llm } from "./llm.js";
import { AnswerCache } from "./cache.js";
import { scan } from "./pipeline.js";

loadDotEnv();
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    previous: { type: "string" },
    "approve-all": { type: "boolean", default: false },
    "site-id": { type: "string" },
    "site-name": { type: "string" },
    "base-url": { type: "string" },
    currency: { type: "string", default: "USD" },
    "max-amount": { type: "string", default: "100" },
    concurrency: { type: "string", default: process.env.SCAN_CONCURRENCY ?? "2" },
    "no-cache": { type: "boolean", default: false },
    "allow-partial": { type: "boolean", default: false },
  },
});
if (!positionals[0]) {
  console.error("usage: scan <siteDir> [--out file] [--previous manifest.json] [--approve-all]");
  process.exit(2);
}

const root = resolveInput(positionals[0]);
const site = siteDefaults(root);
const log = (m: string) => console.error(`[scanner] ${m}`);
const llm = Llm.fromEnv(process.env, log);
const cache = new AnswerCache(values["no-cache"] ? null : resolveOutput(process.env.SCANNER_CACHE_DIR ?? "runs/.scanner-cache"));
log(`scanning ${root} with model ${llm.model}`);

try {
  const result = await scan(root, llm, {
    site: { id: values["site-id"] ?? site.id, name: values["site-name"] ?? site.name, baseUrl: values["base-url"] ?? process.env.STORE_URL ?? "http://localhost:3001" },
    limits: { currency: values.currency!, maxAmount: Number(values["max-amount"]) },
    approveAll: values["approve-all"],
    previous: values.previous ? Manifest.parse(JSON.parse(readFileSync(resolveInput(values.previous), "utf8"))) : undefined,
    concurrency: Number(values.concurrency),
    cache,
    allowPartial: values["allow-partial"],
    log,
  });
  const json = JSON.stringify(Manifest.parse(result.manifest), null, 2) + "\n";
  if (values.out) {
    const out = resolveOutput(values.out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, json);
    writeFileSync(out.replace(/\.json$/, "") + ".details.json", JSON.stringify({ model: llm.model, ms: result.ms, llm: llm.stats, cacheHits: cache.hits, warnings: result.warnings, routes: result.details }, null, 2) + "\n");
    log(`wrote ${out}`);
  } else {
    process.stdout.write(json);
  }
  console.error("");
  console.error(`  ${"tool".padEnd(18)} ${"risk".padEnd(6)} ${"conf".padEnd(5)} binding`);
  for (const t of result.manifest.tools)
    console.error(`  ${t.name.padEnd(18)} ${t.risk.padEnd(6)} ${String(t.confidence ?? "").padEnd(5)} ${t.binding.kind === "http" ? `${t.binding.method} ${t.binding.path}` : `safepay ← ${t.binding.cartPath}`}${t.riskReason?.startsWith("Review") ? "  ⚠ review" : ""}`);
  console.error(`\n  ${result.manifest.tools.length} tools from ${result.discovered.routes.length} routes in ${(result.ms / 1000).toFixed(1)}s · LLM calls ${llm.stats.calls}, retries ${llm.stats.retries}, forced-tool ok ${llm.stats.forcedToolOk}, JSON fallbacks ${llm.stats.jsonFallbacks}, cache hits ${cache.hits}`);
  for (const w of result.warnings) console.error(`  warning: ${w}`);
} catch (e) {
  log(`FAILED: ${(e as Error).message}`);
  process.exit(1);
}
