# apps/publisher — MCP server for approved tools (Eshan)

Streamable HTTP MCP server on **:3002** at `POST /mcp` (stateless). Serves only `approved: true` tools from
`MANIFEST_PATH` (Contract 1), re-read whenever the file changes, so dashboard approvals apply without a restart.

| Command | What |
| --- | --- |
| `pnpm --filter @legible/publisher dev` | Real server (needs the store on `STORE_URL`, Safe Pay on `SAFEPAY_URL`) |
| `pnpm --filter @legible/publisher dev:fixture` | Same, forced to `fixtures/manifest.demo-store.json` |
| `pnpm --filter @legible/publisher smoke [-- --approve]` | Scripted agent over MCP: search → cart → coupon → checkout (→ Sandbox approve → verify) |
| `pnpm --filter @legible/publisher test` / `typecheck` | Vitest (real MCP client, fake store + Safe Pay) / tsc |

## Bindings
- `http`: `{params}` filled from input (URL-encoded); remaining input → query string (GET/DELETE) or JSON body. Store errors come back as MCP `isError` results with the HTTP status and message.
- `safepay` (money): `GET cartPath` → `StoreCart.parse` → `CreateCheckoutRequest` (amount = cart `total`, `maxAmount` from the tool's `limits`, `runId` from the header) → `POST SAFEPAY_URL/safepay/checkouts` → `Checkout.parse` → `{checkoutId, status, approvalUrl, amount, currency, message}`. Refuses if the cart currency ≠ the limit currency. `BLOCKED_LIMIT` is passed through.

## Logging (Contract 2)
Every call, approved or refused, appends one `ToolCallLog` line to `RUNS_DIR/<runId>/calls.jsonl`. `runId` = the
`x-legible-run` header (`[A-Za-z0-9_-]{1,80}`), else `adhoc`.

`GET /health` → `Health` · `GET /` → which tools agents can see right now.
