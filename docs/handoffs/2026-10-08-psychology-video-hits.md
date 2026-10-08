# Psychology video hits and GPT/Dot frame imports — 2026-10-08

## Goal
Add a dedicated Psychology 视频爆款 sidebar, source video data/copy, original frame images and up to twenty independent recreated copy/image versions, API writes and explicit composition/official publishing.

## Decisions
- New owner-scoped library, separate from existing extracted-copy records and old planning. Refer to docs/psychology-video-hits-api.md and the page's copyable GPT/Dot instructions.
- Version 0 owns original frames; 1–20 own recreation versions. 300 storyboard frames/version, 100/request, twenty-frame numbered pages. This is storyboard/frame-image input, not all encoded 30fps frames.
- Actual PNG/JPEG/WebP bytes use the same project key through a dedicated 8MB binary PUT; immutable UUID/content hash, private R2 and per-owner preview. Persistent public HTTPS links are optional.
- CAS plus transaction guards, request receipts and the unified gateway prevent stale/duplicate writes. Current administrator grants/ownership remain required. New sidebar is granted once to active admins by migration0080.
- Complete frame correspondence and script/title gate enabled versions. Frame edits disable affected versions; original-frame edits disable all versions. Task snapshots preserve previous assets/copy across later edits.
- New FFmpeg/ElevenLabs renderer uses the exact imported script and image sequence, aligns relative frame timings to measured narration and overlays escaped optional frame text. No rewriting or new image generation. Explicit render does not publish; publish creates authorized existing groups/jobs and source-version/account nonreuse, preserving schedules/AI-label/caption and official handoff.
- Existing old automatic planning remains paused; no active jobs are stopped/restarted. Capability gate excludes old workers. Dedicated auxiliary renderer only claims psychology-video-remix and retries an unacknowledged completion before accepting another job.
- UI follows existing psychology workspace, with source list/data/copy editor, twenty version slots, original/recreated frame comparison, actual uploads, batch frame JSON, composition status and preview preparation.

## Files changed
- migration0080 and new video-hits store/HTTP, binary assets, production services/tests; unified catalog/dispatch, sidebar/page/index registration, worker assets/claims and existing video library inventory.
- Public video-hits HTML/CSS/JS and generated asset manifest.
- Shared contract, exact image/script renderer and worker job/helper; integrated worker capability; focused actual FFmpeg and browser tests.
- API guide, CURRENT_STATE/ARCHITECTURE and this handoff.

## Tests performed
- Focused 13/13: source/version/frame routes through real unified dispatch, twenty independent versions, ownership/revocation, binary uploads and conflicts, CAS transaction rollback, incomplete enable rejection, snapshot preservation, source/account reuse, actual worker claim/private asset/follow-up queue.
- Actual FFmpeg two-frame composition verifies ordered image colors, audio track, subtitles, dimensions and two-second duration using synthetic images/audio only.
- Actual Chrome workflow creates source/version, uploads original/recreated images, enables and queues render; verifies desktop1440 and mobile390/320, modal bounds and image decode. No live rendering/model/publishing API is called. Screenshots under ignored tmp/video-hits-qa.
- Full npm test --prefix factory-cloud: 1,305 passed, zero failed/skipped. Existing worker capability contract assertions updated; full local root/Cloudflare dependencies used. Final sidebar grant/UI CAS refinement additionally passes focused tests. Release verification follows below.

## Unfinished work
Release verification is recorded below. GPT/Dot must have actual image bytes available to upload; generated chat-native image references are client-dependent. No real user video publication is submitted by tests.

## Recommended next step
Use the API guide with one real video, upload original/recreated frames and enable a complete version. First render/preview, then invoke the explicit publish API under user-authorized account/schedule settings.
