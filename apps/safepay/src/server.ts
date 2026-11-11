/** Real Safe Pay service: `pnpm --filter @legible/safepay dev` (port from SAFEPAY_URL, default 3003). */
import { createApp } from "./app.js";
import { createPlaywrightApprover } from "./approve.js";
import { loadConfig, loadDotEnv } from "./config.js";
import { CheckoutRepo } from "./db.js";
import { PayPalClient } from "./paypal.js";
import { SafePayService } from "./service.js";
import { StoreClient } from "./store-client.js";
import { ROUTES } from "@legible/contracts";

loadDotEnv();
const cfg = loadConfig();

const service = new SafePayService({
  repo: new CheckoutRepo(cfg.dbPath),
  paypal: new PayPalClient(cfg.paypal),
  store: new StoreClient(cfg.storeUrl),
  safepayUrl: cfg.safepayUrl,
  approver: cfg.testMode
    ? createPlaywrightApprover({
        ...cfg.buyer,
        returnUrlPrefix: `${cfg.safepayUrl}${ROUTES.safepay.return}`,
        headless: true,
        failureDir: "test-results",
      })
    : undefined,
});

createApp(service, { testMode: cfg.testMode }).listen(cfg.port, (err?: Error) => {
  if (err) { console.error(`[safepay] cannot listen on port ${cfg.port}: ${err.message}`); process.exit(1); }
  console.log(`[safepay] listening on ${cfg.safepayUrl} (port ${cfg.port}) · store ${cfg.storeUrl} · PayPal Sandbox · test mode ${cfg.testMode ? "ON" : "off"}`);
});
