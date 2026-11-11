/** Human web channel: HTML pages and the endpoint the cart page uses for coupons. */
import { Router } from "express";
import { z } from "zod";
import type { StoreDb } from "../db.js";

export function pageRoutes(db: StoreDb) {
  const router = Router();

  // Web page coupon form (used by public/cart.html; not part of the API).
  router.post("/web/cart/:cartId/coupon", (req, res) => {
    const { code } = z.object({ code: z.string().min(1) }).parse(req.body ?? {});
    res.json(db.applyCoupon(req.params.cartId, code));
  });

  return router;
}
