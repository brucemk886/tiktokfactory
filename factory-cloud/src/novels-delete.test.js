import assert from "node:assert/strict";
import test from "node:test";
import { buildOverview, dropDraftScripts, removeDraftScriptsById, removeScriptsById, scriptHasAudio, scriptIsKept } from "../../scripts/novel-overview.js";
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

test("drops text-only drafts and keeps voiced or explicitly saved scripts", () => {
  const scripts = [
    { id: "keep-audio", novelId: "novel-1", audioId: "audio-1" },
    { id: "keep-pending", novelId: "novel-1", audioId: "", kept: true },
    { id: "drop-draft", novelId: "novel-1", audioId: "" },
    { id: "other-book", novelId: "novel-2", audioId: "" }
  ];
  assert.equal(scriptHasAudio(scripts[0]), true);
  assert.equal(scriptIsKept(scripts[1]), true);
  assert.deepEqual(dropDraftScripts(scripts, { novelId: "novel-1" }).map((item) => item.id), ["keep-audio", "keep-pending", "other-book"]);
  assert.deepEqual(removeDraftScriptsById(scripts, ["drop-draft", "keep-audio"]).map((item) => item.id), ["keep-audio", "keep-pending", "other-book"]);
  assert.deepEqual(removeScriptsById(scripts, ["keep-audio", "drop-draft"]).map((item) => item.id), ["keep-pending", "other-book"]);
});

test("keeps recent drafts when a grace window is set", () => {
  const scripts = [
    { id: "old-draft", novelId: "novel-1", createdAt: "2020-01-01T00:00:00.000Z" },
    { id: "new-draft", novelId: "novel-1", createdAt: new Date().toISOString() }
  ];
  assert.deepEqual(dropDraftScripts(scripts, { novelId: "novel-1", graceMs: 60_000 }).map((item) => item.id), ["new-draft"]);
});

test("overview novels count generated audio per book", () => {
  const page = buildOverview({
    novels: [{ id: "n1", title: "A", platform: "GoodNovel" }],
    scripts: [
      { id: "s1", novelId: "n1", audioId: "audio-1" },
      { id: "s2", novelId: "n1" }
    ]
  }, [{ id: "audio-1", title: "Opening", fileName: "opening.mp3" }], []);
  assert.equal(page.novels[0].audioCount, 1);
});
