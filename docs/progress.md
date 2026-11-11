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
- 2026-11-12 Eshan — M1: demo/store on :3001 (Express + SQLite, 8 USD products, cart/coupon/orders/checkout routes, HTML pages, BUG_COUPON_API + BUG_PAID_EARLY default ON); fixture manifest source lines point at real handlers; 8 Vitest tests.
  Next: M2 run Safe Pay e2e against the real store (Sandbox), add visible-browser approval fallback only if Playwright is flaky.
- 2026-11-12 Eshan — M2: Safe Pay joined to the real store, no Safe Pay code changed. C's Sandbox e2e: ALL CHECKS PASSED (headless Playwright approval worked first try, so no fallback). Real store→Safe Pay→PayPal: happy $28.20 CAPTURED match:true; decline → DECLINED/store failed match:true; 4 jackets → BLOCKED_LIMIT, no PayPal order; BUG_PAID_EARLY → pre-approval verify match:false (status paid vs PAYER_ACTION_REQUIRED), post-capture match:true, so Crash Test must verify twice. Store now exits on EADDRINUSE (Express 5 passes listen errors to the callback).
  Next: M3 scanner (needs LLM_* in .env). Safe Pay's server.ts has the same silent-listen issue (C's folder; demo.ts will check ports/health instead).
- 2026-11-12 Eshan — apps/safepay/src/server.ts (C's folder, approved by Eshan): 2-line fix, exit 1 if listen fails (Express 5 passes EADDRINUSE to the listen callback, so a second Safe Pay used to print "listening" while the stale one served). @Aryan FYI.
  Next: nothing for C; `pnpm demo` also checks ports + /health.
- 2026-11-12 Eshan — M3 (wip): apps/scanner 3-stage pipeline (ts-morph discover, forced-tool-call describe via OpenAI-compatible LLM helper w/ backoff + JSON fallback + answer cache, rules+LLM risk), eval harness vs hand-labelled ground truth; 14 unit tests. Live scan blocked: Gemini free quota exhausted (429).
  Next: rerun scan + eval once LLM_MODEL is switched.
- 2026-11-12 Eshan — M4: apps/publisher MCP server (Streamable HTTP, stateless, :3002): approved tools only, re-reads manifest on change, http + safepay bindings, ToolCallLog per call (refusals too); 10 Vitest tests with a real MCP client. Live: MCP → store → Safe Pay → PayPal Sandbox CAPTURED 28.20 USD, verify match:true.
  Next: finish M3 scan + eval, then M5 Crash Test.
- 2026-11-12 Eshan — M3 done: scan of demo/store with openai/gpt-oss-120b (Groq; llama-3.3-70b not available on the key) → 7 tools, 11/11 forced tool calls OK. Eval x3 fresh runs, identical: tool P/R/F1 100% (LLM-only expose 77.8/100/87.5), risk acc 90.9% (rules-only 90.9%, LLM-only 100%), names 71.4% raw. Fixed: backoff floor vs tiny retry-after (Groq TPM 8000), pnpm "--" arg.
  Next: M5 Crash Test; Groq 8k TPM will throttle the agent loop, keep prompts small.
- 2026-11-12 Eshan — M5: apps/crashtest (CLI `crash --all`; `run --all` collides with pnpm's run): MCP client per scenario run, LLM tool loop via src/llm.ts, Sandbox auto-approve/decline via Safe Pay test route, Verify before + after, grading → FailureKind, weighted score, Report.parse; 15 Vitest tests. Live: bugs ON 25/100 (tool_error, state_mismatch x2), bugs OFF 100/100.
  Next: M6 dashboard (tools by risk + report page).
