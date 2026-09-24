# Recover malformed multi-version rewrite pages

## Goal
A model returned a prose preface + fenced JSON with trailing commas inside two page arrays. Strict parsing saved the entire response as one empty pending version, so side-by-side review could not show pages.

## Decisions
- Shared model JSON reader strips only trailing commas outside strings after extracting the JSON body. It uses JSON.parse only, never eval, and preserves quoted content. Other malformed structures stay raw. Bounded to 256 KB.
- Newly repaired batch outputs become separate disabled pending versions; format recovery never auto-approves content. Single draft generation also understands trailing commas but still requires the existing manual save.
- GET copies marks recoverable pending envelope records. Opening one POSTs an owner-scoped /recover action, atomically creates deterministic child versions and tombstones the envelope. Full original response remains in the tombstoned record; each child retains its version JSON. Replays cannot duplicate or resurrect deleted children. Insert guards prevent splitting an approved/deleted envelope.
- The review dialog offers a version selector and each version's pages align by page index with the source. Approval targets only the selected child. Envelopes must be split before approval.
- No external AI call or new migration is needed for recovery. Other generation/publishing behavior is unchanged.

## Files
psychology-copy-generation.js; psychology-creative.js; library HTML/JS; AI/UI regression tests.

## Validation
Full factory suite: 704 tests passed. Focused tests passed for strings containing comma/bracket tokens, malformed/truncated JSON rejection, three versions with six pages, ownership/role isolation, atomic/idempotent recovery, preserved raw response, independent approval and UI switching.

## Next step
Run full suite; commit and push main; deploy clean main using npm run deploy; verify the reported historical envelope through UI without approving content.
