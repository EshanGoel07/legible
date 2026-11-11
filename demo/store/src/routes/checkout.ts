/** Checkout: pays for a cart through PayPal (via Safe Pay). The buyer approves in PayPal before money moves. */
import { Router } from "express";
import { Checkout, CreateCheckoutRequest, ROUTES } from "@legible/contracts";
import { StoreError, type StoreDb } from "../db.js";
import { WEB_MAX_AMOUNT, type StoreConfig } from "../config.js";

export function checkoutRoutes(db: StoreDb, cfg: StoreConfig) {
  const router = Router();

  // Start a PayPal payment for the cart total; returns the PayPal approval URL.
  router.post("/api/cart/:cartId/checkout", async (req, res) => {
    const cart = db.getCart(req.params.cartId);
    if (!cart.items.length) throw new StoreError(400, "empty_cart", "cart is empty");
    const body = CreateCheckoutRequest.parse({
      siteId: cfg.siteId,
      cartId: cart.cartId,
      amount: cart.total,
      currency: cart.currency,
      maxAmount: WEB_MAX_AMOUNT,
    });
    const r = await fetch(`${cfg.safepayUrl}${ROUTES.safepay.checkouts}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {
      throw new StoreError(502, "safepay_unreachable", `Safe Pay unreachable at ${cfg.safepayUrl}`);
    });
    if (!r.ok) throw new StoreError(502, "safepay_failed", `Safe Pay returned HTTP ${r.status}`);
    res.json(Checkout.parse(await r.json()));
  });

  return router;
}
