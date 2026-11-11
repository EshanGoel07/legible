/** Demo store: `pnpm --filter @legible/store dev` (port from STORE_URL, default 3001). */
import { createApp } from "./app.js";
import { loadConfig, loadDotEnv } from "./config.js";
import { StoreDb } from "./db.js";

loadDotEnv();
const cfg = loadConfig();
const db = new StoreDb(cfg.dbPath);

createApp(db, cfg).listen(cfg.port, () => {
  const on = (b: boolean) => (b ? "ON" : "off");
  console.log(`[store] listening on ${cfg.storeUrl} · Safe Pay ${cfg.safepayUrl} · bugs: BUG_COUPON_API ${on(cfg.bugs.couponApi)}, BUG_PAID_EARLY ${on(cfg.bugs.paidEarly)}`);
});
