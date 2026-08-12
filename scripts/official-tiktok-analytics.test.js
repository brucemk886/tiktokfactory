import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOfficialTikTokAnalyticsService } from "./official-tiktok-analytics.js";

test("official bridge maps authorized accounts and private video data for operations", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "official-tiktok-"));
  const requests = [];
  const service = createOfficialTikTokAnalyticsService({
    workDir,
    now: () => 2_000_000_000_000,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), authorization: options.headers.Authorization });
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/accounts")) {
        return jsonResponse({ accounts: [{
          schema: "tiktok:connection-1",
          profile: { username: "demo_account", displayName: "Demo" },
        }], hasMore: false, nextCursor: "" });
      }
      if (parsed.pathname.endsWith("/videos")) {
        assert.equal(parsed.searchParams.get("accountId"), "tiktok:connection-1");
        assert.equal(parsed.searchParams.get("includePrivate"), "1");
        return jsonResponse({ videos: [{
          id: "765432109876543210",
          createdAt: 1_999_999_000_000,
          duration: 20,
          views: 2_000,
          reach: 1_500,
          likes: 120,
          comments: 8,
          shares: 5,
          averageTimeWatched: 4,
          fullWatchRate: 0.12,
          retention: [{ second: 0, percentage: 1 }, { second: 3, percentage: 0.35 }],
          impressionSources: [{ impressionSource: "For You", percentage: 0.9 }],
        }] });
      }
      return jsonResponse({ error: "Not found" }, 404);
    },
  });

  const settings = service.saveSettings({ baseUrl: "https://tiktokaitool.com/", apiKey: "bridge-secret" });
  assert.equal(settings.configured, true);
  assert.equal(settings.hasApiKey, true);
  assert.equal("apiKey" in settings, false);

  const accounts = await service.listAccounts();
  assert.equal(accounts.accounts[0].profile.username, "demo_account");

  const operation = await service.getOperationSignals({ accountNames: ["@demo_account"], days: 10, videosPerAccount: 30 });
  assert.equal(operation.summary.detailedVideoCount, 1);
  assert.equal(operation.accounts[0].videos[0].retentionCurve[1].second, 3);
  assert.ok(requests.every((request) => request.authorization === "Bearer bridge-secret"));
});

test("official bridge rejects requests when it is not configured", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "official-tiktok-"));
  const originalKey = process.env.TIKTOK_ANALYTICS_BRIDGE_API_KEY;
  delete process.env.TIKTOK_ANALYTICS_BRIDGE_API_KEY;
  try {
    const service = createOfficialTikTokAnalyticsService({ workDir });
    await assert.rejects(() => service.listAccounts(), /not configured/i);
    const operation = await service.getOperationSignals({ accountNames: ["demo"] });
    assert.equal(operation.connected, false);
    assert.equal(operation.status, "unavailable");
  } finally {
    if (originalKey === undefined) delete process.env.TIKTOK_ANALYTICS_BRIDGE_API_KEY;
    else process.env.TIKTOK_ANALYTICS_BRIDGE_API_KEY = originalKey;
  }
});

test("official bridge paginates up to ten thousand accounts", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "official-tiktok-pages-"));
  const cursors = [];
  const service = createOfficialTikTokAnalyticsService({
    workDir,
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      cursors.push(parsed.searchParams.get("cursor") || "");
      if (!parsed.searchParams.get("cursor")) return jsonResponse({ accounts: [{ schema: "one" }], hasMore: true, nextCursor: "cursor-1" });
      return jsonResponse({ accounts: [{ schema: "two" }], hasMore: false, nextCursor: "" });
    },
  });
  service.saveSettings({ baseUrl: "https://tiktokaitool.com", apiKey: "bridge-secret" });
  const result = await service.listAccounts();
  assert.deepEqual(result.accounts.map((item) => item.schema), ["one", "two"]);
  assert.deepEqual(cursors, ["", "cursor-1"]);
});

test("official bridge exposes remote request failures without a legacy fallback", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "official-tiktok-"));
  const service = createOfficialTikTokAnalyticsService({
    workDir,
    fetchImpl: async () => jsonResponse({ error: "Unavailable" }, 503),
  });
  service.saveSettings({ baseUrl: "https://tiktokaitool.com", apiKey: "bridge-secret" });
  await assert.rejects(
    () => service.listAccounts(),
    (error) => error.status === 503 && error.message === "Unavailable",
  );
});

