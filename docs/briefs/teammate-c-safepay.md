# Brief — Teammate C: Safe Pay + Verify (PayPal)

**Your job in one line:** every agent payment goes through you — create a PayPal Sandbox order, enforce limits,
capture only after human approval, and prove PayPal's record matches the store's.

**This is the part judges at a PayPal hackathon look at hardest. It must never be cut.**

## You own
`apps/safepay/`. You are the only person who writes PayPal code.

## Contracts
- Serves (to Eshan's Publisher): **Contract 3** `POST /safepay/checkouts`, `GET /safepay/checkouts/:id`, `POST /safepay/checkouts/:id/capture`; **Contract 4** `GET /verify/:checkoutId` → `VerifyResult`
- Calls: PayPal Orders v2 (Sandbox), the store's order route (`STORE_URL`)

## Stack
Node 20 + TypeScript · `express` · PayPal REST via `fetch` (OAuth client-credentials → Orders v2) · `better-sqlite3` · `playwright` (sandbox approval helper only) · `zod` · `vitest`

## Phase 0 — tonight (most important check of the day)
- [ ] Script: get OAuth token → create order (intent CAPTURE, INR or USD) → print approval link → approve as sandbox buyer → capture → print COMPLETED
- [ ] `apps/safepay/mock`: Contracts 3 and 4 with canned responses on port 3003 (`pnpm --filter safepay dev:fixture`) so Eshan and D aren't blocked
- If INR fails in sandbox for your account, tell Eshan immediately — we switch the demo currency to USD in fixtures.

## Phase 1 — Sat night to Sun
- [ ] `CreateCheckoutRequest.parse` input; if `Number(amount) > maxAmount` → return `BLOCKED_LIMIT`, create no PayPal order
- [ ] Create PayPal order, store checkout row in SQLite, return `Checkout` with `approvalUrl` (the `payer-action`/approve link)
- [ ] Status sync: poll `GET /v2/checkout/orders/:id` (webhooks are a stretch) → `APPROVED`; capture → `CAPTURED` or `DECLINED`
- [ ] Verify API: fetch PayPal order + store's order row, compare status/amount/currency → `VerifyResult` with `mismatches`
- [ ] `approveAsSandboxBuyer(approvalUrl)` with Playwright, using `PAYPAL_SANDBOX_BUYER_*` — test harness only
- [ ] Decline path: use PayPal's sandbox negative testing so the declined-payment scenario works
- [ ] `GET /health` returns `Health`. Never log the client secret or tokens.
- Done when: one script runs create → auto-approve → capture → verify and prints `match: true`.

## Phase 2 joins (Mon 9)
- With Eshan: Publisher's checkout tool returns a real `approvalUrl`; over-limit returns `BLOCKED_LIMIT`
- With D: Verify reports `match: true` on happy path and `state_mismatch` on the planted "paid before capture" bug

## Stretch (Wed)
Prompt-injection defence: a product description tells the agent to buy 10 units — show limits + human approval stop it.

## Rules
Branch `c/<feature>`. Sandbox only (`api-m.sandbox.paypal.com`). Don't commit from the agent — you commit.

## Starter prompt (Claude Code)
> Read AGENTS.md and docs/briefs/teammate-c-safepay.md. First write a standalone script in apps/safepay/scripts that does OAuth → create order → print approval URL → capture against PayPal Sandbox using env vars. Then build the Express service implementing Contracts 3 and 4 from @legible/contracts. Propose the plan first and wait for approval. Never log secrets. Don't commit.
