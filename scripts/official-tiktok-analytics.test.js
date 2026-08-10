import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOfficialTikTokAnalyticsService } from "./official-tiktok-analytics.js";

test("official bridge maps authorized accounts, videos, and private retention data", async () => {
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
        }] });
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
      if (parsed.pathname.includes("/videos/765432109876543210")) {
        return jsonResponse({ video: { id: "765432109876543210", retention: [{ second: 0, percentage: 1 }] } });
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

  const detail = await service.getVideoDetail({ schema: "tiktok:connection-1", videoId: "765432109876543210" });
  assert.equal(detail.video.retention[0].second, 0);

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

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}
