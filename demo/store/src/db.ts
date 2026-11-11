/** SQLite schema, seed data and the queries every route uses. */
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { StoreCart, StoreOrder, type CreateStoreOrderRequest } from "@legible/contracts";
import { CURRENCY, SHIPPING_CENTS } from "./config.js";
import { toCents, toMoney } from "./money.js";

export type Product = {
  productId: string;
  name: string;
  description: string;
  price: string;
  currency: string;
  sizes: string[];
  stock: number;
};

type ProductRow = { id: string; name: string; description: string; price_cents: number; sizes: string; stock: number };

const SEED: Array<Omit<ProductRow, "sizes"> & { sizes: string[] }> = [
  { id: "hoodie-black", name: "Classic Hoodie (Black)", description: "Heavyweight cotton hoodie with a kangaroo pocket.", price_cents: 2900, sizes: ["S", "M", "L"], stock: 50 },
  { id: "hoodie-grey", name: "Classic Hoodie (Grey)", description: "Heavyweight cotton hoodie, heather grey.", price_cents: 2900, sizes: ["S", "M", "L"], stock: 50 },
  { id: "leather-jacket", name: "Leather Jacket", description: "Full-grain leather biker jacket.", price_cents: 7900, sizes: ["S", "M", "L"], stock: 20 },
  { id: "tee-white", name: "Basic Tee (White)", description: "Organic cotton crew-neck t-shirt.", price_cents: 1200, sizes: ["S", "M", "L"], stock: 100 },
  { id: "jeans-slim", name: "Slim Jeans", description: "Stretch denim, slim fit.", price_cents: 4500, sizes: ["30", "32", "34"], stock: 40 },
  { id: "sneakers-canvas", name: "Canvas Sneakers", description: "Low-top canvas sneakers.", price_cents: 5900, sizes: ["8", "9", "10"], stock: 30 },
  { id: "cap-logo", name: "Logo Cap", description: "Adjustable cotton cap.", price_cents: 1500, sizes: [], stock: 60 },
  { id: "socks-pack", name: "Socks (3-pack)", description: "Cotton crew socks, three pairs.", price_cents: 800, sizes: [], stock: 80 },
];

export const COUPONS: Record<string, number> = { DIWALI20: 0.2 };

