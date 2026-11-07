# Brief — Teammate C: Safe Pay + Verify (PayPal)

**Your job in one line:** every agent payment goes through you — create a PayPal Sandbox order, enforce limits,
capture only after human approval, and prove PayPal's record matches the store's.

**This is the part judges at a PayPal hackathon look at hardest. It must never be cut.**

## You own
`apps/safepay/`. You are the only person who writes PayPal code.

## Contracts
- Serves (to Eshan's Publisher): **Contract 3** `POST /safepay/checkouts`, `GET /safepay/checkouts/:id`, `POST /safepay/checkouts/:id/capture`; **Contract 4** `GET /verify/:checkoutId` → `VerifyResult`
- Calls: PayPal Orders v2 (Sandbox); the store's **Contract 6** routes — `POST /api/orders`, `POST /api/orders/:checkoutId/status`, `GET /api/orders/:checkoutId` (paths from `ROUTES.store`)
- Order lifecycle you drive: read the comment block above `StoreCart` in contracts

## Stack
Node 20 + TypeScript · `express` · PayPal REST via `fetch` (OAuth client-credentials → Orders v2) · `better-sqlite3` · `playwright` (sandbox approval helper only) · `zod` · `vitest`

## Phase 0 — tonight (most important check of the day)
- [ ] Script: get OAuth token → create order (intent CAPTURE, INR or USD) → print approval link → approve as sandbox buyer → capture → print COMPLETED
- [ ] `apps/safepay/mock`: Contracts 3 and 4 with canned responses on port 3003 (`pnpm --filter safepay dev:fixture`) so Eshan and D aren't blocked
- If INR fails in sandbox for your account, tell Eshan immediately — we switch the demo currency to USD in fixtures.

## Phase 1 — Sat night to Sun
- [ ] `CreateCheckoutRequest.parse` input; if `Number(amount) > maxAmount` → return `BLOCKED_LIMIT`, create no PayPal order
- [ ] Create PayPal order with `return_url = ${SAFEPAY_URL}/safepay/return?checkoutId=…`, store checkout row in SQLite, `POST /api/orders` to the store (status pending), return `Checkout` with `approvalUrl` (the `payer-action`/approve link)
- [ ] `GET /safepay/return`: PayPal sends the buyer here after approval → capture → `CAPTURED`/`DECLINED` → `POST /api/orders/:checkoutId/status` (paid/failed). Webhooks are a stretch.
- [ ] Verify API: fetch PayPal order + store's order row, compare status/amount/currency → `VerifyResult` with `mismatches`
- [ ] `POST /safepay/test/approve/:checkoutId` (only when `SAFEPAY_TEST_MODE=1`): Playwright approves as `PAYPAL_SANDBOX_BUYER_*`, waits for capture, returns `Checkout`. D calls this over HTTP — never import across folders.
- [ ] Decline path: use PayPal's sandbox negative testing so the declined-payment scenario works
- [ ] `GET /health` returns `Health`. Never log the client secret or tokens.
- Done when: one script runs create → auto-approve → capture → verify and prints `match: true`.

## Phase 2 joins (Mon 9)
- With Eshan: Publisher's checkout tool returns a real `approvalUrl`; over-limit returns `BLOCKED_LIMIT`
- With D: Verify reports `match: true` on happy path and `state_mismatch` on the planted "paid before capture" bug

## Tue 10 — MVP + feature freeze 22:00
- [ ] Happy path and declined path both green inside `pnpm demo`
- [ ] Contract tests: `tests/contracts/publisher-safepay.test.ts` (with Eshan), `tests/contracts/crashtest-verify.test.ts` (with D)

## Stretch (Wed)
Prompt-injection defence: a product description tells the agent to buy 10 units — show limits + human approval stop it.

## Thu 12 — ship
- [ ] Deploy Safe Pay with Eshan (Sandbox keys as host env vars, `SAFEPAY_TEST_MODE` off); confirm one real order end to end on the deployed URL

## Fri 13 — buffer only

## Rules
Branch `c/<feature>`. Sandbox only (`api-m.sandbox.paypal.com`). Don't commit from the agent — you commit.

## Starter prompt (Claude Code)
> Read AGENTS.md and docs/briefs/teammate-c-safepay.md. First write a standalone script in apps/safepay/scripts that does OAuth → create order → print approval URL → capture against PayPal Sandbox using env vars. Then build the Express service implementing Contracts 3 and 4 from @legible/contracts. Propose the plan first and wait for approval. Never log secrets. Don't commit.
