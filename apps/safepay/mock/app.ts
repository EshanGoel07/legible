/**
 * Safe Pay MOCK — Contracts 3 + 4 with canned, in-memory responses. No PayPal, no store calls.
 * Lets Publisher (Eshan) and Crash Test (D) build against the real routes before the real service exists.
 *
 * Canned behaviour:
 *  - amount > maxAmount            → BLOCKED_LIMIT (no PayPal order, approvalUrl null)
 *  - otherwise                     → PENDING_APPROVAL with a fake sandbox approvalUrl
 *  - test/approve, return, capture → CAPTURED
 *  - verify                        → match:true, unless amount ends in ".13" or ?mismatch=1 (store says "paid" before capture)
 */
import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import {
  CONTRACTS_VERSION,
  CaptureResponse,
  Checkout,
  CreateCheckoutRequest,
  Health,
  ROUTES,
  VerifyResult,
} from "@legible/contracts";

type Row = Checkout & { captureId: string | null; cartId: string; siteId: string };

export function createMockApp() {
  const app = express();
  app.use(express.json());
  const checkouts = new Map<string, Row>();

  const toCheckout = (r: Row): Checkout =>
    Checkout.parse({
      checkoutId: r.checkoutId,
      paypalOrderId: r.paypalOrderId,
      approvalUrl: r.approvalUrl,
      status: r.status,
      amount: r.amount,
      currency: r.currency,
    });

  const capture = (r: Row) => {
    if (r.status === "PENDING_APPROVAL" || r.status === "APPROVED") {
      r.status = "CAPTURED";
      r.captureId = `MOCKCAP-${randomUUID().slice(0, 8).toUpperCase()}`;
    }
  };

  const find = (req: Request, res: Response, key: string): Row | undefined => {
    const id = String(req.params[key] ?? req.query[key] ?? "");
    const row = checkouts.get(id);
    if (!row) res.status(404).json({ error: "checkout_not_found", checkoutId: id });
    return row;
  };

  app.get(ROUTES.health, (_req, res) => {
    res.json(Health.parse({ ok: true, service: "safepay", version: "0.0.0-mock", contractsVersion: CONTRACTS_VERSION }));
  });

  app.post(ROUTES.safepay.checkouts, (req, res) => {
    const parsed = CreateCheckoutRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request", issues: parsed.error.issues });
      return;
    }
    const body = parsed.data;
    const checkoutId = `chk_${randomUUID().slice(0, 12)}`;
    const blocked = Number(body.amount) > body.maxAmount;
    const paypalOrderId = blocked ? null : `MOCK${randomUUID().replace(/-/g, "").slice(0, 13).toUpperCase()}`;
    const row: Row = {
      checkoutId,
      paypalOrderId,
      approvalUrl: blocked ? null : `https://www.sandbox.paypal.com/checkoutnow?token=${paypalOrderId}`,
      status: blocked ? "BLOCKED_LIMIT" : "PENDING_APPROVAL",
      amount: body.amount,
      currency: body.currency,
      captureId: null,
      cartId: body.cartId,
      siteId: body.siteId,
    };
    checkouts.set(checkoutId, row);
    res.status(blocked ? 200 : 201).json(toCheckout(row));
  });

  app.get(ROUTES.safepay.checkout, (req, res) => {
    const row = find(req, res, "id");
    if (row) res.json(toCheckout(row));
  });

  app.post(ROUTES.safepay.capture, (req, res) => {
    const row = find(req, res, "id");
    if (!row) return;
    if (row.status === "BLOCKED_LIMIT") {
      res.status(409).json({ error: "blocked_limit", checkoutId: row.checkoutId });
      return;
    }
    capture(row);
    res.json(
      CaptureResponse.parse({
        checkoutId: row.checkoutId,
        status: row.status === "CAPTURED" ? "CAPTURED" : "DECLINED",
        captureId: row.captureId,
      }),
    );
  });

  app.get(ROUTES.safepay.return, (req, res) => {
    const row = find(req, res, "checkoutId");
    if (!row) return;
    capture(row);
    res.type("html").send(`<h1>Payment ${row.status === "CAPTURED" ? "complete" : row.status}</h1><p>Checkout ${row.checkoutId} (mock)</p>`);
  });

  app.post(ROUTES.safepay.testApprove, (req, res) => {
    const row = find(req, res, "checkoutId");
    if (!row) return;
    if (row.status === "BLOCKED_LIMIT") {
      res.status(409).json({ error: "blocked_limit", checkoutId: row.checkoutId });
      return;
    }
    capture(row);
    res.json(toCheckout(row));
  });

  app.get(ROUTES.safepay.verify, (req, res) => {
    const row = find(req, res, "checkoutId");
    if (!row) return;
    const paypalStatus = row.status === "CAPTURED" ? "COMPLETED" : row.status === "DECLINED" ? "DECLINED" : row.paypalOrderId ? "CREATED" : "NONE";
    let storeStatus = row.status === "CAPTURED" ? "paid" : row.status === "DECLINED" ? "failed" : "pending";
    let paypalSideStatus = paypalStatus;
    // Planted-bug simulation: store marked "paid" while PayPal never captured.
    if (req.query.mismatch === "1" || row.amount.endsWith(".13")) {
      paypalSideStatus = "APPROVED";
      storeStatus = "paid";
    }
    const expectedStore = paypalSideStatus === "COMPLETED" ? "paid" : paypalSideStatus === "DECLINED" ? "failed" : "pending";
    const mismatches = storeStatus === expectedStore ? [] : [{ field: "status", paypal: paypalSideStatus, store: storeStatus }];
    res.json(
      VerifyResult.parse({
        checkoutId: row.checkoutId,
        paypal: { status: paypalSideStatus, amount: row.amount, currency: row.currency },
        store: { status: storeStatus, amount: row.amount, currency: row.currency },
        match: mismatches.length === 0,
        mismatches,
      }),
    );
  });

  return app;
}
