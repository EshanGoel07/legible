/** Store config from env. The two functional planted bugs default ON for the demo (set the flag to 0 to show the fix); BUG_PROMPT_INJECTION defaults off. */
import { fileURLToPath } from "node:url";

export const STORE_VERSION = "0.1.0";
export const CURRENCY = "USD";
export const SHIPPING_CENTS = 500;
/** Spending limit the human web checkout sends to Safe Pay (agent checkouts use the manifest limit). */
export const WEB_MAX_AMOUNT = 100;

export type StoreConfig = {
  port: number;
  storeUrl: string;
  safepayUrl: string;
  siteId: string;
  dbPath: string;
  bugs: { couponApi: boolean; paidEarly: boolean; promptInjection: boolean };
};

export function loadDotEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));
  } catch {
    /* no .env: use the host environment */
  }
}

const flag = (v: string | undefined) => v !== "0" && v !== "false";
/** Opt-in flag: off unless set to 1/true (the injection bug is only switched on by `pnpm demo --bugs on`). */
const optIn = (v: string | undefined) => v === "1" || v === "true";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): StoreConfig {
  const storeUrl = (env.STORE_URL ?? "http://localhost:3001").replace(/\/+$/, "");
  return {
    port: Number(env.PORT ?? (new URL(storeUrl).port || 3001)),
    storeUrl,
    safepayUrl: (env.SAFEPAY_URL ?? "http://localhost:3003").replace(/\/+$/, ""),
    siteId: "demo-store",
    dbPath: env.STORE_DB_PATH ?? fileURLToPath(new URL("../store.sqlite", import.meta.url)),
    bugs: { couponApi: flag(env.BUG_COUPON_API), paidEarly: flag(env.BUG_PAID_EARLY), promptInjection: optIn(env.BUG_PROMPT_INJECTION) },
  };
}
