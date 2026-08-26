import assert from "node:assert/strict";
import test from "node:test";
import { planLocalBatchAudioVersions } from "./novel-batch-audio-job.js";

test("plans three openings for books that still need audio versions", async () => {
  const items = await planLocalBatchAudioVersions({
    novelIds: ["ready", "short", "done", "missing"],
    count: 3,
    novelContentLibrary: {
      getNovel(id) {
        if (id === "missing") throw new Error("没有找到该小说。");
        if (id === "short") return { id, title: "短", sourceContent: "too short", scripts: [] };
        if (id === "done") {
          return {
            id,
            title: "够了",
            sourceContent: "A".repeat(120),
            scripts: [{ kept: true }, { kept: true }, { audioId: "a1" }]
          };
        }
        return { id, title: "待出", sourceContent: "B".repeat(120), scripts: [] };
      }
    }
  });
  assert.deepEqual(items.map((item) => [item.novelId, item.skipped, item.needed || 0]), [
    ["ready", false, 3],
    ["short", true, 0],
    ["done", true, 0],
    ["missing", true, 0]
  ]);
});
