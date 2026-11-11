import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Checkout, CreateCheckoutRequest, Health, ROUTES, StoreCart, StoreOrder } from "@legible/contracts";
import { createApp } from "../src/app.js";
import { loadConfig, type StoreConfig } from "../src/config.js";
import { StoreDb } from "../src/db.js";

const servers: Server[] = [];
const listen = (app: express.Express) =>
  new Promise<string>((resolve) => {
    const s = app.listen(0, () => resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`));
    servers.push(s);
  });
afterAll(() => servers.forEach((s) => s.close()));

/** Fake Safe Pay: records the request and returns a canned Checkout. */
const safepayCalls: unknown[] = [];
let safepayUrl = "";
beforeAll(async () => {
  const sp = express();
  sp.use(express.json());
  sp.post(ROUTES.safepay.checkouts, (req, res) => {
    const body = CreateCheckoutRequest.parse(req.body);
    safepayCalls.push(body);
    res.status(201).json(Checkout.parse({ checkoutId: "chk_1", paypalOrderId: "PP1", approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=PP1", status: "PENDING_APPROVAL", amount: body.amount, currency: body.currency }));
  });
  safepayUrl = await listen(sp);
});

async function startStore(bugs: StoreConfig["bugs"]) {
  const cfg = { ...loadConfig({}), dbPath: ":memory:", safepayUrl, bugs };
  const base = await listen(createApp(new StoreDb(cfg.dbPath), cfg));
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json()) as any };
  };
  return call;
}

describe("demo store (bugs off)", () => {
  let call: Awaited<ReturnType<typeof startStore>>;
  beforeAll(async () => {
    call = await startStore({ couponApi: false, paidEarly: false });
  });

  it("GET /health returns Health", async () => {
    const r = await call("GET", ROUTES.health);
    expect(Health.parse(r.body)).toMatchObject({ ok: true, service: "store" });
  });

  it("searches products by text and max price", async () => {
    const r = await call("GET", "/api/products?q=hoodie");
    expect(r.body.products).toHaveLength(2);
    expect(r.body.products[0]).toMatchObject({ price: "29.00", currency: "USD", sizes: ["S", "M", "L"] });
    const cheap = await call("GET", "/api/products?maxPrice=15");
    expect(cheap.body.products.every((p: any) => Number(p.price) <= 15)).toBe(true);
    expect((await call("GET", "/api/products")).body.products).toHaveLength(8);
  });

  it("gets one product, 404 for unknown", async () => {
    expect((await call("GET", "/api/products/leather-jacket")).body.price).toBe("79.00");
    expect((await call("GET", "/api/products/nope")).status).toBe(404);
  });

  it("cart flow: create, add, coupon, totals match StoreCart", async () => {
    const created = await call("POST", "/api/cart");
    expect(created.status).toBe(201);
    const cartId = StoreCart.parse(created.body).cartId;
    expect((await call("POST", `/api/cart/${cartId}/items`, { productId: "hoodie-black", qty: 1 })).status).toBe(400); // size required
    const added = await call("POST", `/api/cart/${cartId}/items`, { productId: "hoodie-black", size: "M", qty: 1 });
    expect(StoreCart.parse(added.body)).toMatchObject({ subtotal: "29.00", shipping: "5.00", discount: "0.00", total: "34.00", currency: "USD" });
    const couponed = await call("POST", `/api/cart/${cartId}/coupon`, { code: "diwali20" });
    expect(StoreCart.parse(couponed.body)).toMatchObject({ discount: "5.80", total: "28.20", coupon: "DIWALI20" });
    expect((await call("POST", `/api/cart/${cartId}/coupon`, { code: "FAKE" })).status).toBe(400);
    expect(StoreCart.parse((await call("GET", `/api/cart/${cartId}`)).body).total).toBe("28.20");
  });

  it("order routes return StoreOrder and start pending", async () => {
    const { cartId } = (await call("POST", "/api/cart")).body;
    const created = await call("POST", ROUTES.store.orders, { cartId, checkoutId: "chk_a", amount: "28.20", currency: "USD" });
    expect(created.status).toBe(201);
    expect(StoreOrder.parse(created.body).status).toBe("pending");
    const paid = await call("POST", ROUTES.store.orderStatus.replace(":checkoutId", "chk_a"), { status: "paid" });
    expect(StoreOrder.parse(paid.body).status).toBe("paid");
    expect(StoreOrder.parse((await call("GET", ROUTES.store.order.replace(":checkoutId", "chk_a"))).body).status).toBe("paid");
    expect((await call("GET", ROUTES.store.order.replace(":checkoutId", "missing"))).status).toBe(404);
    expect((await call("POST", ROUTES.store.orders, { cartId })).status).toBe(400);
  });

  it("checkout sends the cart total to Safe Pay and returns its Checkout", async () => {
    const { cartId } = (await call("POST", "/api/cart")).body;
    expect((await call("POST", `/api/cart/${cartId}/checkout`)).status).toBe(400); // empty
    await call("POST", `/api/cart/${cartId}/items`, { productId: "cap-logo", qty: 2 });
    const r = await call("POST", `/api/cart/${cartId}/checkout`);
    expect(Checkout.parse(r.body).status).toBe("PENDING_APPROVAL");
    expect(safepayCalls.at(-1)).toMatchObject({ siteId: "demo-store", cartId, amount: "35.00", currency: "USD", maxAmount: 100 });
  });
});

describe("planted bugs (on)", () => {
  let call: Awaited<ReturnType<typeof startStore>>;
  beforeAll(async () => {
    call = await startStore({ couponApi: true, paidEarly: true });
  });

  it("BUG_COUPON_API: API returns 500 for DIWALI20, web page route still works", async () => {
    const { cartId } = (await call("POST", "/api/cart")).body;
    await call("POST", `/api/cart/${cartId}/items`, { productId: "hoodie-grey", size: "L", qty: 1 });
    expect((await call("POST", `/api/cart/${cartId}/coupon`, { code: "DIWALI20" })).status).toBe(500);
    const web = await call("POST", `/web/cart/${cartId}/coupon`, { code: "DIWALI20" });
    expect(StoreCart.parse(web.body).total).toBe("28.20");
  });

  it("BUG_PAID_EARLY: new order is stored as paid", async () => {
    const { cartId } = (await call("POST", "/api/cart")).body;
    const r = await call("POST", ROUTES.store.orders, { cartId, checkoutId: "chk_b", amount: "34.00", currency: "USD" });
    expect(StoreOrder.parse(r.body).status).toBe("paid");
  });
});
