/** One MCP server per request (stateless): lists approved tools, executes them, logs every call. */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Manifest, Tool } from "@legible/contracts";
import { PUBLISHER_VERSION } from "./config.js";
import { callHttp, callSafePay, ToolError, type Deps } from "./bindings.js";
import { ADHOC_RUN, logCall } from "./log.js";
import { approvedTools } from "./manifest.js";

const RISK_NOTE: Record<Tool["risk"], string> = {
  read: "",
  write: " [changes data]",
  money: " [MONEY: goes through PayPal; a human approves before money moves; spending limit enforced]",
};

export function createMcpServer(manifest: Manifest, runId: string | undefined, deps: Deps & { runsDir: string }) {
  const server = new Server({ name: `legible-${manifest.site.id}`, version: PUBLISHER_VERSION }, { capabilities: { tools: {} } });
  const tools = approvedTools(manifest);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description + RISK_NOTE[t.risk], inputSchema: t.inputSchema as { type: "object" } })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const input = (req.params.arguments ?? {}) as Record<string, unknown>;
    const t0 = Date.now();
    let ok = false;
    let output: unknown = null;
    let error: string | null = null;
    try {
      const tool = tools.find((x) => x.name === name);
      if (!tool) throw new ToolError(manifest.tools.some((x) => x.name === name) ? `tool "${name}" is not approved for agents` : `unknown tool "${name}"`);
      output = tool.binding.kind === "http" ? await callHttp(tool as Tool & { binding: { kind: "http" } }, input, deps) : await callSafePay(tool as Tool & { binding: { kind: "safepay" } }, input, manifest, runId, deps);
      ok = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      output = e instanceof ToolError && e.body !== undefined ? e.body : null;
    }
    logCall(deps.runsDir, { runId: runId ?? ADHOC_RUN, ts: new Date(t0).toISOString(), tool: name, input, ok, output: output ?? null, error, ms: Date.now() - t0 });
    return ok
      ? { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] }
      : { content: [{ type: "text", text: `Error: ${error}` }], isError: true };
  });

  return server;
}
