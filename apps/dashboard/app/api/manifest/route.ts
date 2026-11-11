/** GET the manifest the dashboard shows; PUT a new one (Manifest.parse, atomic write). The Publisher re-reads it on change. */
import { getConfig, loadManifestView, publisherStatus, saveManifest, SaveError } from "@/lib/data";

export const dynamic = "force-dynamic";

export function GET() {
  const view = loadManifestView(getConfig());
  return view.ok ? Response.json(view) : Response.json({ error: view.error, path: view.displayPath }, { status: 500 });
}

export async function PUT(req: Request) {
  const cfg = getConfig();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "body is not JSON" }, { status: 400 });
  }
  try {
    const m = saveManifest(cfg, body);
    // Ask the Publisher what it serves now: it re-reads the manifest on its next request, no restart.
    const publisher = await publisherStatus(cfg);
    return Response.json({ ok: true, approved: m.tools.filter((t) => t.approved).map((t) => t.name), total: m.tools.length, publisher });
  } catch (e) {
    if (e instanceof SaveError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
