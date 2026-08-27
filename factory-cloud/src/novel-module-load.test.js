import assert from "node:assert/strict";
import test from "node:test";
import { importedPeerHitIdSet, planPeerHitNovelImports } from "../../scripts/peer-hits.js";

const CATALOG = 7733;
const SCRIPTS = 152;
const PEER_HITS = 100;
const AVG_SOURCE = 320;
const EXCERPT = 160;
const SCRIPT_TEXT = 1600;

function bytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function timed(label, fn) {
  const start = performance.now();
  const result = fn();
  const ms = Number((performance.now() - start).toFixed(2));
  return { label, ms, result };
}

function makeNovels(count) {
  const source = "s".repeat(AVG_SOURCE);
  return Array.from({ length: count }, (_, index) => ({
    id: `novel-${index}`,
    title: `Stress Book ${String(index).padStart(4, "0")}`,
    platform: ["GoodNovel", "MotoNovel", "NovelMaster"][index % 3],
    bookId: String(1_000_000_000 + index),
    promotionCode: "",
    promotionCopy: "",
    category: "romance",
    featured: index % 80 === 0,
    sellingPoint: "",
    note: "",
    sourceContent: source,
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z"
  }));
}

function makeSummaries(novels) {
  return novels.map((novel) => ({
    ...novel,
    sourceContent: novel.sourceContent.slice(0, EXCERPT)
  }));
}

function makeScripts(count) {
  const text = "a".repeat(SCRIPT_TEXT);
  return Array.from({ length: count }, (_, index) => ({
    id: `script-${index}`,
    novelId: `novel-${index % 90}`,
    title: `Opening ${index}`,
    text,
    audioId: index < 40 ? `audio-${index}` : "",
    peerHitId: index < 20 ? `peer-${index}` : "",
    versionLabel: "同行爆款",
    sourceType: "peer-hit"
  }));
}

function makeHits(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `peer-${index}`,
    novelId: String(1_000_000_000 + index),
    novelTitle: `Stress Book ${String(index).padStart(4, "0")}`,
    platform: "NovelMaster",
    audioId: `peer-audio-${index}`,
    playCount: 2_800_000 - index * 1000
  }));
}

function oldHydrate(novels, scripts, id) {
  const novel = novels.find((item) => item.id === id);
  return { ...novel, scripts: scripts.filter((item) => item.novelId === novel.id) };
}

function newHydrate(novel, scripts) {
  return { ...novel, scripts: scripts.filter((item) => item.novelId === novel.id) };
}

function overviewPayload(summaries, scripts) {
  return summaries.map((novel) => {
    const owned = scripts.filter((script) => script.novelId === novel.id);
    return {
      ...novel,
      scripts: owned,
      audioCount: owned.filter((item) => item.audioId).length,
      performance: { videoCount: 0, totalViews: 0, averageViews: 0, maxViews: 0, comments: 0 }
    };
  });
}

function matchBindBudget(hits) {
  const ids = new Set();
  const titles = new Set();
  for (const hit of hits) {
    if (hit.novelId) ids.add(hit.novelId);
    if (hit.novelTitle) titles.add(hit.novelTitle);
  }
  return ids.size * 2 + titles.size;
}

test("stress catalog matches production scale and exposes leftover hotspots", () => {
  const novels = makeNovels(CATALOG);
  const summaries = makeSummaries(novels);
  const scripts = makeScripts(SCRIPTS);
  const hits = makeHits(PEER_HITS);

  const fullCatalog = timed("listNovels + hydrate", () => oldHydrate(novels, scripts, "novel-12"));
  const oneBook = timed("getNovelRow + scripts", () => newHydrate(novels[12], scripts));
  const bookList = timed("novelOverview", () => overviewPayload(summaries, scripts));
  const workingSummaries = summaries.filter((_, index) => index < 200);
  const workingList = timed("working overview", () => overviewPayload(workingSummaries, scripts));
  const importPlan = timed("plan 20 peer imports", () => planPeerHitNovelImports(hits.slice(0, 20), novels.slice(0, 20), {
    importedPeerHitIds: importedPeerHitIdSet(scripts)
  }));
  const writeBlob = timed("stringify scripts blob", () => JSON.stringify({ novels: [], scripts }));

  const report = {
    catalog: CATALOG,
    scripts: SCRIPTS,
    peerHits: PEER_HITS,
    fullCatalogSourceBytes: novels.reduce((sum, item) => sum + item.sourceContent.length, 0),
    fullCatalogJsonKb: Number((bytes(novels) / 1024).toFixed(1)),
    oneBookJsonKb: Number((bytes(oneBook.result) / 1024).toFixed(1)),
    overviewJsonKb: Number((bytes({ novels: bookList.result }) / 1024).toFixed(1)),
    workingOverviewJsonKb: Number((bytes({ novels: workingList.result }) / 1024).toFixed(1)),
    scriptsJsonKb: Number((bytes({ novels: [], scripts }) / 1024).toFixed(1)),
    peerListBindBudget: matchBindBudget(hits),
    peerListFallsBackToFullIndex: matchBindBudget(hits) > 80,
    timingsMs: {
      fullCatalogHydrate: fullCatalog.ms,
      oneBookHydrate: oneBook.ms,
      bookListOverview: bookList.ms,
      workingOverview: workingList.ms,
      importPlan20: importPlan.ms,
      writeScriptsBlob: writeBlob.ms
    }
  };
  console.log(`NOVEL_LOAD_REPORT ${JSON.stringify(report)}`);

  assert.ok(report.fullCatalogSourceBytes > 2_000_000, "full catalog source should exceed 2MB");
  assert.ok(report.fullCatalogJsonKb > 2000, "loading all novels is a multi-megabyte Worker payload");
  assert.ok(report.oneBookJsonKb < 50, "single-book hydrate must stay tiny");
  assert.ok(report.overviewJsonKb > 1500, "full catalog list remains a leftover hotspot");
  assert.ok(report.workingOverviewJsonKb < 800, "working book list must stay well under the catalog dump");
  assert.equal(report.peerListFallsBackToFullIndex, true);
  assert.ok(report.peerListBindBudget > 80);
  assert.equal(importPlan.result.length, 20);
});

test("peer-hit list with 100 rows exceeds the targeted match budget", () => {
  const hits = makeHits(100);
  assert.ok(matchBindBudget(hits) > 80);
});
