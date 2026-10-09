# Video Hits administrator management across creators

## Goal
Fix the administrator missing records imported by a separate member account. User explicitly selected complete management: view, edit, enable and use in existing publication workflows.

## Diagnosis
Live read-only counts confirmed a member source, six originals, two recreations and twelve recreated images had persisted. Source list/detail and asset queries always bound the current user's owner ID, including administrators. importSource was provenance only, not a sharing mechanism.

## Decisions
- Current active administrator plus the explicit video-hits module grant can manage all creators' sources. Ordinary members remain restricted to their sources. Lists and detail expose ownerId/ownerUsername separately from importSource.
- Keep source and storage ownership unchanged; compare source revisions with its actual creator ID, not the acting admin. Mutation receipts continue to belong to the actor. Upload IDs remain immutable even for administrators.
- Central asset scopes permit module-authorized admin media access and a member's access to assets explicitly bound to that member's source. Generic unrelated video library files remain private.
- Render history, existing render reuse and prepared previews follow the authorized source/version across operators. Preview inventory selects one asset per version even when different users prepared copies.
- Admin-created render/publish jobs and batches belong to the administrator and use current admin module/account/follower/One checks. Ready-video reservations use the physical asset uploader's owner/digest identity so changing the publisher does not bypass once-only publishing.
- Worker and queued publication checks reload current authorization and validate the source. An administrator demoted to a member loses access to others' sources. Cross-owner photo/video transport uses authorized frozen material without transferring ownership.
- Cleanup summary and explicit archive/restore support administrator scope. Background cleanup rules, paused planning, existing jobs and import protocols stay intact. No data migration, reimport, owner reassignment or production publishing executed.

## Files changed
- New factory-cloud/src/psychology-video-hit-access.js and psychology-video-hit-admin.test.js.
- Existing Video Hits source/asset/video/production/publishing/photo/cleanup handlers, video library and queued authorization gate.
- public/psychology-video-hits.js displays the creator; generated UI asset manifest.
- Existing regression expectations for admin versus member scopes, test registration, canonical/generated API guide, CURRENT_STATE and ARCHITECTURE.

## Tests performed
- Full declared suite: 1,441 tests executed; 1,439 passed initially. The two failures were old MCP expectations that administrators cannot read foreign source/assets; these were updated for the user-approved policy.
- Final focused MCP, source, admin-management and manifest suite: all 59 passed, including the two corrected cases. No unresolved test failures.
- Six new administrator integration cases cover independent creators, ownership preservation, admin edits/enabling/archive/restore, member denials, bound asset reads, permission revocation/demotion, photo batches, rendering/worker asset access, normal video selection, TikTok One selection, direct version publication, idempotent replay and physical-owner digest reservations.
- Existing source/photo/video/cleanup/import regression suites were exercised. Network publishing calls use fixtures only. No GeeLark APIs or live publication called.
- Chromium UI/import regression included in the full run. git diff --check and asset-manifest check passed.

## Unfinished work
None. Deployed and read-only production verification completed.

## Recommended next step
Refresh the administrator Video Hits page and select gpt-dot in the import-source filter, or open the known source’s recreation page.

## Release evidence
Runtime commit f01f096a94bc119f95fb1d3e3a54aca8d75d4334 was pushed to GitHub main before npm run deploy with a clean worktree and HEAD == origin/main. Cloudflare version 01dae0f1-7b50-4d4f-8634-800e0269950a deployed successfully. Live UI JavaScript and API guide returned HTTP 200 and matched local SHA-256; the private list still redirected anonymous requests to login. A read-only production scope query confirmed administrator-wide visibility includes the member gpt-dot source, while the member scope remains one owned source. Verification did not create or change any production content, users, grants or publishing jobs.
