import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { claimTypeFilter, officialPublishFollowupPayload } from "./jobs.js";

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

test("a finished render with publishPending becomes an official-publish job", () => {
  const job = {
    id: "reddit-mix-1",
    title: "书单 A",
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
  assert.match(worker, /body: \{ workerId: context\.workerId, lane: lane\.name, \.\.\.lane\.claim \}/);
});
