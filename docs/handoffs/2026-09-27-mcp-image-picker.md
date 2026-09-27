# ChatGPT image picker import

## Goal
Resolve the reported conflicting file schemas (client expects a string, server receives a string instead of the canonical object), without paid API generation or weakening URL/file validation.

## Decisions
- Prefer psychology_prepare_topic_image_import with topic draft only. Register an MCP Apps resource with a user-visible file selection/confirmation flow.
- Optional official selectFiles / uploadFile / getFileDownloadUrl produce authorized file ID and temporary URL. App-only psychology_save_selected_topic_image deliberately omits fileParams, preserving the strict object schema without the adapter. Direct importer remains for compatible hosts.
- UI uses standard postMessage initialization/tool calls and a legacy callTool fallback. No external browser connections or credentials. Draft text uses textContent; temporary URLs never enter widget state.
- Existing OAuth scope, active admin checks, PNG validation, narrow file-host validation and durable idempotency remain. Prepare writes nothing. Save never invokes generation API. Only completed + real topic ID displays success; selection locks after submission and result lookup/retry retains request ID.
- ChatGPT library availability and presence of native generated images remain host-dependent. Fallback is saving the image locally and selecting it in the card. Do not promise fully automatic handoff.

## Files
factory-cloud/src/topic-import-widget.js; factory-mcp-tools.js; topic-file-import.js; factory-mcp.test.js; docs/FACTORY_MCP.md; docs/CURRENT_STATE.md.

## Tests
26 focused tests passed; full factory suite 873 passed, zero failed/skipped. Actual Chrome tests cover library selection, local upload, escaped topic text, actual OAuth/MCP fixture saving, app-only authorization, standard iframe bridge, lost response after committed import then status lookup, and upload failure without a Factory write. Host file helpers are mocked, R2/downloads use fixture bytes, no publishing or generation API calls. A local fixture screenshot was visually reviewed.

## Deployment / remaining work
Pending commit, push main and deployment. Final live ChatGPT host verification is user-side: refresh tools, open the prepare card, select a real PNG, confirm and verify completed/topic ID.
