/** Contract 6 order routes: called by Safe Pay (server to server), not by shoppers. */
import { Router } from "express";
import { CreateStoreOrderRequest, ROUTES, UpdateStoreOrderStatusRequest } from "@legible/contracts";
import type { StoreDb } from "../db.js";
import type { StoreConfig } from "../config.js";

export function orderRoutes(db: StoreDb, cfg: StoreConfig) {
  const router = Router();

  // Safe Pay records the store's order when a PayPal checkout is created.
  router.post(ROUTES.store.orders, (req, res) => {
    const body = CreateStoreOrderRequest.parse(req.body);
    // PLANTED BUG (BUG_PAID_EARLY=1): marks the order paid before PayPal has captured anything.
    res.status(201).json(db.createOrder(body, cfg.bugs.paidEarly ? "paid" : "pending"));
  });

  // Order status for a checkout.
  router.get(ROUTES.store.order, (req, res) => {
    res.json(db.getOrder(req.params.checkoutId));
  });

  // Safe Pay marks the order paid or failed after PayPal capture or decline.
  router.post(ROUTES.store.orderStatus, (req, res) => {
    const { status } = UpdateStoreOrderStatusRequest.parse(req.body);
    res.json(db.setOrderStatus(req.params.checkoutId, status));
  });

  return router;
}
