/** Small shared pieces: page shell, banners, empty/error cards, skeletons. Server-safe (no hooks). */

/** Page content width: 1440px with 40px gutters, tuned for a 1920×1080 recording. */
export function Container({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`mx-auto max-w-[1440px] px-10 ${className}`}>{children}</div>;
}

/** Full-width ink band that continues the header. */
export function Hero({ children }: { children: React.ReactNode }) {
  return (
    <section className="hero-grid bg-ink text-white">
      <Container className="py-12">{children}</Container>
    </section>
  );
}

export function Eyebrow({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`font-mono text-[13px] font-medium uppercase tracking-[0.14em] ${className}`}>{children}</div>;
}

export function Banner({ tone = "info", title, children }: { tone?: "info" | "warn" | "error"; title: string; children?: React.ReactNode }) {
  const cls = { info: "border-guard/25 bg-guard/5 text-ink", warn: "border-warn/40 bg-warn/10 text-ink", error: "border-fail/40 bg-fail/10 text-ink" }[tone];
  return (
    <div className={`mb-6 rounded-xl border px-5 py-4 ${cls}`}>
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-1 text-[15px] text-ink/80">{children}</div>}
    </div>
  );
}

export function ErrorCard({ title, message, hint }: { title: string; message: string; hint?: string }) {
  return (
    <Container className="py-16">
      <div className="mx-auto max-w-2xl rounded-2xl border border-fail/40 bg-white p-8">
        <Eyebrow className="text-fail">Something is wrong</Eyebrow>
        <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-lg bg-ink p-4 font-mono text-sm text-white/85">{message}</pre>
        {hint && <p className="mt-4 text-muted">{hint}</p>}
      </div>
    </Container>
  );
}

export function Skeleton({ className = "", dark = false }: { className?: string; dark?: boolean }) {
  return <div className={`animate-pulse rounded-xl ${dark ? "bg-white/10" : "bg-ink/[0.07]"} ${className}`} />;
}

export function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-semibold ring-1 ring-inset ${className}`}>{children}</span>;
}

/** "Guarded" glyph for the money tier (deliberately not a PayPal logo). */
export function Lock({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="9" width="12" height="8" rx="2" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
    </svg>
  );
}
