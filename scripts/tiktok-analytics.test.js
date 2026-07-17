import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getGeneratedVideoReuseDetail } from "./asset-library.js";
import { createTikTokAnalyticsService, deduplicateVideoEntries, matchPublishRecords, normalizeTikTokPost } from "./tiktok-analytics.js";

test("normalizes TikTokAPI.store post fields", () => {
  const post = normalizeTikTokPost({
    aweme_id: "7650001000000000001",
    desc: "story test",
    create_time: 1783800000,
    author: { unique_id: "DemoUser" },
    statistics: { play_count: 1200, digg_count: 80, comment_count: 7, share_count: 5, collect_count: 9 },
    video: { duration: 63 }
  });
  assert.equal(post.id, "7650001000000000001");
  assert.equal(post.username, "demouser");
  assert.equal(post.views, 1200);
  assert.equal(post.bookmarks, 9);
  assert.match(post.shareUrl, /demouser\/video\/7650001000000000001/);
});

test("prefers a numeric TikTok id and never builds a link from an internal id", () => {
  const numeric = normalizeTikTokPost({
    aweme_id: "v12044gd0000internal",
    video_id: "7661657101814500622",
    create_time: 1783800000,
    author: { unique_id: "demo" }
  });
  const internalOnly = normalizeTikTokPost({
    aweme_id: "v12044gd0000internal",
    create_time: 1783800000,
    author: { unique_id: "demo" }
  });
  assert.equal(numeric.id, "7661657101814500622");
  assert.match(numeric.shareUrl, /\/video\/7661657101814500622$/);
  assert.equal(internalOnly.shareUrl, "");
});

test("merges duplicate provider ids while keeping fresh metrics and a numeric link", () => {
  const videos = {
    "7660537721592499469": {
      latest: { id: "7660537721592499469", username: "demo", createTime: 1000, description: "#reddit", fetchedAt: 100, views: 285, shareUrl: "https://www.tiktok.com/@demo/video/7660537721592499469" },
      history: [{ fetchedAt: 100, views: 285 }]
    },
    "v12044gd0000duplicate": {
      latest: { id: "v12044gd0000duplicate", username: "demo", createTime: 1000, description: "#reddit ", fetchedAt: 200, views: 300, shareUrl: "https://www.tiktok.com/@demo/video/v12044gd0000duplicate" },
      history: [{ fetchedAt: 200, views: 300 }]
    }
  };
  const deduplicated = deduplicateVideoEntries(videos);
  assert.deepEqual(Object.keys(deduplicated), ["7660537721592499469"]);
  assert.equal(deduplicated["7660537721592499469"].latest.views, 300);
  assert.equal(deduplicated["7660537721592499469"].latest.shareUrl, "https://www.tiktok.com/@demo/video/7660537721592499469");
  assert.deepEqual(deduplicated["7660537721592499469"].latest.sourceIds.sort(), ["7660537721592499469", "v12044gd0000duplicate"]);
});

test("deduplicates posts before assigning adjacent publish records", () => {
  const videos = {
    firstNumeric: { latest: { id: "7660000000000000001", username: "demo", createTime: 1240, description: "#reddit", fetchedAt: 100, views: 200 } },
    firstInternal: { latest: { id: "v12044-first", username: "demo", createTime: 1240, description: "#reddit", fetchedAt: 200, views: 210 } },
    secondNumeric: { latest: { id: "7660000000000000002", username: "demo", createTime: 2080, description: "#reddit", fetchedAt: 100, views: 3000 } },
    secondInternal: { latest: { id: "v12044-second", username: "demo", createTime: 2080, description: "#reddit", fetchedAt: 200, views: 3100 } }
  };
  const records = [
    { id: "audio-a", accountName: "demo", scheduleAt: 1000, audioName: "a.mp3", videoDesc: "#reddit" },
    { id: "audio-b", accountName: "demo", scheduleAt: 1900, audioName: "b.mp3", videoDesc: "#reddit" }
  ];
  const matches = matchPublishRecords(videos, records);
  assert.equal(matches.size, 2);
  assert.equal(matches.get("7660000000000000001").audioName, "a.mp3");
  assert.equal(matches.get("7660000000000000002").audioName, "b.mp3");
});

