/** Reads + validates the manifest; re-read when the file changes so dashboard approvals apply without a restart. */
import { readFileSync, statSync } from "node:fs";
import { Manifest } from "@legible/contracts";

let cached: { path: string; mtimeMs: number; manifest: Manifest } | null = null;

export function loadManifest(path: string): Manifest {
  const { mtimeMs } = statSync(path);
  if (cached && cached.path === path && cached.mtimeMs === mtimeMs) return cached.manifest;
  const manifest = Manifest.parse(JSON.parse(readFileSync(path, "utf8")));
  cached = { path, mtimeMs, manifest };
  return manifest;
}

export const approvedTools = (m: Manifest) => m.tools.filter((t) => t.approved);
