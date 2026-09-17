# Psychology Peer-Hit Media Tabs

## Goal

Align the peer-hit page header with its panels, split video and photo hits into separate tabs, remove narration selection, and lock video recreation to the requested ElevenLabs voice.

## Decisions

- `mediaType` is persisted as `video` or `photo`; old rows migrate to `video`, with `/photo/` links and existing photo metadata backfilled to `photo`.
- TikTok `/video/{id}` and `/photo/{id}` paths infer their type. An explicit conflicting type is rejected.
- Video recreation keeps the TikHub → Kie analysis → Z-Image → ElevenLabs path and sets voice ID `Gubgw9l4dtIoQA9YZHgx` on the server. Browser-supplied voice IDs are ignored.
- Photo recreation uses the existing `psychology-photo-story` Workflow, producing six reviewable Z-Image pages with no video download or narration.
- The header removes the shared 1320 px centering constraint on this page so it aligns with the panels.

## Files changed

- `factory-cloud/migrations/0025_psychology_peer_hit_media_type.sql`
- `factory-cloud/src/psychology-peer-hits-store.js`
- `factory-cloud/src/psychology-peer-production.js`
- `factory-cloud/src/psychology-peer-hits.test.js`
- `factory-cloud/src/psychology-peer-production.test.js`
- `public/psychology-peer-hits.html`
- `public/psychology-peer-hits.css`
- `public/psychology-peer-hits.js`
- `public/psychology-peer-production.js`
- `docs/psychology-peer-hits-api.md`
- `docs/CURRENT_STATE.md`
- `design-qa.md`

## Tests performed

- Focused peer-hit and production suite: 25 passed.
- Full `factory-cloud` suite: 328 passed.
- JavaScript syntax checks passed for both browser files and both Cloudflare modules.
- Local Chrome visual QA at 1917 × 915 measured the header and panel at the same 268 px left edge; tab switching updated the form, table, status text and DOM state.

## Unfinished work

- None for this change. The photo tab will remain empty until grokbot or an administrator imports records identified as `photo`.

## Deployment

- Commit `a5c7a54` was pushed to GitHub `main` before deployment.
- The clean release checkout matched `origin/main` exactly.
- Migration `0025_psychology_peer_hit_media_type.sql` applied successfully.
- The first Worker upload hit a transient Cloudflare `fetch failed`; the standard deploy command was rerun and completed without reapplying the migration.
- Production Worker version: `85c53b37-52ea-43c7-9d4e-60fa6e4feb17`.
- Authenticated production smoke test confirmed both tabs, 36 migrated video records, updated copy, and no narration selector.

## Recommended next step

Have grokbot send `mediaType: "photo"` with a TikTok `/photo/{id}` URL and complete source copy when the first photo-hit records are ready.
