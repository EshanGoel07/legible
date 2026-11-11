/**
 * Phase 1 "done" check against REAL PayPal Sandbox (USD):
 *   over-limit → BLOCKED_LIMIT · create → auto-approve (Playwright) → capture → verify match:true
 *   · decline path (sandbox negative testing) · planted "paid before capture" bug → state mismatch
 * Uses an in-process store stub (Contract 6) and a temporary SQLite DB. Needs PAYPAL_* + buyer creds in the root .env.
 *
 *   pnpm --filter @legible/safepay e2e [-- --headed] [--skip-decline]
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { CaptureResponse, Checkout, Health, ROUTES, VerifyResult } from "@legible/contracts";
import { createApp } from "../src/app.js";
import { createPlaywrightApprover } from "../src/approve.js";
import { loadConfig, loadDotEnv } from "../src/config.js";
import { CheckoutRepo } from "../src/db.js";
import { PayPalClient } from "../src/paypal.js";
import { SafePayService } from "../src/service.js";
import { StoreClient } from "../src/store-client.js";
import { createStoreStub } from "../dev/store-stub.js";

const headed = process.argv.includes("--headed");
const skipDecline = process.argv.includes("--skip-decline");

loadDotEnv();
const cfg = loadConfig({ ...process.env, SAFEPAY_TEST_MODE: "1" });
const tmp = mkdtempSync(join(tmpdir(), "safepay-e2e-"));

const stub = createStoreStub();
const storeServer = stub.app.listen(0);
await new Promise((r) => storeServer.once("listening", r));
const storeUrl = `http://127.0.0.1:${(storeServer.address() as AddressInfo).port}`;

const repo = new CheckoutRepo(join(tmp, "e2e.sqlite"));
const service = new SafePayService({
  repo,
  paypal: new PayPalClient(cfg.paypal),
  store: new StoreClient(storeUrl),
  safepayUrl: cfg.safepayUrl,
  approver: createPlaywrightApprover({
    ...cfg.buyer,
    returnUrlPrefix: `${cfg.safepayUrl}${ROUTES.safepay.return}`,
    headless: !headed,
    failureDir: "test-results",
  }),
});
const server = createApp(service, { testMode: true }).listen(cfg.port);
await new Promise((r, j) => { server.once("listening", r); server.once("error", j); });
const base = cfg.safepayUrl;

const p = (route: string, id: string) => base + route.replace(/:(id|checkoutId)/, encodeURIComponent(id));
async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${new URL(url).pathname} → HTTP ${res.status} ${JSON.stringify(json)}`);
  return json;
}
const checkout = (amount: string) =>
  call("POST", base + ROUTES.safepay.checkouts, { siteId: "demo-store", cartId: `cart_e2e_${Date.now()}`, amount, currency: "USD", maxAmount: 50, runId: "e2e" }).then((j) => Checkout.parse(j));
const verify = async (id: string) => VerifyResult.parse(await call("GET", p(ROUTES.safepay.verify, id)));

let failed = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed++;
};

try {
  const h = Health.parse(await call("GET", base + ROUTES.health));
  check("health", h.ok && h.service === "safepay", `v${h.version} contracts ${h.contractsVersion}`);

  // 1. Over the limit: no PayPal order
  const blocked = await checkout("75.00");
  check("over-limit → BLOCKED_LIMIT", blocked.status === "BLOCKED_LIMIT" && blocked.paypalOrderId === null);
  const vb = await verify(blocked.checkoutId);
  check("over-limit verify", vb.match, `paypal ${vb.paypal.status} / store ${vb.store.status}`);

  // 2. Happy path
  const c = await checkout("20.00");
  check("create → PENDING_APPROVAL", c.status === "PENDING_APPROVAL" && !!c.approvalUrl, `paypal ${c.paypalOrderId}`);
  console.log("      approving in sandbox as buyer (Playwright)…");
  const approved = Checkout.parse(await call("POST", p(ROUTES.safepay.testApprove, c.checkoutId)));
  check("test approve → CAPTURED", approved.status === "CAPTURED");
  const cap = CaptureResponse.parse(await call("POST", p(ROUTES.safepay.capture, c.checkoutId)));
  check("capture is idempotent", cap.status === "CAPTURED" && !!cap.captureId, `capture ${cap.captureId}`);
  const v = await verify(c.checkoutId);
  check("verify happy path", v.match, `paypal ${v.paypal.status} ${v.paypal.amount} ${v.paypal.currency} / store ${v.store.status} ${v.store.amount} ${v.store.currency}`);
  console.log(`      match: ${v.match}`);

  // 3. Decline path (PayPal sandbox negative testing)
  if (!skipDecline) {
    const d = await checkout("21.00");
    console.log("      approving decline case…");
    const dd = Checkout.parse(await call("POST", `${p(ROUTES.safepay.testApprove, d.checkoutId)}?outcome=decline`));
    check("decline → DECLINED", dd.status === "DECLINED");
    const vd = await verify(d.checkoutId);
    check("verify decline", vd.match && vd.store.status === "failed", `paypal ${vd.paypal.status} / store ${vd.store.status}`);
  }

  // 4. Planted bug: store marks the order paid before PayPal captured
  stub.setPlantPaidBeforeCapture(true);
  const bug = await checkout("22.00");
  const vbug = await verify(bug.checkoutId);
  check("planted bug → state mismatch", !vbug.match && vbug.mismatches.some((m) => m.field === "status"), JSON.stringify(vbug.mismatches));
} catch (e) {
  failed++;
  console.error(`ERROR ${e instanceof Error ? e.message : String(e)}`);
} finally {
  server.close();
  storeServer.close();
  repo.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} check(s) failed` : "\nALL CHECKS PASSED");
process.exit(failed ? 1 : 0);
