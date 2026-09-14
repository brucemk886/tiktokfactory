# Psychology peer-hit production — implementation draft

## Goal
Select saved psychology peer hits and create video or photo jobs from their copy, retaining source, script, scene and image-prompt correspondence.

## Decisions
- Work is isolated on `codex/psychology-peer-production`. Neither the live service nor the original Local Factory checkout has been modified.
- The peer-hit list supports up to five selections across pages and three existing/new generation modes: Chinese bilingual paper-collage video, English interactive-test video, and a six-slide English photo story.
- Video jobs reuse existing generators. Photo-story jobs use the existing Kie text service and Z-Image, saving six paired captions/prompts and image results. Photo captions are separate text, not burned into the generated images.
- Saved copy/transcript is required. Titles alone are rejected. References are marked as source material, not model instructions. Original source text is retained in the job payload.
- Batch creation validates every source before an atomic insert and uses request IDs to deduplicate network retries. Admin/template permissions and same-origin checks apply; external grokbot keys remain import-only.
- Production history retains sources, scenes, prompts, progress and failures. Photo outputs can be loaded into the existing photo publish page, and media imports verify job ownership and successful completion. Publishing remains an explicit action.

## Files
- New shared `scripts/psychology-peer-production.js`, worker `scripts/psychology-photo-story-job.js`, cloud `factory-cloud/src/psychology-peer-production.js`, UI `public/psychology-peer-production.js`, and corresponding cloud tests.
- Updated peer-hit UI/API, worker script mapping, job result preservation, image policy, photo import and photo page.

## Validation
- Complete Factory Cloud suite: 273 tests passed, including six new checks.
- Added tests covering batch source mapping/idempotency, rejection without writes, storyboard/image persistence, cross-owner/incomplete media import rejection, paired six-image generation through a mocked provider, and partial output retention on provider failure.
- Browser fixture at `http://127.0.0.1:3026/psychology-peer-hits` used actual UI and actual request handlers with in-memory SQLite. Selecting two rows created two separate jobs and cleared selection. No paid providers or publishing APIs were called.

## Remaining release work
- Final complete test suite and whitespace checks passed. Implementation is still isolated and has not been merged or deployed.
- No actual provider generation or image/video quality verification has been performed. The new photo worker should receive a bounded test job after release approval; do not claim real output quality from mocked API tests.
- Deploy cloud and update workers together: older workers cannot execute `psychology-photo-story`. Preserve active rendering/publishing jobs and do not restart them mid-job.
- Original checkout has untracked `artifacts/` belonging to other work; preserve it and never commit those exports to GitHub.
