/** Express app: API routes, Contract 6 order routes, static HTML pages, JSON errors. */
import express, { type NextFunction, type Request, type Response } from "express";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { CONTRACTS_VERSION, Health, ROUTES } from "@legible/contracts";
import { STORE_VERSION, type StoreConfig } from "./config.js";
import { StoreError, type StoreDb } from "./db.js";
import { productRoutes } from "./routes/products.js";
import { cartRoutes } from "./routes/cart.js";
import { orderRoutes } from "./routes/orders.js";
import { checkoutRoutes } from "./routes/checkout.js";
import { pageRoutes } from "./routes/pages.js";

export function createApp(db: StoreDb, cfg: StoreConfig) {
  const app = express();
  app.use(express.json());

  app.get(ROUTES.health, (_req, res) => {
    res.json(Health.parse({ ok: true, service: "store", version: STORE_VERSION, contractsVersion: CONTRACTS_VERSION }));
  });

  app.use(productRoutes(db));
  app.use(cartRoutes(db, cfg));
  app.use(orderRoutes(db, cfg));
  app.use(checkoutRoutes(db, cfg));
  app.use(pageRoutes(db));
  app.use(express.static(fileURLToPath(new URL("../public", import.meta.url)), { extensions: ["html"] }));

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found" });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof StoreError) {
      if (err.status >= 500) console.error(`[store] ${req.method} ${req.path} ${err.status} ${err.message}`);
      res.status(err.status).json({ error: err.code, message: err.message });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: "invalid_request", message: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
    console.error(`[store] ${req.method} ${req.path} failed: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
