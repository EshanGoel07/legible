/**
 * Executes a manifest tool.
 *  http    → fill {params} from input, the rest goes to the query string (GET/DELETE) or JSON body; call STORE_URL.
 *  safepay → GET cartPath → StoreCart.parse → CreateCheckoutRequest (amount = cart total, maxAmount from limits)
 *            → POST Safe Pay → Checkout.parse → checkoutId, status, approvalUrl for the agent.
 */
import { Checkout, CreateCheckoutRequest, ROUTES, StoreCart, type Manifest, type Tool } from "@legible/contracts";

export type Deps = { storeUrl: string; safepayUrl: string; fetch?: typeof fetch };

export class ToolError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: unknown) {
    super(message);
  }
}

/** Replaces {name} with input values; returns the path and the inputs left over. */
export function fillPath(template: string, input: Record<string, unknown>): { path: string; rest: Record<string, unknown> } {
  const rest = { ...input };
  const path = template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => {
    const v = rest[name];
    if (v === undefined || v === null || v === "") throw new ToolError(`missing required path parameter "${name}"`);
    delete rest[name];
    return encodeURIComponent(String(v));
  });
  return { path, rest };
}

async function send(deps: Deps, method: string, url: string, body?: unknown): Promise<unknown> {
  const f = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    throw new ToolError(`${new URL(url).origin} unreachable: ${(e as Error).message}`);
  }
  const text = await res.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const msg = typeof json === "object" && json && "message" in json ? String((json as { message: unknown }).message) : typeof json === "string" ? json.slice(0, 200) : "";
    throw new ToolError(`HTTP ${res.status} from ${method} ${new URL(url).pathname}${msg ? `: ${msg}` : ""}`, res.status, json);
  }
  return json;
}

export async function callHttp(tool: Tool & { binding: { kind: "http" } }, input: Record<string, unknown>, deps: Deps): Promise<unknown> {
  const { method } = tool.binding;
  const { path, rest } = fillPath(tool.binding.path, input);
  const url = new URL(deps.storeUrl + path);
  if (method === "GET" || method === "DELETE") {
    for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    return send(deps, method, url.toString());
  }
  return send(deps, method, url.toString(), rest);
}

export async function callSafePay(tool: Tool & { binding: { kind: "safepay" } }, input: Record<string, unknown>, manifest: Manifest, runId: string | undefined, deps: Deps) {
  if (!tool.limits) throw new ToolError("money tool has no limits");
  const { path } = fillPath(tool.binding.cartPath, input);
  const cart = StoreCart.parse(await send(deps, "GET", deps.storeUrl + path));
  if (!cart.items.length) throw new ToolError("cart is empty");
  if (cart.currency !== tool.limits.currency)
    throw new ToolError(`cart currency ${cart.currency} does not match the tool limit currency ${tool.limits.currency}; refusing to pay`);
  const req = CreateCheckoutRequest.parse({
    siteId: manifest.site.id,
    cartId: cart.cartId,
    amount: cart.total,
    currency: cart.currency,
    maxAmount: tool.limits.maxAmount,
    ...(runId ? { runId } : {}),
  });
  const checkout = Checkout.parse(await send(deps, "POST", deps.safepayUrl + ROUTES.safepay.checkouts, req));
  const message =
    checkout.status === "BLOCKED_LIMIT"
      ? `Payment blocked: ${checkout.amount} ${checkout.currency} is over this site's limit of ${tool.limits.maxAmount} ${tool.limits.currency}. No PayPal order was created.`
      : checkout.status === "PENDING_APPROVAL"
        ? `PayPal order created for ${checkout.amount} ${checkout.currency}. A human must approve it at approvalUrl before any money moves.`
        : `Checkout status: ${checkout.status}.`;
  return { checkoutId: checkout.checkoutId, status: checkout.status, approvalUrl: checkout.approvalUrl, amount: checkout.amount, currency: checkout.currency, message };
}
