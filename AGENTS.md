# Legible — rules for every coding agent (Claude Code and Codex)

Legible turns a website into something AI agents can use safely (MCP tools with risk tiers),
routes agent payments through PayPal Sandbox, and proves it works with a Crash Test harness.

## Before you start any task
1. Read `docs/progress.md` (what others finished) and the contract you touch in `packages/contracts/src/index.ts`.
2. Read your owner's brief in `docs/briefs/`.
3. Propose a short plan and wait for the human to approve it before writing code.

## Hard rules
- Only edit files inside your owner's folders (see OWNERSHIP). Need a change elsewhere? Stop and tell the human.
- Never edit `packages/contracts/` or `fixtures/` unless the human explicitly says this task is a contract change.
- Import shared types ONLY from `@legible/contracts`. Never import from another app's folder.
- Validate every payload you produce or receive with the contract's Zod schema (`X.parse(...)`).
- Never commit, push, merge or rebase. When done, list changed files and suggest a commit message.
- Never add a dependency without asking (lockfile conflicts). Use the ones in your brief.
- Never print, log or hardcode secrets. Read them from `process.env`; new variable names go in `.env.example` (ask first).
- PayPal is Sandbox only. Never use live credentials or `api-m.paypal.com`.
- Every service exposes `GET /health` → `HealthSchema` from contracts.
- Write tests (Vitest) for anything that crosses a contract.
- When finished, append 2 lines to `docs/progress.md`: what changed, what's next.

## OWNERSHIP
| Folder | Owner |
| --- | --- |
| `packages/contracts/`, `fixtures/`, `scripts/`, root config | Eshan (lead) — humans only |
| `apps/scanner/`, `apps/publisher/` | Eshan |
| `apps/dashboard/`, `apps/webmcp/` | Teammate B |
| `apps/safepay/` | Teammate C |
| `apps/crashtest/`, `demo/store/` | Teammate D (Codex) |
| `tests/contracts/` | everyone, one file per join |

## Ports (local dev)
store 3001 · publisher 3002 · safepay 3003 · dashboard 3004 · scanner CLI (no port)
