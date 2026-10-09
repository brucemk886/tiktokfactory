# Video Hits import-source labels and client tool discovery — 2026-10-09

## Goal
Add an import-source column and API field for grokbot, gpt-dot and future agents. Preserve the active Grokbot imports. Diagnose Dot reporting no new Video Hits MCP tools.

## Decisions
- Source-level `importSource` is caller-declared provenance, not identity/permission. Trim/lowercase; 1–64 ASCII letters/digits/dot/underscore/hyphen, starting with a letter/digit. New agents explicitly send their stable slug.
- User confirmed all existing data comes from grokbot. Additive migration 0084 adds NOT NULL DEFAULT grokbot; old insert shapes remain valid. Backfill does not alter revision, timestamps or old request digests/receipts. Omitted create defaults to grokbot for the ongoing legacy importer; omitted update preserves the value. New manual UI entries use manual.
- List filtering runs before pagination and combines with owner, scope, search and content type. UI shows a separate column, filter, summary and editor; custom names need no release. Filter survives navigation and refresh.
- REST/MCP share the existing executor and validation. No key rotation, importer restart, render/publish mutation, or removal of legacy REST endpoints.
- MCP version 1.5.1. Current agent session still advertises the old 22 model-visible Local Factory tools, none named videoHits. Public production guide and OAuth metadata expose the new write capability; read-only D1 confirmed the active administrator has the Video Hits module. This identifies missing client tool discovery, not a rejected write/API key. The user's Dot session has not made a verified write.
- Direct custom MCP connections must refresh tool metadata and start a new conversation; if needed reconnect the same endpoint. Client must consent to factory.video_hits.write when challenged. Server cannot force existing conversation tool metadata to reload. Official reference: https://developers.openai.com/plugins/deploy/connect-chatgpt . No callable tool is available here to refresh that client's private connection.

## Files changed
Migration 0084; shared source contract; source handler and factory catalog; MCP schemas/version; source HTML/JS/CSS; canonical API guide and generated public copy; asset manifest; focused API/MCP/browser tests; CURRENT_STATE and FACTORY_MCP.

## Tests performed
- Focused source/API/MCP/browser suite: 46 passed, including old migration/receipt compatibility, validation/CAS, owner/type/pagination filtering, actual OAuth writes and custom agent names.
- Browser QA: source creation/edit/filter and preserved navigation, screenshots checked at 1440px and 390px; overflow checks also cover 320px. Fixture-only tests; no live publishing.
- Complete declared factory suite passed 1385/1385 with four workers (55.5 seconds). No live publishing APIs called. Production verification is recorded below.
- Production baseline aggregate reads: 58 sources, revision sum 116, 364 domain receipts. One active admin, with Video Hits module enabled. No customer content or credentials recorded.

## Unfinished work
User/client must refresh the connection and open a new conversation; actual Dot host upload and one-item import remain unverified in that session. A missing model tool is not an API call failure.

## Recommended next step
Give Dot the public guide and have it confirm psychology_videoHits_guide and psychology_videoHits_create are actually available. Import one real image-text item with importSource gpt-dot, then read it back. Keep the REST Grokbot integration supported.


## Release evidence
Runtime commit 17f27dc95057fd079ed9ae593fb9f85e10470d2f was pushed to GitHub main and deployed using factory-cloud npm run deploy from a clean exact HEAD == origin/main checkout. Migration 0084 applied successfully. Cloudflare version e287b546-e8a7-4e2c-ad6c-a1b5c855f797.

Live guide and JS returned 200 and matched local SHA256. Guide: d3b6222de6000b115a35595166517ec84fc983c6ff674c85823565b686ed7ff6; JS: f48e41da0834cbdaa2251b98bcd9a280a560022fbc3a430477581e173bffed7c. Health returned 200; OAuth metadata still advertises factory.video_hits.write; unauthenticated MCP and private image access returned 401.

Post-release aggregate read found 59 source records, all import_source grokbot, revision sum 118 and 368 domain receipts (baseline 58/116/364). Existing ingestion continued during this task. No production test content or publishing job was created, no key changed and no running importer was interrupted. Actual tools/list and write testing used the local OAuth protocol fixture, not the user's live Dot OAuth session; that client still requires refresh/new-conversation verification.
