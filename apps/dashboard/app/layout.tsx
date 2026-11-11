import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { getConfig, loadManifestView, publisherStatus } from "@/lib/data";

export const metadata: Metadata = { title: "Legible", description: "Make any website safely usable by AI agents, and prove it." };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cfg = getConfig();
  const view = loadManifestView(cfg);
  const pub = await publisherStatus(cfg);
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-8">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-900 text-lg font-bold text-white">L</div>
              <div className="leading-tight">
                <div className="text-[17px] font-semibold tracking-tight">Legible</div>
                <div className="text-xs text-slate-500">{view.ok ? view.manifest.site.name : "no site"}</div>
              </div>
            </div>
            <Nav />
            <div className="ml-auto flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm" title={`Publisher (MCP) at ${cfg.publisherUrl}/mcp`}>
              <span className={`h-2.5 w-2.5 rounded-full ${pub ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" : "bg-slate-300"}`} />
              <span className="text-slate-700">{pub ? <>MCP server · serving <b>{pub.approved.length}</b> tools</> : "MCP server offline"}</span>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-8 py-10">{children}</main>
      </body>
    </html>
  );
}
