# Novel AI Script and Audio Optimization Loop

## Goal

Connect owner-authorized TikTok account/video analytics to the novel operations brain so it can diagnose opening-copy and retention problems, rewrite real local novel scripts, generate replacement ElevenLabs audio, and preserve paired script/audio assets locally.

## Decisions

- Official private analysis now requests a 30-day window and up to 100 videos per selected account.
- DeepSeek remains responsible for bounded full-dataset analysis, including every available second-by-second curve point; SOL receives the evidence report and makes the final decision.
- Rewrites are limited to real `sourceAudioId` entries in the local library. The model cannot invent a source asset.
- Each optimization carries evidence, opening diagnosis, a complete rewritten narration, source video ID, generated audio record, and destination path.
- ElevenLabs generation is sequential, fingerprinted for idempotent reuse, and non-blocking at plan level: one failed audio is surfaced without losing the rest of the plan.
- The existing operator `audioDir` is the requested destination folder. A canonical copy also remains in the managed local library.

## Files Changed

- `scripts/private-tiktok-signals.js`
- `scripts/deepseek-brain.js`
- `scripts/codex-brain.js`
- `scripts/operation-brain.js`
- `scripts/audio-library.js`
- `scripts/server.js`
- `public/operator.html`, `public/operator.js`, `public/operator.css`
- `public/audio-library.html`, `public/audio-library.js`, `public/audio-library.css`
- `public/access.js`, `public/accounts.js`, `scripts/local-auth.js`, `scripts/local-auth.test.js`
- focused tests for the operation brain and audio library

## Tests Performed

- `node --check` on changed JavaScript entry points.
- `node --test scripts/audio-library.test.js scripts/operation-brain.test.js scripts/official-tiktok-analytics.test.js scripts/deepseek-brain.test.js scripts/codex-brain.test.js`
- Result: 30 tests passed.

## Unfinished Work

- Existing library audio can recover its script only when its original `novel-marketing` JSON still exists. Truly orphaned legacy MP3 files remain audio-only.
- TikTok metrics can only be analyzed when the official API returned them; unavailable audience or curve fields are not fabricated.

## Recommended Next Step

Generate one review plan from `/operator` using an audio directory that contains at least one library-paired novel script. Confirm the rewritten narration and MP3 before enabling automatic task creation.
