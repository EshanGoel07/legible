/** Express routes for Contracts 3 + 4 (+ PayPal return_url and the TEST ONLY approve route). */
import express, { type NextFunction, type Request, type Response } from "express";
import { CONTRACTS_VERSION, Health, ROUTES } from "@legible/contracts";
import { SERVICE_VERSION } from "./config.js";
import { HttpError, type SafePayService } from "./service.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body style="font-family:system-ui;max-width:32rem;margin:4rem auto"><h1>${esc(title)}</h1><p>${body}</p></body></html>`;

export function createApp(service: SafePayService, opts: { testMode: boolean }) {
  const app = express();
  app.use(express.json());

  app.get(ROUTES.health, (_req, res) => {
    res.json(Health.parse({ ok: true, service: "safepay", version: SERVICE_VERSION, contractsVersion: CONTRACTS_VERSION }));
  });

  app.post(ROUTES.safepay.checkouts, async (req, res) => {
    const c = await service.createCheckout(req.body);
    res.status(c.status === "BLOCKED_LIMIT" ? 200 : 201).json(c);
  });

  app.get(ROUTES.safepay.checkout, (req, res) => {
    res.json(service.getCheckout(String(req.params.id)));
  });

  app.post(ROUTES.safepay.capture, async (req, res) => {
    res.json(await service.capture(String(req.params.id)));
  });

  app.get(ROUTES.safepay.return, async (req, res) => {
    const checkoutId = typeof req.query.checkoutId === "string" ? req.query.checkoutId : "";
    if (!checkoutId) throw new HttpError(400, "missing_checkout_id", "checkoutId query parameter is required");
    const c = await service.handleReturn(checkoutId, req.query.cancelled === "1");
    const title = c.status === "CAPTURED" ? "Payment complete" : c.status === "DECLINED" ? "Payment declined" : "Payment not completed";
    res.type("html").send(page(title, `Checkout <code>${esc(c.checkoutId)}</code>: ${esc(c.status)} (${esc(c.amount)} ${esc(c.currency)}). You can close this tab.`));
  });

  if (opts.testMode) {
    app.post(ROUTES.safepay.testApprove, async (req, res) => {
      res.json(await service.testApprove(String(req.params.checkoutId), { decline: req.query.outcome === "decline" }));
    });
  }

  app.get(ROUTES.safepay.verify, async (req, res) => {
    res.json(await service.verify(String(req.params.checkoutId)));
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not_found" });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: "invalid_json" });
      return;
    }
    console.error(`[safepay] ${req.method} ${req.path} failed: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
