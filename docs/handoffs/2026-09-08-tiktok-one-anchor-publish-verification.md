# TikTok One anchor publishing: official chain verification

Date: 2026-09-08

## Goal
Verify the user-provided anchor documentation, existing invitation link, current integration, and the official route for publishing anchored videos without manual brand approval clicks.

## Verified implementation
Sibling D:/cursor/tiktokaitool lib/tiktok-one.ts uses /v1.3/tto/tcm/campaign/ and /v1.3/tto/tcm/anchor/get/. Existing lib/tiktok-auth.ts calls /business/video/publish/ but does NOT send post_info.tto_invite_link. Existing legacy audit supports a documented REJECT example; no brand APPROVE implementation has been verified. Existing visual redesign remains uncommitted; no product changes or deployments this turn.

## New primary-source findings
- Official publish endpoint doc id1762228496095234 explicitly supports post_info.tto_invite_link. Requires is_branded_content=true, creator invited and joined. Publishing links the video to the campaign. Use creator access token and open_id as business_id. Do NOT set upload_to_draft=true: documentation says all other post_info fields are then ignored.
- POST /tto/creator/campaign/join/ uses creator_id=open_id and tto_invite_link with creator token. Doc id1836584318657537.
- CURRENT official permission table id1735713875563521 maps join/video-link/link-request-confirm to TikTok Creator > Creator Campaign > Update Creator TTO Campaign. This supersedes the older recorded Creator Order permission wording. Publish maps to TikTok Accounts > Account Post Content > Video Publish. The user's three brand-side scopes alone do not establish creator-side join permission.
- Campaign create doc id1815693549459458 expressly recommends passing tto_invite_link during /business/video/publish/. anchor_id binds the anchor to the campaign. Anchor visibility is restricted to the target country; measurement also depends on creator country matching anchor country.
- Official help how-to-create-a-tiktok-one-campaign-with-anchors says creators accept project and post in TTO flow with disclosure and project linking; anchors are added automatically. This supports a publish-with-project route but is NOT a successful API end-to-end test for this user's project.
- GET /business/publish/status/ doc id1816387106635778 returns PUBLISH_COMPLETE only after moderation/publication, with post_ids when public. API acceptance/share_id alone is not publication success.
- No documented brand approval endpoint was established. /tto/creator/link/request/confirm/ APPROVE is creator consent to link a public video, not brand approval of submitted drafts. The old audit REJECT example does not establish complete operation_type enum or new-project compatibility. Do not guess mutation requests.

## User-link read-only evidence
HTTP HEAD to the user's short link returned302 to creatorlink/share-link, whose nested URL contains campaignID=7619254006434611213. Do not persist full invitation tokens in this handoff.
Read-only genuine campaign query with existing brand token confirmed campaign name 27cup, type CAMPAIGN, campaign_channel_type STANDARD_CAMPAIGN, anchor_id7618431434382114817, country_codes US, two video_ids, and returned invite_link matches supplied short link.
GET anchor/get with this anchor_ids filter returned code0 with empty anchors and total0. A diagnostic unfiltered query with Country-Code US returned HTTP403/code40006; no meaning inferred. Therefore anchor details/APPROVED state were NOT confirmed through API this turn. Do not falsely claim anchor approval was read from API.
Credentials decrypted only in process, never logged or persisted. Ignored work/tto-anchor-readonly.mjs derived from existing read-only diagnostic script. No TikTok writes, joining, publishing, or approval performed.

## Next step
Implement a small scoped test path after the user requests implementation: select existing campaign, retrieve canonical invite_link, verify creator authorization/eligibility/join state, join once if needed, publish one user-selected video using is_branded_content=true and tto_invite_link, poll existing publishing status, verify returned video in campaign/report and actual anchor visibility in eligible region, and observe whether this existing project still requires brand review. Do not promise this approves previously pending brand drafts. If brand review persists, use actual documented brand API if discovered or separately validate browser automation; neither currently verified.

## Sources
https://business-api.tiktok.com/portal/docs?id=1826564965840066
https://business-api.tiktok.com/portal/docs?id=1815693549459458
https://business-api.tiktok.com/portal/docs?id=1762228496095234
https://business-api.tiktok.com/portal/docs?id=1836584318657537
https://business-api.tiktok.com/portal/docs?id=1735713875563521
https://business-api.tiktok.com/portal/docs?id=1816387106635778
https://ads.tiktok.com/resources/help/article/how-to-create-a-tiktok-one-campaign-with-anchors?lang=nl-NL
