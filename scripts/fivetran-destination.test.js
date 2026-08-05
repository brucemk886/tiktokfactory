import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFivetranDestinationService, summarizeOperationSignals } from "./fivetran-destination.js";

test("summarizes retention and distribution conflicts without raw comments", () => {
  const result = summarizeOperationSignals([{
    schema: "tiktok_organic_demo",
    username: "@Demo",
    videos: [
      {
        id: "10101",
        duration: 20,
        views: 2_000,
        reach: 1_500,
        likes: 120,
        comments: 8,
        shares: 5,
        averageTimeWatched: 4,
        fullWatchRate: 12,
        retention: [{ second: 0, percentage: 100 }, { second: 3, percentage: 35 }, { second: 5, percentage: 25 }],
        engagementLikes: [{ second: 3, percentage: 15 }],
        impressionSources: [{ impressionSource: "For You", percentage: 90 }],
        audienceGender: [{ gender: "Female", percentage: 64 }]
      },
      {
        id: "20202",
        duration: 20,
        views: 100,
        averageTimeWatched: 9,
        fullWatchRate: 0.3,
        retention: [{ second: 0, percentage: 1 }, { second: 3, percentage: 0.72 }, { second: 5, percentage: 0.6 }],
        impressionSources: [{ impressionSource: "Search", percentage: 0.2 }]
      }
    ]
  }], { days: 10, requestedAccountCount: 1, generatedAt: 1234 });

  assert.equal(result.summary.detailedVideoCount, 2);
  assert.equal(result.summary.conflictCount, 2);
  assert.equal(result.accounts[0].username, "demo");
  assert.equal(result.accounts[0].videos[0].forYouRate, 0.9);
  assert.equal(result.accounts[0].videos[0].retentionCurve.length, 3);
  assert.equal(result.accounts[0].videos[0].retentionCurve[1].second, 3);
  assert.equal(result.accounts[0].videos[0].likeCurve[0].percentage, 0.15);
  assert.equal(result.accounts[0].videos[0].reach, 1_500);
  assert.equal(result.accounts[0].videos[0].comments, 8);
  assert.equal(result.accounts[0].videos[0].audienceGender[0].label, "Female");
  assert.equal(result.accounts[0].videos[0].conflict, "high_distribution_weak_retention");
  assert.equal(result.accounts[0].videos[1].conflict, "low_distribution_strong_retention");
  assert.equal("rawComments" in result.accounts[0].videos[0], false);
});

test("destination settings keep the password private and preserve blank updates", () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fivetran-destination-"));
  const service = createFivetranDestinationService({ workDir, PoolClass: FakePool, now: () => 1234 });

  const first = service.saveSettings({
    host: "db.example.com",
    port: 5432,
    database: "warehouse",
    user: "reader",
    password: "private-password",
    ssl: true
  });
  assert.equal(first.configured, true);
  assert.equal(first.hasPassword, true);
  assert.equal("password" in first, false);

  const second = service.saveSettings({ host: "pooler.example.com", password: "" });
  assert.equal(second.host, "pooler.example.com");
  assert.equal(second.hasPassword, true);

  const stored = JSON.parse(fs.readFileSync(path.join(workDir, "fivetran-destination-settings.json"), "utf8"));
  assert.equal(stored.password, "private-password");
});

test("discover only returns TikTok-shaped schemas and exact table counts", async () => {
  FakePool.handler = async (sql) => {
    if (sql.includes("information_schema.columns")) {
      return { rows: [
        { table_schema: "plain_app", table_name: "notes", column_name: "id", data_type: "bigint" },
        { table_schema: "tiktok_organic_demo", table_name: "profile", column_name: "username", data_type: "character varying" },
        { table_schema: "tiktok_organic_demo", table_name: "video", column_name: "id", data_type: "bigint" }
      ] };
    }
    if (sql.includes('"tiktok_organic_demo"."profile"')) return { rows: [{ count: 1 }] };
    if (sql.includes('"tiktok_organic_demo"."video"')) return { rows: [{ count: 12 }] };
    return { rows: [] };
  };
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fivetran-destination-"));
  const service = createFivetranDestinationService({ workDir, PoolClass: FakePool });
  service.saveSettings({ host: "db.example.com", database: "warehouse", user: "reader", password: "secret" });

  const result = await service.discover();
  assert.equal(result.schemas.length, 1);
  assert.equal(result.schemas[0].name, "tiktok_organic_demo");
  assert.equal(result.schemas[0].profileCount, 1);
  assert.equal(result.schemas[0].videoCount, 12);
});

