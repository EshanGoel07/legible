import { getConfig, loadManifestView, publisherStatus } from "@/lib/data";
import { ToolsBoard } from "@/components/ToolsBoard";
import { ErrorCard } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ToolsPage() {
  const cfg = getConfig();
  const view = loadManifestView(cfg);
  if (!view.ok) return <ErrorCard title="The manifest can't be read" message={`${view.displayPath}\n\n${view.error}`} hint="Re-run the scanner: pnpm --filter @legible/scanner scan ../../demo/store --out runs/manifest.json" />;
  const pub = await publisherStatus(cfg);
  return <ToolsBoard view={view} publisherServing={pub?.approved ?? null} />;
}
