# Psychology artboard queue

## Goal
Expose all four psychology templates without language suffixes. After selecting peer hits, submit into the existing execution queue and open an inspectable artboard showing script, scene prompts, image generation, voiceover, composition and output.

## Changes
- Added the missing four-image `psychology` template with the required question, answer-guide, portrait format and generation-only worker payload.
- Added `/psychology-production` and the admin sidebar entry `画板队列`. Successful submission opens the new artboard automatically. The queue shows pending/running/done/failed counts, pagination, selected-task deep links, explicit stage events, scene cards, actual image prompts, narration/provider/voice details and audio-derived media timing tracks.
- Photo production remains entirely in Cloudflare Workflows. It records script/image steps and per-page progress; no fake audio/render steps appear.
- All three local video generators now save explicit stage transitions and reviewable scene/audio/composition metadata. Collage scene timings follow measured voice segments; interactive tests expose measured caption timings. Actual image retry prompts are retained.
- Local workers sync peer-production progress every five seconds while the job is running. Sync failure does not abort rendering. The existing completion route still finalizes results.
- Production metadata is explicitly whitelisted and bounded before cloud persistence. Local file paths and arbitrary credential fields are excluded. Failed tasks preserve completed assets and mark interrupted stages as failed.
- Individual artboard lookup and counts are scoped to the authenticated owner; the photo import page can load older tasks through their specific ID rather than only the latest thirty jobs.

## Verification
- 279 Factory Cloud tests passed, including four-template payload validation/idempotency, artboard pagination/ownership, explicit timeline/failure persistence, private-field removal, and worker metadata integration checks.
- Browser fixture with in-memory SQLite verified four template choices, submit-to-queue navigation, selected artboard restoration, photo-specific steps, measured media timing tracks and a rendered desktop layout. No paid providers or publishing APIs were called.
- No changes to voice provider selection, video layout/rendering parameters or publishing authorization.

## Release notes
Cloud and local worker changes must be deployed together. Check cloud and local queues before restarting the parent server; preserve active renders and publications. Keep original checkout's untracked artifacts out of Git. Real provider output quality has not been re-evaluated in this change.
