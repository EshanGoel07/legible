/**
 * Content-addressed cache of LLM answers: key = sha256(model + system + user prompt).
 * Unchanged code → zero LLM calls on rescans (free tiers have small daily quotas). `--no-cache` bypasses it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class AnswerCache {
  hits = 0;
  misses = 0;
  constructor(private readonly dir: string | null) {
    if (dir) mkdirSync(dir, { recursive: true });
  }
  private file(parts: string[]) {
    return join(this.dir!, `${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32)}.json`);
  }
  get(parts: string[]): unknown | undefined {
    if (!this.dir) return undefined;
    const f = this.file(parts);
    if (!existsSync(f)) return (this.misses++, undefined);
    this.hits++;
    return JSON.parse(readFileSync(f, "utf8"));
  }
  set(parts: string[], value: unknown) {
    if (this.dir) writeFileSync(this.file(parts), JSON.stringify(value, null, 2));
  }
}
