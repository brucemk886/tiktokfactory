# TikTok One regional API investigation

User clarified US / Europe / Other are views of the same project and requested API verification before more UI work. No code or deployment changes in this investigation.

Verified official references:
- https://ads.tiktok.com/resources/help/article/how-to-access-creator-information-on-tiktok-one: creator information separated by region; switch top navigation without new accounts/login.
- https://business-api.tiktok.com/portal/docs/get-tto-creator-marketplace-campaigns/v1.3: no three-way regional request parameter documented; country_codes represents creator locations.
- https://business-api.tiktok.com/portal/docs/report-on-tto-creator-marketplace-videos/v1.3: Country-Code header selected from campaign country_codes.

Read-only live diagnostics using existing encrypted connection in memory (no tokens printed or saved):
- Report-empty project: campaign returns country_codes [US], one associated video; report returns zero for US, GB and SG.
- Positive-control project previously shown with two videos: country_codes [US], two associated videos; US report returns two, GB and SG return zero.
GB/SG are diagnostic country codes only, not proven Europe/Other aggregate selectors. No writes to TikTok. No automatic assertion that these regions lack data or require reauthorization.
Browser-skill status/doctor and daemon startup unavailable, preventing logged-in official web comparison. Remaining: inspect the same project's Europe/Other webpage network response or ask TikTok support why cross-region creator data isn't represented in country_codes. Do not claim menu fixes prove three-region API support. Do not invent EU/ROW header values.
