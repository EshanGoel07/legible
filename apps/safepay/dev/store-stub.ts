/**
 * DEV/TEST ONLY: tiny in-memory stand-in for the demo store's Contract 6 order routes,
 * so Safe Pay can be run and tested before D's real store exists. Not the real store.
 * `plantPaidBeforeCapture` reproduces the planted bug: the store marks orders "paid" on creation.
 */
import express from "express";
import {
  CONTRACTS_VERSION,
  CreateStoreOrderRequest,
  Health,
  ROUTES,
  StoreOrder,
  UpdateStoreOrderStatusRequest,
} from "@legible/contracts";

export function createStoreStub(init: { plantPaidBeforeCapture?: boolean } = {}) {
  const opts = { ...init };
  const app = express();
  app.use(express.json());
  const orders = new Map<string, StoreOrder>();

  app.get(ROUTES.health, (_req, res) => {
    res.json(Health.parse({ ok: true, service: "store", version: "0.0.0-safepay-stub", contractsVersion: CONTRACTS_VERSION }));
  });

  app.post(ROUTES.store.orders, (req, res) => {
    const p = CreateStoreOrderRequest.safeParse(req.body);
    if (!p.success) return void res.status(400).json({ error: "invalid_request", issues: p.error.issues });
    const order = StoreOrder.parse({ ...p.data, status: opts.plantPaidBeforeCapture ? "paid" : "pending" });
    orders.set(order.checkoutId, order);
    res.status(201).json(order);
  });

  app.post(ROUTES.store.orderStatus, (req, res) => {
    const order = orders.get(String(req.params.checkoutId));
    if (!order) return void res.status(404).json({ error: "order_not_found" });
    const p = UpdateStoreOrderStatusRequest.safeParse(req.body);
    if (!p.success) return void res.status(400).json({ error: "invalid_request", issues: p.error.issues });
    order.status = p.data.status;
    res.json(StoreOrder.parse(order));
  });

  app.get(ROUTES.store.order, (req, res) => {
    const order = orders.get(String(req.params.checkoutId));
    if (!order) return void res.status(404).json({ error: "order_not_found" });
    res.json(StoreOrder.parse(order));
  });

  /** Toggle the planted "paid before capture" bug at runtime (affects orders created afterwards). */
  const setPlantPaidBeforeCapture = (on: boolean) => {
    opts.plantPaidBeforeCapture = on;
  };
  return { app, orders, setPlantPaidBeforeCapture };
}
