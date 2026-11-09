import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { CaptureResponse, Checkout, Health, ROUTES, VerifyResult } from "@legible/contracts";
import { createApp } from "../src/app.js";
import { CheckoutRepo } from "../src/db.js";
import { PayPalError, type PayPalOrder } from "../src/paypal.js";
import { SafePayService, type PayPalApi } from "../src/service.js";
import { StoreClient } from "../src/store-client.js";
import { createStoreStub } from "../dev/store-stub.js";

/** In-memory PayPal Orders v2 double: approval is simulated with `approve(orderId)`. */
class FakePayPal implements PayPalApi {
  orders = new Map<string, { order: PayPalOrder; approved: boolean }>();
  calls = { create: 0, capture: 0 };
  private n = 0;
  async createOrder(o: { amount: string; currency: string; returnUrl: string }) {
    this.calls.create++;
    const id = `FAKE${++this.n}`;
    const order: PayPalOrder = {
      id,
      status: "PAYER_ACTION_REQUIRED",
      links: [{ rel: "payer-action", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }],
      purchase_units: [{ amount: { value: o.amount, currency_code: o.currency } }],
    };
    this.orders.set(id, { order, approved: false });
    return order;
  }
  approve(id: string) {
    const o = this.orders.get(id)!;
    o.approved = true;
    o.order.status = "APPROVED";
  }
  async getOrder(id: string) {
    return structuredClone(this.orders.get(id)!.order);
  }
  async captureOrder(id: string, opts: { mockDecline?: boolean } = {}) {
    this.calls.capture++;
    await new Promise((r) => setTimeout(r, 20));
    const o = this.orders.get(id)!;
    if (!o.approved) throw new PayPalError("not approved", 422, "UNPROCESSABLE_ENTITY", ["ORDER_NOT_APPROVED"], "dbg");
    if (opts.mockDecline) throw new PayPalError("declined", 422, "UNPROCESSABLE_ENTITY", ["INSTRUMENT_DECLINED"], "dbg");
    if (o.order.status === "COMPLETED") throw new PayPalError("already", 422, "UNPROCESSABLE_ENTITY", ["ORDER_ALREADY_CAPTURED"], "dbg");
    const amount = o.order.purchase_units![0].amount!;
    o.order.status = "COMPLETED";
    o.order.purchase_units![0].payments = { captures: [{ id: `CAP-${id}`, status: "COMPLETED", amount }] };
    return structuredClone(o.order);
  }
}

let storeServer: Server;
let storeUrl: string;
let stub: ReturnType<typeof createStoreStub>;
let paypal: FakePayPal;
let service: SafePayService;
let base: string;
let appServer: Server | undefined;

const req = { siteId: "demo-store", cartId: "cart_1", amount: "20.00", currency: "USD", maxAmount: 50 };

