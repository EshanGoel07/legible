/** Product catalogue: read-only. */
import { Router } from "express";
import type { StoreConfig } from "../config.js";
import type { StoreDb } from "../db.js";
import { present } from "../planted.js";

export function productRoutes(db: StoreDb, cfg: StoreConfig) {
  const router = Router();

  // Search products by text and optional max price (USD).
  router.get("/api/products", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const maxPrice = req.query.maxPrice !== undefined ? Number(req.query.maxPrice) : undefined;
    res.json({ products: db.searchProducts(q, Number.isFinite(maxPrice) ? maxPrice : undefined).map((p) => present(p, cfg)) });
  });

  // One product with its sizes, price and stock.
  router.get("/api/products/:productId", (req, res) => {
    res.json(present(db.getProduct(req.params.productId), cfg));
  });

  return router;
}
