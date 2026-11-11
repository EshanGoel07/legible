/** Service config from env. Secrets are read here and never logged. */
import { fileURLToPath } from "node:url";
import { configFromEnv, type PayPalConfig } from "./paypal.js";

export const SERVICE_VERSION = "0.1.0";

export type SafePayConfig = {
  port: number;
  safepayUrl: string;
  storeUrl: string;
  testMode: boolean;
  dbPath: string;
  paypal: PayPalConfig;
  buyer: { email: string; password: string };
};

/** Loads the repo-root .env if present (values go to process.env only). */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  } catch {
    /* no .env — rely on the host environment (e.g. deployed) */
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SafePayConfig {
  const safepayUrl = (env.SAFEPAY_URL ?? "http://localhost:3003").replace(/\/+$/, "");
  return {
    port: Number(env.PORT ?? (new URL(safepayUrl).port || 3003)),
    safepayUrl,
    storeUrl: (env.STORE_URL ?? "http://localhost:3001").replace(/\/+$/, ""),
    testMode: env.SAFEPAY_TEST_MODE === "1",
    dbPath: fileURLToPath(new URL("../safepay.sqlite", import.meta.url)),
    paypal: configFromEnv(env),
    buyer: { email: env.PAYPAL_SANDBOX_BUYER_EMAIL ?? "", password: env.PAYPAL_SANDBOX_BUYER_PASSWORD ?? "" },
  };
}