beforeAll(async () => {
  stub = createStoreStub();
  storeServer = stub.app.listen(0);
  await new Promise((r) => storeServer.once("listening", r));
  storeUrl = `http://127.0.0.1:${(storeServer.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => storeServer.close(() => r())));

async function startApp(testMode: boolean) {
  appServer?.close();
  paypal = new FakePayPal();
  stub.setPlantPaidBeforeCapture(false);
  stub.orders.clear();
  service = new SafePayService({
    repo: new CheckoutRepo(":memory:"),
    paypal,
    store: new StoreClient(storeUrl),
    safepayUrl: "http://localhost:3003",
    approver: testMode ? async (url) => paypal.approve(new URL(url).searchParams.get("token")!) : undefined,
    log: () => {},
  });
  appServer = createApp(service, { testMode }).listen(0);
  await new Promise((r) => appServer!.once("listening", r));
  base = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
}

const u = (route: string, id = "") => base + route.replace(/:(id|checkoutId)/, encodeURIComponent(id));
const post = (url: string, body?: unknown) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const create = async (body: Record<string, unknown> = req) => Checkout.parse(await (await post(u(ROUTES.safepay.checkouts), body)).json());
const verify = async (id: string) => VerifyResult.parse(await (await fetch(u(ROUTES.safepay.verify, id))).json());

describe("Safe Pay service (fake PayPal, store stub)", () => {
  beforeEach(() => startApp(true));
  afterAll(() => appServer?.close());

  it("health", async () => {
    expect(Health.parse(await (await fetch(u(ROUTES.health))).json()).service).toBe("safepay");
  });

  it("over the limit → BLOCKED_LIMIT, no PayPal order, no store order", async () => {
    const c = await create({ ...req, amount: "50.01" });
    expect(c).toMatchObject({ status: "BLOCKED_LIMIT", paypalOrderId: null, approvalUrl: null });
    expect(paypal.calls.create).toBe(0);
    expect(stub.orders.size).toBe(0);
    expect((await post(u(ROUTES.safepay.capture, c.checkoutId))).status).toBe(409);
    expect((await verify(c.checkoutId)).match).toBe(true);
  });

  it("exactly at the limit is allowed", async () => {
    expect((await create({ ...req, amount: "50.00" })).status).toBe("PENDING_APPROVAL");
  });

  it("create → store order pending, approval URL returned", async () => {
    const c = await create();
    expect(c.status).toBe("PENDING_APPROVAL");
    expect(c.approvalUrl).toContain("sandbox.paypal.com");
    expect(stub.orders.get(c.checkoutId)?.status).toBe("pending");
    expect(Checkout.parse(await (await fetch(u(ROUTES.safepay.checkout, c.checkoutId))).json()).checkoutId).toBe(c.checkoutId);
  });

  it("capture before approval → 409 not_approved, nothing changes", async () => {
    const c = await create();
    const res = await post(u(ROUTES.safepay.capture, c.checkoutId));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_approved");
    expect(stub.orders.get(c.checkoutId)?.status).toBe("pending");
  });

  it("return_url + concurrent capture → one PayPal capture, store paid, verify match", async () => {
    const c = await create();
    paypal.approve(c.paypalOrderId!);
    const [a, b] = await Promise.all([
      fetch(`${u(ROUTES.safepay.return)}?checkoutId=${c.checkoutId}&token=${c.paypalOrderId}`),
      post(u(ROUTES.safepay.capture, c.checkoutId)),
    ]);
    expect(a.status).toBe(200);
    expect(await a.text()).toContain("Payment complete");
    expect(CaptureResponse.parse(await b.json()).status).toBe("CAPTURED");
    expect(paypal.calls.capture).toBe(1);
    expect(stub.orders.get(c.checkoutId)?.status).toBe("paid");
    expect(await verify(c.checkoutId)).toMatchObject({ match: true, paypal: { status: "COMPLETED" }, store: { status: "paid" } });
  });

  it("cancel on return_url leaves the checkout pending", async () => {
    const c = await create();
    await fetch(`${u(ROUTES.safepay.return)}?checkoutId=${c.checkoutId}&cancelled=1`);
    expect(service.getCheckout(c.checkoutId).status).toBe("PENDING_APPROVAL");
  });

  it("test approve → CAPTURED", async () => {
    const c = await create();
    expect(Checkout.parse(await (await post(u(ROUTES.safepay.testApprove, c.checkoutId))).json()).status).toBe("CAPTURED");
  });

  it("test approve with outcome=decline → DECLINED, store failed, verify match", async () => {
    const c = await create();
    const r = Checkout.parse(await (await post(`${u(ROUTES.safepay.testApprove, c.checkoutId)}?outcome=decline`)).json());
    expect(r.status).toBe("DECLINED");
    expect(stub.orders.get(c.checkoutId)?.status).toBe("failed");
    expect((await verify(c.checkoutId)).match).toBe(true);
  });

  it("verify catches the planted paid-before-capture bug", async () => {
    stub.setPlantPaidBeforeCapture(true);
    const c = await create();
    const v = await verify(c.checkoutId);
    expect(v.match).toBe(false);
    expect(v.mismatches).toContainEqual({ field: "status", paypal: "PAYER_ACTION_REQUIRED", store: "paid" });
  });

  it("verify catches an amount mismatch", async () => {
    const c = await create();
    stub.orders.get(c.checkoutId)!.amount = "19.00";
    expect((await verify(c.checkoutId)).mismatches).toContainEqual({ field: "amount", paypal: "20.00", store: "19.00" });
  });

  it("invalid body → 400, unknown id → 404", async () => {
    expect((await post(u(ROUTES.safepay.checkouts), { ...req, amount: 20 })).status).toBe(400);
    expect((await fetch(u(ROUTES.safepay.checkout, "nope"))).status).toBe(404);
    expect((await fetch(u(ROUTES.safepay.verify, "nope"))).status).toBe(404);
  });
});

describe("test mode off", () => {
  beforeAll(() => startApp(false));
  afterAll(() => appServer?.close());

  it("POST /safepay/test/approve is not served", async () => {
    const c = await create();
    expect((await post(u(ROUTES.safepay.testApprove, c.checkoutId))).status).toBe(404);
  });
});
