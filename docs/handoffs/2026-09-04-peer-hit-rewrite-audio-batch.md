# Peer-hit 85×3 rewrite and audio batch

Date: 2026-09-04
Batch ID: `peer85-20260904`

## Goal

Rewrite every one of the 85 imported peer-hit transcripts into three materially different TikTok novel narrations, keep each narration at 3–5 minutes, automatically choose the default male/female Kokoro voice, save the scripts and MP3 files under the corresponding novel, and run a final quality review. Poor content/audio may regenerate no more than two times after the initial attempt.

## Decisions

- The dedicated production mode is `peer-longform-batch-v1`; ordinary short opening generation is unchanged.
- Each English script must be 780–880 words, end with the novel's exact App CTA, use a 10–26 word concrete first-sentence hook, contain at least 28 sentences, avoid excessive long/repeated sentences, and remain below the pairwise full-script/opening similarity thresholds.
- A failed structured/content audit regenerates the complete three-version set at most twice. A failed 180–300 second MP3 is regenerated with bounded speech-speed correction at most twice.
- Narrator gender is model-reviewed from first-person evidence before queueing. Batch result: 62 female and 23 male source assignments before two manual corrections; final manifest remains 62 female / 23 male. Kokoro defaults are `af_jessica` and `am_adam`.
- Two imported transcripts were Spanish non-fiction rather than novel narration. While still queued, `Mom, I Just Want You Happy` was switched to its corresponding novel source and female voice; `My Ex Changed My Door Lock` was switched to its corresponding novel source and male voice.
- Production Cloud currently records `opening-variants` results but does not run the repository's newer `autoKeepAndVoiceOpeningJob` path. To avoid deploying from a dirty worktree, the local `--sync` command performs the missing idempotent bridge: it re-audits each completed result, inserts three deterministic novel scripts, queues one deterministic three-item audio job, and marks `directSyncedDone`.
- Heartbeat automation 85 runs every ten minutes, stays quiet on unchanged state, invokes `--sync`, and performs/finalizes the full audit when all work finishes.

## Files changed

- `scripts/codex-brain.js`
- `scripts/audio-generate-job.js`
- `scripts/narrator-gender.js`
- `scripts/peer-rewrite-audio-batch.js`
- `scripts/peer-rewrite-batch.test.js`
- `docs/CURRENT_STATE.md`
- `docs/handoffs/2026-09-04-peer-hit-rewrite-audio-batch.md`

Unrelated pre-existing user changes in `public/tasks.css`, `public/tasks.html`, and `public/tasks.js` were preserved and not edited.

## Tests performed

- `node --check` on all new/changed production scripts.
- `git diff --check` on the touched production files.
- 48 focused tests across Codex opening generation, peer-source selection, batch-audio planning, Kokoro voices, audio generation, and the new batch quality suite passed.
- The new suite explicitly proves that content generation stops after initial + two regeneration attempts and that duration retuning records its attempt count.
- Production preflight confirmed exactly 85 ready peer-hit sources and an empty queue before launch.

## Production state at handoff creation

- 85 opening jobs were inserted with deterministic IDs.
- The worker runs two opening jobs concurrently.
- Four opening jobs had completed and passed the second pre-save audit.
- Twelve deterministic scripts were saved for four novels.
- Four audio jobs (12 planned MP3s) were queued; all four initial completed sources used the female default voice.
- Runtime manifest: `D:\localfactory-data\work\peer-rewrite-batches\peer85-20260904.json`.

## Unfinished work

- Remaining opening jobs and all queued audio jobs must finish.
- Every newly completed opening job must be bridged with:
  `node scripts/peer-rewrite-audio-batch.js --sync --batch-id peer85-20260904`
  The heartbeat automation already does this.
- Final acceptance requires 85 completed sources, 255 saved scripts, 255 playable MP3s in the correct platform/novel folders, correct manifest voice per source, actual duration 180–300 seconds, and no unresolved quality failures.
- If an item exhausts two quality regenerations, do not run a third; place it on the manual-review list.

## Recommended next step

Let the heartbeat continue the idempotent sync. On completion, create a JSON/Markdown audit report beside the manifest with counts, regeneration totals, rejected/manual-review rows, per-file duration/decode/loudness checks, and the final target directories. Notify the user only on meaningful failure or full completion.