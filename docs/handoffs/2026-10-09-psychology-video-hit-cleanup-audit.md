# Psychology video-hit cleanup audit — 2026-10-09

## Goal
Audit and fix the implemented recreation cleanup mechanism without interrupting rendering/publishing or activating background workers.

## Findings and decisions
- Reproduced starvation: a full batch of permanently failing R2 deletions continually blocked eligible files. Rotate by last attempt, retaining exact keys and retries.
- Reproduced local false success on missing storage roots and changed output configuration. Freeze actual canonical output paths in durable manifests (0083); require an accessible directory. Legacy outputs must be located and registered by the original worker before unlink; unknown missing paths cannot be acknowledged.
- Reproduced stuck running cleanup after worker termination and lost completion. Requeue only cleanup jobs after 15 minutes without progress using conditional writes; reconcile already acknowledged cleanup. Active render/publish jobs remain untouched.
- Reproduced stale generated inventory for old revisions and direct compose/publish. Filter by frozen source/version identity, keeping drafts visible.
- Reproduced image uploads writing after losing their GC claim and late uploads leaking after compensation failure. Check the pre-upload claim and persist compensation with cleanup generation fences for images and ready videos. Older acknowledgments cannot close a newer retry.
- Clarify logical content cleanup versus physical R2/local deletion; expose local failure messages in owner-scoped status. Original/reference protections and once-per-version/digest publication reservations remain intact.

## Files changed
Migration0083; video-hit cleanup collector/worker API and tests; image/ready upload handlers; generated video inventory; local cleanup/renderer and tests; video-hit status UI/browser test/asset manifest; API guide and state/architecture documents.

## Tests performed
Eight new regression cases failed before the fixes and passed afterward. Added further generation-race, ready upload, heartbeat/CAS, local error visibility and legacy-path tests. Final npm test passed 1349/1349, no failures or skips. UI manifest and git diff checks passed; real Chromium screenshots at 1440/390/320 were generated and the 320px cleanup status was visually checked. Existing video-transfer PID 100756 remained running unchanged. Deployment results follow after release verification. Tests use isolated SQLite, synthetic storage/publishing, temporary filesystem directories and real Chromium/FFmpeg; no live publication is invoked.

## Unfinished work
Deployment verification pending at time of this pre-release entry. Existing local worker processes are not restarted. Local cleanup/path changes require the updated original renderer/worker; the dedicated helper remains unstarted. Legacy files whose original directory has moved cannot be automatically located and require restoring that directory/configuration before retry.

## Recommended next step
Ship the verified commit through main and the repository deployment guard; check live assets and migration read-only. Observe owner cleanup status for actionable R2/local errors. Do not restore old planning or start paid render/publish helpers as part of this audit.
