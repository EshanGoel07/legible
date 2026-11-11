// Join: Scanner → Publisher: the scanned manifest is valid and the Publisher serves exactly its approved tools.
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Manifest } from "@legible/contracts";
import { RUNS, URLS, json, mcp, readJson, up } from "./helpers";

const file = join(RUNS, "manifest.json");
const ready = existsSync(file) && (await up(URLS.publisher, "publisher"));

describe.skipIf(!ready)("scanner → publisher", () => {
  it("runs/manifest.json passes Manifest.parse; money tools are safepay-bound with limits", () => {
    const m = Manifest.parse(readJson(file));
    for (const t of m.tools.filter((x) => x.risk === "money")) expect(t).toMatchObject({ binding: { kind: "safepay" }, limits: { currency: "USD" } });
  });

  it("the Publisher lists exactly the approved tools of the manifest it serves", async () => {
    const info = (await json("GET", `${URLS.publisher}/`)).body;
    const { tools } = await mcp("tools/list", {});
    expect(tools.map((t: any) => t.name).sort()).toEqual(info.approved.map((s: string) => s.split(" ")[0]).sort());
  });
});
