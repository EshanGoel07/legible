/**
 * pnpm demo [--bugs on|off] [--manual] [--exit]
 *
 * The golden path in one command:
 *   ports free? → start store (bug flags) + Safe Pay (test mode) → /health → scan demo/store → start Publisher on the
 *   scanned manifest → /health → (dashboard if apps/dashboard exists) → Crash Test all scenarios → summary + report path.
 *
 *   --bugs on|off  planted store bugs, including the prompt-injection note (default on: the "before" picture)
 *   --manual       scanner leaves tools unapproved; approve them in the dashboard, then press Enter (needs apps/dashboard)
 *   --exit         stop all services when done (default: keep them running for the dashboard / video until Ctrl+C)
 *
 * Service logs: runs/demo-logs/<service>.log. Only uses Node built-ins; every URL from env, every path from ROUTES.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Health, Manifest, Report, ROUTES } from "@legible/contracts";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
try {
  process.loadEnvFile(join(ROOT, ".env"));
} catch {
  /* host environment */
}

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: { bugs: { type: "string", default: "on" }, manual: { type: "boolean", default: false }, exit: { type: "boolean", default: false } },
});

const url = (name: string, def: string) => (process.env[name] ?? def).replace(/\/+$/, "");
const URLS = {
  store: url("STORE_URL", "http://localhost:3001"),
  safepay: url("SAFEPAY_URL", "http://localhost:3003"),
  publisher: url("PUBLISHER_URL", "http://localhost:3002"),
  dashboard: url("DASHBOARD_URL", "http://localhost:3004"),
};
const RUNS = resolve(ROOT, process.env.RUNS_DIR ?? "runs");
const LOGS = join(RUNS, "demo-logs");
const MANIFEST = join(RUNS, "manifest.json");
const hasDashboard = existsSync(join(ROOT, "apps/dashboard/package.json"));

const c = { b: (s: string) => `\x1b[1m${s}\x1b[0m`, g: (s: string) => `\x1b[32m${s}\x1b[0m`, r: (s: string) => `\x1b[31m${s}\x1b[0m`, y: (s: string) => `\x1b[33m${s}\x1b[0m`, d: (s: string) => `\x1b[2m${s}\x1b[0m` };
const step = (s: string) => console.log(`\n${c.b("▸ " + s)}`);
const children: Array<{ name: string; proc: ChildProcess }> = [];

if (values.bugs !== "on" && values.bugs !== "off") fail(`--bugs must be on or off (got ${values.bugs})`);
const bugsOn = values.bugs === "on";

function fail(msg: string): never {
  console.error(`\n${c.r("✗ demo failed:")} ${msg}`);
  stopAll();
  process.exit(1);
}

function stopAll() {
  for (const { proc } of children) {
    if (proc.pid && proc.exitCode === null) {
      try {
        process.kill(-proc.pid, "SIGTERM"); // whole group: pnpm → tsx → node
      } catch {
        /* already gone */
      }
    }
  }
}
process.on("SIGINT", () => {
  console.log("\nstopping services…");
  stopAll();
  process.exit(0);
});

// ───────────── preflight

function checkEnv() {
  const need = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_SANDBOX_BUYER_EMAIL", "PAYPAL_SANDBOX_BUYER_PASSWORD", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) fail(`missing in .env: ${missing.join(", ")} (see .env.example)`);
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20 || major >= 23) fail(`Node ${process.versions.node}: use Node 22 (see .nvmrc); better-sqlite3 has no build for Node ${major}`);
}

const portFree = (port: number) =>
  new Promise<boolean>((res) => {
    const s = createServer();
    s.once("error", () => res(false));
    s.listen(port, () => s.close(() => res(true)));
  });

async function checkPorts() {
  const want = [URLS.store, URLS.safepay, URLS.publisher, ...(hasDashboard ? [URLS.dashboard] : [])].map((u) => Number(new URL(u).port));
  const busy: number[] = [];
  for (const p of want) if (!(await portFree(p))) busy.push(p);
  if (busy.length) fail(`port(s) ${busy.join(", ")} already in use. Stop the old services first, e.g.  kill $(lsof -t -iTCP:${busy[0]} -sTCP:LISTEN)`);
  console.log(`  ports free: ${want.join(", ")}`);
}

