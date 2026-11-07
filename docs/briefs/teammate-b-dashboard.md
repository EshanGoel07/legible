# Brief — Teammate B: Dashboard (+ WebMCP stretch, submission draft)

**Your job in one line:** the web app a developer actually sees — approve the tools the Scanner found, and read
the Crash Test report. It's what judges look at in the demo video, so it should be clear and good-looking.

## You own
`apps/dashboard/`, `apps/webmcp/` (stretch). Touch nothing else (see AGENTS.md).

## Contracts (read-only for you — import from `@legible/contracts`)
- **Contract 1** `Manifest` — read it, let the user toggle `approved` and edit `description`, write it back (must still pass `Manifest.parse`)
- **Contract 5** `Report` — render score + per-scenario failures
- `Health` — your `GET /api/health` returns `{ service: "dashboard", ... }`

## Stack
Next.js (App Router) + TypeScript + Tailwind · `zod` via `@legible/contracts` · `vitest` · port 3004

## Work against fixtures (you never wait on anyone)
- Manifest: `fixtures/manifest.demo-store.json` (read via `MANIFEST_PATH`)
- Report: `fixtures/report.sample.json` (later: newest `runs/<runId>/report.json` from `RUNS_DIR`)

## Phase 0 — tonight
- [ ] Next.js app boots on 3004, `/api/health` returns `Health`, reads + parses the fixture manifest

## Phase 1 — Sat night to Sun
- [ ] **Tools page:** tools grouped by risk — 🟢 read / 🟡 write / 🔴 money. Each card: name, description, input fields, source file:line, scanner `confidence` and `riskReason`. Low confidence (< 0.8) gets a "review" badge.
- [ ] Approve / reject toggle and inline description edit → "Save manifest" writes JSON that passes `Manifest.parse` (show the Zod error if not)
- [ ] Money tools show their `limits` (currency, max amount) and a note "payments go through PayPal with human approval"
- [ ] **Report page:** big Agent-Readiness Score, one row per scenario (pass/fail, agent), expandable failures with `kind`, message, evidence
- [ ] **Runs list:** all runs in `RUNS_DIR`, newest first; falls back to the sample report when empty
- Done when: both pages work fully on the fixtures, and saving a manifest round-trips through `Manifest.parse`.

## Phase 2 joins (Mon 9)
- With Eshan: load a freshly scanned manifest; approved/rejected tools change what the MCP server serves after restart
- With D: show a real `report.json` from a Crash Test run

## Wed — stretch: WebMCP output (`apps/webmcp`)
A small script: manifest in → a JS file that calls `navigator.modelContext.registerTool(...)` for each approved tool
(with a polyfill so it works today). Reads only `Manifest` — no other module depends on it, so it can be dropped safely.

## Thu — submission draft (you lead this)
- Devpost write-up draft: problem, how it works, PayPal APIs used, what's next (Eshan edits)
- Demo video: screen recording of dashboard + report; Eshan narrates the full flow

## Rules
Branch `b/<feature>`. Small PRs. Don't let the agent commit — you commit. `git pull --rebase origin main` before every PR.

## Starter prompt (Claude Code)
> Read AGENTS.md and docs/briefs/teammate-b-dashboard.md. Build apps/dashboard as a Next.js App Router + Tailwind app on port 3004 with a tools page and a report page, using `Manifest` and `Report` from @legible/contracts to parse fixtures/manifest.demo-store.json and fixtures/report.sample.json. Propose the page layout and component list first and wait for my approval. Don't commit.
