/** Assemble Contract 1 from the three stages. Output always passes Manifest.parse. */
import { Manifest, ROUTES, Tool, type Risk } from "@legible/contracts";
import { classify, type Classified } from "./classify.js";
import { pathParams, toManifestPath, type DiscoveredRoute } from "./discover.js";
import type { RouteDescription } from "./describe.js";

export type BuildOptions = {
  site: { id: string; name: string; baseUrl: string };
  limits: { currency: string; maxAmount: number };
  approveAll?: boolean;
  /** Reuse tool names from a previous manifest for the same binding (renaming tools breaks agents). */
  previous?: Manifest;
};

export type RouteDetail = {
  method: string;
  path: string;
  file: string;
  line: number;
  llm: RouteDescription | null;
  error: string | null;
  classified: Classified | null;
  /** Final decision; null when the route could not be described */
  final: { expose: boolean; name: string; risk: Risk; confidence: number } | null;
  note?: string;
};

export type BuildResult = { manifest: Manifest; details: RouteDetail[]; warnings: string[] };

export function buildManifest(routes: DiscoveredRoute[], described: Array<RouteDescription | Error>, opts: BuildOptions): BuildResult {
  const warnings: string[] = [];
  const details: RouteDetail[] = [];
  const tools: Tool[] = [];
  const used = new Set<string>();
  const previousNames = new Map((opts.previous?.tools ?? []).map((t) => [bindingKey(t.binding), t.name]));

  routes.forEach((route, i) => {
    const d = described[i];
    const base = { method: route.method, path: route.path, file: route.file, line: route.line };
    if (d instanceof Error) {
      warnings.push(`${route.method} ${route.path}: LLM failed (${d.message}); route skipped`);
      details.push({ ...base, llm: null, error: d.message, classified: null, final: null });
      return;
    }
    const c = classify(route, d);
    const detail: RouteDetail = { ...base, llm: d, error: null, classified: c, final: { expose: d.expose, name: d.name, risk: c.risk, confidence: c.confidence } };
    details.push(detail);
    if (!d.expose) return;

    // Safety rule: the order API exists for the payment service (Contract 6). Whatever the model says, agents never get it.
    if (isPaymentServiceRoute(route)) {
      detail.final!.expose = false;
      detail.note = PAYMENT_SERVICE_NOTE;
      warnings.push(`${route.method} ${route.path}: ${detail.note}`);
      return;
    }

    let binding: Tool["binding"];
    if (c.risk === "money") {
      const cart = findCartRoute(route, routes);
      if (!cart) {
        detail.final!.expose = false;
        detail.note = "money route without a GET cart/total route: cannot bind to Safe Pay, not exposed";
        warnings.push(`${route.method} ${route.path}: ${detail.note}`);
        return;
      }
      binding = { kind: "safepay", cartPath: toManifestPath(cart.path) };
    } else {
      binding = { kind: "http", method: route.method, path: toManifestPath(route.path) };
    }

    let name = previousNames.get(bindingKey(binding)) ?? d.name;
    for (let n = 2; used.has(name); n++) name = `${d.name}_${n}`;
    used.add(name);
    detail.final!.name = name;

    tools.push(
      Tool.parse({
        name,
        description: d.description,
        risk: c.risk,
        approved: !!opts.approveAll,
        inputSchema: inputSchema(route, d),
        binding,
        source: { file: route.file, line: route.line },
        confidence: c.confidence,
        riskReason: c.riskReason,
        ...(c.risk === "money" ? { limits: { currency: opts.limits.currency, maxAmount: opts.limits.maxAmount } } : {}),
      }),
    );
  });

  if (!tools.length) throw new Error(`no tools to publish (${warnings.length} warnings: ${warnings.join(" | ")})`);
  return { manifest: Manifest.parse({ manifestVersion: "0.1", site: opts.site, tools }), details, warnings };
}

/** JSON Schema from the LLM's input list; every path param is forced in as a required string. */
export function inputSchema(route: DiscoveredRoute, d: RouteDescription) {
  const properties: Record<string, Record<string, unknown>> = {};
  const required = new Set<string>();
  for (const p of pathParams(route.path)) {
    properties[p] = { type: "string" };
    required.add(p);
  }
  for (const inp of d.inputs) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(inp.name)) continue;
    if (inp.in === "path" && !(inp.name in properties)) continue; // model invented a path param that isn't in the route
    properties[inp.name] = { type: inp.type, ...(inp.description ? { description: inp.description } : {}) };
    if (inp.required || inp.in === "path") required.add(inp.name);
  }
  return { type: "object" as const, properties, ...(required.size ? { required: [...required] } : {}) };
}

/** Contract 6: routes the payment service (Safe Pay) calls on the site to record and update orders. */
const PAYMENT_SERVICE_ROUTES = new Set<string>([ROUTES.store.orders, ROUTES.store.order, ROUTES.store.orderStatus]);
export const PAYMENT_SERVICE_NOTE = "order route that only the payment service calls (Contract 6): never an agent tool, not exposed";
export const isPaymentServiceRoute = (r: Pick<DiscoveredRoute, "path">) => PAYMENT_SERVICE_ROUTES.has(r.path);

const segments = (p: string) => p.split("/").filter(Boolean);

/**
 * A route that returns a cart, so its total is what the shopper agreed to pay. Never an orders route.
 * Cart = the handler (or a declaration it uses) mentions StoreCart, or the path has a `cart(s)` segment directly
 * followed by a cart-id param (e.g. /api/cart/:cartId).
 */
export function isCartRoute(r: Pick<DiscoveredRoute, "method" | "path" | "handlerSource" | "context">): boolean {
  if (r.method !== "GET") return false;
  const segs = segments(r.path);
  if (segs.some((s) => /^orders?$/i.test(s))) return false;
  const cartParam = segs.some((s, i) => /^carts?$/i.test(s) && /^:\w*cart\w*$/i.test(segs[i + 1] ?? ""));
  const returnsCart = /\bStoreCart\b/.test(`${r.handlerSource}\n${r.context.join("\n")}`);
  return cartParam || returnsCart;
}

/**
 * The GET route the Publisher reads for the amount: the longest cart route (see isCartRoute) whose path is a prefix of
 * the money route's path and whose params the money route also has. Safe Pay charges that route's total, so an orders
 * route (or anything else that is not a cart) must never be picked.
 */
export function findCartRoute(money: DiscoveredRoute, routes: DiscoveredRoute[]): DiscoveredRoute | null {
  const candidates = routes.filter(
    (r) => r !== money && isCartRoute(r) && money.path.startsWith(r.path) && pathParams(r.path).length > 0 && pathParams(r.path).every((p) => pathParams(money.path).includes(p)),
  );
  return candidates.sort((a, b) => b.path.length - a.path.length)[0] ?? null;
}

const bindingKey = (b: Tool["binding"]) => (b.kind === "http" ? `${b.method} ${b.path}` : `safepay ${b.cartPath}`);
