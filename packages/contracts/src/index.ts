/**
 * @legible/contracts — the ONLY thing modules share.
 * Frozen after Sat 7 Nov. Changing anything here = a PR labelled `contract`,
 * lead approval, and everyone pulling the same hour. Bump CONTRACTS_VERSION.
 */
import { z } from "zod";

export const CONTRACTS_VERSION = "0.2.0";

/** Header the agent/harness sends on every MCP request so calls can be matched to a run. */
export const RUN_HEADER = "x-legible-run";

/** Money as a decimal string ("1499.00"), never a float — same as PayPal. */
export const Money = z.string().regex(/^\d+\.\d{2}$/, "amount must look like 1499.00");
export const Currency = z.string().regex(/^[A-Z]{3}$/, "ISO 4217 code, e.g. INR");

// ───────────────────────── Contract 1 — Agent manifest (Scanner → Publisher, Dashboard, Crash Test)

export const Risk = z.enum(["read", "write", "money"]);
export type Risk = z.infer<typeof Risk>;

export const HttpBinding = z.object({
  kind: z.literal("http"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  /** Route on the site, may contain {params} that map to input fields, e.g. /api/cart/{cartId}/items */
  path: z.string().startsWith("/"),
});

export const SafePayBinding = z.object({
  kind: z.literal("safepay"),
  /** Route the Publisher reads to get the cart total before calling Safe Pay */
  cartPath: z.string().startsWith("/"),
});

export const Binding = z.discriminatedUnion("kind", [HttpBinding, SafePayBinding]);

export const Tool = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, "snake_case tool name"),
    description: z.string().min(5),
    risk: Risk,
    approved: z.boolean(),
    /** JSON Schema object describing the tool's input */
    inputSchema: z.object({ type: z.literal("object") }).passthrough(),
    binding: Binding,
    /** Where the scanner found it — shown in the dashboard */
    source: z.object({ file: z.string(), line: z.number().int().positive() }).optional(),
    /** Scanner's confidence 0..1 and one-line reason for the risk tier */
    confidence: z.number().min(0).max(1).optional(),
    riskReason: z.string().optional(),
    limits: z.object({ currency: Currency, maxAmount: z.number().positive() }).optional(),
  })
  .superRefine((t, ctx) => {
    if (t.risk === "money" && t.binding.kind !== "safepay")
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["binding"], message: "money tools must use a safepay binding" });
    if (t.binding.kind === "safepay" && t.risk !== "money")
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["risk"], message: "safepay binding requires risk=money" });
    if (t.risk === "money" && !t.limits)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["limits"], message: "money tools need limits" });
  });
export type Tool = z.infer<typeof Tool>;

export const Manifest = z
  .object({
    manifestVersion: z.literal("0.1"),
    site: z.object({ id: z.string().min(1), name: z.string().min(1), baseUrl: z.string().url() }),
    tools: z.array(Tool).min(1),
  })
  .superRefine((m, ctx) => {
    const seen = new Set<string>();
    m.tools.forEach((t, i) => {
      if (seen.has(t.name))
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tools", i, "name"], message: `duplicate tool ${t.name}` });
      seen.add(t.name);
    });
  });
export type Manifest = z.infer<typeof Manifest>;

// ───────────────────────── Contract 2 — Tool call log (Publisher writes runs/<runId>/calls.jsonl, Crash Test reads)

export const ToolCallLog = z.object({
  runId: z.string().min(1),
  ts: z.string().datetime(),
  tool: z.string(),
  input: z.record(z.unknown()),
  ok: z.boolean(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  ms: z.number().nonnegative(),
});
export type ToolCallLog = z.infer<typeof ToolCallLog>;

// ───────────────────────── Contract 3 — Safe Pay API (Safe Pay serves, Publisher calls)

export const CheckoutStatus = z.enum(["PENDING_APPROVAL", "APPROVED", "CAPTURED", "DECLINED", "BLOCKED_LIMIT"]);
export type CheckoutStatus = z.infer<typeof CheckoutStatus>;

/** POST /safepay/checkouts */
export const CreateCheckoutRequest = z.object({
  siteId: z.string(),
  cartId: z.string(),
  amount: Money,
  currency: Currency,
  runId: z.string().optional(),
  /** Limit from the manifest tool; Safe Pay refuses above it */
  maxAmount: z.number().positive(),
});
export type CreateCheckoutRequest = z.infer<typeof CreateCheckoutRequest>;

/** Response of POST /safepay/checkouts and GET /safepay/checkouts/:id */
export const Checkout = z.object({
  checkoutId: z.string(),
  paypalOrderId: z.string().nullable(),
  approvalUrl: z.string().url().nullable(),
  status: CheckoutStatus,
  amount: Money,
  currency: Currency,
});
export type Checkout = z.infer<typeof Checkout>;

/** POST /safepay/checkouts/:id/capture */
export const CaptureResponse = z.object({
  checkoutId: z.string(),
  status: z.enum(["CAPTURED", "DECLINED"]),
  captureId: z.string().nullable(),
});
export type CaptureResponse = z.infer<typeof CaptureResponse>;

// ───────────────────────── Contract 4 — Verify API (Safe Pay serves GET /verify/:checkoutId, Crash Test calls)

const Side = z.object({ status: z.string(), amount: Money, currency: Currency });
export const VerifyResult = z.object({
  checkoutId: z.string(),
  paypal: Side,
  store: Side,
  match: z.boolean(),
  mismatches: z.array(z.object({ field: z.string(), paypal: z.string(), store: z.string() })),
});
export type VerifyResult = z.infer<typeof VerifyResult>;

// ───────────────────────── Contract 5 — Scenario (YAML in fixtures/scenarios) and Report (runs/<runId>/report.json)

export const Scenario = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  site: z.string(),
  task: z.string().min(10),
  expect: z.object({
    toolsCalled: z.array(z.string()).optional(),
    toolsNotCalled: z.array(z.string()).optional(),
    paidAmountMax: z.number().positive().optional(),
    currency: Currency.optional(),
    verifyMatch: z.boolean().optional(),
    finalStatus: CheckoutStatus.optional(),
  }),
});
export type Scenario = z.infer<typeof Scenario>;

