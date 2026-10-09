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
- Final upstream fifteen-image photo-limit integration passed 60/60 focused API/MCP/photo/asset checks.
- New picker also passed a 390px overflow check; screenshot: tmp/video-hits-mcp-qa/image-upload-mobile.png.
- Read-only production baseline: recent REST requests all done and recent image uploads active; no production content was created or modified for QA.

## Unfinished work
Implementation and deployment complete. User/client must refresh the MCP tool schema and consent to the new write scope; actual Dot host file adaptation has not been exercised in that user session. The existing grokbot REST workflow remains supported. Never delete the permanent REST interface after its batch completes.

## Recommended next step
After release, refresh the Local Factory tool schema and grant factory.video_hits.write once. Give Dot the public guide URL. Host-level file capability and OAuth consent remain user/client actions; no credentials belong in the guide.

## Release evidence
Runtime commit fd69e97f63d7260dd8785a7a0ecaaea75061e15a was pushed to GitHub main and deployed from a clean exact HEAD == origin/main checkout using npm run deploy in factory-cloud. Cloudflare version dda6f0cd-d09c-46ff-ba2f-ae8fac233af8. No migration or key change. Live guide returned 200 text/markdown and matched source SHA256 3e98d4f1bd5061579db3c7d3d491676e4cd7efe13eaf6c7cd612bec7af7958d7; live UI asset matched. OAuth metadata advertises factory.video_hits.write. Existing REST/MCP and binary-image access require authentication; other docs still redirect to login. Health passed. Production aggregate reads showed continuing material ingestion and completed recent request receipts; no production content/permission/publishing mutation was made for QA.