test("official bridge lists publish accounts, uploads an asset, and creates a batch", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "official-tiktok-publish-"));
  const videoPath = path.join(workDir, "sample.mp4");
  fs.writeFileSync(videoPath, Buffer.from("sample-video"));
  const requests = [];
  const service = createOfficialTikTokAnalyticsService({
    workDir,
    fetchImpl: async (url, options = {}) => {
      const parsed = new URL(url);
      requests.push({ pathname: parsed.pathname, options });
      assert.equal(options.headers.Authorization, "Bearer publish-secret");
      if (parsed.pathname === "/api/v1/accounts") {
        return jsonResponse({ accounts: [{ connectionId: "connection-1", displayName: "Demo" }] });
      }
      if (parsed.pathname === "/api/v1/publish/assets") {
        let uploadedBytes = 0;
        for await (const chunk of options.body) uploadedBytes += chunk.length;
        assert.equal(uploadedBytes, fs.statSync(videoPath).size);
        assert.equal(options.headers["Content-Type"], "video/mp4");
        assert.equal(decodeURIComponent(options.headers["X-File-Name"]), "sample.mp4");
        return jsonResponse({ assetKey: "tmp/sample.mp4", fileSize: uploadedBytes, contentType: "video/mp4" });
      }
      if (parsed.pathname === "/api/v1/publish/batches") {
        const payload = JSON.parse(options.body);
        assert.equal(payload.items[0].connectionId, "connection-1");
        assert.equal(payload.items[0].assetKey, "tmp/sample.mp4");
        return jsonResponse({ batch: { id: "batch-1", taskCount: 1 } }, 201);
      }
      return jsonResponse({ error: "Not found" }, 404);
    },
  });

  service.saveSettings({ baseUrl: "https://tiktokaitool.com", apiKey: "publish-secret" });
  const accounts = await service.listPublishAccounts();
  assert.equal(accounts.accounts[0].connectionId, "connection-1");
  const asset = await service.uploadPublishAsset({ filePath: videoPath, fileName: "sample.mp4" });
  const batch = await service.createPublishBatch({
    items: [{ connectionId: "connection-1", assetKey: asset.assetKey }],
  });
  assert.equal(batch.batch.id, "batch-1");
  assert.deepEqual(requests.map((request) => request.pathname), [
    "/api/v1/accounts",
    "/api/v1/publish/assets",
    "/api/v1/publish/batches",
  ]);
});

test("official bridge gets one stored video detail by account and video id", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "official-tiktok-video-detail-"));
  const service = createOfficialTikTokAnalyticsService({
    workDir,
    fetchImpl: async (url, options = {}) => {
      const parsed = new URL(url);
      assert.equal(parsed.pathname, "/api/integrations/local-factory/videos/700000000000000001");
      assert.equal(parsed.searchParams.get("accountId"), "tiktok:connection-1");
      assert.equal(options.headers.Authorization, "Bearer bridge-secret");
      return jsonResponse({ video: { id: "700000000000000001", views: 100 } });
    },
  });
  service.saveSettings({ baseUrl: "https://tiktokaitool.com", apiKey: "bridge-secret" });

  const result = await service.getVideo({ accountId: "tiktok:connection-1", videoId: "700000000000000001" });

  assert.equal(result.video.views, 100);
});

test("official bridge retries transient upload failures with a fresh file stream", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "official-tiktok-upload-retry-"));
  const videoPath = path.join(workDir, "sample.mp4");
  fs.writeFileSync(videoPath, Buffer.from("retryable-video"));
  const bodies = [];
  let calls = 0;
  const service = createOfficialTikTokAnalyticsService({
    workDir,
    networkRetryDelays: [0, 0],
    sleep: async () => {},
    fetchImpl: async (url, options = {}) => {
      assert.equal(new URL(url).pathname, "/api/v1/publish/assets");
      calls += 1;
      bodies.push(options.body);
      if (calls < 3) {
        throw new TypeError("fetch failed", { cause: { code: "ECONNRESET", message: "socket closed" } });
      }
      let uploadedBytes = 0;
      for await (const chunk of options.body) uploadedBytes += chunk.length;
      return jsonResponse({ assetKey: "tmp/retried.mp4", fileSize: uploadedBytes, contentType: "video/mp4" });
    },
  });
  service.saveSettings({ baseUrl: "https://tiktokaitool.com", apiKey: "publish-secret" });

  const asset = await service.uploadPublishAsset({ filePath: videoPath, fileName: "sample.mp4" });

  assert.equal(asset.assetKey, "tmp/retried.mp4");
  assert.equal(calls, 3);
  assert.equal(new Set(bodies).size, 3);
});

test("official bridge reports the failed publishing stage and network cause", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "official-tiktok-upload-error-"));
  const videoPath = path.join(workDir, "sample.mp4");
  fs.writeFileSync(videoPath, Buffer.from("failed-video"));
  const service = createOfficialTikTokAnalyticsService({
    workDir,
    networkRetryDelays: [0, 0],
    sleep: async () => {},
    fetchImpl: async () => {
      throw new TypeError("fetch failed", { cause: { code: "ECONNRESET", message: "socket closed" } });
    },
  });
  service.saveSettings({ baseUrl: "https://tiktokaitool.com", apiKey: "publish-secret" });

  await assert.rejects(
    () => service.uploadPublishAsset({ filePath: videoPath, fileName: "sample.mp4" }),
    (error) => error.status === 502
      && /上传 TikTok 发布素材网络失败/.test(error.message)
      && /ECONNRESET/.test(error.message)
      && /已尝试 3 次/.test(error.message),
  );
});

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}
