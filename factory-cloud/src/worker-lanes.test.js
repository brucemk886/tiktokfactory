import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { claimTypeFilter, hasOwnKeys, mergeWorkerCatalog, officialPublishFollowupPayload } from "./jobs.js";

test("claim filter lets a lane pick only its own job types", () => {
  assert.deepEqual(claimTypeFilter({}), { sql: "", binds: [], types: [], excludeTypes: [] });
  const publish = claimTypeFilter({ types: ["official-publish"] });
  assert.equal(publish.sql, " AND type IN (?)");
  assert.deepEqual(publish.binds, ["official-publish"]);
  const render = claimTypeFilter({ excludeTypes: ["official-publish", "official-publish", ""] });
  assert.equal(render.sql, " AND type NOT IN (?)");
  assert.deepEqual(render.binds, ["official-publish"]);
  const capped = claimTypeFilter({ types: Array.from({ length: 40 }, (_, i) => `t${i}`) });
  assert.equal(capped.binds.length, 20);
});

const WORKER_SQL = "COALESCE(NULLIF(json_extract(payload_json, '$.targetWorkerId'), ''), NULLIF(json_extract(payload_json, '$.renderWorkerId'), ''), '')";

test("a worker only claims jobs pinned to itself or to nobody", () => {
  const publish = claimTypeFilter({ workerId: "windows-local", types: ["official-publish"] });
  assert.equal(publish.sql, ` AND type IN (?) AND ${WORKER_SQL} IN ('', ?)`);
  assert.deepEqual(publish.binds, ["official-publish", "windows-local"]);
  const render = claimTypeFilter({ workerId: "windows-local", excludeTypes: ["official-publish"] });
  assert.equal(render.sql, ` AND type NOT IN (?) AND ${WORKER_SQL} IN ('', ?)`);
  assert.deepEqual(render.binds, ["official-publish", "windows-local"]);
  // assignedOnly: a secondary machine skips unpinned jobs entirely.
  const pinned = claimTypeFilter({ workerId: "worker-2", assignedOnly: true, excludeTypes: ["official-publish"] });
  assert.equal(pinned.sql, ` AND type NOT IN (?) AND ${WORKER_SQL} = ?`);
  assert.deepEqual(pinned.binds, ["official-publish", "worker-2"]);
});

test("worker catalogs merge per machine instead of last push wins", () => {
  const existing = [
    { id: "legacy", name: "old A group" },
    { id: "a1", name: "A", workerId: "windows-local" },
    { id: "b1", name: "B", workerId: "worker-2" }
  ];
  const afterA = mergeWorkerCatalog(existing, [{ id: "legacy", name: "A legacy re-pushed" }, { id: "a2", name: "A2" }], "windows-local");
  assert.deepEqual(afterA.map((item) => `${item.id}@${item.workerId || "-"}`), ["b1@worker-2", "legacy@windows-local", "a2@windows-local"]);
  // B pushing an empty list clears only B's entries; untagged ones survive.
  const afterB = mergeWorkerCatalog(existing, [], "worker-2");
  assert.deepEqual(afterB.map((item) => item.id), ["legacy", "a1"]);
  assert.deepEqual(mergeWorkerCatalog(null, [{ id: "x" }], "w"), [{ id: "x", workerId: "w" }]);
});

test("empty settings from a fresh worker do not count as settings", () => {
  assert.equal(hasOwnKeys({}), false);
  assert.equal(hasOwnKeys(null), false);
  assert.equal(hasOwnKeys([1]), false);
  assert.equal(hasOwnKeys({ subtitle: {} }), true);
});

test("a finished render with publishPending becomes an official-publish job", () => {
  const job = {
    id: "reddit-mix-1",
    title: "书单 A",
    worker_id: "windows-local",
    payload_json: JSON.stringify({
      taskId: "task-1",
      taskName: "书单 A",
      taskType: "reddit-mix",
      publish: { provider: "official", connectionIds: ["c1"], scheduleAt: 1 },
      generation: { totalVideos: 2 }
    })
  };
  const payload = officialPublishFollowupPayload(job, {
    publishPending: true,
    results: [{ fileName: "a.mp4", outputPath: "D:/out/a.mp4" }, { fileName: "", outputPath: "" }]
  });
  assert.equal(payload.publishOnly, true);
  assert.equal(payload.taskType, "official-publish");
  assert.equal(payload.taskId, "task-1");
  assert.equal(payload.renderJobId, "reddit-mix-1");
  assert.equal(payload.renderWorkerId, "windows-local");
  assert.deepEqual(payload.videos.map((video) => video.fileName), ["a.mp4"]);
  assert.deepEqual(payload.publish, { provider: "official", connectionIds: ["c1"], scheduleAt: 1 });
  assert.deepEqual(payload.generation, { totalVideos: 2 });

  assert.equal(officialPublishFollowupPayload(job, { results: [] }), null);
  assert.equal(officialPublishFollowupPayload({ ...job, payload_json: JSON.stringify({ publishOnly: true, publish: { provider: "official" } }) }, { results: [{ fileName: "a.mp4" }] }), null);
  assert.equal(officialPublishFollowupPayload({ ...job, payload_json: JSON.stringify({ publish: { provider: "geelark" } }) }, { results: [{ fileName: "a.mp4" }] }), null);
  assert.equal(officialPublishFollowupPayload({ ...job, payload_json: JSON.stringify({ publish: { provider: "official", autoPublish: false } }) }, { results: [{ fileName: "a.mp4" }] }), null);
});

test("cloud and worker agree on the split render/publish protocol", async () => {
  const root = new URL("./", import.meta.url);
  const [jobs, worker] = await Promise.all([
    readFile(new URL("jobs.js", root), "utf8"),
    readFile(new URL("../../scripts/factory-cloud-worker.js", root), "utf8")
  ]);
  assert.match(jobs, /return json\(\{ ok: true, requeued, splitPublish: true \}\);/);
  assert.match(jobs, /rawResult\.publishPending/);
  assert.match(jobs, /WHERE status = 'queued'\$\{filter\.sql\}/);
  assert.match(worker, /context\.cloudSplitPublish = Boolean\(data\?\.splitPublish\)/);
  assert.match(worker, /result: \{ \.\.\.local, publishPending: true \}/);
  assert.match(worker, /body: \{ workerId: context\.workerId, lane: lane\.name, assignedOnly: context\.settings\.assignedOnly === true, \.\.\.lane\.claim \}/);
});
