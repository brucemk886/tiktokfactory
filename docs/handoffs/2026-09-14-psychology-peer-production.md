# Psychology peer-hit production

## Goal and final direction
Select 1–5 saved psychology peer hits, choose a format, and produce original scripts, storyboards and matching images/video. The owner explicitly requires photo production entirely online, without the local factory worker.

## Implementation
- `/psychology-peer-hits` supports selection, three templates, production history, source copy, scene prompts, progress and failures.
- Video jobs reuse existing interactive-test and collage generators. Photo stories use `PeerPhotoWorkflow` (`factory-peer-photo`, binding `PEER_PHOTO_WORKFLOW`) for text generation, validation, six Z-Image submissions and durable polling. Closing the browser or switching off the local machine does not stop photo generation.
- `factory-cloud/src/entry.js` exports the existing HTTP worker and the workflow class. No new D1 migration or cron schedule is required. Existing cloud `KIE_API_KEY` is used.
- Local worker claims always exclude photo stories. No new local script or worker restart is required.
- All source copies are validated before atomic job insertion. Request IDs and deterministic workflow IDs deduplicate network retries; failed workflow dispatch can be retried. Completed jobs cannot be restarted through duplicate submission.
- Paid provider submissions disable automatic retries after ambiguous errors. Polls and D1 writes retry safely. Completed pages and failure details remain available when a later image fails.
- Photo output imports require ownership, template permission and successful completion. Captions remain separate from images, not baked into pixels. Publishing stays an explicit action in the existing photo page.

## Files
Shared prompt/payload builder: `scripts/psychology-peer-production.js`. Cloud handlers/workflow: `factory-cloud/src/psychology-peer-production.js`, `peer-photo-workflow.js`, `entry.js`, and Kie/job/photo-import adapters. UI: peer-hit HTML/CSS/JS, new production JS and photo-page integration.

## Validation
- 275 Factory Cloud tests passed. Coverage includes source mapping, permissions, retry deduplication, cloud dispatch recovery, local-worker exclusion, six paired image/caption outputs, durable polling/replay, partial output retention and unauthorized photo import rejection.
- Browser fixture used the actual UI and API handlers with in-memory SQLite: selecting two sources created two separate jobs and cleared selection.
- Wrangler generated binding types successfully; local Workers runtime started with the workflow binding. Cloud Kie secret presence confirmed without reading its value.
- No real paid generation or TikTok publication was performed. Mocked provider tests do not establish actual content quality.

## Release
User authorized production release. Follow the repository guard: commit, synchronize GitHub main, then deploy from a clean main checkout via `npm run deploy` in `factory-cloud`. Preserve original checkout's untracked `artifacts/`; never publish those exports.
