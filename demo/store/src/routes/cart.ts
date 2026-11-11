/** Shopping cart: create, add items, apply a coupon, read totals. */
import { Router } from "express";
import { z } from "zod";
import { ROUTES } from "@legible/contracts";
import { StoreError, type StoreDb } from "../db.js";
import type { StoreConfig } from "../config.js";

const AddItemBody = z.object({ productId: z.string().min(1), size: z.string().min(1).optional(), qty: z.coerce.number().int().min(1).default(1) });
const CouponBody = z.object({ code: z.string().min(1) });

export function cartRoutes(db: StoreDb, cfg: StoreConfig) {
  const router = Router();

  // Create an empty cart.
  router.post("/api/cart", (_req, res) => {
    res.status(201).json(db.createCart());
  });

  // Cart contents and totals (subtotal, shipping, discount, total).
  router.get(ROUTES.store.cart, (req, res) => {
    res.json(db.getCart(req.params.cartId));
  });

  // Add a product (and size) to the cart.
  router.post("/api/cart/:cartId/items", (req, res) => {
    const body = AddItemBody.parse(req.body ?? {});
    res.json(db.addItem(req.params.cartId, body.productId, body.size, body.qty));
  });

  // Apply a coupon code to the cart.
  router.post("/api/cart/:cartId/coupon", (req, res) => {
    const { code } = CouponBody.parse(req.body ?? {});
    // PLANTED BUG (BUG_COUPON_API=1): the API path crashes on DIWALI20; the web page path works.
    if (cfg.bugs.couponApi && code.trim().toUpperCase() === "DIWALI20") {
      throw new StoreError(500, "internal_error", "Cannot read properties of undefined (reading 'percent')");
    }
    res.json(db.applyCoupon(req.params.cartId, code));
  });

  return router;
}
