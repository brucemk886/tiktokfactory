# Goal
Add reusable psychology template-based delayed answer comments after confirmed video publication. Operator confirmed that each topic owns its reveal comment.

# Decisions
- New admin page /psychology-comments configures templates 01/02/03: opt-in, default 120 minutes, optional caption teaser with {hours}/{minutes}. Existing tasks stay unenrolled; changes affect future batches only.
- Topic bank revealComment is editable/importable independently of video scripts. Missing answers reject an enabled batch atomically. No AI invents answers. Freeze answer, delay and teaser in the generation transaction.
- Require comment.list.manage at batch creation and before sending, plus existing factory user/account-group permissions. Scope settings to admins; task listing/actions to creator.
- Separate minute maintenance step polls publication receipts, requires published status and video ID, then starts the delay using actual publishedAt or conservative completedAt. Forty due records/run with two processing loops; leases and hub idempotency protect overlapping ticks. Photo rendering stays at five.
- Stable hub externalId psychology-reveal:<itemId>; lost replies query before replay. Unknown results stop for review. Manual checks remain read-only across network failures. Only unsent, unclaimed tasks may be cancelled.
- Videos whose publishing failed continue waiting for publish recovery. Disabled templates do not cancel existing commitments. No automatic retrospective enrollment or actual test comments.

# Files changed
Migration 0036; psychology-comments service/UI/tests; topic bank field/import/edit/source mapping; automatic batch snapshot and caption; minute cron, sidebar/pages/session permissions; bridge error response metadata; docs and focused existing test fixtures.

# Tests performed
- Factory full suite: 496/496 passed, including 15 new scheduled-comment tests and existing topic/auto-publish tests.
- Isolated Chrome UI: template saving, default delay, expanded answer, desktop/mobile screenshots, zero page errors and 390px document width at 390px viewport. Caption input height corrected after visual inspection.
- No actual TikTok publication/comment was executed. Fixtures simulate the hub.

# Unfinished work
Deployment and safe production smoke confirmation are reported in the task response. Real first use requires the operator's own topic answers, enabled template and authorized account. Rendering scripts/voice are not rewritten; optional teaser changes the post caption only. Photo commenting and manual template publishing are not enrolled; the initial integration is topic-bank automatic video publishing.

# Recommended next step
Fill revealComment per question, enable the corresponding template at /psychology-comments and create a new topic-bank automatic video batch. Check the frozen scheduled comment row and its eventual hub receipt. Do not change the hub request ID on retry.
