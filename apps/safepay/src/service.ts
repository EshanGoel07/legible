/**
 * Safe Pay core: limits → PayPal order → store order → (human approval) → capture once → store status → verify.
 * Order lifecycle: see the comment above StoreCart in @legible/contracts.
 */
import { randomUUID } from "node:crypto";
import {
  CaptureResponse,
  Checkout,
  CreateCheckoutRequest,
  ROUTES,
  VerifyResult,
} from "@legible/contracts";
import type { CheckoutRepo, CheckoutRow } from "./db.js";
import { PayPalError, approvalLink, firstCapture, type PayPalClient, type PayPalOrder } from "./paypal.js";
import type { StoreApi } from "./store-client.js";

export type PayPalApi = Pick<PayPalClient, "createOrder" | "getOrder" | "captureOrder">;
/** Opens the approval URL as the sandbox buyer and resolves once PayPal has redirected back (approved). */
export type Approver = (approvalUrl: string) => Promise<void>;

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

/** PayPal 422 issues that mean the payment was declined (vs. a programming / state error). */
const DECLINE_ISSUES = new Set(["INSTRUMENT_DECLINED", "TRANSACTION_REFUSED", "PAYER_CANNOT_PAY", "PAYEE_BLOCKED_TRANSACTION", "MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED"]);

/** What the human sees on the PayPal approval page, so it is obvious an agent started this payment. */
export const BRAND_NAME = "Legible Demo Store";
export const ORDER_DESCRIPTION = "AI agent purchase";

export type SafePayDeps = {
  repo: CheckoutRepo;
  paypal: PayPalApi;
  store: StoreApi;
  safepayUrl: string;
  approver?: Approver;
  log?: (msg: string) => void;
};

export class SafePayService {
  private inflight = new Map<string, Promise<CaptureResponse>>();
  private log: (msg: string) => void;

  constructor(private readonly deps: SafePayDeps) {
    this.log = deps.log ?? ((m) => console.log(`[safepay] ${m}`));
  }

  private toCheckout(r: CheckoutRow): Checkout {
    return Checkout.parse({
      checkoutId: r.checkoutId,
      paypalOrderId: r.paypalOrderId,
      approvalUrl: r.approvalUrl,
      status: r.status,
      amount: r.amount,
      currency: r.currency,
    });
  }

  private mustGet(checkoutId: string): CheckoutRow {
    const row = this.deps.repo.get(checkoutId);
    if (!row) throw new HttpError(404, "checkout_not_found", `no checkout ${checkoutId}`);
    return row;
  }

  // ───────────── Contract 3

  async createCheckout(input: unknown): Promise<Checkout> {
    const parsed = CreateCheckoutRequest.safeParse(input);
    if (!parsed.success) throw new HttpError(400, "invalid_request", "body does not match CreateCheckoutRequest", parsed.error.issues);
    const req = parsed.data;
    const now = new Date().toISOString();
    const checkoutId = `chk_${randomUUID()}`;
    const base: CheckoutRow = {
      checkoutId,
      siteId: req.siteId,
      cartId: req.cartId,
      runId: req.runId ?? null,
      amount: req.amount,
      currency: req.currency,
      maxAmount: req.maxAmount,
      status: "PENDING_APPROVAL",
      paypalOrderId: null,
      approvalUrl: null,
      captureId: null,
      declineOnCapture: false,
      createdAt: now,
      updatedAt: now,
    };

    // Spending limit: refuse before anything touches PayPal or the store.
    if (Number(req.amount) > req.maxAmount) {
      this.deps.repo.insert({ ...base, status: "BLOCKED_LIMIT" });
      this.log(`${checkoutId} BLOCKED_LIMIT ${req.amount} ${req.currency} > max ${req.maxAmount}`);
      return this.toCheckout(this.mustGet(checkoutId));
    }

    const returnBase = `${this.deps.safepayUrl.replace(/\/+$/, "")}${ROUTES.safepay.return}?checkoutId=${encodeURIComponent(checkoutId)}`;
    let order: PayPalOrder;
    try {
      order = await this.deps.paypal.createOrder({
        amount: req.amount,
        currency: req.currency,
        returnUrl: returnBase,
        cancelUrl: `${returnBase}&cancelled=1`,
        referenceId: checkoutId,
        requestId: `${checkoutId}-create`,
        brandName: BRAND_NAME,
        description: ORDER_DESCRIPTION,
        ...(req.runId ? { customId: req.runId } : {}),
      });
    } catch (e) {
      if (e instanceof PayPalError) throw new HttpError(502, "paypal_create_failed", e.message, { issues: e.issues, debugId: e.debugId });
      throw e;
    }
    const url = approvalLink(order);
    if (!url) throw new HttpError(502, "paypal_no_approval_link", `PayPal order ${order.id} has no approval link`);
    this.deps.repo.insert({ ...base, paypalOrderId: order.id, approvalUrl: url });

    try {
      await this.deps.store.createOrder({ cartId: req.cartId, checkoutId, amount: req.amount, currency: req.currency });
    } catch (e) {
      this.log(`${checkoutId} store create order failed: ${(e as Error).message}`);
      throw new HttpError(502, "store_create_failed", (e as Error).message);
    }
    this.log(`${checkoutId} PENDING_APPROVAL paypal=${order.id} ${req.amount} ${req.currency}`);
    return this.toCheckout(this.mustGet(checkoutId));
  }

