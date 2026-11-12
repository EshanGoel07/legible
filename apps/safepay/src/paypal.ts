/**
 * Minimal PayPal REST client (Sandbox only): OAuth client-credentials + Orders v2.
 * Never logs or returns the client secret, the access token or the Authorization header.
 */
import { randomUUID } from "node:crypto";

export const SANDBOX_HOST = "api-m.sandbox.paypal.com";

export type PayPalConfig = { apiBase: string; clientId: string; clientSecret: string };

export type PayPalLink = { href: string; rel: string; method?: string };
export type PayPalCapture = { id: string; status: string; amount?: { value: string; currency_code: string }; status_details?: { reason?: string } };
export type PayPalOrder = {
  id: string;
  status: string;
  links?: PayPalLink[];
  purchase_units?: Array<{
    amount?: { value: string; currency_code: string };
    payments?: { captures?: PayPalCapture[] };
  }>;
};

/** Error carrying only PayPal's public error fields — safe to print. */
export class PayPalError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly paypalName: string | undefined,
    readonly issues: string[],
    readonly debugId: string | undefined,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

/** Reads config from env and refuses anything that isn't the Sandbox host. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): PayPalConfig {
  const apiBase = (env.PAYPAL_API_BASE ?? `https://${SANDBOX_HOST}`).replace(/\/+$/, "");
  const clientId = env.PAYPAL_CLIENT_ID ?? "";
  const clientSecret = env.PAYPAL_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set (see .env.example)");
  return assertSandbox({ apiBase, clientId, clientSecret });
}

export function assertSandbox(cfg: PayPalConfig): PayPalConfig {
  let host: string;
  try {
    host = new URL(cfg.apiBase).host;
  } catch {
    throw new Error("PAYPAL_API_BASE is not a valid URL");
  }
  if (host !== SANDBOX_HOST) throw new Error(`Refusing to call ${host}: Safe Pay is Sandbox only (${SANDBOX_HOST})`);
  return cfg;
}

async function toPayPalError(res: Response, what: string): Promise<PayPalError> {
  let body: any = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }
  const name = body.name ?? body.error;
  const issues: string[] = Array.isArray(body.details) ? body.details.map((d: any) => d.issue).filter(Boolean) : [];
  const debugId = body.debug_id ?? res.headers.get("paypal-debug-id") ?? undefined;
  const msg = body.message ?? body.error_description ?? res.statusText;
  return new PayPalError(
    `${what} failed (HTTP ${res.status}): ${name ?? "error"} — ${msg}${issues.length ? ` [${issues.join(", ")}]` : ""}${debugId ? ` debug_id=${debugId}` : ""}`,
    res.status,
    name,
    issues,
    debugId,
  );
}

export class PayPalClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly cfg: PayPalConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    assertSandbox(cfg);
  }

  async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
    const res = await this.fetchImpl(`${this.cfg.apiBase}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw await toPayPalError(res, "OAuth token");
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
    return json.access_token;
  }

  private async call<T>(method: string, path: string, what: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
    const token = await this.getAccessToken();
    const res = await this.fetchImpl(`${this.cfg.apiBase}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw await toPayPalError(res, what);
    return (await res.json()) as T;
  }

  /**
   * @param opts.brandName shown to the buyer on the PayPal approval page
   * @param opts.description what is being paid for (shown to the buyer)
   * @param opts.customId our own reference stored on the PayPal order (the Crash Test / agent run id)
   */
  createOrder(opts: { amount: string; currency: string; returnUrl: string; cancelUrl: string; referenceId?: string; requestId?: string; brandName?: string; description?: string; customId?: string }) {
    return this.call<PayPalOrder>(
      "POST",
      "/v2/checkout/orders",
      "Create order",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: opts.referenceId,
            ...(opts.description ? { description: opts.description.slice(0, 127) } : {}),
            ...(opts.customId ? { custom_id: opts.customId.slice(0, 127) } : {}),
            amount: { currency_code: opts.currency, value: opts.amount },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              ...(opts.brandName ? { brand_name: opts.brandName.slice(0, 127) } : {}),
              return_url: opts.returnUrl,
              cancel_url: opts.cancelUrl,
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
            },
          },
        },
      },
      { "PayPal-Request-Id": opts.requestId ?? randomUUID(), Prefer: "return=representation" },
    );
  }

  getOrder(orderId: string) {
    return this.call<PayPalOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`, "Get order");
  }

  /**
   * @param opts.mockDecline Sandbox negative testing: PayPal answers the capture with
   *   422 INSTRUMENT_DECLINED via the `PayPal-Mock-Response` header. Only honoured by the Sandbox.
   */
  captureOrder(orderId: string, opts: { requestId?: string; mockDecline?: boolean } = {}) {
    const headers: Record<string, string> = { "PayPal-Request-Id": opts.requestId ?? randomUUID(), Prefer: "return=representation" };
    if (opts.mockDecline) headers["PayPal-Mock-Response"] = JSON.stringify({ mock_application_codes: "INSTRUMENT_DECLINED" });
    return this.call<PayPalOrder>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, "Capture order", undefined, headers);
  }
}

/** The link the buyer opens to approve: `payer-action` (payment_source flow) or legacy `approve`. */
export function approvalLink(order: PayPalOrder): string | null {
  const l = order.links?.find((x) => x.rel === "payer-action") ?? order.links?.find((x) => x.rel === "approve");
  return l?.href ?? null;
}

export function firstCapture(order: PayPalOrder): PayPalCapture | null {
  return order.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
}
