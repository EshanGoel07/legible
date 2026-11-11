/** discover → describe (LLM, limited concurrency) → classify + build. */
import { buildManifest, type BuildOptions, type BuildResult } from "./build.js";
import { describeRoute, type RouteDescription } from "./describe.js";
import { discoverRoutes, type DiscoverResult } from "./discover.js";
import type { AnswerCache } from "./cache.js";
import type { Llm } from "./llm.js";

export type ScanResult = BuildResult & { discovered: DiscoverResult; ms: number };

export async function scan(root: string, llm: Llm, opts: BuildOptions & { concurrency?: number; cache?: AnswerCache; allowPartial?: boolean; log?: (m: string) => void }): Promise<ScanResult> {
  const t0 = Date.now();
  const log = opts.log ?? (() => {});
  const discovered = discoverRoutes(root);
  log(`stage 1 discover: ${discovered.routes.length} routes${discovered.skipped.length ? `, ${discovered.skipped.length} skipped` : ""}`);
  for (const s of discovered.skipped) log(`  skipped ${s.file}:${s.line} ${s.reason}`);

  const described = await mapLimit(discovered.routes, opts.concurrency ?? 2, async (r): Promise<RouteDescription | Error> => {
    try {
      const d = await describeRoute(llm, r, opts.cache);
      log(`stage 2 describe: ${r.method} ${r.path} → ${d.expose ? d.name : "(not exposed)"} [${d.risk}, ${d.confidence}]`);
      return d;
    } catch (e) {
      log(`stage 2 describe: ${r.method} ${r.path} FAILED ${(e as Error).message}`);
      return e as Error;
    }
  });

  const failed = described.filter((d) => d instanceof Error).length;
  if (failed && !opts.allowPartial)
    throw new Error(`${failed}/${discovered.routes.length} routes could not be described by the LLM; refusing to write a partial manifest (use --allow-partial to override)`);
  const built = buildManifest(discovered.routes, described, opts);
  log(`stage 3 classify: ${built.details.filter((d) => d.classified && !d.classified.agreed).length} rule/model disagreements`);
  return { ...built, discovered, ms: Date.now() - t0 };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}
