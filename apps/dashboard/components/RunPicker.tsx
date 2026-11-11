"use client";
import { useRouter } from "next/navigation";

export function RunPicker({ runs, current }: { runs: Array<{ id: string; score: number; bugs: "on" | "off" | null; createdAt: string }>; current: string }) {
  const router = useRouter();
  return (
    <label className="flex shrink-0 flex-col gap-1 text-sm text-slate-500">
      Run
      <select value={current} onChange={(e) => router.push(`/report?run=${encodeURIComponent(e.target.value)}`)}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[15px] text-slate-900 shadow-sm">
        {runs.map((r) => (
          <option key={r.id} value={r.id}>{r.createdAt} · {r.score}/100{r.bugs ? ` · bugs ${r.bugs}` : ""}</option>
        ))}
      </select>
    </label>
  );
}
