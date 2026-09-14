# Brand-side approval automation verification

User owns both brand and creator accounts, submits via project invite link, then must approve videos in BRAND project. Wants removal of manual per-video review/publish clicks. Do not ask again whether creator-side linking is intended; it is not.

Investigated official API guides, endpoint permission catalog, Postman, official help and SDK tree. Public docs confirm creator-link APPROVE, not brand review. Old /tcm/video/audit_status/update/ Postman example uses REJECT; example does NOT prove this is the only accepted operation and does NOT prove APPROVE support or new TTO compatibility. Legacy full doc could not be recovered. No speculative mutation tests performed.

Official API content-linking guide supports draft/new/existing video association and reporting; publishing-then-linking is not proven to preserve webpage anchor or bypass brand draft approval. Do not recommend replacing the user's workflow as verified.

Implementation path proposed for existing workflow (not implemented or validated): local browser worker with brand login reads pending videos from approved project and owned-creator allowlists; stable project/collaboration/video/version identity; approval state check; publish step only if offered and authorized; verify live video and ID; no retry of uncertain write; store approval/publish outcomes separately and use API for report collection. No platform moderation bypass. Login/captcha requires user interaction. This is browser automation, not official API integration; real page flow and session durability must be verified before unattended use. No automatic job was scheduled.

Sources:
https://www.postman.com/tiktok/tiktok-api-for-business/request/1ethbfv/tcm-video-audit-status-update
https://business-api.tiktok.com/portal/docs/approve-or-reject-a-tto-video-linking-request-as-a-creator/v1.3
https://business-api.tiktok.com/portal/docs/tto-creator-marketplace-content-linking/v1.3
https://business-api.tiktok.com/portal/docs/create-and-manage-a-tto-creator-marketplace-campaign/v1.3
https://ads.tiktok.com/resources/help/article/about-campaign-management-for-branded-content-with-creators-campaigns?lang=bg-BG

No source code changes or deployments in this verification turn. Previous visual redesign remains local in sibling repo.
