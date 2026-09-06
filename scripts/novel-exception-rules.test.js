import assert from "node:assert/strict";
import test from "node:test";
import {
  applyProjectionEvent,
  applyWorkflowAction,
  classifyOfficialNovelEvent,
  classifyPublishRecord,
  exceptionFingerprint,
  trustedFactoryTaskUrl,
  trustedHubReviewUrl,
} from "./novel-exception-rules.js";

test("does not guess auth failure from Chinese message text", () => {
  const event = classifyOfficialNovelEvent({
    sourceStatus: "failed",
    message: "账号好像授权有问题",
    localTaskId: "t1",
    entityType: "task",
    entityId: "t1",
  });
  assert.equal(event.kind, "production_failed");
});

test("needs_review uses remote status even when local status is failed", () => {
  const event = classifyPublishRecord({
    id: "r1",
    status: "failed",
    officialRemoteStatus: "needs_review",
    taskId: "t1",
  });
  assert.equal(event.kind, "publish_needs_review");
});

test("future schedule is not a sync failure", () => {
  const now = Date.now();
  const event = classifyPublishRecord({
    id: "r2",
    status: "submitted",
    scheduleAt: now + 86_400_000,
  }, now);
  assert.equal(event.skipCreate, true);
});

test("same event id does not bump occurrence; new attempt reopens", () => {
  const first = applyProjectionEvent(null, {
    kind: "production_failed",
    fingerprint: "production_failed|task|t1",
    entityType: "task",
    entityId: "t1",
    eventId: "e1",
    sourceRevision: "1",
    attemptId: "a1",
    title: "混剪失败",
    observedAt: 100,
  }, 100);
  assert.equal(first.row.occurrenceCount, 1);
  const replay = applyProjectionEvent(first.row, {
    ...first.row,
    eventId: "e1",
    sourceRevision: "1",
    observedAt: 200,
  }, 200);
  assert.equal(replay.row.occurrenceCount, 1);
  const recovered = applyProjectionEvent(first.row, {
    ...first.row,
    conditionState: "recovered",
    eventId: "e2",
    sourceRevision: "2",
    observedAt: 300,
  }, 300);
  assert.equal(recovered.row.conditionState, "recovered");
  const again = applyProjectionEvent(recovered.row, {
    kind: "production_failed",
    fingerprint: "production_failed|task|t1",
    entityType: "task",
    entityId: "t1",
    eventId: "e3",
    sourceRevision: "3",
    attemptId: "a2",
    title: "混剪失败",
    observedAt: 400,
  }, 400);
  assert.equal(again.row.workflowState, "open");
  assert.equal(again.row.occurrenceCount, 2);
});

test("ignore and manual resolve do not invent recovered condition", () => {
  const existing = {
    id: "x",
    version: 1,
    workflowState: "open",
    conditionState: "active",
  };
  const ignored = applyWorkflowAction(existing, { action: "ignore", reason: "今晚再看", version: 1, ignoreFor: "1h" }, 1000);
  assert.equal(ignored.workflowState, "ignored");
  assert.equal(ignored.conditionState, "active");
  const manual = applyWorkflowAction({ ...existing, version: 2 }, { action: "resolve_manual", reason: "已人工核对", version: 2 }, 2000);
  assert.match(manual.resolvedReason, /^manual:/);
  assert.equal(manual.conditionState, "active");
  assert.throws(() => applyWorkflowAction(existing, { action: "ignore", version: 99, reason: "x" }), /刷新后重试/);
});

test("cancel is not a production failure", () => {
  const event = classifyOfficialNovelEvent({
    sourceStatus: "canceled",
    localTaskId: "t-cancel",
    entityType: "task",
    entityId: "t-cancel",
  });
  assert.equal(event.skipCreate, true);
  assert.equal(event.conditionState, "recovered");
});

test("legacy errors without errorCode stay other_production, not auth failure", () => {
  const event = classifyOfficialNovelEvent({
    sourceStatus: "needs_attention",
    message: "旧版本失败，没有错误码",
    localTaskId: "t-old",
    entityType: "task",
    entityId: "t-old",
  });
  assert.equal(event.kind, "other_production");
});

test("unreachable source stays unknown and does not recover", () => {
  const existing = {
    id: "x",
    kind: "official_publish_failed",
    fingerprint: "official_publish_failed|publish_record|r1",
    eventId: "e1",
    sourceRevision: "1",
    conditionState: "active",
    workflowState: "open",
    occurrenceCount: 1,
    version: 1,
  };
  const next = applyProjectionEvent(existing, {
    ...existing,
    eventId: "e2",
    sourceRevision: "2",
    conditionState: "unknown",
    observedAt: 50,
  }, 50);
  assert.equal(next.row.conditionState, "unknown");
  assert.equal(next.row.workflowState, "open");
});

test("delete hides the episode; same event stays gone, new attempt comes back", () => {
  const existing = {
    id: "x",
    version: 1,
    workflowState: "open",
    conditionState: "active",
    eventId: "e1",
    sourceRevision: "1",
    attemptId: "a1",
    fingerprint: "production_failed|task|t1",
    occurrenceCount: 1,
  };
  const deleted = applyWorkflowAction(existing, { action: "delete", version: 1 }, 10);
  assert.equal(deleted.workflowState, "deleted");
  assert.equal(deleted.conditionState, "active");
  const replay = applyProjectionEvent(deleted, {
    ...deleted,
    kind: "production_failed",
    eventId: "e1",
    sourceRevision: "1",
    observedAt: 20,
  }, 20);
  assert.equal(replay.row.workflowState, "deleted");
  const later = applyProjectionEvent(deleted, {
    kind: "production_failed",
    fingerprint: "production_failed|task|t1",
    entityType: "task",
    entityId: "t1",
    eventId: "e-new",
    sourceRevision: "9",
    attemptId: "a2",
    title: "混剪失败",
    observedAt: 30,
  }, 30);
  assert.equal(later.row.workflowState, "open");
  assert.equal(later.row.occurrenceCount, 2);
});

test("trusted links reject javascript urls", () => {
  const task = trustedFactoryTaskUrl("javascript:alert(1)", "task-1");
  assert.equal(task.href, "https://factory.tiktokaitool.com/tasks");
  const hub = trustedHubReviewUrl("https://evil.example/phish", "batch-1");
  assert.equal(hub.href, "https://tiktokaitool.com");
  assert.equal(exceptionFingerprint({ kind: "account_auth_failed", entityType: "account", entityId: "c1", connectionId: "c1" }), "account_auth_failed|account|c1|c1");
});
