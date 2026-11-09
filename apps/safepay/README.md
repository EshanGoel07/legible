# apps/safepay — Safe Pay + Verify (Teammate C)
Brief: `docs/briefs/teammate-c-safepay.md`. PayPal **Sandbox only** (`api-m.sandbox.paypal.com`; the client refuses any other host).
**Currency: USD.** INR is rejected by PayPal Sandbox (`CURRENCY_NOT_SUPPORTED`).

## Commands (from the repo root)
| Command | What |
| --- | --- |
| `pnpm --filter @legible/safepay dev` | **Real service** on :3003 (PayPal Sandbox + SQLite + store at `STORE_URL`) |
| `pnpm --filter @legible/safepay dev:fixture` | **Mock** on :3003, canned responses, no PayPal/store calls |
| `pnpm --filter @legible/safepay dev:store-stub [-- --plant-bug]` | Throwaway Contract 6 order routes on :3001, only if D's store isn't running |
| `pnpm --filter @legible/safepay e2e [-- --headed] [--skip-decline]` | Real Sandbox end-to-end: limit block, create, auto-approve, capture, `match: true`, decline, planted bug |
| `pnpm --filter @legible/safepay sandbox:smoke -- --currency USD --amount 20.00` | Phase 0 manual smoke: approve in your browser, prints `COMPLETED` |
| `pnpm --filter @legible/safepay test` / `typecheck` | Vitest (no network) / tsc |

Env (root `.env`): `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_API_BASE`, `PAYPAL_SANDBOX_BUYER_EMAIL/PASSWORD` (test approve only), `SAFEPAY_URL`, `STORE_URL`, `SAFEPAY_TEST_MODE`.
One-time for test approval: `cd apps/safepay && npx playwright install chromium`.

## Routes (real service)
| Route | Behaviour |
| --- | --- |
| `GET /health` | `Health` |
| `POST /safepay/checkouts` | `CreateCheckoutRequest`. `Number(amount) > maxAmount` → `BLOCKED_LIMIT`, **no PayPal order, no store order**. Otherwise creates a PayPal order (intent CAPTURE, `return_url = SAFEPAY_URL/safepay/return?checkoutId=…`), stores the row in SQLite, `POST /api/orders` to the store (pending) → `Checkout` with `approvalUrl` (201) |
| `GET /safepay/checkouts/:id` | `Checkout` |
| `POST /safepay/checkouts/:id/capture` | `CaptureResponse`. Captures **at most once** (shared in-flight capture + `PayPal-Request-Id`). 409 `not_approved` before the buyer approves, 409 `blocked_limit` if blocked |
| `GET /safepay/return?checkoutId=` | PayPal redirects the buyer here: capture → store `paid`/`failed` → small HTML page. `&cancelled=1` leaves it pending |
| `POST /safepay/test/approve/:checkoutId[?outcome=decline]` | **Only when `SAFEPAY_TEST_MODE=1`** (else 404). Playwright logs in as the sandbox buyer, approves, waits for capture → `Checkout`. `outcome=decline` uses PayPal sandbox negative testing (`INSTRUMENT_DECLINED`) → `DECLINED`, store `failed` |
| `GET /verify/:checkoutId` | `VerifyResult`: reads the PayPal order + store `GET /api/orders/:checkoutId`. Store may say `paid` only if PayPal has a `COMPLETED` capture; amount and currency must match |

Errors: `{ error, message, details? }` with 400 / 404 / 409 / 502. Secrets and tokens are never logged.

## Layout
`src/` paypal client · db (SQLite) · store-client · service (logic) · approve (Playwright) · app (routes) · server · config
`mock/` Phase 0 mock · `dev/` store stub · `scripts/` smoke + e2e · `test/` Vitest
