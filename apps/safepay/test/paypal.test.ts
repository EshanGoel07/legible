import { describe, expect, it, vi } from "vitest";
import { PayPalClient, PayPalError, approvalLink, configFromEnv } from "../src/paypal.js";

const SECRET = "super-secret-value";
const cfg = { apiBase: "https://api-m.sandbox.paypal.com", clientId: "client-id", clientSecret: SECRET };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("PayPal client", () => {
  it("refuses non-sandbox hosts", () => {
    expect(() => new PayPalClient({ ...cfg, apiBase: "https://api-m.paypal.com" })).toThrow(/Sandbox only/);
    expect(() => configFromEnv({ PAYPAL_CLIENT_ID: "a", PAYPAL_CLIENT_SECRET: "b", PAYPAL_API_BASE: "https://api-m.paypal.com" })).toThrow(/Sandbox only/);
  });

  it("creates an order and returns the payer-action link", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(200, { access_token: "tok", expires_in: 3600 }))
      .mockResolvedValueOnce(json(201, { id: "ORDER1", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1" }] }));
    const client = new PayPalClient(cfg, fetchMock as unknown as typeof fetch);
    const order = await client.createOrder({ amount: "1499.00", currency: "INR", returnUrl: "http://localhost:3003/r", cancelUrl: "http://localhost:3003/c" });
    expect(approvalLink(order)).toContain("token=ORDER1");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "INR", value: "1499.00" } }] });
  });

  it("create order: brand name, description and custom_id (run id) are sent when given, omitted otherwise", async () => {
    const order = { id: "ORDER2", status: "PAYER_ACTION_REQUIRED", links: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(200, { access_token: "tok", expires_in: 3600 }))
      .mockResolvedValueOnce(json(201, order))
      .mockResolvedValueOnce(json(201, order));
    const client = new PayPalClient(cfg, fetchMock as unknown as typeof fetch);
    const base = { amount: "34.00", currency: "USD", returnUrl: "http://localhost:3003/r", cancelUrl: "http://localhost:3003/c" };
    await client.createOrder({ ...base, brandName: "Legible Demo Store", description: "AI agent purchase", customId: "r_20261112_000000_hoodie-no-coupon" });
    const withFields = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(withFields.purchase_units[0]).toMatchObject({ description: "AI agent purchase", custom_id: "r_20261112_000000_hoodie-no-coupon", amount: { currency_code: "USD", value: "34.00" } });
    expect(withFields.payment_source.paypal.experience_context).toMatchObject({ brand_name: "Legible Demo Store", user_action: "PAY_NOW" });
    await client.createOrder(base);
    const bare = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(bare.purchase_units[0]).not.toHaveProperty("custom_id");
    expect(bare.purchase_units[0]).not.toHaveProperty("description");
    expect(bare.payment_source.paypal.experience_context).not.toHaveProperty("brand_name");
  });

  it("errors carry PayPal's issue and debug_id but never the secret or token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(200, { access_token: "tok-abc", expires_in: 3600 }))
      .mockResolvedValueOnce(json(422, { name: "UNPROCESSABLE_ENTITY", message: "The requested action could not be performed", details: [{ issue: "CURRENCY_NOT_SUPPORTED" }], debug_id: "dbg123" }));
    const client = new PayPalClient(cfg, fetchMock as unknown as typeof fetch);
    const err = await client.createOrder({ amount: "1.00", currency: "INR", returnUrl: "http://x/r", cancelUrl: "http://x/c" }).catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.issues).toEqual(["CURRENCY_NOT_SUPPORTED"]);
    expect(err.message).toContain("dbg123");
    expect(err.message).not.toContain(SECRET);
    expect(err.message).not.toContain("tok-abc");
  });

  it("OAuth failure does not leak the secret", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(401, { error: "invalid_client", error_description: "Client Authentication failed" }));
    const err = await new PayPalClient(cfg, fetchMock as unknown as typeof fetch).getAccessToken().catch((e) => e);
    expect(err.message).toContain("invalid_client");
    expect(JSON.stringify({ m: err.message, s: err.stack })).not.toContain(SECRET);
  });
});