export class StoreError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export class StoreDb {
  readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
        price_cents INTEGER NOT NULL, sizes TEXT NOT NULL, stock INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS carts (id TEXT PRIMARY KEY, coupon TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cart_items (cart_id TEXT NOT NULL, product_id TEXT NOT NULL, size TEXT NOT NULL DEFAULT '',
        qty INTEGER NOT NULL, PRIMARY KEY (cart_id, product_id, size));
      CREATE TABLE IF NOT EXISTS orders (checkout_id TEXT PRIMARY KEY, cart_id TEXT NOT NULL, status TEXT NOT NULL,
        amount TEXT NOT NULL, currency TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
    const upsert = this.db.prepare(
      "INSERT OR REPLACE INTO products (id, name, description, price_cents, sizes, stock) VALUES (@id, @name, @description, @price_cents, @sizes, @stock)",
    );
    for (const p of SEED) upsert.run({ ...p, sizes: JSON.stringify(p.sizes) });
  }

  private toProduct(r: ProductRow): Product {
    return { productId: r.id, name: r.name, description: r.description, price: toMoney(r.price_cents), currency: CURRENCY, sizes: JSON.parse(r.sizes), stock: r.stock };
  }

  // ───────────── products

  searchProducts(q?: string, maxPrice?: number): Product[] {
    const rows = this.db.prepare("SELECT * FROM products ORDER BY price_cents").all() as ProductRow[];
    const words = (q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    return rows
      .filter((r) => words.every((w) => `${r.name} ${r.description} ${r.id}`.toLowerCase().includes(w)))
      .filter((r) => maxPrice === undefined || r.price_cents <= maxPrice * 100)
      .map((r) => this.toProduct(r));
  }

  getProduct(productId: string): Product {
    const r = this.db.prepare("SELECT * FROM products WHERE id = ?").get(productId) as ProductRow | undefined;
    if (!r) throw new StoreError(404, "product_not_found", `no product ${productId}`);
    return this.toProduct(r);
  }

  // ───────────── carts

  createCart(): StoreCart {
    const id = `cart_${randomUUID().slice(0, 8)}`;
    this.db.prepare("INSERT INTO carts (id, coupon, created_at) VALUES (?, NULL, ?)").run(id, new Date().toISOString());
    return this.getCart(id);
  }

  getCart(cartId: string): StoreCart {
    const cart = this.db.prepare("SELECT * FROM carts WHERE id = ?").get(cartId) as { id: string; coupon: string | null } | undefined;
    if (!cart) throw new StoreError(404, "cart_not_found", `no cart ${cartId}`);
    const items = this.db
      .prepare("SELECT ci.product_id, ci.size, ci.qty, p.price_cents FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = ? ORDER BY ci.rowid")
      .all(cartId) as Array<{ product_id: string; size: string; qty: number; price_cents: number }>;
    const subtotal = items.reduce((s, i) => s + i.price_cents * i.qty, 0);
    const discount = cart.coupon ? Math.round(subtotal * (COUPONS[cart.coupon] ?? 0)) : 0;
    const shipping = items.length ? SHIPPING_CENTS : 0;
    return StoreCart.parse({
      cartId,
      items: items.map((i) => ({ productId: i.product_id, size: i.size || null, qty: i.qty, unitPrice: toMoney(i.price_cents) })),
      subtotal: toMoney(subtotal),
      shipping: toMoney(shipping),
      discount: toMoney(discount),
      total: toMoney(subtotal - discount + shipping),
      currency: CURRENCY,
      coupon: cart.coupon,
    });
  }

  addItem(cartId: string, productId: string, size: string | undefined, qty: number): StoreCart {
    this.getCart(cartId);
    const p = this.getProduct(productId);
    if (p.sizes.length && !size) throw new StoreError(400, "size_required", `${productId} needs a size: ${p.sizes.join(", ")}`);
    if (size && !p.sizes.includes(size)) throw new StoreError(400, "invalid_size", `${productId} comes in ${p.sizes.join(", ") || "one size"}`);
    if (qty > p.stock) throw new StoreError(409, "out_of_stock", `only ${p.stock} left`);
    this.db
      .prepare("INSERT INTO cart_items (cart_id, product_id, size, qty) VALUES (?, ?, ?, ?) ON CONFLICT (cart_id, product_id, size) DO UPDATE SET qty = qty + excluded.qty")
      .run(cartId, productId, size ?? "", qty);
    return this.getCart(cartId);
  }

  applyCoupon(cartId: string, code: string): StoreCart {
    this.getCart(cartId);
    const c = code.trim().toUpperCase();
    if (!(c in COUPONS)) throw new StoreError(400, "invalid_coupon", `coupon ${code} is not valid`);
    this.db.prepare("UPDATE carts SET coupon = ? WHERE id = ?").run(c, cartId);
    return this.getCart(cartId);
  }

  // ───────────── orders (Contract 6: Safe Pay calls these)

  createOrder(req: CreateStoreOrderRequest, status: "pending" | "paid"): StoreOrder {
    this.getCart(req.cartId);
    const now = new Date().toISOString();
    this.db
      .prepare("INSERT OR IGNORE INTO orders (checkout_id, cart_id, status, amount, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(req.checkoutId, req.cartId, status, toMoney(toCents(req.amount)), req.currency, now, now);
    return this.getOrder(req.checkoutId);
  }

  getOrder(checkoutId: string): StoreOrder {
    const r = this.db.prepare("SELECT * FROM orders WHERE checkout_id = ?").get(checkoutId) as
      | { checkout_id: string; cart_id: string; status: string; amount: string; currency: string }
      | undefined;
    if (!r) throw new StoreError(404, "order_not_found", `no order for checkout ${checkoutId}`);
    return StoreOrder.parse({ checkoutId: r.checkout_id, cartId: r.cart_id, status: r.status, amount: r.amount, currency: r.currency });
  }

  setOrderStatus(checkoutId: string, status: "paid" | "failed"): StoreOrder {
    this.getOrder(checkoutId);
    this.db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE checkout_id = ?").run(status, new Date().toISOString(), checkoutId);
    return this.getOrder(checkoutId);
  }
}
