import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  deleteUnresolvedNovelExceptions,
  listNovelExceptions,
  patchNovelException,
  projectNovelException,
  summarizeNovelExceptions,
} from "./novel-exceptions-store.js";
import { handleNovelExceptions, ingestWorkerNovelExceptionEvents, projectJobException } from "./novel-exceptions.js";
import { pageFileFor } from "./pages.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.join(here, "../migrations/0021_novel_exceptions.sql"), "utf8");

function d1Sqlite() {
  const database = new DatabaseSync(":memory:");
  database.exec(migration);
  return {
    prepare(sql) {
      return {
        bind(...binds) {
          return {
            async first() {
              return database.prepare(sql).get(...binds) ?? null;
            },
            async all() {
              return { results: database.prepare(sql).all(...binds) };
            },
            async run() {
              const info = database.prepare(sql).run(...binds);
              return { meta: { changes: info.changes } };
            },
          };
        },
      };
    },
  };
}

test("repeats of the same event stay one row", async () => {
  const db = d1Sqlite();
  const event = {
    kind: "production_failed",
    fingerprint: "production_failed|task|task-1",
    entityType: "task",
    entityId: "task-1",
    eventId: "same-event",
    sourceRevision: "1",
    title: "失败",
    severity: "critical",
    stage: "produce",
    observedAt: 10,
  };
  for (let index = 0; index < 10; index += 1) {
    await projectNovelException(db, event, 10 + index);
  }
  const listed = await listNovelExceptions(db, { unresolved: true });
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].occurrenceCount, 1);
});

test("summary counts are full-set not page size", async () => {
  const db = d1Sqlite();
  for (let index = 0; index < 25; index += 1) {
    await projectNovelException(db, {
      kind: "production_failed",
      fingerprint: `production_failed|task|t-${index}`,
      entityType: "task",
      entityId: `t-${index}`,
      eventId: `e-${index}`,
      title: "失败",
      severity: index < 5 ? "critical" : "warning",
      stage: "produce",
      observedAt: 1000 + index,
    }, 1000 + index);
  }
  const page = await listNovelExceptions(db, { limit: 20 });
  assert.equal(page.items.length, 20);
  assert.ok(page.nextCursor);
  const summary = await summarizeNovelExceptions(db, {});
  assert.equal(summary.open, 25);
  assert.equal(summary.critical, 5);
});

test("patch ignore does not look recovered and requestId is idempotent", async () => {
  const db = d1Sqlite();
  const created = await projectNovelException(db, {
    kind: "official_publish_failed",
    fingerprint: "official_publish_failed|publish_record|r1",
    entityType: "publish_record",
    entityId: "r1",
    eventId: "pub-1",
    title: "发布失败",
    severity: "critical",
    stage: "publish",
    observedAt: 1,
  }, 1);
  const first = await patchNovelException(db, created.row.id, {
    action: "ignore",
    reason: "明天再看",
    ignoreFor: "1h",
    version: 1,
    requestId: "req-1",
  }, "admin", 2);
  const again = await patchNovelException(db, created.row.id, {
    action: "ignore",
    reason: "明天再看",
    ignoreFor: "1h",
    version: 1,
    requestId: "req-1",
  }, "admin", 3);
  assert.equal(first.row.workflowState, "ignored");
  assert.equal(first.row.conditionState, "active");
  assert.equal(again.replayed, true);
});

test("delete removes from default list and does not change condition", async () => {
  const db = d1Sqlite();
  const created = await projectNovelException(db, {
    kind: "production_failed",
    fingerprint: "production_failed|task|old-1",
    entityType: "task",
    entityId: "old-1",
    eventId: "old-event",
    sourceRevision: "7",
    title: "混剪失败",
    severity: "critical",
    stage: "produce",
    observedAt: 1,
  }, 1);
  const deleted = await patchNovelException(db, created.row.id, {
    action: "delete",
    version: 1,
    requestId: "del-1",
  }, "admin", 2);
  assert.equal(deleted.row.workflowState, "deleted");
  assert.equal(deleted.row.conditionState, "active");
  const listed = await listNovelExceptions(db, { unresolved: true });
  assert.equal(listed.items.length, 0);
  const again = await projectNovelException(db, {
    kind: "production_failed",
    fingerprint: "production_failed|task|old-1",
    entityType: "task",
    entityId: "old-1",
    eventId: "old-event",
    sourceRevision: "7",
    title: "混剪失败",
    observedAt: 3,
  }, 3);
  assert.equal(again.row.workflowState, "deleted");
});

test("bulk delete clears current unresolved only", async () => {
  const db = d1Sqlite();
  await projectNovelException(db, {
    kind: "production_failed",
    fingerprint: "production_failed|task|a",
    entityType: "task",
    entityId: "a",
    eventId: "a1",
    title: "失败",
    severity: "critical",
    stage: "produce",
    observedAt: 1,
  }, 1);
  const result = await deleteUnresolvedNovelExceptions(db, { reason: "clear-unresolved" }, "admin", 9);
  assert.equal(result.deleted, 1);
  const listed = await listNovelExceptions(db, { unresolved: true });
  assert.equal(listed.items.length, 0);
});

