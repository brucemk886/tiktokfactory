# Psychology missing publication records: recovered workflow evidence (2026-09-24)

## Goal
Read-only investigation of single-item isolated groups shown as 未返回发布结果; determine whether failures are in TikTok, hub submission, or factory preparation.

## Findings
- Inspected all 29 active items without item submission receipts in production D1. Their groups have waiting status, empty request_json/response_json, no ready payload, no stored uploaded asset or backup checkpoints. They were isolated before a hub request was frozen. There is no evidence of a TikTok publication attempt for these groups.
- Existing contemporaneous handoff docs/handoffs/2026-09-23-psychology-publish-records.md explicitly records an operator clearing factory_jobs on September 23, leaving 143 psychology items without jobs. This explains the later missing job rows; ordinary 30-day pruning is not the established cause here.
- Queried all 29 factory-peer-photo workflow histories using read-only Wrangler describe. Results: 23 errored with internal error, please try again later; 1 timed out after 120000ms; 1 original-image download HTTP 403; 1 original-image download HTTP 520; 1 Pexels search HTTP 403. Total 27 preparation failures.
- One source workflow completed (psy-auto-2d956708b9b49da09b3a5c54860117f6-005), but durable publish failure record reports 请填写内容标题或文案。, phase photo-upload-or-submit, autoRetryCount 2. Completing the source workflow does not prove final image rendering or publication completed.
- One history (psy-auto-5fcc94d9cbeafcdb95965dfa331d1455-023) could not be retrieved: Cloudflare workflow-history API returned internal_server code 10001 twice. This is a query error, not evidence of that job's execution result.
- Fifth groups in both September 22 batches were directly checked: b741...-010 and 2d956...-007 failed in the legacy story analysis path (DeepSeek then Gemini step), before rendering handoff. Their failure-save steps succeeded before job cleanup.

## Confirmed design defects
1. peer-photo-workflow.js saves production failures only in factory_jobs; unlike later upload/submission errors, these errors are not independently persisted on the automation item or durable outcome record.
2. dispatchPublishGroup isolates unfinished/failed members in groups with default waiting status and no failure reason; after job cleanup, the UI cannot recover why those groups cannot proceed.
3. The UI phrase 未返回发布结果 conflates pre-submission failure/lost records with an upstream service awaiting a result. A completed source plan is also distinct from completed rendering.

## Actions and limits
- No production writes, retries, workflow restarts, media generation, or publication calls performed. No runtime code changed in this investigation.
- Sanitized local workflow summaries are in the task host's TEMP/psychology-missing-workflows.jsonl, not Git. No tokens, source payloads, or signed asset URLs recorded.
- Next implementation: independently persist terminal generation status/error and submission phase per item, preserve these before cleanup, reflect isolated members' actual stage, and import the 28 verified historical failure outcomes with evidence while retaining the unverified item. Never automatically recreate or publish these historical tasks.

## Implemented stage-aware status (2026-09-24)
- Migration 0050 snapshots status/type/error/time on psychology items using indexed triggers for execution updates, relinks and deletes. Update trigger only writes when status/error changes. Manual retry clears stale failure state; deleted active work is still missing, never inferred as success.
- Backfills only 27 verified failed workflow IDs under no-current-job/no-receipt/no-ready guards. The title validation failure comes from its existing durable official record; the unqueryable history remains missing. No queue or publishing mutations.
- New psychology-item-status.js resolves exact durable TikTok outcome, live retry, handoff, production/submission failure, then missing evidence. API exposes displayStatus/failureReason without changing executable status/retry controls.
- Frontend distinguishes 排队中/制作中/制作失败/待发布/发布中/发布成功/发布失败/记录缺失. Mixed success batches show 部分成功; all successful show 全部成功. Per-item errors are directly visible. Group rows summarize actual member states, no longer waiting placeholders.
- Full tests: 637 passed, including job deletion durability, retry superseding stale failure, remote outcomes winning, and mixed-stage aggregation.
- Production deployed b4f62ad as 4bfa0231-bfb9-4dff-8364-df89e2047298; migration 0050 succeeded. Live verified all seven rows: five 部分成功, two 全部成功. First batch shows 10 successful / 10 production failures; second 14 successful / 14 production failures / 2 publication failures. One uncertain row remains 记录缺失. Detail/group view verified recovered production failures and directly visible reasons. No publish/retry calls made.
