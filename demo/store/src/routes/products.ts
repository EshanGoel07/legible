/** Product catalogue: read-only. */
import { Router } from "express";
import type { StoreDb } from "../db.js";

export function productRoutes(db: StoreDb) {
  const router = Router();

  // Search products by text and optional max price (USD).
  router.get("/api/products", (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const maxPrice = req.query.maxPrice !== undefined ? Number(req.query.maxPrice) : undefined;
    res.json({ products: db.searchProducts(q, Number.isFinite(maxPrice) ? maxPrice : undefined) });
  });

  // One product with its sizes, price and stock.
  router.get("/api/products/:productId", (req, res) => {
    res.json(db.getProduct(req.params.productId));
  });

  return router;
}
