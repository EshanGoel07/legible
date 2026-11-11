"use client";
import { useRouter } from "next/navigation";

/** Sits in the ink hero of the report page. */
export function RunPicker({ runs, current }: { runs: Array<{ id: string; score: number; bugs: "on" | "off" | null; createdAt: string }>; current: string }) {
  const router = useRouter();
  return (
    <label className="flex flex-col gap-1.5 font-mono text-[13px] uppercase tracking-[0.14em] text-white/45">
      Run
      <select value={current} onChange={(e) => router.push(`/report?run=${encodeURIComponent(e.target.value)}`)}
        className="rounded-lg border border-white/20 bg-ink-2 px-3 py-2.5 font-mono text-[15px] normal-case tracking-normal text-white">
        {runs.map((r) => (
          <option key={r.id} value={r.id}>{r.createdAt} · {r.score}/100{r.bugs ? ` · bugs ${r.bugs}` : ""}</option>
        ))}
      </select>
    </label>
  );
}
