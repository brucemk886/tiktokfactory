# Video Hits MCP / REST material integration — 2026-10-09

## Goal
Let GPT / Dot create video-hit sources, upload pictures, save original/recreated frames and version text, and verify results through the existing connection. Deliver one executable API document. Preserve the REST import currently being used by grokbot.

## Decisions
- Sixteen additional module-scoped MCP tools; four JSON writes and two image transports require explicit factory.video_hits.write consent. Existing read/topic tokens retain their grants. No MCP publish/render/archive or automatic-operations mutation.
- REST and MCP delegate to the same extracted executor and owner/request ledger. Existing addresses, key, input shapes, canonical hash, status/receipt rules and domain validation remain intact. No migration, key rotation, importer restart or temporary legacy endpoint to remove.
- Reuse the existing private image storage/immutable upload identity. Add owner-bound metadata GET. ChatGPT file references use a bounded shared downloader; actual bytes and a local picker cover clients without file-reference adaptation. MCP JSON bounds actual streamed input at 12MB; image validation remains 8MB.
- One Markdown guide is generated into the public assets and checked by the existing manifest build/deployment gate. Only its exact path is served anonymously; page copy and MCP guide use that same file.

## Files changed
factory API shared executor; MCP OAuth and tool registration; new factory-video-hits-mcp and video-hit-import-widget; shared file downloader; video-hit asset status and metadata; public guide routing and manifest generation; page API copy; focused tests; API/MCP/architecture/current docs.

## Tests performed
- Focused API/MCP/topic/video-hit suite: 75 passed.
- Browser + MCP suite: 23 passed, including actual >128KB PNG upload through OAuth and existing video-hit page navigation/preview flow. No live external publication.
- Initial full suite: 1366/1367 passed; existing video-detail reload timed out under default concurrency. After upstream integration the complete declared suite passed 1380/1380 with four test workers.
- New picker also passed a 390px overflow check; screenshot: tmp/video-hits-mcp-qa/image-upload-mobile.png.
- Read-only production baseline: recent REST requests all done and recent image uploads active; no production content was created or modified for QA.

## Unfinished work
Commit/push and deployment verification pending. The user's grokbot remains active; compatibility deployment is explicitly authorized. Never delete the permanent REST interface after its batch completes.

## Recommended next step
After release, refresh the Local Factory tool schema and grant factory.video_hits.write once. Give Dot the public guide URL. Host-level file capability and OAuth consent remain user/client actions; no credentials belong in the guide.
