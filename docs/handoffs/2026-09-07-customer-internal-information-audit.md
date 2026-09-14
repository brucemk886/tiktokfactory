# Customer internal-information audit — 2026-09-07

Goal: read-only audit of unnecessary internal details exposed to ordinary customers. Source main 220fb4a, clean. Browser session uudo verified a viewer session, authorization page, publisher, personal history and account list via DOM. Tiny viewport prevented useful visual-layout certification. Session stopped. No live publishing, deletion, API key creation or code changes.

Confirmed findings:
1. app/dashboard-client.tsx 701–717: owner email repeated on account cards, raw scopes, OAuth2/Accounts API jargon. Permission explanations should stay but use customer-readable capabilities.
2. lib/http.ts:1: generic errors return raw Error.message, consumed by page error components. Could expose SQL/runtime/provider detail on failures; no secrets exposure demonstrated. Use safe customer error mapping with internal logs.
3. app/tiktok-publisher.tsx displays task.error verbatim; lib/tiktok-publish-queue.ts:139 stores Worker-stopped technical text; authorization lastError also raw (dashboard703). Translate business outcomes and useful next actions.
4. lib/web-publish-batch.ts 11/12/23/27/61 still emits batch/subbatch/queue terms on error despite normal-page batch removal.
5. dashboard662/1510: disconnect/account deletion alerts display internal deletion UUID and tell user to retain it. Show accepted/completed business state, optional support reference only when needed.
6. web-batch-composer61/99/104/130/133: multipart, backend queue, technical group progress and task terminology. Prefer uploading/submitting X of Y, scheduled, awaiting publication.
7. dashboard1418 and lib/publish-risk.ts: raw spam_risk code in tooltip and 30-day historical errors treated as current risk badge. Show historical publication restriction with date, not unverified current account state.
8. composer118/128: missing account display name falls back to internal connection ID; use account unavailable/reselect instead.
9. dashboard1183/1186: raw account_type and technical insights-fields/scheduled refresh descriptions. Map display labels and say data temporarily unavailable. Distribution labels can fall back to raw object keys.
10. publish GET publicTask returns batchId/externalRef/publishId despite hidden UI. These identifiers are not secrets; minimize customer response fields while preserving task/account IDs required for actions and documented API integration.
11. dashboard685: missing server configuration displayed as waiting for TikTok configuration, which customer cannot fix. Use temporary service unavailability.

Already gated: admin console, Cloudflare monitoring, domain verification, sync history, user management, GeeLark and AI admin views. Login error UI maps unknown errors to a generic message. Customer API keys are intentionally shown once for user-created integrations; documented API parameters should remain in API docs, not ordinary publishing flow.

Next step: if implementing, add a shared customer-safe error presenter and separate customer-facing status/response mapping; preserve internal logs and administrator diagnostics. Audit findings only; no deployment performed.
