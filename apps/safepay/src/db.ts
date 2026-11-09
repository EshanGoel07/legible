/** SQLite persistence for checkouts (better-sqlite3, synchronous). */
import Database from "better-sqlite3";
import type { CheckoutStatus } from "@legible/contracts";

export type CheckoutRow = {
  checkoutId: string;
  siteId: string;
  cartId: string;
  runId: string | null;
  amount: string;
  currency: string;
  maxAmount: number;
  status: CheckoutStatus;
  paypalOrderId: string | null;
  approvalUrl: string | null;
  captureId: string | null;
  /** TEST ONLY: next capture is sent with PayPal's sandbox decline mock header */
  declineOnCapture: boolean;
  createdAt: string;
  updatedAt: string;
};

type DbRow = Omit<CheckoutRow, "declineOnCapture"> & { declineOnCapture: number };

export class CheckoutRepo {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkouts (
        checkoutId TEXT PRIMARY KEY,
        siteId TEXT NOT NULL,
        cartId TEXT NOT NULL,
        runId TEXT,
        amount TEXT NOT NULL,
        currency TEXT NOT NULL,
        maxAmount REAL NOT NULL,
        status TEXT NOT NULL,
        paypalOrderId TEXT UNIQUE,
        approvalUrl TEXT,
        captureId TEXT,
        declineOnCapture INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )`);
  }

  insert(row: CheckoutRow): void {
    this.db
      .prepare(
        `INSERT INTO checkouts (checkoutId, siteId, cartId, runId, amount, currency, maxAmount, status, paypalOrderId, approvalUrl, captureId, declineOnCapture, createdAt, updatedAt)
         VALUES (@checkoutId, @siteId, @cartId, @runId, @amount, @currency, @maxAmount, @status, @paypalOrderId, @approvalUrl, @captureId, @declineOnCapture, @createdAt, @updatedAt)`,
      )
      .run({ ...row, declineOnCapture: row.declineOnCapture ? 1 : 0 });
  }

  get(checkoutId: string): CheckoutRow | null {
    const r = this.db.prepare(`SELECT * FROM checkouts WHERE checkoutId = ?`).get(checkoutId) as DbRow | undefined;
    return r ? { ...r, declineOnCapture: r.declineOnCapture === 1 } : null;
  }

  update(checkoutId: string, patch: Partial<Omit<CheckoutRow, "checkoutId" | "createdAt">>): CheckoutRow {
    const fields = Object.keys(patch) as (keyof typeof patch)[];
    const values: Record<string, unknown> = { checkoutId, updatedAt: new Date().toISOString() };
    for (const f of fields) values[f] = f === "declineOnCapture" ? (patch[f] ? 1 : 0) : patch[f];
    const sets = [...fields.filter((f) => f !== "updatedAt"), "updatedAt"].map((f) => `${f} = @${f}`).join(", ");
    this.db.prepare(`UPDATE checkouts SET ${sets} WHERE checkoutId = @checkoutId`).run(values);
    const row = this.get(checkoutId);
    if (!row) throw new Error(`checkout ${checkoutId} not found`);
    return row;
  }

  close(): void {
    this.db.close();
  }
}
