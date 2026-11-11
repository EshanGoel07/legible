// Join: Crash Test → Publisher: calls carry x-legible-run and land in runs/<runId>/calls.jsonl as ToolCallLog lines.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ToolCallLog } from "@legible/contracts";
import { RUNS, URLS, mcp, up } from "./helpers";

const ready = await up(URLS.publisher, "publisher");

describe.skipIf(!ready)("crashtest → publisher", () => {
  it("every call (ok or refused) is logged under the run header's id", async () => {
    const runId = `contract_${Date.now()}`;
    await mcp("tools/call", { name: "search_products", arguments: { q: "cap" } }, runId);
    await mcp("tools/call", { name: "no_such_tool", arguments: {} }, runId);
    const lines = readFileSync(join(RUNS, runId, "calls.jsonl"), "utf8").trim().split("\n").map((l) => ToolCallLog.parse(JSON.parse(l)));
    expect(lines.map((l) => [l.runId, l.tool, l.ok])).toEqual([[runId, "search_products", true], [runId, "no_such_tool", false]]);
  });
});
