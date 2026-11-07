# Decisions
- 2026-11-07 — TypeScript everywhere, pnpm monorepo, Zod contracts, SQLite for local state.
- 2026-11-07 — Money is a decimal string ("1499.00"), never a float.
- 2026-11-07 — Modules connect only via `@legible/contracts` + env URLs. No cross-app imports.
- 2026-11-07 — PayPal Sandbox only; Orders v2, intent CAPTURE, human approval required.
- 2026-11-07 — Agents never commit/push; humans commit, lead merges, Codex reviews Claude PRs.
- 2026-11-08 — Publisher moves to Eshan (Scanner + Publisher = one owner for manifest in/out). B: Dashboard, WebMCP, submission draft.
- 2026-11-08 — Safe Pay creates/updates the store order; capture happens on PayPal return_url; Crash Test approves via Safe Pay's test-only HTTP route. Contracts frozen at v0.2.0.
