// Join: Dashboard ← Crash Test report (Contract 5) + manifest (Contract 1).
import { describe, expect, it } from "vitest";
import { Manifest, Report, ROUTES } from "@legible/contracts";
import { json, up } from "./helpers";

const DASH = (process.env.DASHBOARD_URL ?? "http://localhost:3004").replace(/\/+$/, "");
const ready = await up(DASH, "dashboard");

describe.skipIf(!ready)("dashboard ← report + manifest", () => {
  it("serves the newest report as a valid Report", async () => {
    const { status, body } = await json("GET", `${DASH}/api/report`);
    expect(status).toBe(200);
    const r = Report.parse(body.report);
    expect(r.scenarios.length).toBeGreaterThan(0);
  });

  it("serves the manifest it edits as a valid Manifest", async () => {
    const { body } = await json("GET", `${DASH}/api/manifest`);
    expect(Manifest.parse(body.manifest).tools.length).toBeGreaterThan(0);
  });

  it("pages render", async () => {
    for (const p of ["/tools", "/report", ROUTES.health]) expect((await fetch(DASH + p)).status).toBe(200);
  });
});