test("matches a scraped post to the nearest publish record for the same account", () => {
  const videos = {
    video1: { latest: { id: "video1", username: "demo", createTime: 10000 } }
  };
  const records = [
    { id: "wrong-account", accountName: "other", scheduleAt: 10000 },
    { id: "nearest", accountName: "demo", scheduleAt: 10060, fileName: "a.mp4" },
    { id: "farther", accountName: "demo", scheduleAt: 12000, fileName: "b.mp4" }
  ];
  const matches = matchPublishRecords(videos, records);
  assert.equal(matches.get("video1").recordId, "nearest");
  assert.equal(matches.get("video1").matchDistanceSeconds, 60);
  assert.equal(matches.get("video1").matchConfidence, "high");
});

test("does not guess a local video when publish time differs by more than 30 minutes", () => {
  const videos = { video1: { latest: { id: "video1", username: "demo", createTime: 10000, description: "#reddit" } } };
  const records = [{ id: "far", accountName: "demo", scheduleAt: 10000 + 31 * 60, fileName: "wrong.mp4", videoDesc: "#reddit" }];
  assert.equal(matchPublishRecords(videos, records).has("video1"), false);
});

test("stores snapshots and never exposes the raw API key", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tiktok-analytics-"));
  let views = 100;
  let requestedUrl = "";
  const fetchImpl = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: { videos: [{ video_id: "post-1", create_time: 1783800000, author: { unique_id: "demo" }, play_count: views }] }
      })
    };
  };
  let currentTime = 1783800100000;
  const service = createTikTokAnalyticsService({ workDir, fetchImpl, now: () => currentTime });
  service.saveSettings({ apiKeys: ["abcdefghijklmnop"], dailyRequestLimit: 100 });
  assert.deepEqual(service.getSettings().apiKeys, []);
  assert.equal(service.getSettings().maskedApiKey, "abcd...mnop");

  await service.fetchAccount("demo");
  assert.equal(new URL(requestedUrl).searchParams.get("count"), "20");
  views = 180;
  currentTime += 24 * 60 * 60 * 1000;
  await service.fetchAccount("demo");

  const dashboard = service.getDashboard({ range: "all" }, []);
  assert.equal(dashboard.summary.videoCount, 1);
  assert.equal(dashboard.videos[0].history.length, 2);
  assert.equal(dashboard.videos[0].viewsDelta, 80);
});

test("summarizes account stability and returns account video details", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tiktok-account-summary-"));
  const views = [50, 150, 600, 1200];
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      code: 0,
      data: {
        videos: views.map((playCount, index) => ({
          video_id: `post-${index + 1}`,
          create_time: 1783800000 - index * 60,
          author: { unique_id: "demo" },
          play_count: playCount
        }))
      }
    })
  });
  const service = createTikTokAnalyticsService({ workDir, fetchImpl, now: () => 1783800100000 });
  service.saveSettings({ apiKeys: ["test-api-key"], dailyRequestLimit: 100 });
  await service.fetchAccount("demo");

  const dashboard = service.getDashboard({ period: "all" }, []);
  assert.equal(dashboard.accounts[0].videos, 4);
  assert.equal(dashboard.accounts[0].averageViews, 500);
  assert.equal(dashboard.accounts[0].medianViews, 375);
  assert.equal(dashboard.accounts[0].low100Rate, 25);
  assert.equal(dashboard.accounts[0].over500Rate, 50);
  assert.equal(dashboard.accounts[0].over1000Rate, 25);

  const detail = service.getAccountDetail("demo", { period: "all" }, []);
  assert.equal(detail.videos.length, 4);
  assert.equal(detail.summary.maxViews, 1200);
});

