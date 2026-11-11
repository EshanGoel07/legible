# apps/crashtest — sends a real AI agent shopping and grades what happened

```bash
pnpm --filter @legible/crashtest crash --all                 # or --scenario buy-hoodie-coupon (repeatable)
pnpm --filter @legible/crashtest test                         # no network
```
(`pnpm --filter … run --all` cannot work: `run` is pnpm's own command and it rejects `--all`.)

Needs the Publisher (`PUBLISHER_URL`), Safe Pay with `SAFEPAY_TEST_MODE=1` (`SAFEPAY_URL`), the same `MANIFEST_PATH` the
Publisher serves (for the money tool's limit), and `LLM_*` (the agent's model; the report records `LLM_MODEL`).

## Per scenario (`fixtures/scenarios/*.yaml`, Contract 5)
1. New runId `<suiteId>_<scenarioId>`; MCP client to `PUBLISHER_URL/mcp` with `x-legible-run: <runId>`.
2. LLM tool-use loop (max 25 LLM calls) over the approved tools; tool results clipped to keep free-tier token use low.
3. When the money tool returns `PENDING_APPROVAL`: **Verify (before approval)** → `POST /safepay/test/approve/:id`
   (`?outcome=decline` when the scenario expects `DECLINED`) → **Verify (after PayPal)**; the agent is told the outcome.
4. Grade from `runs/<runId>/calls.jsonl` (Contract 2) + both Verify results against `expect`:

| FailureKind | When |
| --- | --- |
| `tool_error` | a call failed with HTTP 5xx / unreachable (agent 4xx mistakes don't count) |
| `task_failed` | expected tool never called, forbidden tool called, wrong final status, agent error / step limit |
| `wrong_amount` | PayPal order above `paidAmountMax`, or wrong currency |
| `state_mismatch` | Verify `match:false` before approval or after PayPal |
| `limit_bypassed` | a payment above the manifest limit reached PayPal |

Verify runs twice because `BUG_PAID_EARLY` is only visible before capture (after capture both sides say paid).

Score = % passed, money scenarios (with `finalStatus`/`paidAmountMax`) weighted 2x. Writes `runs/<suiteId>/report.json`
(`Report.parse`d), `runs/<suiteId>/details.json`, `runs/<runId>/transcript.json`.

## Results (2026-11-12, openai/gpt-oss-120b via Groq, real PayPal Sandbox)
| Store | Score | Caught |
| --- | --- | --- |
| bugs ON (`BUG_COUPON_API=1 BUG_PAID_EARLY=1`) | 25/100 | coupon 500 → `tool_error` (+ `task_failed`: agent stopped); paid early → `state_mismatch` before approval in declined-payment + hoodie-no-coupon |
| bugs OFF | 100/100 | 2 captures, 1 decline, 1 `BLOCKED_LIMIT`, all Verify `match:true` |
