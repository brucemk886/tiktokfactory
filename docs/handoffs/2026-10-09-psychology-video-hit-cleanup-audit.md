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
Eight new regression cases failed before the fixes and passed afterward. Added further generation-race, ready upload, heartbeat/CAS, local error visibility and legacy-path tests. Final npm test passed 1349/1349, no failures or skips. UI manifest and git diff checks passed; real Chromium screenshots at 1440/390/320 were generated and the 320px cleanup status was visually checked. Existing video-transfer PID 100756 remained running unchanged. Runtime commit 0856b3f14f3e9592eb0e212f6659a9a5fd8a5cdd was pushed to main, then deployed via npm run deploy from a clean exact HEAD == origin/main release. Migration0083 applied successfully; production version 5d19e7f2-64df-434e-889a-3e2691bc459e. Live JS/CSS SHA256 matched; unauthenticated cleanup/list/private-video requests returned 401. A remote read-only aggregate referencing the new columns executed successfully with rows_written=0. No production publication or manual collection was invoked. Tests use isolated SQLite, synthetic storage/publishing, temporary filesystem directories and real Chromium/FFmpeg; no live publication is invoked.

## Unfinished work
Cloud fixes and deployment verification are complete. Existing local worker processes are not restarted. Local cleanup/path changes require the updated original renderer/worker; the dedicated helper remains unstarted. Legacy files whose original directory has moved cannot be automatically located and require restoring that directory/configuration before retry.

## Recommended next step
Observe owner cleanup status for actionable R2/local errors; use updated original worker code when the user next activates it. Do not restore old planning or start paid render/publish helpers as part of this audit.
