/**
 * Phase 0 smoke test against PayPal Sandbox:
 *   OAuth token → create order (intent CAPTURE) → print approval URL → wait for buyer approval → capture → print COMPLETED
 *
 * Run from repo root:
 *   pnpm --filter @legible/safepay sandbox:smoke -- --currency INR --amount 1499.00
 * Reads PAYPAL_* from the repo-root .env. Never prints the secret or the access token.
 */
import { Currency, Money } from "@legible/contracts";
import { PayPalClient, PayPalError, approvalLink, configFromEnv, firstCapture } from "../src/paypal.js";

// Load the repo-root .env (values only go into process.env; nothing is printed).
const envPath = new URL("../../../.env", import.meta.url);
try {
  process.loadEnvFile(envPath);
} catch {
  console.error("No .env at the repo root. Run: cp .env.example .env  and fill in the PAYPAL_* sandbox values.");
  process.exit(2);
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const currency = Currency.parse(arg("currency", "INR").toUpperCase());
const amount = Money.parse(arg("amount", "1499.00"));
const timeoutMs = Number(arg("timeout", "300")) * 1000;
const safepayUrl = (process.env.SAFEPAY_URL ?? "http://localhost:3003").replace(/\/+$/, "");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function verdict(ok: boolean, reason: string): never {
  console.log("");
  if (ok) console.log(`RESULT: ${currency} WORKS — capture COMPLETED`);
  else console.log(`RESULT: ${currency} NOT USABLE: ${reason}${currency !== "USD" ? "  → re-run with --currency USD" : ""}`);
  process.exit(ok ? 0 : 1);
}

async function main() {
  const client = new PayPalClient(configFromEnv());
  console.log(`PayPal Sandbox smoke test — ${amount} ${currency}`);

  await client.getAccessToken();
  console.log("1. token ok");

  let order;
  try {
    order = await client.createOrder({
      amount,
      currency,
      returnUrl: `${safepayUrl}/safepay/return?checkoutId=smoke`,
      cancelUrl: `${safepayUrl}/safepay/return?checkoutId=smoke&cancelled=1`,
      referenceId: "smoke",
    });
  } catch (e) {
    if (e instanceof PayPalError) verdict(false, `create order rejected — ${e.message}`);
    throw e;
  }
  const url = approvalLink(order);
  console.log(`2. order created: ${order.id} (status ${order.status})`);
  if (!url) verdict(false, "order has no approval link");
  console.log("\n   Open this URL, log in as your SANDBOX BUYER and click Pay:");
  console.log(`   ${url}\n`);
  console.log("   (The redirect back to localhost may show an error page — that's fine, this script keeps polling.)");

  const deadline = Date.now() + timeoutMs;
  let status = order.status;
  while (status !== "APPROVED" && status !== "COMPLETED") {
    if (Date.now() > deadline) verdict(false, `buyer did not approve within ${timeoutMs / 1000}s (status ${status})`);
    await sleep(3000);
    status = (await client.getOrder(order.id)).status;
    process.stdout.write(`\r3. waiting for approval… status ${status}      `);
  }
  console.log(`\n3. order ${status}`);

  let captured;
  try {
    captured = status === "COMPLETED" ? await client.getOrder(order.id) : await client.captureOrder(order.id);
  } catch (e) {
    if (e instanceof PayPalError) verdict(false, `capture rejected — ${e.message}`);
    throw e;
  }
  const cap = firstCapture(captured);
  console.log(`4. order status: ${captured.status}`);
  console.log(`   capture: ${cap?.id ?? "-"} status ${cap?.status ?? "-"} ${cap?.amount ? `${cap.amount.value} ${cap.amount.currency_code}` : ""}`);
  if (cap?.status === "COMPLETED") {
    console.log("\nCOMPLETED");
    verdict(true, "");
  }
  verdict(false, `capture status ${cap?.status ?? "missing"}${cap?.status_details?.reason ? ` (${cap.status_details.reason})` : ""}`);
}

main().catch((e) => {
  // Only print the message — never the request/headers.
  console.error(`smoke test error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
});