test("database failures are sanitized before reaching the browser", async () => {
  FakePool.connectError = Object.assign(new Error("password private-password failed"), { code: "28P01" });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fivetran-destination-"));
  const service = createFivetranDestinationService({ workDir, PoolClass: FakePool });
  service.saveSettings({ host: "db.example.com", database: "warehouse", user: "reader", password: "private-password" });

  await assert.rejects(service.testConnection(), (error) => {
    assert.equal(error.statusCode, 502);
    assert.match(error.message, /authentication failed/i);
    assert.doesNotMatch(error.message, /private-password/);
    return true;
  });
  FakePool.connectError = null;
});

test("single-video detail returns private metrics for one exact video ID", async () => {
  FakePool.handler = async (sql, params) => {
    if (sql.includes("information_schema.columns")) {
      const tables = [
        "profile", "video", "video_view_retention", "video_engagement_like",
        "video_impression_source", "video_audience_gender", "video_audience_country",
        "video_audience_city", "video_audience_type", "comment"
      ];
      return { rows: tables.flatMap((table) => [
        { table_schema: "tiktok_organic_demo", table_name: table, column_name: table === "profile" ? "username" : "video_id", data_type: "bigint" }
      ]) };
    }
    if (sql.includes('from "tiktok_organic_demo"."video"') && sql.includes("id = $1::bigint")) {
      assert.deepEqual(params, ["765432109876543210"]);
      return { rows: [{ id: "765432109876543210", caption: "Demo video", video_views: 321, video_duration: 20, average_time_watched: 8.5, full_video_watched_rate: 0.22 }] };
    }
    if (sql.includes('from "tiktok_organic_demo"."profile"')) return { rows: [{ username: "demo", display_name: "Demo" }] };
    if (sql.includes('"video_view_retention"')) return { rows: [{ video_id: "765432109876543210", second: 0, percentage: 1 }, { video_id: "765432109876543210", second: 3, percentage: 0.72 }] };
    if (sql.includes('"video_engagement_like"')) return { rows: [{ video_id: "765432109876543210", second: 3, percentage: 0.15 }] };
    if (sql.includes('"video_impression_source"')) return { rows: [{ video_id: "765432109876543210", impression_source: "For You", percentage: 0.91 }] };
    if (sql.includes('"video_audience_gender"')) return { rows: [{ video_id: "765432109876543210", gender: "Female", percentage: 0.64 }] };
    if (sql.includes('"video_audience_country"')) return { rows: [{ video_id: "765432109876543210", country: "US", percentage: 0.4 }] };
    if (sql.includes('"video_audience_city"')) return { rows: [{ video_id: "765432109876543210", city_name: "New York", percentage: 0.12 }] };
    if (sql.includes('"video_audience_type"')) return { rows: [{ video_id: "765432109876543210", type: "New viewers", percentage: 0.7 }] };
    if (sql.includes('from "tiktok_organic_demo"."comment"')) return { rows: [{ id: "99", username: "viewer", text: "Useful", likes: 4, create_time: 1_700_000_000 }] };
    return { rows: [] };
  };
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fivetran-destination-"));
  const service = createFivetranDestinationService({ workDir, PoolClass: FakePool });
  service.saveSettings({ host: "db.example.com", database: "warehouse", user: "reader", password: "secret" });

  const result = await service.getVideoDetail({ schema: "tiktok_organic_demo", videoId: "765432109876543210" });
  assert.equal(result.profile.username, "demo");
  assert.equal(result.video.views, 321);
  assert.equal(result.video.retention[1].percentage, 0.72);
  assert.equal(result.video.impressionSources[0].impressionSource, "For You");
  assert.equal(result.video.audienceCity[0].cityName, "New York");
  assert.equal(result.comments[0].text, "Useful");
});

test("single-video detail rejects non-numeric video IDs", async () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fivetran-destination-"));
  const service = createFivetranDestinationService({ workDir, PoolClass: FakePool });
  service.saveSettings({ host: "db.example.com", database: "warehouse", user: "reader", password: "secret" });
  await assert.rejects(service.getVideoDetail({ schema: "tiktok_organic_demo", videoId: "123 or 1=1" }), /valid numeric TikTok video ID/i);
});

class FakePool {
  static handler = async () => ({ rows: [] });
  static connectError = null;

  constructor(config) {
    this.config = config;
  }

  async connect() {
    if (FakePool.connectError) throw FakePool.connectError;
    return {
      query: async (sql, params) => FakePool.handler(String(sql), params),
      release() {}
    };
  }

  async end() {}
}
