/** Small shared pieces: banners, empty/error cards, skeletons. Server-safe (no hooks). */
export function Banner({ tone = "info", title, children }: { tone?: "info" | "warn" | "error"; title: string; children?: React.ReactNode }) {
  const cls = { info: "border-sky-200 bg-sky-50 text-sky-900", warn: "border-amber-200 bg-amber-50 text-amber-900", error: "border-rose-200 bg-rose-50 text-rose-900" }[tone];
  return (
    <div className={`mb-6 rounded-xl border px-5 py-4 ${cls}`}>
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-1 text-[15px] opacity-90">{children}</div>}
    </div>
  );
}

export function ErrorCard({ title, message, hint }: { title: string; message: string; hint?: string }) {
  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-rose-200 bg-white p-8 shadow-sm">
      <div className="text-sm font-semibold uppercase tracking-wide text-rose-600">Something is wrong</div>
      <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
      <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-mono text-sm text-slate-700">{message}</pre>
      {hint && <p className="mt-4 text-slate-600">{hint}</p>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-slate-200/70 ${className}`} />;
}

export function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${className}`}>{children}</span>;
}
