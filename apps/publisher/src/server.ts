/** MCP server: `pnpm --filter @legible/publisher dev` (port from PUBLISHER_URL, default 3002). */
import { createApp, MCP_PATH } from "./app.js";
import { loadConfig, loadDotEnv } from "./config.js";
import { approvedTools, loadManifest } from "./manifest.js";

loadDotEnv();
const cfg = loadConfig();
const m = loadManifest(cfg.manifestPath); // fail fast on a bad manifest

createApp(cfg).listen(cfg.port, (err?: Error) => {
  if (err) {
    console.error(`[publisher] cannot listen on port ${cfg.port}: ${err.message}`);
    process.exit(1);
  }
  console.log(`[publisher] MCP on ${cfg.publisherUrl}${MCP_PATH} · ${approvedTools(m).length}/${m.tools.length} tools approved · manifest ${cfg.manifestPath} · logs ${cfg.runsDir}/<runId>/calls.jsonl`);
});
