# Novel content hierarchy

Date: 2026-08-10

## Goal

Promote novels to the primary content entity. Keep the old script/audio library as a child view and compare every generated script against the videos that used its paired audio.

## Implemented

- Added `scripts/novel-content-library.js`, persisted at `<workDir>/novel-content-library.json`.
- Data hierarchy: novel source -> script/opening variant -> audio -> matched local publish/TikTok video metrics.
- Marketing generation imports the submitted source and selected scripts automatically.
- AI operation input now contains the canonical novel/script hierarchy and enriched script mapping identifiers.
- Added `/novel-content` UI with novel, script/audio, and unassigned-script tabs.
- Existing `/audio-library` links redirect to the script/audio tab without changing the existing sidebar permission ID.
- Existing audio records are non-destructively discovered and appear under `待归类` until assigned.

## Files

- `scripts/novel-content-library.js`
- `scripts/novel-content-library.test.js`
- `scripts/server.js`
- `scripts/operation-brain.js`
- `scripts/codex-brain.js`
- `scripts/content-diagnosis-rules.js`
- `scripts/sidebar-modules.js`
- `public/novel-content.html`
- `public/novel-content.css`
- `public/novel-content.js`
- `public/novel-library.js`

## Verification

- Syntax checks passed for the new UI/service and changed server/AI files.
- 36 focused tests passed across novel content, audio, deterministic diagnosis, operation brain, Codex strategy, local auth, and sidebar catalog.

## Follow-up

- Restart Local Factory to load the new routes and sidebar label.
- Assign legacy entries from `待归类` to their correct novel once; new marketing generations are linked automatically.
- For exact sentence-level attribution, persist generated narration timestamps from the audio/video render pipeline instead of relying on the current estimated sentence timing.
