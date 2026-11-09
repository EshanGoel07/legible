import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CaptureResponse, Checkout, CONTRACTS_VERSION, Health, ROUTES, VerifyResult } from "@legible/contracts";
import { createMockApp } from "../mock/app.js";

let server: Server;
let base: string;
const path = (p: string, params: Record<string, string> = {}) =>
  base + Object.entries(params).reduce((acc, [k, v]) => acc.replace(`:${k}`, encodeURIComponent(v)), p);
const post = (url: string, body?: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

const req = { siteId: "demo-store", cartId: "cart_1", amount: "1499.00", currency: "INR", maxAmount: 5000 };

beforeAll(async () => {
  server = createMockApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("safepay mock — Contracts 3 + 4", () => {
  it("GET /health returns Health", async () => {
    const h = Health.parse(await (await fetch(path(ROUTES.health))).json());
    expect(h).toMatchObject({ ok: true, service: "safepay", contractsVersion: CONTRACTS_VERSION });
  });

  it("happy path: create → test approve → capture → verify match", async () => {
    const res = await post(path(ROUTES.safepay.checkouts), req);
    expect(res.status).toBe(201);
    const c = Checkout.parse(await res.json());
    expect(c.status).toBe("PENDING_APPROVAL");
    expect(c.approvalUrl).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\//);

    const got = Checkout.parse(await (await fetch(path(ROUTES.safepay.checkout, { id: c.checkoutId }))).json());
    expect(got.checkoutId).toBe(c.checkoutId);

    const approved = Checkout.parse(await (await post(path(ROUTES.safepay.testApprove, { checkoutId: c.checkoutId }))).json());
    expect(approved.status).toBe("CAPTURED");

    const cap = CaptureResponse.parse(await (await post(path(ROUTES.safepay.capture, { id: c.checkoutId }))).json());
    expect(cap).toMatchObject({ status: "CAPTURED", checkoutId: c.checkoutId });
    expect(cap.captureId).toBeTruthy();

    const v = VerifyResult.parse(await (await fetch(path(ROUTES.safepay.verify, { checkoutId: c.checkoutId }))).json());
    expect(v).toMatchObject({ match: true, mismatches: [], paypal: { status: "COMPLETED" }, store: { status: "paid" } });
  });

  it("over the limit → BLOCKED_LIMIT, no PayPal order", async () => {
    const c = Checkout.parse(await (await post(path(ROUTES.safepay.checkouts), { ...req, amount: "5000.01" })).json());
    expect(c).toMatchObject({ status: "BLOCKED_LIMIT", paypalOrderId: null, approvalUrl: null });
    expect((await post(path(ROUTES.safepay.testApprove, { checkoutId: c.checkoutId }))).status).toBe(409);
  });

  it("return_url captures the checkout", async () => {
    const c = Checkout.parse(await (await post(path(ROUTES.safepay.checkouts), req)).json());
    const res = await fetch(`${path(ROUTES.safepay.return)}?checkoutId=${c.checkoutId}`);
    expect(res.status).toBe(200);
    const got = Checkout.parse(await (await fetch(path(ROUTES.safepay.checkout, { id: c.checkoutId }))).json());
    expect(got.status).toBe("CAPTURED");
  });

  it("verify reports state mismatch when ?mismatch=1 (planted 'paid before capture' bug)", async () => {
    const c = Checkout.parse(await (await post(path(ROUTES.safepay.checkouts), req)).json());
    const v = VerifyResult.parse(await (await fetch(`${path(ROUTES.safepay.verify, { checkoutId: c.checkoutId })}?mismatch=1`)).json());
    expect(v.match).toBe(false);
    expect(v.mismatches[0]).toMatchObject({ field: "status", store: "paid" });
  });

  it("rejects an invalid body with 400 and unknown ids with 404", async () => {
    expect((await post(path(ROUTES.safepay.checkouts), { ...req, amount: 1499 })).status).toBe(400);
    expect((await fetch(path(ROUTES.safepay.checkout, { id: "nope" }))).status).toBe(404);
  });
});
