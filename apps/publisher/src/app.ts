/** Express: GET /health, POST /mcp (Streamable HTTP, stateless). The run id comes from the x-legible-run header. */
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CONTRACTS_VERSION, Health, ROUTES, RUN_HEADER } from "@legible/contracts";
import { PUBLISHER_VERSION, type PublisherConfig } from "./config.js";
import { createMcpServer } from "./mcp.js";
import { approvedTools, loadManifest } from "./manifest.js";
import { safeRunId } from "./log.js";

export const MCP_PATH = "/mcp";

export function createApp(cfg: PublisherConfig, opts: { fetch?: typeof fetch } = {}) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get(ROUTES.health, (_req, res) => {
    res.json(Health.parse({ ok: true, service: "publisher", version: PUBLISHER_VERSION, contractsVersion: CONTRACTS_VERSION }));
  });

  /** Human-readable summary of what agents can see right now. */
  app.get("/", (_req, res) => {
    const m = loadManifest(cfg.manifestPath);
    res.json({ site: m.site, mcp: `${cfg.publisherUrl}${MCP_PATH}`, runHeader: RUN_HEADER, approved: approvedTools(m).map((t) => `${t.name} (${t.risk})`), notApproved: m.tools.filter((t) => !t.approved).map((t) => t.name) });
  });

  app.post(MCP_PATH, async (req: Request, res: Response) => {
    let manifest;
    try {
      manifest = loadManifest(cfg.manifestPath);
    } catch (e) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: `manifest invalid: ${(e as Error).message}` }, id: null });
      return;
    }
    const runId = safeRunId(req.header(RUN_HEADER));
    const server = createMcpServer(manifest, runId, { storeUrl: cfg.storeUrl, safepayUrl: cfg.safepayUrl, runsDir: cfg.runsDir, fetch: opts.fetch });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Stateless server: no SSE stream, no sessions to delete.
  app.get(MCP_PATH, (_req, res) => res.status(405).set("allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }));
  app.delete(MCP_PATH, (_req, res) => res.status(405).set("allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }));

  return app;
}
