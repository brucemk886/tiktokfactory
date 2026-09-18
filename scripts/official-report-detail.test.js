import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { scopedAnalyticsAccounts } from "../factory-cloud/src/official.js";
import { ensureModuleProjects } from "./official-account-group-store.js";

const read = (name) => fs.readFileSync(new URL("../public/" + name, import.meta.url), "utf8");
function browser(url, fetch) {
  const nodes = new Map();
  const node = (key) => {
    if (!nodes.has(key)) nodes.set(key, {
      innerHTML: "", textContent: "", value: "", hidden: false, events: {},
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(key, value) { this[key] = value; },
      addEventListener(key, fn) { this.events[key] = fn; },
      querySelectorAll() { return []; }, focus() {}, scrollIntoView() {},
    });
    return nodes.get(key);
  };
  const tabs = ["high", "low", "anomaly"].map((tab) => Object.assign(node(tab), { dataset: { resultTab: tab } }));
  const location = new URL(url);
  const document = { querySelector: node, querySelectorAll: (s) => s === "[data-result-tab]" ? tabs : [] };
  const context = vm.createContext({
    location, document, URL, URLSearchParams, window: {}, fetch,
    history: { replaceState(_state, _title, url) { location.href = String(url); } },
  });
  return { context, nodes, node, tabs, location };
}
const flush = () => new Promise(setImmediate);
const reply = (body, ok = true) => ({ ok, json: async () => body });

test("report tabs isolate panels, preserve date/group filters and encode video detail navigation", async () => {
  const report = { enabled: true, summary: {}, anomalyAccounts: [{ account: "acct", username: "tester", zero: 1, published: 1 }],
    buckets: {
      highView: [{ account: "acct", id: "12345678901", username: "tester", title: "high", views: 1200 }],
      lowView: [{ account: "acct", id: "12345678902", username: "tester", title: "low", views: 20 }],
      zeroView: [{ account: "acct", id: "12345678903", username: "tester", title: "<zero>", views: 0 }],
    } };
  let calls = 0;
  const b = browser("https://factory.test/psychology-effects?period=7d&group=g&tab=low", async () => {
    calls++;
    return reply({ project: { id: "p", name: "心理学", reportEnabled: true }, report });
  });
  vm.runInContext(read("official-group-report.js"), b.context);
  await flush();
  assert.equal(b.node("#lowSection").hidden, false);
  assert.equal(b.node("#highSection").hidden, true);
  assert.equal(b.tabs[1]["aria-selected"], "true");
  assert.match(b.node("#lowSection").innerHTML, /视频详情/);
  assert.match(b.node("#lowSection").innerHTML, /tab%3Dlow/);
  assert.match(b.node("#anomalySection").innerHTML, /tab%3Danomaly/);
  assert.match(b.node("#anomalySection").innerHTML, /<details/);
  assert.match(b.node("#anomalySection").innerHTML, /&lt;zero&gt;/);
  assert.equal(b.nodes.has("#zeroSection"), false);
  b.node("#groupSelect").value = "g";
  vm.runInContext("readFilters()", b.context);
  b.tabs[2].events.click();
  assert.equal(b.node("#anomalySection").hidden, false);
  assert.equal(b.node("#lowSection").hidden, true);
  assert.equal(calls, 1, "tab switching must not reload the report");
  assert.equal(b.location.searchParams.get("period"), "7d");
  assert.equal(b.location.searchParams.get("group"), "g");
  const href = vm.runInContext('videoDetailHref({account:"acct&1",id:"12345678903"})', b.context);
  const query = new URL(href, b.location).searchParams;
  assert.equal(query.get("account"), "acct&1");
  assert.equal(query.get("module"), "psychology");
  assert.match(query.get("returnTo"), /tab=anomaly/);
  b.tabs[2].events.keydown({ key: "ArrowLeft", preventDefault() {} });
  assert.equal(b.node("#lowSection").hidden, false);
  assert.equal(vm.runInContext("videoDetailHref({id:'123'})", b.context), "");
});

