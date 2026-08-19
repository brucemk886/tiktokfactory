# Novel hook engine upgrade

Date: 2026-08-19

## Goal

Make the online novel rewrite openings more likely to stop scrolling without inventing unsupported plot facts.

## Decisions

- Added `智能最强钩子` as the recommended default and made it generate two outputs.
- Replaced the previous four manual directions with `铁证砸脸`, `身份炸弹`, `现场失控`, and `绝境反杀`.
- Every opening now follows a three-beat structure: confirmed fact, mistaken expectation or consequence, then a reversal-shaped information gap.
- Smart generation internally builds a fact ledger, drafts six candidates, rejects unsupported facts, and ranks the remainder by stop-scroll power, curiosity gap, emotional intensity, and spoken-English rhythm.
- Legacy style IDs remain accepted for already queued jobs, but resolve to the new canonical strategies.

## Files changed

- `scripts/novel-opening-styles.js`
- `scripts/novel-opening-styles.test.js`
- `scripts/codex-brain.js`
- `scripts/codex-brain.test.js`
- `public/novel-rewrite.html`
- `public/novel-rewrite.js`
- `public/novel-rewrite.css`

## Tests performed

- `node --test scripts/novel-opening-styles.test.js scripts/codex-brain.test.js`
- `npm test` from `factory-cloud`
- `npx wrangler deploy --dry-run --config wrangler.jsonc` from `factory-cloud`

## Unfinished work

- No code work remains. A currently running local factory worker must load the new commit before it can execute the upgraded prompt.

## Recommended next step

Generate two smart hooks from one known novel and compare their first three sentences for factual fidelity and stop-scroll strength before adjusting the score weights.