test("limits dashboard accounts to the currently configured account list", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tiktok-current-accounts-"));
  const fetchImpl = async (url) => {
    const username = new URL(url).searchParams.get("unique_id");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: { videos: [{ video_id: `post-${username}`, create_time: 1783800000, author: { unique_id: username }, play_count: 100 }] }
      })
    };
  };
  const service = createTikTokAnalyticsService({ workDir, fetchImpl, now: () => 1783800100000 });
  service.saveSettings({ apiKeys: ["test-api-key"], dailyRequestLimit: 100 });
  await service.fetchAccount("current-account");
  await service.fetchAccount("retired-account");

  const dashboard = service.getDashboard({ period: "all", allowedAccounts: ["current-account"] }, []);
  assert.deepEqual(dashboard.accounts.map((item) => item.username), ["current-account"]);
  assert.equal(dashboard.summary.videoCount, 1);
  assert.equal(service.getAccountDetail("retired-account", { period: "all", allowedAccounts: ["current-account"] }, []).videos.length, 0);
});

test("calculates exact overlap between generated video clips", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "asset-reuse-"));
  const workDir = path.join(root, "work");
  fs.mkdirSync(path.join(workDir, "asset-library"), { recursive: true });
  fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ workDir }), "utf8");
  fs.writeFileSync(path.join(workDir, "asset-library", "usage.json"), JSON.stringify({
    assets: { asset1: { usedCount: 2, buckets: { 0: 2, 1: 2 } } },
    generated: [
      { outputId: "target", clips: [{ assetId: "asset1", fileName: "source.mp4", start: 0, duration: 10 }] },
      { outputId: "other", clips: [{ assetId: "asset1", fileName: "source.mp4", start: 5, duration: 10 }] }
    ]
  }), "utf8");

  const detail = getGeneratedVideoReuseDetail(root, "target.mp4");
  assert.equal(detail.summary.reusedSeconds, 5);
  assert.equal(detail.summary.reusePercent, 50);
  assert.equal(detail.relatedVideos[0].sharedSeconds, 5);
});

test("stops before exceeding the configured daily request limit", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tiktok-daily-limit-"));
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({ code: 0, data: { videos: [] } }) };
  };
  const service = createTikTokAnalyticsService({ workDir, fetchImpl, now: () => 1783800100000 });
  service.saveSettings({ apiKeys: ["test-api-key"], dailyRequestLimit: 1 });
  await service.fetchAccount("demo");
  await assert.rejects(() => service.fetchAccount("demo2"), /免费额度已用完/);
  assert.equal(calls, 1);
});

test("balances requests across two API keys", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tiktok-key-balance-"));
  const authorizations = [];
  const fetchImpl = async (_url, options) => {
    authorizations.push(options.headers.Authorization);
    return { ok: true, status: 200, json: async () => ({ code: 0, data: { videos: [] } }) };
  };
  const service = createTikTokAnalyticsService({ workDir, fetchImpl, now: () => 1783800100000 });
  service.saveSettings({ apiKeys: ["first-key", "second-key"], dailyRequestLimit: 100 });

  await service.fetchAccount("demo1");
  await service.fetchAccount("demo2");

  assert.deepEqual(authorizations, ["Bearer first-key", "Bearer second-key"]);
  assert.equal(service.getSettings().keyCount, 2);
  assert.equal(service.getSettings().totalDailyLimit, 200);
});

test("falls back to the second API key when the first key is unavailable", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "tiktok-key-fallback-"));
  const authorizations = [];
  const fetchImpl = async (_url, options) => {
    authorizations.push(options.headers.Authorization);
    if (authorizations.length === 1) {
      return { ok: false, status: 429, json: async () => ({ message: "quota exceeded" }) };
    }
    return { ok: true, status: 200, json: async () => ({ code: 0, data: { videos: [] } }) };
  };
  const service = createTikTokAnalyticsService({ workDir, fetchImpl, now: () => 1783800100000 });
  service.saveSettings({ apiKeys: ["first-key", "second-key"], dailyRequestLimit: 100 });

  const result = await service.fetchAccount("demo");

  assert.deepEqual(authorizations, ["Bearer first-key", "Bearer second-key"]);
  assert.equal(result.keyIndex, 1);
});
