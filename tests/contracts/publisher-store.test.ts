// Join: Publisher (MCP http bindings) → store.
import { describe, expect, it } from "vitest";
import { StoreCart } from "@legible/contracts";
import { URLS, mcp, up } from "./helpers";

const ready = (await up(URLS.store, "store")) && (await up(URLS.publisher, "publisher"));
const out = (r: any) => JSON.parse(r.content[0].text);

describe.skipIf(!ready)("publisher → store", () => {
  it("tools/list serves tools with object input schemas", async () => {
    const { tools } = await mcp("tools/list", {});
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) expect(t.inputSchema.type).toBe("object");
  });

  it("http bindings reach the store: search (GET + query), cart create/add (POST + path params) return StoreCart", async () => {
    const found = out(await mcp("tools/call", { name: "search_products", arguments: { q: "hoodie", maxPrice: 30 } }));
    expect(found.products.length).toBeGreaterThan(0);
    const cart = StoreCart.parse(out(await mcp("tools/call", { name: "create_cart", arguments: {} })));
    const added = StoreCart.parse(out(await mcp("tools/call", { name: "add_to_cart", arguments: { cartId: cart.cartId, productId: found.products[0].productId, size: "M", qty: 1 } })));
    expect(added.items).toHaveLength(1);
    expect(added.total).toBe("34.00");
  });

  it("store errors come back as MCP isError results", async () => {
    const r = await mcp("tools/call", { name: "add_to_cart", arguments: { cartId: "cart_does_not_exist", productId: "x", qty: 1 } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/HTTP 404/);
  });
});
