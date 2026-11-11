import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { McpPill } from "@/components/McpPill";
import { getConfig, loadManifestView, publisherStatus } from "@/lib/data";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = { title: "Legible", description: "Make any web app agent-ready — starting with Express/TypeScript." };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cfg = getConfig();
  const view = loadManifestView(cfg);
  const pub = await publisherStatus(cfg);
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans">
        <header className="sticky top-0 z-20 border-b border-white/10 bg-ink text-white">
          <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-8 px-10">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-white font-mono text-lg font-semibold text-ink">L</div>
              <div className="leading-tight">
                <div className="text-[17px] font-semibold tracking-tight">Legible</div>
                <div className="font-mono text-xs text-white/55">{view.ok ? view.manifest.site.name : "no site"}</div>
              </div>
            </div>
            <Nav />
            <McpPill count={pub ? pub.approved.length : null} title={`Publisher (MCP) at ${cfg.publisherUrl}/mcp`} />
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