  getCheckout(checkoutId: string): Checkout {
    return this.toCheckout(this.mustGet(checkoutId));
  }

  /** Captures at most once per checkout; concurrent callers (return_url + test approve) share one PayPal call. */
  capture(checkoutId: string): Promise<CaptureResponse> {
    const running = this.inflight.get(checkoutId);
    if (running) return running;
    const p = this.doCapture(checkoutId).finally(() => this.inflight.delete(checkoutId));
    this.inflight.set(checkoutId, p);
    return p;
  }

  private async doCapture(checkoutId: string): Promise<CaptureResponse> {
    let row = this.mustGet(checkoutId);
    if (row.status === "CAPTURED" || row.status === "DECLINED") return this.captureResponse(row);
    if (row.status === "BLOCKED_LIMIT" || !row.paypalOrderId)
      throw new HttpError(409, "blocked_limit", `checkout ${checkoutId} was blocked by its spending limit; nothing to capture`);

    let outcome: { status: "CAPTURED" | "DECLINED"; captureId: string | null };
    try {
      const order = await this.deps.paypal.captureOrder(row.paypalOrderId, { requestId: `${checkoutId}-capture`, mockDecline: row.declineOnCapture });
      outcome = this.outcomeFromOrder(order);
    } catch (e) {
      if (!(e instanceof PayPalError)) throw e;
      if (e.issues.includes("ORDER_NOT_APPROVED") || e.issues.includes("PAYER_ACTION_REQUIRED"))
        throw new HttpError(409, "not_approved", "the buyer has not approved this PayPal order yet");
      if (e.issues.includes("ORDER_ALREADY_CAPTURED")) {
        outcome = this.outcomeFromOrder(await this.deps.paypal.getOrder(row.paypalOrderId));
      } else if (e.issues.some((i) => DECLINE_ISSUES.has(i))) {
        outcome = { status: "DECLINED", captureId: null };
      } else {
        throw new HttpError(502, "paypal_capture_failed", e.message, { issues: e.issues, debugId: e.debugId });
      }
    }

    row = this.deps.repo.update(checkoutId, { status: outcome.status, captureId: outcome.captureId });
    this.log(`${checkoutId} ${outcome.status}${outcome.captureId ? ` capture=${outcome.captureId}` : ""}`);
    try {
      await this.deps.store.setStatus(checkoutId, outcome.status === "CAPTURED" ? "paid" : "failed");
    } catch (e) {
      // Money already moved (or was declined) at PayPal; Verify will surface the store mismatch.
      this.log(`${checkoutId} store status update failed: ${(e as Error).message}`);
    }
    return this.captureResponse(row);
  }

