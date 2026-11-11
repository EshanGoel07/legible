# apps/dashboard: approve tools, read the report

Next.js 16 (App Router) + Tailwind 4 on **:3004**. Started by `pnpm demo`; on its own:

| Command | What |
| --- | --- |
| `pnpm --filter @legible/dashboard dev` | Dev server on :3004 (reads `MANIFEST_PATH`, `RUNS_DIR`; default `runs/manifest.json`, `runs/`) |
| `pnpm --filter @legible/dashboard dev:fixture` | Fixture manifest + sample report only (read-only) |
| `pnpm --filter @legible/dashboard test` / `typecheck` | Vitest (data layer + route handlers) / tsc |

## Pages
- **Tools** (`/tools`): the manifest's tools grouped Money / Write / Read (red / amber / green). Each card shows the
  description, what it calls (HTTP route, or PayPal via Safe Pay for money), inputs, source `file:line`, scanner
  confidence (amber **Review** badge below 0.8 or when rules and model disagreed) and `riskReason`. Money tools show
  their Safe Pay limit. Approve toggles + **Save manifest** → `PUT /api/manifest` → `Manifest.parse` → atomic write
  (tmp + rename). The Publisher re-reads the file on its next request, so the header pill ("MCP server · serving N
  tools") changes without a restart. "Kept away from agents" lists the routes the scanner refused to expose.
- **Report** (`/report[?run=<id>]`): big Agent-Readiness Score, before/after panel (newest bugs-ON run vs newest
  bugs-OFF run, tagged by `pnpm demo` in `runs/<id>/demo.json`; otherwise the two newest runs), one row per scenario
  with the PayPal outcome; expand for each failure's kind, message, a Store-vs-PayPal table for Verify evidence and the
  raw evidence JSON.

## States
No scanned manifest → fixture manifest, read-only banner. `MANIFEST_PATH` inside `fixtures/` → read-only (saves are
refused with 403). No runs → sample report with a banner. Broken files → error cards that say which file and why
(an unreadable report is skipped and listed, the rest still load). Loading skeletons on both pages.

## API
`GET /health` → `Health` · `GET /api/manifest` · `PUT /api/manifest` (body: `Manifest`; 400 with the Zod issues,
403 fixtures, 409 no scan / other site) · `GET /api/report[?run=]` → `{ report: Report, runs, … }`.
