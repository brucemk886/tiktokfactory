# Goal
Select publishing accounts by psychology account group on the automatic publishing page.

# Decisions
- Use existing scoped /api/official-tiktok/publish-accounts response groups and account groupId; no new backend authorization path or group assignments.
- Group dropdown shows eligible account counts. Username/nickname search combines with the group filter. Select filtered, clear filtered and clear all are explicit actions.
- Persist selection in a Set independent of rendered rows. Switching filters retains selected accounts across groups and displays the hidden-selected count. Submit uses the full selected set in stable directory order.
- Refresh prunes unavailable accounts, retains valid selections and ignores stale responses. Media changes wait for the current account directory. View-only filters do not reset submission idempotency; actual selection changes do.

# Files changed
public/psychology-auto-publish.html, .js, .css; scripts/psychology-auto-publish-ui.test.js; docs/CURRENT_STATE.md.

# Validation
- Full factory suite: 503/503 passing. New tests cover same-name/different-ID groups, combined search, cross-group payloads, filtered clear, revocation and stale refresh responses.
- Isolated Chrome: video and photo modes, cross-group selection and mock submission, filtered deselection, 390px mobile layout, no page errors. Desktop screenshot inspected.
- No production batch or external publication was created during testing.

# Unfinished work
Production deployment and read-only verification are reported in the task response.

# Next step
Choose a group in 发布账号, select individual accounts or 全选筛选结果, then review the selected total and publishing allocation before creating a batch.
