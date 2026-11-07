# Legible

Make any website safely usable by AI agents — and prove it.

1. **Scan** a site's codebase → an agent manifest of tools with risk tiers (read / write / money)
2. **Approve** tools in a dashboard (human in the loop)
3. **Publish** the approved manifest as an MCP server
4. **Safe Pay**: every money tool goes through PayPal Sandbox — human approval, spending limits, no card data to agents
5. **Crash Test**: real agents run real tasks; results are verified against PayPal and the store's DB → Agent-Readiness Report

Built for the PayPal AI Hackathon 2026.

## Repo map
| Folder | Module | Owner |
| --- | --- | --- |
| `packages/contracts` | Shared Zod schemas (the only shared code) | Eshan |
| `apps/scanner` | Codebase → manifest (LLM) + scanner accuracy eval | Eshan |
| `apps/publisher` | Manifest → MCP server, call log | Eshan |
| `apps/dashboard` | Approve tools, view reports | B |
| `apps/webmcp` | Manifest → WebMCP browser script (stretch) | B |
| `apps/safepay` | PayPal Sandbox orders, limits, Verify API | C |
| `apps/crashtest` | Agent harness, grading, report | D |
| `demo/store` | Demo shop with planted bugs | D |

## Quick start
```bash
pnpm install
cp .env.example .env   # fill in keys (Sandbox only)
pnpm validate:fixtures # all fixtures must pass contracts
pnpm dev:fixtures      # each module's fixture/mock
```

## Team workflow
- Read `AGENTS.md` (rules for every coding agent) and your brief in `docs/briefs/`.
- Branch: `<initial>/<feature>` e.g. `b/mcp-server`. Small PRs. Lead merges.
- `git pull --rebase origin main` before work and before every PR.
- Contract change = PR labelled `contract`, lead approval, everyone pulls.