test("admin without the module and missing session cannot read exceptions", async () => {
  const db = d1Sqlite();
  const naked = { user: { role: "admin", sidebarModules: ["tasks"], id: "a0" } };
  const denied = await handleNovelExceptions(
    new Request("https://factory.test/api/novel-exceptions"),
    { DB: db },
    new URL("https://factory.test/api/novel-exceptions"),
    naked
  );
  assert.equal(denied.status, 403);
  const missing = await handleNovelExceptions(
    new Request("https://factory.test/api/novel-exceptions"),
    { DB: db },
    new URL("https://factory.test/api/novel-exceptions"),
    null
  );
  assert.equal(missing, null);
});

test("operator cannot read summary or list", async () => {
  const db = d1Sqlite();
  const operator = { user: { role: "operator", sidebarModules: ["tasks"], id: "op" } };
  const request = new Request("https://factory.test/api/novel-exceptions/summary");
  const denied = await handleNovelExceptions(request, { DB: db }, new URL(request.url), operator);
  assert.equal(denied.status, 403);
});

test("admin with module can list and worker events are accepted", async () => {
  const db = d1Sqlite();
  const admin = { user: { role: "admin", sidebarModules: ["novel-exceptions", "tasks"], id: "a1" } };
  await ingestWorkerNovelExceptionEvents(db, {
    events: [{
      eventId: "local-output-81",
      itemFailed: true,
      sourceStatus: "failed",
      localTaskId: "big-task",
      entityType: "output",
      entityId: "big-task:clip-81.mp4",
      fileName: "clip-81.mp4",
      message: "第 81 条合成失败",
    }],
  }, "windows-local");
  const request = new Request("https://factory.test/api/novel-exceptions");
  const response = await handleNovelExceptions(request, { DB: db }, new URL(request.url), admin);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].entityId, "big-task:clip-81.mp4");
  assert.equal(body.items[0].taskLink.href.endsWith("/tasks"), true);
});

test("job failure and later success share the same fingerprint", async () => {
  const db = d1Sqlite();
  await projectJobException(db, {
    id: "job-1",
    type: "reddit-mix",
    status: "failed",
    error: "encode failed",
    updated_at: 10,
    payload: { taskId: "t1" },
  }, 10);
  const open = await listNovelExceptions(db, { unresolved: true });
  assert.equal(open.items.length, 1);
  assert.equal(open.items[0].kind, "production_failed");
  await projectJobException(db, {
    id: "job-1",
    type: "reddit-mix",
    status: "done",
    updated_at: 20,
    payload: { taskId: "t1" },
  }, 20);
  const after = await listNovelExceptions(db, { workflowState: "resolved" });
  assert.equal(after.items.length, 1);
  assert.equal(after.items[0].conditionState, "recovered");
  await projectJobException(db, {
    id: "job-2",
    type: "reddit-mix",
    status: "cancelled",
    updated_at: 30,
    payload: { taskId: "t2" },
  }, 30);
  const still = await listNovelExceptions(db, { unresolved: true });
  assert.equal(still.items.length, 0);
});

test("exception page is mapped and APIs never wrap retry-publish or resume", () => {
  assert.equal(pageFileFor("/novel-exceptions"), "novel-exceptions.html");

  const hereDir = path.dirname(fileURLToPath(import.meta.url));
  const sources = [
    fs.readFileSync(path.join(hereDir, "novel-exceptions.js"), "utf8"),
    fs.readFileSync(path.join(hereDir, "novel-exceptions-store.js"), "utf8"),
    fs.readFileSync(path.join(hereDir, "../../public/novel-exceptions.js"), "utf8"),
    fs.readFileSync(path.join(hereDir, "../../scripts/novel-exception-reporter.js"), "utf8"),
  ].join("\n");
  assert.doesNotMatch(sources, /retry-publish/);
  assert.doesNotMatch(sources, /\/resume/);
  assert.doesNotMatch(sources, /listAutoTasks/);
  const autoTasks = fs.readFileSync(path.join(hereDir, "auto-tasks-store.js"), "utf8");
  assert.match(autoTasks, /VIDEO_LIST_CAP = 80/);
  const jobs = fs.readFileSync(path.join(hereDir, "jobs.js"), "utf8");
  assert.match(jobs, /supplied !== expected[\s\S]*\/api\/worker\/novel-exceptions\/events/s);
  const wrangler = fs.readFileSync(path.join(hereDir, "../wrangler.jsonc"), "utf8");
  assert.doesNotMatch(wrangler, /\*\/5 \* \* \* \*/);
  const rules = fs.readFileSync(path.join(hereDir, "../../scripts/novel-exception-rules.js"), "utf8");
  assert.match(rules, /DEFAULT_WORKER_ONLINE_WINDOW_MS = 10 \* 60 \* 1000/);
  assert.match(rules, /stuck_no_progress/);
  assert.match(rules, /content_mapping_missing/);
});
