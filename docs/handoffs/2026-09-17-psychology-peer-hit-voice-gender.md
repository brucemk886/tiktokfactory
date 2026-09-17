# Psychology peer-hit voice gender

## Goal

Store an editable voice gender on every psychology peer-hit and use a server-owned ElevenLabs default voice for male and female video recreation.

## Decisions

- `voiceGender` accepts only `male` or `female`; existing and newly omitted records default to `male`.
- Sparse grokbot updates that omit `voiceGender` preserve the saved selection.
- Male maps to `Gubgw9l4dtIoQA9YZHgx`; female maps to Lara `vChnJZ1Cu89g2XXumPfT`.
- The browser can change gender but cannot submit arbitrary voice IDs.
- Photo recreation stores the field for consistency but does not generate narration.

## Files changed

- D1 migration, peer-hit store/router, video recreation payload, page UI/assets, API documentation, focused tests, and current state.

## Tests performed

- `node --test src/psychology-peer-hits.test.js src/psychology-peer-production.test.js` — 27 passed.
- `npm test` in `factory-cloud` — 330 passed.
- `node --check` passed for both changed browser scripts; `git diff --check` passed.

## Unfinished work

- Apply migration 0026, deploy from a clean `origin/main` release checkout, and verify production.

## Recommended next step

- Have grokbot send `voiceGender` when it can identify the intended narrator; operators can correct it in the list.
