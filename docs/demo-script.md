# Demo video script, 2:45

Problem → scan → approve → agent buys via PayPal → bug caught → fix flag → green report.
About 315 words of narration (~2:10 at 145 wpm), leaving ~35 s for on-screen pauses. Record each segment separately and cut out the waiting.

## Before recording
- `.env` filled; `nvm use` (Node 22); Chromium installed (`pnpm --filter @legible/safepay exec playwright install chromium`).
- Run `pnpm demo --exit` and `pnpm demo --bugs off --exit` once each, so the scanner cache is warm and you know the timings.
- Recording order: **take 1** `pnpm demo --manual` (bugs ON, you approve in the dashboard), **take 2** `pnpm demo --bugs off --exit`
  in a second terminal after take 1 is stopped (Ctrl+C). The dashboard pairs the two runs for the before/after panel.
- Terminal font ≥ 16pt, dark theme, window ~110 columns. Browser at 1920×1080, 100% zoom, sandbox buyer logged out.
- Tabs ready: `http://localhost:3001` (store), `http://localhost:3004/tools` and `/report` (dashboard).

---

### 0:00–0:20 · Problem
**Screen:** the demo store homepage (`localhost:3001`), then a slow scroll.
**Say:** "AI agents are starting to shop for us. But websites are built for humans. An agent scraping HTML breaks,
and an agent holding a payment API is a liability. Legible makes a website safe for agents, and proves it, with PayPal."

### 0:20–0:45 · Scan
**Screen:** terminal: `pnpm demo --manual`. Pause on the scanner table (tool · risk · confidence · binding) and the two warnings.
**Say:** "Legible reads the store's code. ts-morph finds every route, an LLM describes each one with a forced tool call,
and deterministic rules check the risk: read, write or money. It found seven agent tools. Notice the two warnings:
the model wanted to expose the internal order routes, and the rules refused, because a money action that can't go
through PayPal never becomes a tool. On our labelled set: 100% tool F1."

### 0:45–1:00 · Approve
**Screen:** the terminal says *Your turn*. Dashboard `/tools`: header pill **MCP server · serving 0 tools**. Hover the red
`checkout` card ($100.00 limit, "How an agent payment works" beside it), toggle the cards on, click **Save manifest**:
the bar says *MCP server now serves 7 tools* and the header pill updates. Scroll to "Kept away from agents". Back to the
terminal, press Enter.
**Say:** "A human approves what agents get. The checkout tool is red: it can only create a PayPal order, capped at
a hundred dollars, and a person approves every payment."

### 1:00–1:40 · An agent buys through PayPal
**Screen:** split: Crash Test lines for `hoodie-no-coupon` (search → cart → add → checkout → "approving 34.00 USD") |
browser: store `/cart` → **Pay with PayPal** → sandbox login → **Complete purchase** → Safe Pay "Payment complete".
Then `curl localhost:3003/verify/<checkoutId>` showing `"match": true`, PayPal `COMPLETED`, store `paid`.
**Say:** "Now a real AI agent shops through our MCP server. When it checks out, Safe Pay creates a PayPal Sandbox order
with Orders v2. No card data ever reaches the agent. The buyer approves in PayPal, Safe Pay captures on the return URL,
and our Verify API compares PayPal's record with the store's database. They match."

### 1:40–2:10 · Bugs caught
**Screen:** the terminal summary **25/100**, then click the printed dashboard link → `/report`: the red **25** ring and four
rows. Expand `buy-hoodie-coupon` (Tool error: HTTP 500), then `declined-payment`: the Store-vs-PayPal table with
`status  paid  PAYER_ACTION_REQUIRED` in red. Point at `over-limit` ✓ *Blocked by limit · $321.00*.
**Say:** "Crash Test ran four scenarios and scored this store 25 out of 100. The coupon works on the website but
crashes through the API, so the agent stopped instead of overpaying. Worse: the store marked orders paid before
PayPal captured a cent. Only checking PayPal before approval catches that. And four leather jackets, three hundred
dollars, were blocked before PayPal was even called."

### 2:10–2:35 · Fix → green
**Screen:** `pnpm demo --bugs off --exit`, cut to the summary **100/100**, then the dashboard `/report`: the before/after
panel reads **Store bugs ON 25 → Store bugs OFF 100** with ✗ → ✓ per scenario.
**Say:** "We fix both bugs, flip the flags, and run the same agent again. Two captures, one decline handled cleanly,
one payment blocked by the limit. A hundred out of a hundred. That score is what makes a site agent-ready."

### 2:35–2:45 · Close
**Screen:** README architecture diagram.
**Say:** "Legible: scan, approve, publish, pay safely with PayPal, and crash-test it. Make any web app agent-ready, starting with Express and TypeScript."

---

## If something goes wrong while recording
- Port in use → `kill $(lsof -t -iTCP:3001 -sTCP:LISTEN)` (the demo prints the exact command).
- Dashboard slow on first load → it compiles each page once in dev mode; open `/tools` and `/report` once before recording.
- LLM 429s slow a run → wait a minute (Groq free tier: 8k tokens/min); the backoff retries on its own.
- Sandbox login page changed → record the human flow by hand; Crash Test screenshots failures to `apps/safepay/test-results/`.
