/** HTTP client for the store's Contract 6 order routes. Every response is parsed with the contract schema. */
import { CreateStoreOrderRequest, ROUTES, StoreOrder, UpdateStoreOrderStatusRequest } from "@legible/contracts";

export interface StoreApi {
  createOrder(req: CreateStoreOrderRequest): Promise<StoreOrder>;
  setStatus(checkoutId: string, status: "paid" | "failed"): Promise<StoreOrder>;
  /** null when the store has no order for this checkout (404) */
  getOrder(checkoutId: string): Promise<StoreOrder | null>;
}

export class StoreError extends Error {
  constructor(message: string, readonly httpStatus?: number) {
    super(message);
    this.name = "StoreError";
  }
}

export class StoreClient implements StoreApi {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private url(path: string, checkoutId?: string) {
    return this.baseUrl.replace(/\/+$/, "") + (checkoutId ? path.replace(":checkoutId", encodeURIComponent(checkoutId)) : path);
  }

  private async send(method: string, url: string, body?: unknown): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new StoreError(`store unreachable at ${this.baseUrl}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async expectOrder(res: Response, what: string): Promise<StoreOrder> {
    if (!res.ok) throw new StoreError(`store ${what} failed: HTTP ${res.status}`, res.status);
    return StoreOrder.parse(await res.json());
  }

  async createOrder(req: CreateStoreOrderRequest): Promise<StoreOrder> {
    const res = await this.send("POST", this.url(ROUTES.store.orders), CreateStoreOrderRequest.parse(req));
    return this.expectOrder(res, "create order");
  }

  async setStatus(checkoutId: string, status: "paid" | "failed"): Promise<StoreOrder> {
    const res = await this.send("POST", this.url(ROUTES.store.orderStatus, checkoutId), UpdateStoreOrderStatusRequest.parse({ status }));
    return this.expectOrder(res, "update order status");
  }

  async getOrder(checkoutId: string): Promise<StoreOrder | null> {
    const res = await this.send("GET", this.url(ROUTES.store.order, checkoutId));
    if (res.status === 404) return null;
    return this.expectOrder(res, "get order");
  }
}
