/**
 * Stage 1 — Discover (deterministic, no LLM).
 * Finds Express route registrations (`app.get(...)`, `router.post(...)`, …) with ts-morph and returns
 * method, path, file, line, the handler source and the declarations the handler references.
 * Paths given as constants (e.g. `ROUTES.store.cart` declared `as const`) are resolved through the type checker.
 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { Node, Project, SyntaxKind, type CallExpression, type SourceFile } from "ts-morph";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type DiscoveredRoute = {
  method: HttpMethod;
  /** Express path, e.g. /api/cart/:cartId/items */
  path: string;
  /** Relative to the scanned root, e.g. src/routes/cart.ts */
  file: string;
  line: number;
  /** Comment lines directly above the registration */
  comment: string;
  handlerSource: string;
  /** Short source of declarations the handler uses (schemas, helpers' signatures) */
  context: string[];
};

export type DiscoverResult = { routes: DiscoveredRoute[]; skipped: Array<{ file: string; line: number; reason: string }> };

const METHODS = new Set(["get", "post", "put", "patch", "delete"]);
/** Infrastructure routes that are never agent tools (not sent to the LLM). */
const INFRA_PATHS = new Set(["/health", "/healthz", "/ready", "/metrics"]);
const MAX_CONTEXT_CHARS = 500;

export function discoverRoutes(root: string): DiscoverResult {
  const tsconfig = join(root, "tsconfig.json");
  const project = existsSync(tsconfig)
    ? new Project({ tsConfigFilePath: tsconfig, skipAddingFilesFromTsConfig: true })
    : new Project({ compilerOptions: { allowJs: true } });
  project.addSourceFilesAtPaths([join(root, "src/**/*.{ts,js,mts}"), "!" + join(root, "**/*.test.ts"), "!" + join(root, "**/node_modules/**")]);

  const routes: DiscoveredRoute[] = [];
  const skipped: DiscoverResult["skipped"] = [];
  for (const sf of project.getSourceFiles()) {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const r = toRoute(call, sf, root);
      if (!r) continue;
      if ("reason" in r) skipped.push(r);
      else if (!INFRA_PATHS.has(r.path)) routes.push(r);
    }
  }
  routes.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { routes, skipped };
}

function toRoute(call: CallExpression, sf: SourceFile, root: string): DiscoveredRoute | { file: string; line: number; reason: string } | null {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return null;
  const method = callee.getName();
  if (!METHODS.has(method)) return null;
  if (!looksLikeExpress(callee.getExpression())) return null;

  const args = call.getArguments();
  if (args.length < 2) return null;
  const handler = args[args.length - 1];
  if (!Node.isArrowFunction(handler) && !Node.isFunctionExpression(handler)) return null;

  const file = relative(root, sf.getFilePath());
  const line = call.getStartLineNumber();
  const path = resolvePath(args[0]);
  if (!path) return { file, line, reason: `could not resolve path expression \`${args[0].getText()}\`` };
  if (!path.startsWith("/")) return null;

  const stmt = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
  const comment = (stmt ?? call)
    .getLeadingCommentRanges()
    .map((c) => c.getText().replace(/^\/\/\s?|^\/\*+\s?|\s?\*+\/$/g, "").trim())
    .join(" ");

  return { method: method.toUpperCase() as HttpMethod, path, file, line, comment, handlerSource: handler.getText(), context: referencedDeclarations(handler) };
}

/** `app`, `router`, `fooRouter`, or anything typed as an Express app/router. */
function looksLikeExpress(receiver: Node): boolean {
  const text = receiver.getText();
  if (/^(app|router|server|api|\w+Router)$/.test(text)) return true;
  const type = receiver.getType().getText();
  return /\b(Express|Router|Application|IRouter)\b/.test(type);
}

/** String literal, no-substitution template, or any expression whose type is a string literal (e.g. ROUTES.x as const). */
function resolvePath(expr: Node): string | null {
  if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) return expr.getLiteralValue();
  const t = expr.getType();
  if (t.isStringLiteral()) return String(t.getLiteralValue());
  return null;
}

/** Declarations used inside the handler but defined elsewhere in project code (schemas in full, functions as signatures). */
function referencedDeclarations(handler: Node): string[] {
  const out = new Map<string, string>();
  for (const id of handler.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const decls = id.getSymbol()?.getDeclarations() ?? [];
    for (const d of decls) {
      const path = d.getSourceFile().getFilePath();
      if (path.includes("/node_modules/") || path.endsWith(".d.ts")) continue;
      if (d.getPos() >= handler.getPos() && d.getEnd() <= handler.getEnd()) continue; // declared inside the handler
      const text = declarationSummary(d);
      if (text) out.set(`${path}:${d.getPos()}`, text);
    }
  }
  return [...out.values()].slice(0, 8);
}

function declarationSummary(d: Node): string | null {
  if (Node.isVariableDeclaration(d)) {
    const text = d.getVariableStatement()?.getText() ?? d.getText();
    return text.length <= MAX_CONTEXT_CHARS ? text : `${text.slice(0, MAX_CONTEXT_CHARS)} …`;
  }
  if (Node.isMethodDeclaration(d) || Node.isFunctionDeclaration(d)) {
    const body = d.getBody();
    const sig = body ? d.getText().slice(0, body.getStart() - d.getStart()).trim() : d.getText();
    return sig.length <= MAX_CONTEXT_CHARS ? sig : null;
  }
  return null;
}

/** Express `:param` → manifest `{param}` */
export const toManifestPath = (p: string) => p.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
export const pathParams = (p: string) => [...p.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
