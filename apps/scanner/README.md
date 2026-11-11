# apps/scanner — website code → agent manifest (Eshan)

Reads a site's source and writes **Contract 1** (`Manifest`): which routes an AI agent may call, how to call them,
and how risky each one is (`read` / `write` / `money`). Money tools are bound to Safe Pay with spending limits.

```bash
pnpm --filter @legible/scanner scan ../../demo/store --out runs/manifest.json [--previous fixtures/manifest.demo-store.json] [--approve-all]
pnpm --filter @legible/scanner eval [-- --no-cache]
pnpm --filter @legible/scanner test   # no network
```

## Pipeline
1. **Discover (deterministic, ts-morph).** Every `app|router.<method>(path, handler)` in `src/**`. Paths given as constants
   (`ROUTES.store.cart` declared `as const`) are resolved through the type checker. Each route carries file:line, the comment
   above it, the handler source, and the declarations the handler references (Zod schemas in full, helper signatures).
   `/health`-style infra routes are dropped here.
2. **Describe (LLM, one forced tool call per route).** `describe_route` returns `expose`, `name`, `description`, a flat
   `inputs` list (we build the JSON Schema), `risk`, `riskReason`, `confidence`; validated with Zod.
   Falls back to JSON mode + Zod with one repair retry if the provider ignores the forced tool choice.
3. **Classify (rules first, LLM confirms).** Money words in the path/handler (camelCase split) → money; GET → read; else write.
   Agreement keeps the model's confidence. Disagreement takes the more cautious tier, multiplies confidence by 0.6 and
   writes a `Review:` riskReason (the dashboard flags it). A money route is exposed only if it can be bound to Safe Pay
   (a GET cart route whose path prefixes it): agents never get a money tool that bypasses PayPal + limits.

Output passes `Manifest.parse`. Tools start `approved: false` (a human approves in the dashboard) unless `--approve-all`.
`--previous` keeps tool names stable across rescans (same binding → same name); renaming tools breaks agents.
`<out>.details.json` holds every route's decision, including the ones not exposed.

## LLM
Any OpenAI-compatible provider via `src/llm.ts` (`openai` SDK), configured only by `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`.
Retries 429/5xx/timeouts with exponential backoff (max 5, never shorter than the step even if `retry-after` is tiny).
Answers are cached by sha256(model + prompt + schema) in `runs/.scanner-cache`, so rescanning unchanged code costs 0 calls.
A scan refuses to write a partial manifest if any route failed (`--allow-partial` overrides).

## Eval (hand-labelled ground truth: `eval/ground-truth.demo-store.json`, 11 routes, 7 should be tools)
`openai/gpt-oss-120b` via Groq, 3 fresh runs (`--no-cache`), 2026-11-12. All three runs gave the same scores:

| metric | value |
|---|---|
| discovery recall (stage 1) | 100% (11/11) |
| tool precision / recall / F1, pipeline | 100% / 100% / 100% |
| tool precision / recall / F1, LLM `expose` alone | 77.8% / 100% / 87.5% (2 FP: internal order routes) |
| risk-tier accuracy, pipeline (all 11 routes) | 90.9% |
| risk-tier accuracy, pipeline (exposed tools) | 100% |
| risk-tier accuracy, rules only / LLM only | 90.9% / 100% |
| tool name exact match (raw LLM names) | 71.4% (`add_item_to_cart`, `start_checkout`) |
| mean confidence, correct / wrong | 0.92 / 0.57 |

Caveat: 11 routes on one site, labelled by us; a second site is the next step before quoting these numbers widely.
