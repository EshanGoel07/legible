// Join: Crash Test → Safe Pay Verify (Contract 4).
import { describe, expect, it } from "vitest";
import { Checkout, ROUTES, VerifyResult } from "@legible/contracts";
import { URLS, json, makeCart, path, up } from "./helpers";

const ready = (await up(URLS.store, "store")) && (await up(URLS.safepay, "safepay"));

describe.skipIf(!ready)("crashtest → verify", () => {
  it("blocked checkout: PayPal NONE, store missing, match", async () => {
    const cart = await makeCart("leather-jacket", "L", 4);
    const co = Checkout.parse((await json("POST", URLS.safepay + ROUTES.safepay.checkouts, { siteId: "demo-store", cartId: cart.cartId, amount: cart.total, currency: "USD", maxAmount: 100 })).body);
    const v = VerifyResult.parse((await json("GET", URLS.safepay + path(ROUTES.safepay.verify, { checkoutId: co.checkoutId }))).body);
    expect(v).toMatchObject({ match: true, paypal: { status: "NONE" }, store: { status: "missing" } });
  });

  it("unknown checkout is a 404", async () => {
    expect((await json("GET", URLS.safepay + path(ROUTES.safepay.verify, { checkoutId: "chk_nope" }))).status).toBe(404);
  });
});
