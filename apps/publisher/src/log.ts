/** Contract 2: one ToolCallLog line per tool call in <RUNS_DIR>/<runId>/calls.jsonl. */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ToolCallLog } from "@legible/contracts";

export const ADHOC_RUN = "adhoc";
/** Run ids become folder names: keep them boring. */
export const safeRunId = (v: unknown): string | undefined => (typeof v === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : undefined);

export function logCall(runsDir: string, entry: ToolCallLog): void {
  const line = ToolCallLog.parse(entry);
  const dir = join(runsDir, line.runId);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "calls.jsonl"), JSON.stringify(line) + "\n");
}
