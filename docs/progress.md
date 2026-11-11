# Progress log
Append 2 lines per finished task: `YYYY-MM-DD <owner> — what changed. Next: …`

- 2026-11-07 Eshan — repo scaffold, contracts v0.1.0, fixtures, briefs. Next: each owner builds Phase 0 fixture.
- 2026-11-08 Eshan — ownership change: Publisher (MCP server) moved to Eshan; B owns Dashboard + WebMCP stretch + Devpost/demo draft.
- 2026-11-08 Eshan — contracts v0.2.0: Contract 6 Store API, ROUTES, Safe Pay return/test-approve; AGENTS.md setup + package conventions; Mon–Fri tasks in every brief.
- 2026-11-09 C — apps/safepay Phase 0: PayPal Sandbox smoke script (`sandbox:smoke`, OAuth→create→approve→capture), Contract 3+4 mock on :3003 (`dev:fixture`), Vitest for both. Sandbox result: USD create→approve→capture COMPLETED (order 5X961193EC320870D, capture 20K51503GN7005034); INR rejected at create on two apps (422 CURRENCY_NOT_SUPPORTED) — demo must switch to USD.
  Next: Eshan switches fixtures to USD; Phase 1 real service (limits, SQLite, store order, return_url capture, Verify).
- 2026-11-09 C — apps/safepay Phase 1: real service (limits → BLOCKED_LIMIT, PayPal order + SQLite + store order, return_url capture-once, Verify, test-only Playwright approve, sandbox decline). `e2e` against real Sandbox: all checks pass, match: true; planted bug → status mismatch. 23 Vitest tests.
  Next: joins with Eshan (Publisher → checkouts) and D (real store + verify); contract tests publisher-safepay / crashtest-verify; fixtures to USD (Eshan).
- 2026-11-12 Eshan — M0: fixtures switched to USD (hoodie $29, jacket $79, ship $5, money limit USD 100, paidAmountMax 30); added hoodie-no-coupon + declined-payment scenarios; .nvmrc 22, engines <23; .env.example uses LLM_BASE_URL/LLM_API_KEY/LLM_MODEL (OpenAI-compatible).
  Next: M1 demo/store (Express + SQLite, USD seed, BUG_COUPON_API / BUG_PAID_EARLY flags).
