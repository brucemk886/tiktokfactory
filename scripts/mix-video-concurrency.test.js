import assert from "node:assert/strict";
import test from "node:test";
import { createLock, resolveMixVideoConcurrency } from "./mix-video-concurrency.js";

test("mix jobs default to two in-task videos, parkour stays serial", () => {
  assert.equal(resolveMixVideoConcurrency({}), 2);
  assert.equal(resolveMixVideoConcurrency({ videoConcurrency: 3 }), 3);
  assert.equal(resolveMixVideoConcurrency({ videoConcurrency: 99 }), 4);
  assert.equal(resolveMixVideoConcurrency({ videoConcurrency: 0 }), 2);
  assert.equal(resolveMixVideoConcurrency({ videoConcurrency: 3 }, { parkour: true }), 1);
  assert.equal(resolveMixVideoConcurrency({ videoConcurrency: 3 }, { simulator: true }), 1);
});

test("createLock runs critical sections one at a time", async () => {
  const lock = createLock();
  const seen = [];
  await Promise.all([
    lock(async () => {
      seen.push("a-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      seen.push("a-end");
    }),
    lock(async () => {
      seen.push("b-start");
      seen.push("b-end");
    })
  ]);
  assert.deepEqual(seen, ["a-start", "a-end", "b-start", "b-end"]);
});
