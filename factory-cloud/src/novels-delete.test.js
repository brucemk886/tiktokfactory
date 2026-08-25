import assert from "node:assert/strict";
import test from "node:test";
import { takeNovelFromStore } from "./novels.js";

test("removes one novel and only its rewrite scripts from the catalog store", () => {
  const store = {
    novels: [
      { id: "novel-keep", title: "Keep" },
      { id: "novel-drop", title: "Drop" }
    ],
    scripts: [
      { id: "script-keep", novelId: "novel-keep" },
      { id: "script-drop-1", novelId: "novel-drop" },
      { id: "script-drop-2", novelId: "novel-drop" },
      { id: "script-orphan", novelId: "" }
    ]
  };
  const taken = takeNovelFromStore(store, "novel-drop");
  assert.equal(taken.novel.title, "Drop");
  assert.deepEqual(taken.novels.map((item) => item.id), ["novel-keep"]);
  assert.deepEqual(taken.scripts.map((item) => item.id), ["script-keep", "script-orphan"]);
});

test("returns null when the novel is missing", () => {
  assert.equal(takeNovelFromStore({ novels: [{ id: "novel-keep", title: "Keep" }], scripts: [] }, "missing"), null);
});
