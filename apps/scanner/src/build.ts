/** Assemble Contract 1 from the three stages. Output always passes Manifest.parse. */
import { Manifest, Tool, type Risk } from "@legible/contracts";
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

/** The GET route the Publisher reads for the amount: longest GET path that is a prefix of the money route's path. */
export function findCartRoute(money: DiscoveredRoute, routes: DiscoveredRoute[]): DiscoveredRoute | null {
  const candidates = routes.filter(
    (r) => r.method === "GET" && r !== money && money.path.startsWith(r.path) && pathParams(r.path).every((p) => pathParams(money.path).includes(p)) && pathParams(r.path).length > 0,
  );
  return candidates.sort((a, b) => b.path.length - a.path.length)[0] ?? null;
}

const bindingKey = (b: Tool["binding"]) => (b.kind === "http" ? `${b.method} ${b.path}` : `safepay ${b.cartPath}`);