/** Safe Pay's test approval drives a headless Chromium; a clean clone has to download it once. */
async function checkChromium() {
  const code = `import("playwright").then(({ chromium }) => { const fs = require("node:fs"); process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 3); }).catch(() => process.exit(4));`;
  const ok = await new Promise<number>((res) => spawn(process.execPath, ["-e", code], { cwd: join(ROOT, "apps/safepay"), stdio: "ignore" }).on("exit", (n) => res(n ?? 1)));
  if (ok !== 0) fail(`Playwright Chromium is not installed. Run once:  pnpm --filter @legible/safepay exec playwright install chromium`);
  console.log("  Playwright Chromium: installed");
}

// ───────────── services

function start(name: string, filter: string, script: string, env: Record<string, string> = {}) {
  mkdirSync(LOGS, { recursive: true });
  const log = createWriteStream(join(LOGS, `${name}.log`));
  const proc = spawn("pnpm", ["--filter", filter, script], { cwd: ROOT, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  proc.stdout!.pipe(log);
  proc.stderr!.pipe(log);
  children.push({ name, proc });
  return proc;
}

async function waitHealthy(name: string, base: string, service: Health["service"], proc: ChildProcess, timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (proc.exitCode !== null) fail(`${name} exited (code ${proc.exitCode}). Last log lines:\n${tail(name)}`);
    try {
      const h = Health.parse(await (await fetch(base + ROUTES.health)).json());
      if (h.ok && h.service === service) {
        console.log(`  ${c.g("✓")} ${name.padEnd(9)} ${base}  ${c.d(`v${h.version} · contracts ${h.contractsVersion}`)}`);
        return;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  fail(`${name} did not become healthy at ${base}${ROUTES.health} within ${timeoutMs / 1000}s. Last log lines:\n${tail(name)}`);
}

const tail = (name: string) => {
  try {
    return readFileSync(join(LOGS, `${name}.log`), "utf8").trim().split("\n").slice(-15).join("\n");
  } catch {
    return "(no log)";
  }
};

/** Runs a pnpm script to completion; `onLine` sees every output line (stdout + stderr). */
function run(args: string[], env: Record<string, string>, onLine: (l: string) => void): Promise<number> {
  return new Promise((res) => {
    const p = spawn("pnpm", args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    for (const s of [p.stdout!, p.stderr!]) createInterface({ input: s }).on("line", onLine);
    p.on("exit", (code) => res(code ?? 1));
  });
}

// ───────────── main

async function main() {
  const t0 = Date.now();
  console.log(c.b(`Legible demo · store bugs ${bugsOn ? c.r("ON") : c.g("OFF")} · ${values.manual ? "manual approval" : "auto-approve"}`));

  step("Preflight");
  checkEnv();
  await checkPorts();
  await checkChromium();

  step("Start store + Safe Pay");
  const flags = bugsOn ? "1" : "0";
  const store = start("store", "@legible/store", "dev", { BUG_COUPON_API: flags, BUG_PAID_EARLY: flags, BUG_PROMPT_INJECTION: flags });
  const safepay = start("safepay", "@legible/safepay", "dev", { SAFEPAY_TEST_MODE: "1" });
  await waitHealthy("store", URLS.store, "store", store);
  await waitHealthy("safepay", URLS.safepay, "safepay", safepay);

  step(`Scan demo/store → ${MANIFEST}`);
  const manual = values.manual && hasDashboard;
  if (values.manual && !hasDashboard) console.log(c.y("  --manual needs apps/dashboard; it is not in this checkout, so tools are auto-approved."));
  const scanArgs = ["--filter", "@legible/scanner", "scan", join(ROOT, "demo/store"), "--out", MANIFEST, "--previous", join(ROOT, "fixtures/manifest.demo-store.json"), ...(manual ? [] : ["--approve-all"])];
  const scanCode = await run(scanArgs, {}, (l) => {
    if (/^\s+\S+\s+(read|write|money)\s|tools from|warning|FAILED|stage 1/.test(l)) console.log(`  ${l.replace(/^\[scanner\] /, "")}`);
  });
  if (scanCode !== 0) fail("scanner failed (see output above)");
  const manifest = Manifest.parse(JSON.parse(readFileSync(MANIFEST, "utf8")));

  step("Start Publisher (MCP)" + (hasDashboard ? " + Dashboard" : ""));
  const publisher = start("publisher", "@legible/publisher", "dev", { MANIFEST_PATH: MANIFEST, RUNS_DIR: RUNS });
  await waitHealthy("publisher", URLS.publisher, "publisher", publisher);
  if (hasDashboard) {
    const dash = start("dashboard", "@legible/dashboard", "dev", { MANIFEST_PATH: MANIFEST, RUNS_DIR: RUNS });
    try {
      await waitHealthy("dashboard", URLS.dashboard, "dashboard", dash, 120_000);
    } catch {
      console.log(c.y("  dashboard did not start; continuing without it"));
    }
  } else {
    console.log(c.d("  (no apps/dashboard/package.json: skipping the dashboard)"));
  }

  if (manual) {
    console.log(`\n  ${c.b("Your turn:")} open ${c.b(URLS.dashboard + "/tools")}, approve the tools agents may use, click ${c.b("Save manifest")}, then press Enter here…`);
    await new Promise((r) => createInterface({ input: process.stdin }).once("line", r));
    const m = Manifest.parse(JSON.parse(readFileSync(MANIFEST, "utf8")));
    console.log(`  ${m.tools.filter((t) => t.approved).length}/${m.tools.length} tools approved`);
  } else {
    console.log(`  ${manifest.tools.filter((t) => t.approved).length}/${manifest.tools.length} tools approved for agents: ${manifest.tools.map((t) => `${t.name} (${t.risk})`).join(", ")}`);
  }

  step("Crash Test: an AI agent shops through MCP, pays through PayPal Sandbox");
  let reportPath = "";
  const crashCode = await run(["--filter", "@legible/crashtest", "crash", "--all"], { MANIFEST_PATH: MANIFEST, RUNS_DIR: RUNS }, (l) => {
    const m = l.match(/^report: (.+)$/);
    if (m) reportPath = m[1].trim();
    if (/^(Crash Test|▶|✓|✗|crashtest FAILED)|^\s{2}PayPal Sandbox|^\s{4}\w+: /.test(l)) console.log(`  ${l}`);
  });
  if (crashCode !== 0 || !reportPath) fail(`Crash Test failed (exit ${crashCode})`);

  // ───── summary from the report itself (Contract 5)
  const report = Report.parse(JSON.parse(readFileSync(reportPath, "utf8")));
  // Tag the run so the dashboard can show bugs ON vs OFF side by side.
  writeFileSync(join(dirname(reportPath), "demo.json"), JSON.stringify({ bugs: bugsOn ? "on" : "off", manual, createdAt: report.createdAt }, null, 2) + "\n");
  const bar = report.score >= 80 ? c.g : report.score >= 50 ? c.y : c.r;
  console.log(`\n${"═".repeat(64)}\n${c.b("Agent-Readiness Score")}  ${bar(c.b(`${report.score}/100`))}   site ${report.siteId} · store bugs ${bugsOn ? "ON" : "OFF"}\n${"─".repeat(64)}`);
  for (const s of report.scenarios) {
    console.log(`${s.passed ? c.g("✓ PASS") : c.r("✗ FAIL")}  ${s.id}  ${c.d(s.agent)}`);
    for (const f of s.failures) console.log(`        ${c.y(f.kind)}  ${f.message}`);
  }
  console.log(`${"─".repeat(64)}\nreport    ${reportPath}`);
  console.log(`manifest  ${MANIFEST}`);
  console.log(`logs      ${LOGS}/`);
  if (hasDashboard) console.log(`dashboard ${URLS.dashboard}/report?run=${encodeURIComponent(report.runId)}   (tools: ${URLS.dashboard}/tools)`);
  console.log(`MCP       ${URLS.publisher}/mcp   (header x-legible-run)`);
  console.log(c.d(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`));
  writeFileSync(join(RUNS, "latest-report.txt"), reportPath + "\n");

  if (values.exit) {
    stopAll();
    process.exit(0);
  }
  console.log(`\nServices are still running (store ${URLS.store}). Press Ctrl+C to stop them.`);
}

main().catch((e) => fail((e as Error).message));
