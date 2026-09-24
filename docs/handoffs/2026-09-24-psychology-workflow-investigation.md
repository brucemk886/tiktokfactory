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
