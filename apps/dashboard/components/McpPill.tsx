/** Header status of the Publisher. The dot is keyed by the count, so it pulses once whenever the served-tool count changes. */
export function McpPill({ count, title }: { count: number | null; title: string }) {
  return (
    <div className="ml-auto flex items-center gap-2.5 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm" title={title}>
      <span key={count ?? "off"} className={`h-2.5 w-2.5 rounded-full ${count === null ? "bg-white/30" : "pop bg-pass"}`} />
      <span className="text-white/85">
        {count === null ? "MCP server offline" : <>MCP server · serving <b className="font-mono font-semibold text-white">{count}</b> tool{count === 1 ? "" : "s"}</>}
      </span>
    </div>
  );
}
