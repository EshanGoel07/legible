import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Health, Manifest, Report } from "@legible/contracts";
import { getConfig, hiddenReason, listRuns, loadManifestView, loadReportView, pickComparison, saveManifest, SaveError, type DashConfig } from "../lib/data";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const fixture = () => Manifest.parse(JSON.parse(readFileSync(join(REPO, "fixtures/manifest.demo-store.json"), "utf8")));
const report = (runId: string, createdAt: string, passed: boolean[]) =>
  Report.parse({ runId, siteId: "demo-store", createdAt, score: passed.every(Boolean) ? 100 : 25, scenarios: passed.map((p, i) => ({ id: `s${i}`, agent: "m", passed: p, failures: p ? [] : [{ kind: "tool_error", message: "boom" }] })) });

let tmp: string;
let cfg: DashConfig;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "dash-test-"));
  mkdirSync(join(tmp, "runs"));
  cpSync(join(REPO, "fixtures"), join(tmp, "fixtures"), { recursive: true });
  writeFileSync(join(tmp, "pnpm-workspace.yaml"), "");
  cfg = getConfig({ MANIFEST_PATH: "runs/manifest.json", RUNS_DIR: "runs", PUBLISHER_URL: "http://127.0.0.1:9" }, tmp);
});

describe("manifest", () => {
  it("falls back to the fixture manifest, read-only, when nothing was scanned yet", () => {
    const v = loadManifestView(cfg);
    expect(v.ok && v.source).toBe("fixture");
    expect(v.ok && v.readOnly).toBe(true);
  });

  it("a fixtures/ MANIFEST_PATH is read-only and cannot be saved", () => {
    const fx = getConfig({ MANIFEST_PATH: "fixtures/manifest.demo-store.json", RUNS_DIR: "runs" }, tmp);
    const v = loadManifestView(fx);
    expect(v.ok && v.readOnly).toBe(true);
    expect(() => saveManifest(fx, fixture())).toThrow(/read-only/);
  });

  it("saves approvals atomically after Manifest.parse; shows routes kept away from agents", () => {
    const m = fixture();
    writeFileSync(cfg.manifestPath, JSON.stringify(m));
    writeFileSync(cfg.manifestPath.replace(".json", ".details.json"), JSON.stringify({ model: "x", routes: [{ method: "POST", path: "/api/orders", file: "src/routes/orders.ts", line: 11, note: "money route without a GET cart/total route: cannot bind to Safe Pay, not exposed", llm: null, final: { expose: false, name: "create_order", risk: "money", confidence: 0.9 } }] }));
    const v = loadManifestView(cfg);
    expect(v.ok && v.source).toBe("scan");
    expect(v.ok && v.readOnly).toBe(false);
    expect(v.ok && v.hidden).toEqual([expect.objectContaining({ path: "/api/orders", risk: "money", reason: expect.stringMatching(/PayPal/) })]);

    m.tools[0].approved = false;
    saveManifest(cfg, m);
    expect(Manifest.parse(JSON.parse(readFileSync(cfg.manifestPath, "utf8"))).tools[0].approved).toBe(false);
    expect(readdirSync(join(tmp, "runs")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects invalid manifests with the Zod issue, and a different site", () => {
    writeFileSync(cfg.manifestPath, JSON.stringify(fixture()));
    const bad = fixture() as any;
    bad.tools[5].binding = { kind: "http", method: "POST", path: "/x" }; // money tool without safepay binding
    expect(() => saveManifest(cfg, bad)).toThrow(/money tools must use a safepay binding/);
    const other = fixture();
    other.site.id = "elsewhere";
    expect(() => saveManifest(cfg, other)).toThrow(SaveError);
  });

  it("unreadable manifest → error view, not a crash", () => {
    writeFileSync(cfg.manifestPath, "{ nope");
    expect(loadManifestView(cfg).ok).toBe(false);
  });

  it("hiddenReason translates the scanner's note", () => {
    expect(hiddenReason("money route … cannot bind to Safe Pay", "x")).toMatch(/PayPal/);
    expect(hiddenReason(undefined, "web page only")).toBe("web page only");
  });
});

describe("runs + report", () => {
  const writeRun = (id: string, r: ReturnType<typeof report>, bugs?: "on" | "off") => {
    mkdirSync(join(tmp, "runs", id));
    writeFileSync(join(tmp, "runs", id, "report.json"), JSON.stringify(r));
    if (bugs) writeFileSync(join(tmp, "runs", id, "demo.json"), JSON.stringify({ bugs }));
  };

  it("no runs → the sample report", () => {
    const v = loadReportView(cfg);
    expect(v.ok && v.source).toBe("sample");
  });

  it("newest first; bad reports are listed as errors, not fatal; scenario tasks come from fixtures", () => {
    writeRun("r_old", report("r_old", "2026-11-12T01:00:00Z", [true]));
    writeRun("r_new", report("r_new", "2026-11-12T02:00:00Z", [false]));
    mkdirSync(join(tmp, "runs", "r_bad"));
    writeFileSync(join(tmp, "runs", "r_bad", "report.json"), JSON.stringify({ score: 500 }));
    const { runs, errors } = listRuns(cfg);
    expect(runs.map((r) => r.id)).toEqual(["r_new", "r_old"]);
    expect(errors[0]).toMatch(/r_bad/);
    const v = loadReportView(cfg);
    expect(v.ok && v.run.id).toBe("r_new");
    expect(v.ok && v.tasks["buy-hoodie-coupon"]).toMatch(/DIWALI20/);
    expect(loadReportView(cfg, "r_old").ok && (loadReportView(cfg, "r_old") as any).run.id).toBe("r_old");
  });

  it("comparison prefers bugs ON vs bugs OFF, else the two newest runs", () => {
    writeRun("a", report("a", "2026-11-12T01:00:00Z", [false]), "on");
    writeRun("b", report("b", "2026-11-12T02:00:00Z", [true]));
    expect(pickComparison(listRuns(cfg).runs)?.labels).toEqual(["Previous run", "Latest run"]);
    writeRun("c", report("c", "2026-11-12T03:00:00Z", [true]), "off");
    const c = pickComparison(listRuns(cfg).runs)!;
    expect([c.before.id, c.after.id, ...c.labels]).toEqual(["a", "c", "Store bugs ON", "Store bugs OFF"]);
  });
});

describe("route handlers", () => {
  let saved: NodeJS.ProcessEnv;
  beforeEach(() => {
    saved = { ...process.env };
    process.env.MANIFEST_PATH = cfg.manifestPath;
    process.env.RUNS_DIR = cfg.runsDir;
    process.env.PUBLISHER_URL = "http://127.0.0.1:9";
  });
  afterEach(() => {
    process.env = saved;
  });

  it("GET /health returns Health", async () => {
    const { GET } = await import("../app/health/route");
    expect(Health.parse(await GET().json()).service).toBe("dashboard");
  });

  it("PUT /api/manifest saves a valid manifest (publisher offline → null) and 400s on an invalid one", async () => {
    writeFileSync(cfg.manifestPath, JSON.stringify(fixture()));
    const { PUT } = await import("../app/api/manifest/route");
    const m = fixture();
    m.tools.forEach((t) => (t.approved = t.risk !== "money"));
    const ok = await PUT(new Request("http://x/api/manifest", { method: "PUT", body: JSON.stringify(m) }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, total: 6, publisher: null, approved: expect.not.arrayContaining(["checkout"]) });
    const bad = await PUT(new Request("http://x/api/manifest", { method: "PUT", body: JSON.stringify({ manifestVersion: "0.1" }) }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/site|tools/);
  });
});
