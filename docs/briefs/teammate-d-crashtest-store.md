# Brief — Teammate D (Codex): Demo store + Crash Test harness + PR review

**Your job in one line:** build the store we test, then the robot inspector that sends real AI agents to shop
and grades what happened. You also review every Claude-written PR before Eshan merges.

## You own
`demo/store/`, `apps/crashtest/`, `fixtures/scenarios/` additions (ask Eshan first; they're contract-shaped).

## Contracts
- Demo store: its routes must match the bindings in `fixtures/manifest.demo-store.json` (that's how the scanner gets graded)
- Crash Test consumes: MCP server (Eshan's Publisher), **Contract 2** `ToolCallLog`, **Contract 4** `VerifyResult`; reads **Contract 5** `Scenario`
- Crash Test produces: **Contract 5** `Report` at `runs/<runId>/report.json`

## Stack
Store: Node 20 + TypeScript + `express` + `better-sqlite3`, simple HTML pages + PayPal JS button for the human channel ·
Harness: `@modelcontextprotocol/sdk` client + `@anthropic-ai/sdk` (and `openai` for a 2nd agent) tool-use loop · `yaml` · `zod` · `vitest`

## Phase 0 — tonight (Eshan needs this to scan)
- [ ] `demo/store` routes exactly as the fixture manifest: `GET /api/products`, `GET /api/products/:productId`, `POST /api/cart`, `POST /api/cart/:cartId/items`, `POST /api/cart/:cartId/coupon`, `GET /api/cart/:cartId`, plus `POST /api/checkout` and an order route Safe Pay reads
- [ ] Seed 8 products in SQLite (hoodies with sizes, a leather jacket over ₹5000), prices in INR
- [ ] `GET /health` returns `Health`

## Phase 1 — Sat night to Sun
- [ ] Plant 3 bugs, each behind an env flag so we can show before/after:
  1. `DIWALI20` works from the web page but `POST /api/cart/:id/coupon` returns 500
  2. cart total from the API ignores shipping, the web page includes it
  3. store marks the order `paid` when approval starts, before capture
- [ ] Harness CLI: `pnpm --filter crashtest run <scenario.yaml> --agent claude`
  - generate `runId`, connect MCP client to `PUBLISHER_URL` with header `x-legible-run`
  - give the LLM the scenario `task` + MCP tools; loop until it stops or 25 steps
  - when `checkout` returns an `approvalUrl`, call C's approval helper (test only)
  - grade: read `runs/<runId>/calls.jsonl`, call Verify, compare to `expect` → failures by `FailureKind`
  - write `report.json` (`Report.parse` before writing); score = % scenarios passed, weighted 2x for money scenarios
- [ ] 4 scenarios: happy path (`buy-hoodie-coupon`), coupon, `over-limit`, declined payment
- Done when: the harness writes a valid report against the fixture MCP server (`apps/publisher/fixture`) and C's mock.

## Code review duty (every day)
Review each Claude Code PR for: contract violations, edits outside the owner's folder, secrets, missing `parse` on payloads, untested money paths. Comment, don't fix their code.

## Stretch (Wed)
2nd demo site (tutor booking, non-commerce) to prove "any website"; run Claude vs GPT and compare scores.

## Rules
Branch `d/<feature>`. Codex must not commit or push — you do. `git pull --rebase origin main` before every PR.

## Starter prompt (Codex)
> Read AGENTS.md and docs/briefs/teammate-d-crashtest-store.md. Build demo/store as an Express + better-sqlite3 app whose routes exactly match the bindings in fixtures/manifest.demo-store.json, with seeded INR products and GET /health returning the Health schema from @legible/contracts. Propose the plan first. Do not commit or push.