test("report HTML exposes exactly three panels without a duplicate zero-view section", () => {
  const html = read("official-group-report.html");
  assert.equal((html.match(/role="tab"/g) || []).length, 3);
  assert.equal((html.match(/role="tabpanel"/g) || []).length, 3);
  assert.doesNotMatch(html, /id="zeroSection"/);
});

async function detailBrowser({ failDetail = false, video = {}, back = "/psychology-effects?period=7d&group=g&tab=low" } = {}) {
  const queries = [];
  const b = browser("https://factory.test/official-video-detail?account=acct&video=12345678901&module=psychology&returnTo=" + encodeURIComponent(back), async (path) => {
    queries.push(new URL(path, "https://factory.test"));
    return path.startsWith("/api/official-analytics/video-detail")
      ? failDetail ? reply({ error: "temporarily unavailable" }, false) : reply({ video })
      : reply({ videos: [{ id: "12345678901", title: "Archived", analytics: { full_video_watched_rate: 0.25 }, ...video }] });
  });
  vm.runInContext(read("official-analytics-shared.js"), b.context);
  vm.runInContext("window.OfficialAnalytics.drawRetention = (_node, curve) => { window.curve = curve; }", b.context);
  vm.runInContext(read("official-video-detail.js"), b.context);
  await flush();
  return { ...b, queries };
}
test("video detail displays completion/watch metrics and passes retention through with project context", async () => {
  const b = await detailBrowser({ video: {
    id: "12345678901", title: "Live", views: 120, likes: 0,
    averageTimeWatched: 4.5, fullWatchRate: 0.4, retention: [{ second: 3, percentage: 0.8 }],
  } });
  assert.ok(b.queries.every(url => url.searchParams.get("module") === "psychology"));
  const metrics = b.node("#videoMetrics").innerHTML;
  assert.match(metrics, /完播率<\/span><strong>40%/);
  assert.match(metrics, /平均观看时长<\/span><strong>4.5秒/);
  assert.match(metrics, /点赞<\/span><strong>0</);
  assert.match(metrics, /视频时长<\/span><strong>暂无数据/);
  assert.equal(b.context.window.curve[0].percentage, 0.8);
  assert.equal(b.node("#backVideos").href, "/psychology-effects?period=7d&group=g&tab=low");
});
test("video detail falls back to archived private metrics and rejects external return URLs", async () => {
  const b = await detailBrowser({ failDetail: true, back: "https://outside.test/" });
  assert.match(b.node("#videoMetrics").innerHTML, /完播率<\/span><strong>25%/);
  assert.match(b.node("#detailNotice").textContent, /已归档数据/);
  assert.equal(b.node("#backVideos").href, "/official-account-videos?account=acct&module=psychology");
  assert.equal(vm.runInContext('mergeVideoDetail({views:12,analytics:{fullWatchRate:0.2}},{views:null,analytics:{fullWatchRate:null}}).analytics.fullWatchRate', b.context), 0.2);
});
test("analytics account scope rejects cross-project and unassigned operator accounts", () => {
  const store = ensureModuleProjects({});
  const psych = store.projects.find(p => p.moduleKey === "psychology");
  const novel = store.projects.find(p => p.moduleKey === "novel-promotion");
  store.groups = [{id:"g1",name:"Psych",projectId:psych.id},{id:"g2",name:"Novel",projectId:novel.id}];
  store.assignments = { a:"g1", b:"g2" };
  const accounts = [{schema:"a"},{schema:"b"},{schema:"unassigned"}];
  const admin = {role:"admin"};
  const operator = {role:"operator",allowedAccountGroups:["g1"]};
  assert.deepEqual(scopedAnalyticsAccounts(accounts,store,admin,"psychology").map(a=>a.schema), ["a"]);
  assert.deepEqual(scopedAnalyticsAccounts(accounts,store,operator,"psychology").map(a=>a.schema), ["a"]);
  assert.deepEqual(scopedAnalyticsAccounts(accounts,store,operator,"novel-promotion"), []);
  assert.deepEqual(scopedAnalyticsAccounts(accounts,store,admin,"invalid-module"), []);
});
