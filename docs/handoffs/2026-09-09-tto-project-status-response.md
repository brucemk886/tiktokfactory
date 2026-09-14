# TTO campaign status fields: actual API verification

2026-09-09: Retried prior failed read-only query successfully; Cloudflare authorization error7403 did not recur. No authentication settings changed.

GET /open_api/v1.3/tto/tcm/campaign/ with campaign_type CAMPAIGN returned16 projects across4 pages at page_size5. All16 project objects lack status/state/audit/active fields. campaign_type BRAND_LINK returned1 project, also without status fields. Combined count17 matches the screenshot count.

Actual CAMPAIGN field union: advertiser_ids, anchor_id, campaign_channel_type, campaign_description, campaign_id, campaign_name, campaign_type, country_codes, create_time, invite_link (absent on some), spark_ads_requested_authorization_days, video_ids. For27cup campaign7619254006434611213, channel is STANDARD_CAMPAIGN, type CAMPAIGN, anchor7618431434382114817, countryUS, create_time2026-03-20 08:38:28,2 video IDs. campaign_channel_type and campaign_type represent types, not active status.

BRAND_LINK field list: brand_name, brand_profile_id, campaign_id, campaign_name, campaign_type, country_codes, create_time, invite_link, spark_ads_requested_authorization_days, video_ids.

This is genuine current API evidence, not mock data or a documentation-only inference. Token used only in process; invitation links excluded from recorded evidence. No API writes, product changes or deployments performed. Cannot implement an accurate active-project filter from the returned fields alone. Do not assume anchors, video count or invitation presence imply active status.
