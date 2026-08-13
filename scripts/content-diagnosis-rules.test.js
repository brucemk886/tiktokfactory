import test from "node:test";
import assert from "node:assert/strict";
import { buildContentRuleDiagnostics } from "./content-diagnosis-rules.js";

const NOW = new Date("2026-08-10T08:00:00+08:00").getTime();

test("rule v1 maps a TikTok video to its local script and gates evidence-based rewrites", () => {
  const result = buildContentRuleDiagnostics({
    generatedAt: NOW,
    matchedVideos: [{
      id: "video-weak",
      local: { recordId: "publish-1", fileName: "render-1.mp4", audioName: "Opening A.mp3" }
    }],
    scriptLibrary: [{
      id: "audio-opening-a",
      title: "Opening A",
      fileName: "Opening A.mp3",
      script: "The police called before sunrise. My missing sister had used my identity. I had three minutes to expose her.",
      performance: { sampleCount: 2, low200Rate: 50 }
    }],
    privateAnalytics: {
      accounts: [{
        username: "demo",
        videos: [
          video("video-good", { views: 1200, retentionAt3: 0.72, retentionAt10: 0.51, averageWatchRatio: 0.48 }),
          video("video-weak", {
            views: 900,
            retentionAt3: 0.42,
            retentionAt10: 0.18,
            averageWatchRatio: 0.28,
            largestRetentionDrop: 0.12,
            largestRetentionDropSecond: 8
          })
        ]
      }]
    }
  });

  const weak = result.videos.find((item) => item.videoId === "video-weak");
  assert.equal(result.version, "novel-content-v1");
  assert.equal(weak.sampleStatus, "eligible");
  assert.equal(weak.decision, "rewrite_test");
  assert.equal(weak.rewriteEligible, true);
  assert.equal(weak.mapping.sourceAudioId, "audio-opening-a");
  assert.equal(weak.mapping.sentenceTimingMode, "estimated_from_script_character_share_v1");
  assert.ok(weak.rules.some((item) => item.code === "opening_loss_over_30pp"));
  assert.ok(weak.rules.some((item) => item.code === "rapid_loss_3_to_10"));
  assert.ok(weak.largestDropSentence?.text);
});

test("rule v1 includes immature and low-view samples in all statistics", () => {
  const result = buildContentRuleDiagnostics({
    generatedAt: NOW,
    privateAnalytics: {
      accounts: [{
        username: "demo",
        videos: [video("new-low", {
          views: 80,
          createdAt: Math.floor((NOW - 3_600_000) / 1000),
          retentionAt3: 0.2,
          averageWatchRatio: 0.1
        })]
      }]
    }
  });
  assert.equal(result.thresholds.sampleFilteringEnabled, false);
  assert.equal(result.thresholds.minimumViews, 0);
  assert.equal(result.thresholds.minimumPublishedHours, 0);
  assert.equal(result.videos[0].sampleStatus, "eligible");
  assert.equal(result.videos[0].sampleMaturity, "early");
  assert.deepEqual(result.videos[0].sampleWarnings, ["published_under_24h", "views_under_200"]);
  assert.equal(result.videos[0].baseline.sampleCount, 1);
  assert.equal(result.videos[0].decision, "rewrite_test");
  assert.equal(result.videos[0].rewriteEligible, false);
});

test("rule v1 separates distribution weakness from content weakness", () => {
  const result = buildContentRuleDiagnostics({
    generatedAt: NOW,
    privateAnalytics: {
      accounts: [{
        username: "demo",
        videos: [
          video("peer-a", { views: 1000, retentionAt3: 0.7, retentionAt10: 0.58, averageWatchRatio: 0.5 }),
          video("peer-b", { views: 900, retentionAt3: 0.68, retentionAt10: 0.56, averageWatchRatio: 0.48 }),
          video("low-distribution", { views: 220, retentionAt3: 0.75, retentionAt10: 0.62, averageWatchRatio: 0.52 })
        ]
      }]
    }
  });
  const item = result.videos.find((video) => video.videoId === "low-distribution");
  assert.equal(item.decision, "adjust_distribution");
  assert.equal(item.rewriteEligible, false);
});

function video(id, overrides = {}) {
  return {
    videoId: id,
    caption: id,
    createdAt: Math.floor((NOW - 48 * 3_600_000) / 1000),
    duration: 30,
    views: 500,
    retentionAt3: 0.7,
    retentionAt5: 0.62,
    retentionAt10: 0.5,
    averageWatchRatio: 0.45,
    fullWatchRate: 0.25,
    largestRetentionDrop: 0.03,
    largestRetentionDropSecond: 4,
    retentionCurve: [{ second: 0, percentage: 1 }, { second: 3, percentage: overrides.retentionAt3 ?? 0.7 }],
    ...overrides
  };
}
