# Brief — Eshan (lead): Scanner + Publisher (MCP server), contracts, integration

**Why this is the highest-impact slot:** the Scanner is Legible's AI core — an LLM pipeline that reads an
unknown codebase and decides what an agent may do and how dangerous it is. It's the most novel part, it
feeds every other module, and with an accuracy eval it gives you a measurable resume line.

**Resume line to earn:** "Built an LLM pipeline that converts web-app codebases into MCP tool manifests with
risk classification (read/write/money); X% tool-extraction F1 and Y% risk-tier accuracy on a labelled benchmark
of N routes across 2 apps."

## You own
`packages/contracts/`, `fixtures/`, `scripts/`, root config, `apps/scanner/`, `apps/publisher/`, merging to `main`, the pitch.

You own both ends of the manifest: the Scanner writes it, the Publisher serves it. Build the Scanner first (it's the AI core and your resume metric), the Publisher second.

## Contracts
- Produces: **Contract 1** `Manifest` (`fixtures/manifest.demo-store.json` is the target shape)
- Consumes: the demo store's source code (`demo/store`, from D)

## Stack
Node 20 + TypeScript · `@anthropic-ai/sdk` (structured output via tool use) · `zod` · `ts-morph` (route discovery) · `vitest`

## Phase 0 — tonight
- [ ] Push this scaffold, protect `main` (PR required, 1 review), add teammates, fill CODEOWNERS handles
- [ ] Share PayPal Sandbox app creds privately; confirm everyone's `pnpm validate:fixtures` passes
- [ ] Freeze contracts v0.2.0

## Phase 1 — Sat night to Sun
Build the scanner as a 3-stage pipeline — this structure is what makes it impressive, not one big prompt:
1. **Discover (deterministic):** `ts-morph` finds Express/Next route handlers → list of `{method, path, file, line, handlerSource}`.
2. **Describe (LLM):** per route, Claude returns `{name, description, inputSchema, risk, riskReason, confidence}` via a forced tool call. Feed only that handler + the files it imports.
3. **Classify money risk (rules + LLM):** rule pass first (`POST` touching `order`, `payment`, `checkout`, PayPal calls → money); LLM confirms; disagreement → lower confidence + flag in dashboard. Money tools get `binding.kind = "safepay"` and default `limits`.
- [ ] Output validated with `Manifest.parse`; CLI: `pnpm --filter scanner scan ../../demo/store > manifest.json`
- [ ] **Eval (your resume metric):** hand-label ground truth for the demo store (and the 2nd demo site later), script computes tool precision/recall and risk-tier accuracy; print a table. Run it after every prompt change.
- Done when: scanning `demo/store` yields a manifest your Publisher serves unchanged, and the eval prints a score.

## Publisher (MCP server) — Sun, after the Scanner's first working output
**Contracts:** consumes C1 `Manifest`, C3 Safe Pay (`CreateCheckoutRequest` → `Checkout`); produces C2 `ToolCallLog`.
**Stack:** `@modelcontextprotocol/sdk` (Streamable HTTP) + `express`, port 3002. Read the run id from `RUN_HEADER`.

Phase 0 (tonight, 30 min — D's harness needs it): `apps/publisher/fixture` serving the 6 fixture tools with canned responses.
- [ ] Load `MANIFEST_PATH`, `Manifest.parse`, register only `approved: true` tools
- [ ] `http` binding: fill `{params}` from input, call `STORE_URL`, return JSON
- [ ] `safepay` binding: GET `cartPath` → `StoreCart.parse` → amount = `total`, currency → POST `${SAFEPAY_URL}/safepay/checkouts` with `maxAmount` from `limits` → return `approvalUrl` + status
- [ ] Append every call as one `ToolCallLog` line to `runs/<runId>/calls.jsonl`; `GET /health`
- Done when: MCP Inspector / Claude Desktop calls all 6 fixture tools, and checkout reaches C's mock.

Time saver: Publisher is mostly glue — let Claude Code write it from this brief while you review; spend your own thinking on Scanner prompts and the eval.

## Contracts v0.2.0 (added Sun 8 Nov — tell the team)
Contract 6 Store API (`StoreCart`, `StoreOrder`, order lifecycle) and `ROUTES` were added so the Store ↔ Publisher ↔
Safe Pay ↔ Crash Test hand-offs are defined. Contracts are frozen from here.

## Mon 9 — integration day (you run it)
- [ ] Join 1 (solo): Scanner → Publisher — Publisher boots from a freshly scanned manifest
- [ ] Join 2 (with C): Publisher → Safe Pay — checkout returns a real `approvalUrl`; over-limit → `BLOCKED_LIMIT`
- [ ] Join 3 (with D): Crash Test → Publisher — calls appear in `calls.jsonl` with the right `runId`
- [ ] Each join adds its `tests/contracts/*.test.ts`; merge only when `pnpm test:contracts` passes

## Tue 10 — MVP + feature freeze 22:00
- [ ] `scripts/demo.ts` + root script `pnpm demo`: start store, Safe Pay, Publisher, Dashboard → scan → run all scenarios → open report
- [ ] Happy path passes; all 3 planted bugs caught with the right `FailureKind`
- [ ] If not green by 22:00: cut scope (static report page, 2 scenarios). Never cut PayPal.

## Wed 11 — stretch
- [ ] Scanner eval on D's 2nd demo site → final resume numbers
- [ ] Rehearse the 3-minute demo twice; merge stretch branches only if they don't touch the golden path

## Thu 12 — ship
- [ ] Deploy with C (Railway/Render, Sandbox only, `SAFEPAY_TEST_MODE` off), narrate the demo video, final edit of B's Devpost draft

## Fri 13 — submit before 12:00 IST

## As lead (daily)
- 10:00 and 22:00 syncs, 10 min. Merge PRs after Codex review. Run Phase 2 joins in the order in the plan.
- Guard the contracts: say no to drive-by changes.
- Own the 3-minute demo script and Devpost write-up structure.

## Starter prompts (Claude Code)

**Scanner:**
> Read AGENTS.md and docs/briefs/eshan-lead-scanner.md. Build apps/scanner as a 3-stage pipeline (discover with ts-morph, describe with the Anthropic SDK using a forced tool call returning JSON, classify risk with rules then LLM confirmation). Output must pass `Manifest.parse` from @legible/contracts. Start by proposing the file layout and the prompt for stage 2; wait for my approval. Don't commit.

**Publisher:**
> Read AGENTS.md and the Publisher section of docs/briefs/eshan-lead-scanner.md. Build apps/publisher: an MCP server using @modelcontextprotocol/sdk with Streamable HTTP on port 3002 that registers approved tools from a manifest validated with `Manifest` from @legible/contracts, implements http and safepay bindings, and logs ToolCallLog lines. Start with the Phase 0 fixture server. Propose the file layout first and wait for approval. Don't commit.
