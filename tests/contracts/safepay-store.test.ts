// Join: Safe Pay → store (Contract 6 order routes) + Safe Pay's own Contract 3 responses.
import { describe, expect, it } from "vitest";
import { Checkout, ROUTES, StoreOrder, VerifyResult } from "@legible/contracts";
import { URLS, json, makeCart, path, up } from "./helpers";

const ready = (await up(URLS.store, "store")) && (await up(URLS.safepay, "safepay"));

describe.skipIf(!ready)("safepay → store", () => {
  it("creating a checkout creates the store order with the same amount (StoreOrder, Checkout, VerifyResult)", async () => {
    const cart = await makeCart();
    const created = await json("POST", URLS.safepay + ROUTES.safepay.checkouts, { siteId: "demo-store", cartId: cart.cartId, amount: cart.total, currency: cart.currency, maxAmount: 100, runId: "contract-test" });
    expect(created.status).toBe(201);
    const co = Checkout.parse(created.body);
    expect(co).toMatchObject({ status: "PENDING_APPROVAL", amount: cart.total, currency: "USD" });
    expect(co.approvalUrl).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\//);

    const order = StoreOrder.parse((await json("GET", URLS.store + path(ROUTES.store.order, { checkoutId: co.checkoutId }))).body);
    expect(order).toMatchObject({ checkoutId: co.checkoutId, cartId: cart.cartId, amount: cart.total, currency: "USD" });
    expect(["pending", "paid"]).toContain(order.status); // "paid" only with BUG_PAID_EARLY=1

    expect(Checkout.parse((await json("GET", URLS.safepay + path(ROUTES.safepay.checkout, { id: co.checkoutId }))).body).checkoutId).toBe(co.checkoutId);
    const v = VerifyResult.parse((await json("GET", URLS.safepay + path(ROUTES.safepay.verify, { checkoutId: co.checkoutId }))).body);
    expect(v.store.amount).toBe(cart.total);
    expect(v.match).toBe(order.status === "pending"); // before approval: pending ↔ match, paid-early ↔ mismatch
  });

  it("over the limit: BLOCKED_LIMIT, no PayPal order, no store order", async () => {
    const cart = await makeCart("leather-jacket", "L", 4);
    const co = Checkout.parse((await json("POST", URLS.safepay + ROUTES.safepay.checkouts, { siteId: "demo-store", cartId: cart.cartId, amount: cart.total, currency: cart.currency, maxAmount: 100 })).body);
    expect(co).toMatchObject({ status: "BLOCKED_LIMIT", paypalOrderId: null, approvalUrl: null });
    expect((await json("GET", URLS.store + path(ROUTES.store.order, { checkoutId: co.checkoutId }))).status).toBe(404);
  });

  it("bad request is a 400, not a PayPal call", async () => {
    expect((await json("POST", URLS.safepay + ROUTES.safepay.checkouts, { siteId: "x", amount: "1.5" })).status).toBe(400);
  });
});
