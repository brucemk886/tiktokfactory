# Local Factory Agent Guide

## Start Here

Before working on this repository:

1. Read `docs/CURRENT_STATE.md`.
2. Read `docs/ARCHITECTURE.md` when changing module boundaries or shared services.
3. Read the latest relevant file in `docs/handoffs/` when continuing another agent's work.
4. Check `git status --short` and preserve changes you did not create.

## Working Rules

- Treat repository files and Project Hub records as the source of truth. Chat history is supporting context only.
- Keep API keys, passwords, cookies, tokens, and private customer data out of Git and handoff files.
- Do not interrupt active rendering or publishing jobs unless the user explicitly asks.
- Never call GeeLark publishing APIs from tests.
- Keep automated Project Hub agents read-only. Code changes require an explicit implementation task.
- Update or add focused tests for changes to publishing, queues, analytics, permissions, or video generation.
- Deploy factory.tiktokaitool.com only with `npm run deploy` from `factory-cloud`. Do not run `wrangler deploy` directly.
- Deploy tiktokaitool.com with `npm run cloudflare:deploy` from `tiktok-analytics-cloud`.

## Handoff

At the end of substantial work, add a handoff through Project Hub or create a Markdown file under `docs/handoffs/` containing:

- Goal
- Decisions
- Files changed
- Tests performed
- Unfinished work
- Recommended next step

Keep `docs/CURRENT_STATE.md` concise and update it only when the durable project state changes.
