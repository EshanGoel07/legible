/** Demo store: `pnpm --filter @legible/store dev` (port from STORE_URL, default 3001). */
import { createApp } from "./app.js";
import { loadConfig, loadDotEnv } from "./config.js";
import { StoreDb } from "./db.js";

loadDotEnv();
const cfg = loadConfig();
const db = new StoreDb(cfg.dbPath);

// Express 5 calls this callback with an error too (e.g. EADDRINUSE): fail loudly instead of pretending to listen.
createApp(db, cfg).listen(cfg.port, (err?: Error) => {
  if (err) {
    console.error(`[store] cannot listen on port ${cfg.port}: ${err.message}`);
    process.exit(1);
  }
  const on = (b: boolean) => (b ? "ON" : "off");
  console.log(`[store] listening on ${cfg.storeUrl} · Safe Pay ${cfg.safepayUrl} · bugs: BUG_COUPON_API ${on(cfg.bugs.couponApi)}, BUG_PAID_EARLY ${on(cfg.bugs.paidEarly)}`);
});