export const FailureKind = z.enum(["tool_error", "wrong_amount", "state_mismatch", "task_failed", "injection_followed", "limit_bypassed"]);

export const Report = z.object({
  runId: z.string(),
  siteId: z.string(),
  createdAt: z.string().datetime(),
  /** 0..100 Agent-Readiness Score */
  score: z.number().min(0).max(100),
  scenarios: z.array(
    z.object({
      id: z.string(),
      agent: z.string(),
      passed: z.boolean(),
      failures: z.array(z.object({ kind: FailureKind, message: z.string(), evidence: z.unknown().optional() })),
    })
  ),
});
export type Report = z.infer<typeof Report>;

// ───────────────────────── Contract 6 — Store API (Demo store serves; Publisher and Safe Pay call it)
/**
 * Order lifecycle (who calls what):
 *  1. Publisher's `checkout` tool: GET store cart  → StoreCart (amount = total)
 *  2. Publisher → Safe Pay POST /safepay/checkouts
 *  3. Safe Pay → store POST /api/orders            → StoreOrder status "pending"
 *  4. Buyer approves in PayPal → PayPal redirects to Safe Pay GET /safepay/return → Safe Pay captures
 *  5. Safe Pay → store POST /api/orders/:checkoutId/status { paid | failed }
 *  6. Crash Test → Safe Pay GET /verify/:checkoutId (Safe Pay reads GET /api/orders/:checkoutId)
 */

/** GET /api/cart/:cartId */
export const StoreCart = z.object({
  cartId: z.string(),
  items: z.array(z.object({ productId: z.string(), size: z.string().nullable(), qty: z.number().int().positive(), unitPrice: Money })),
  subtotal: Money,
  shipping: Money,
  discount: Money,
  total: Money,
  currency: Currency,
  coupon: z.string().nullable(),
});
export type StoreCart = z.infer<typeof StoreCart>;

export const StoreOrderStatus = z.enum(["pending", "paid", "failed"]);

/** POST /api/orders — Safe Pay creates the store's order when a checkout is created */
export const CreateStoreOrderRequest = z.object({ cartId: z.string(), checkoutId: z.string(), amount: Money, currency: Currency });
export type CreateStoreOrderRequest = z.infer<typeof CreateStoreOrderRequest>;

/** POST /api/orders/:checkoutId/status — Safe Pay updates it after capture or decline */
export const UpdateStoreOrderStatusRequest = z.object({ status: z.enum(["paid", "failed"]) });

/** Response of the three order routes, and of GET /api/orders/:checkoutId */
export const StoreOrder = z.object({ checkoutId: z.string(), cartId: z.string(), status: StoreOrderStatus, amount: Money, currency: Currency });
export type StoreOrder = z.infer<typeof StoreOrder>;

// ───────────────────────── Every route in one place (use these, never retype paths)
export const ROUTES = {
  health: "/health",
  store: {
    cart: "/api/cart/:cartId",
    orders: "/api/orders",
    order: "/api/orders/:checkoutId",
    orderStatus: "/api/orders/:checkoutId/status",
  },
  safepay: {
    checkouts: "/safepay/checkouts",
    checkout: "/safepay/checkouts/:id",
    capture: "/safepay/checkouts/:id/capture",
    /** PayPal return_url: captures, then updates the store order */
    return: "/safepay/return",
    /** TEST ONLY (SAFEPAY_TEST_MODE=1): Playwright approves as the sandbox buyer, waits for capture, returns Checkout */
    testApprove: "/safepay/test/approve/:checkoutId",
    verify: "/verify/:checkoutId",
  },
} as const;

// ───────────────────────── Every service: GET /health

export const Health = z.object({
  ok: z.boolean(),
  service: z.enum(["store", "publisher", "safepay", "dashboard"]),
  version: z.string(),
  contractsVersion: z.string(),
});
export type Health = z.infer<typeof Health>;
