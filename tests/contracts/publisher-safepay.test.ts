// Join: Publisher (safepay binding) → Safe Pay.
import { describe, expect, it } from "vitest";
import { Checkout, ROUTES } from "@legible/contracts";
import { URLS, json, makeCart, mcp, path, up } from "./helpers";

const ready = (await up(URLS.store, "store")) && (await up(URLS.publisher, "publisher")) && (await up(URLS.safepay, "safepay"));
const out = (r: any) => JSON.parse(r.content[0].text);

describe.skipIf(!ready)("publisher → safepay", () => {
  it("checkout tool creates a Safe Pay checkout for the cart total and returns a sandbox approvalUrl", async () => {
    const cart = await makeCart();
    const r = out(await mcp("tools/call", { name: "checkout", arguments: { cartId: cart.cartId } }));
    expect(r).toMatchObject({ status: "PENDING_APPROVAL", amount: cart.total, currency: "USD" });
    expect(r.approvalUrl).toMatch(/sandbox\.paypal\.com/);
    const co = Checkout.parse((await json("GET", URLS.safepay + path(ROUTES.safepay.checkout, { id: r.checkoutId }))).body);
    expect(co.amount).toBe(cart.total);
  });

  it("over the manifest limit → BLOCKED_LIMIT passed through to the agent", async () => {
    const cart = await makeCart("leather-jacket", "L", 4);
    const r = out(await mcp("tools/call", { name: "checkout", arguments: { cartId: cart.cartId } }));
    expect(r).toMatchObject({ status: "BLOCKED_LIMIT", approvalUrl: null });
  });
});