  private outcomeFromOrder(order: PayPalOrder): { status: "CAPTURED" | "DECLINED"; captureId: string | null } {
    const cap = firstCapture(order);
    if (cap?.status === "COMPLETED") return { status: "CAPTURED", captureId: cap.id };
    return { status: "DECLINED", captureId: cap?.id ?? null };
  }

  private captureResponse(row: CheckoutRow): CaptureResponse {
    return CaptureResponse.parse({ checkoutId: row.checkoutId, status: row.status, captureId: row.captureId });
  }

  // ───────────── PayPal return_url

  async handleReturn(checkoutId: string, cancelled: boolean): Promise<Checkout> {
    const row = this.mustGet(checkoutId);
    if (cancelled) {
      this.log(`${checkoutId} buyer cancelled at PayPal`);
      return this.toCheckout(row);
    }
    await this.capture(checkoutId);
    return this.getCheckout(checkoutId);
  }

  // ───────────── TEST ONLY: automated sandbox approval

  async testApprove(checkoutId: string, opts: { decline?: boolean } = {}): Promise<Checkout> {
    if (!this.deps.approver) throw new HttpError(404, "not_found", "test approval is disabled");
    let row = this.mustGet(checkoutId);
    if (row.status === "BLOCKED_LIMIT") throw new HttpError(409, "blocked_limit", `checkout ${checkoutId} was blocked by its spending limit`);
    if (row.status === "PENDING_APPROVAL" || row.status === "APPROVED") {
      if (opts.decline) row = this.deps.repo.update(checkoutId, { declineOnCapture: true });
      if (!row.approvalUrl) throw new HttpError(409, "no_approval_url", `checkout ${checkoutId} has no approval URL`);
      await this.deps.approver(row.approvalUrl);
      await this.capture(checkoutId); // no-op if the return_url redirect already captured
    }
    return this.getCheckout(checkoutId);
  }

  // ───────────── Contract 4

  async verify(checkoutId: string): Promise<VerifyResult> {
    const row = this.mustGet(checkoutId);

    let paypal: { status: string; amount: string; currency: string };
    if (!row.paypalOrderId) {
      paypal = { status: "NONE", amount: row.amount, currency: row.currency };
    } else {
      let order: PayPalOrder;
      try {
        order = await this.deps.paypal.getOrder(row.paypalOrderId);
      } catch (e) {
        if (e instanceof PayPalError) throw new HttpError(502, "paypal_get_failed", e.message, { debugId: e.debugId });
        throw e;
      }
      const cap = firstCapture(order);
      const amt = cap?.amount ?? order.purchase_units?.[0]?.amount;
      paypal = { status: cap?.status ?? order.status, amount: amt?.value ?? "0.00", currency: amt?.currency_code ?? row.currency };
    }

    let storeOrder;
    try {
      storeOrder = await this.deps.store.getOrder(checkoutId);
    } catch (e) {
      throw new HttpError(502, "store_get_failed", (e as Error).message);
    }
    const store = storeOrder
      ? { status: storeOrder.status, amount: storeOrder.amount, currency: storeOrder.currency }
      : { status: "missing", amount: row.amount, currency: row.currency };

    const mismatches: VerifyResult["mismatches"] = [];
    // The store may only say "paid" when PayPal holds a COMPLETED capture, and vice versa.
    const paypalPaid = paypal.status === "COMPLETED";
    const storePaid = store.status === "paid";
    const statusOk = row.paypalOrderId ? paypalPaid === storePaid && (store.status !== "missing") : store.status === "missing";
    if (!statusOk) mismatches.push({ field: "status", paypal: paypal.status, store: store.status });
    if (row.paypalOrderId && storeOrder) {
      if (Number(paypal.amount).toFixed(2) !== Number(store.amount).toFixed(2))
        mismatches.push({ field: "amount", paypal: paypal.amount, store: store.amount });
      if (paypal.currency !== store.currency) mismatches.push({ field: "currency", paypal: paypal.currency, store: store.currency });
    }

    return VerifyResult.parse({ checkoutId, paypal, store, match: mismatches.length === 0, mismatches });
  }
}
