import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, "public", name), "utf8");
const listHtml = read("official-analytics.html");
const listScript = read("official-analytics.js");
const accountHtml = read("official-account-detail.html");
const accountScript = read("official-account-detail.js");
const videosHtml = read("official-account-videos.html");
const videosScript = read("official-account-videos.js");
const videoHtml = read("official-video-detail.html");
const videoScript = read("official-video-detail.js");
const sharedScript = read("official-analytics-shared.js");
const accessScript = read("access.js");

test("authorized accounts is a focused list page", () => {
  assert.match(listHtml, /<h1 id="pageTitle">授权账号<\/h1>/);
  assert.match(listHtml, /账号列表/);
  assert.doesNotMatch(listHtml, /id="accountChart"|id="videoRows"|id="videoChart"/);
  assert.match(listScript, /official-account-detail\?account=/);
  assert.match(listScript, /official-account-videos\?account=/);
});

test("account detail owns metrics, audience insights and playback history", () => {
  assert.match(accountHtml, /<h1>账号详情<\/h1>/);
  assert.match(accountHtml, /id="accountChart"/);
  assert.match(accountHtml, /id="accountDaysFilter"/);
  for (const id of ["genderDistribution", "ageDistribution", "countryDistribution", "cityDistribution", "activityDistribution"]) {
    assert.match(accountHtml, new RegExp(`id="${id}"`));
  }
  assert.match(accountScript, /official-account-videos\?account=/);
  assert.match(accountScript, /accountHistory/);
  assert.match(accountScript, /renderDistribution/);
});

test("account videos and video analytics are separate rich pages", () => {
  assert.match(videosHtml, /id="videoRows"/);
  assert.doesNotMatch(videosHtml, /id="videoChart"/);
  assert.match(videosScript, /official-video-detail\?account=/);
  assert.match(videosScript, /totalTimeWatched/);
  assert.match(videosScript, /fullWatchRate/);
  assert.match(videosScript, /sortKey:\s*"views"/);
  assert.match(videosHtml, /data-sort="createTime"/);
  assert.match(videosHtml, /data-sort="views"/);
  assert.match(videoHtml, /<h1>视频留存分析<\/h1>/);
  for (const id of ["retentionChart", "sourceDistribution", "videoCountryDistribution", "videoComments"]) {
    assert.match(videoHtml, new RegExp(`id="${id}"`));
  }
  for (const id of ["videoChart", "videoMetrics", "videoGenderDistribution", "videoCityDistribution", "audienceTypeDistribution", "otherAnalytics"]) {
    assert.doesNotMatch(videoHtml, new RegExp(`id="${id}"`));
  }
  assert.match(videoScript, /renderComments/);
  assert.match(videoScript, /trafficSources:\s*true/);
  assert.match(videoScript, /drawRetention/);
});

test("all official subpages remain under the authorized-account sidebar item", () => {
  assert.match(accessScript, /official-account-detail/);
  assert.match(accessScript, /official-account-videos/);
  assert.match(accessScript, /official-video-detail/);
  assert.match(accessScript, /return "\/official-analytics"/);
});

test("split views do not expose the local archive path", () => {
  for (const source of [listHtml, accountHtml, videosHtml, videoHtml]) {
    assert.doesNotMatch(source, /archiveDir|official-history\.sqlite|长期历史数据库|D:\\localcodex/);
  }
});

test("a single snapshot is not rendered as a misleading area chart", () => {
  assert.match(sharedScript, /rows\.length\s*<\s*2/);
  assert.match(sharedScript, /形成第二个快照后展示变化曲线/);
});

test("official video detail exposes online-equivalent analytics", () => {
  assert.match(sharedScript, /function drawRetention/);
  assert.match(sharedScript, /function renderDistribution/);
  assert.match(sharedScript, /Direct Message/);
  assert.match(sharedScript, /Personal Profile/);
  for (const field of ["impressionSources", "audienceCountry", "commentList", "videoViewRetention"]) {
    assert.match(videoScript, new RegExp(field));
  }
});
