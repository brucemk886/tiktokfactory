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
  const periods = ["today", "yesterday", "7d", "30d", "range"].map(period => Object.assign(node("period-" + period), { dataset: { period } }));
  const location = new URL(url);
  const document = { querySelector: node, querySelectorAll: (s) => s === "[data-result-tab]" ? tabs : s === "#periodTabs [data-period]" ? periods : [] };
  const context = vm.createContext({
    location, document, URL, URLSearchParams, AbortController, window: {}, fetch,
    history: { replaceState(_state, _title, url) { location.href = String(url); } },
  });
  return { context, nodes, node, tabs, periods, location };
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
  assert.equal(calls, 3, "tab switching must not reload analytics, publishing or traffic");
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

test("normal videos remain below tabs, paginate by ten independently and expose detail/open links", async () => {
  const videos = Array.from({ length: 21 }, (_, i) => ({
    account: "acct", id: String(12345678901 + i), username: "tester", title: "Normal " + i, views: 403,
  }));
  const report = { enabled: true, summary: { midView: 21 }, buckets: { midView: videos } };
  const b = browser("https://factory.test/psychology-effects?tab=anomaly", async () => reply({
    project: { id: "p", reportEnabled: true }, report,
  }));
  const buttons = [2, 3].map(page => Object.assign(b.node("normal-page-" + page), { dataset: { page: String(page) } }));
  b.node("#normalSection").querySelectorAll = () => buttons;
  vm.runInContext(read("official-group-report.js"), b.context);
  await flush();
  const table = () => b.node("#normalSection").innerHTML;
  assert.equal((table().match(/class="report-video-title"/g) || []).length, 10);
  assert.match(table(), /每页 10 条 · 共 3 页 · 21 条/);
  assert.match(table(), /视频详情/);
  assert.match(table(), /打开/);
  assert.match(table(), /module=psychology/);
  assert.match(table(), /tab%3Danomaly/);
  assert.equal(b.node("#normalSection").hidden, false);
  buttons[0].events.click();
  assert.equal(vm.runInContext("state.pages.normal", b.context), 2);
  assert.equal(vm.runInContext("state.pages.high", b.context), 1);
  assert.match(table(), /Normal 10</);
  buttons[1].events.click();
  assert.equal((table().match(/class="report-video-title"/g) || []).length, 1);
  assert.match(table(), /Normal 20</);
  b.tabs[0].events.click();
  assert.equal(b.node("#normalSection").hidden, false);
  await vm.runInContext("loadReport()", b.context);
  assert.equal(vm.runInContext("state.pages.normal", b.context), 1);
  report.enabled = false;
  await vm.runInContext("loadReport()", b.context);
  assert.doesNotMatch(table(), /Normal 0</);
  assert.match(table(), /打开最上方的开关/);
  const html = read("official-group-report.html");
  assert.ok(html.indexOf('id="normalSection"') > html.indexOf('id="anomalySection"'));
});

test("legacy snapshots distinguish missing normal-video details from a genuinely empty bucket", async () => {
  const b = browser("https://factory.test/psychology-effects", async () => reply({
    project: { id: "p", reportEnabled: true },
    report: { enabled: true, summary: { midView: 2 }, buckets: {} },
  }));
  vm.runInContext(read("official-group-report.js"), b.context);
  await flush();
  assert.match(b.node("#normalSection").innerHTML, /历史快照未保存/);
  assert.doesNotMatch(b.node("#normalSection").innerHTML, /这一时段没有/);
});

test('overview renders analytics before delayed receipts and keeps unavailable values distinct from zero',async()=>{
 let release;
 const b=browser('https://factory.test/psychology-effects',async path=>{
  if(new URL(path,'https://factory.test').searchParams.get('view')==='publish')return new Promise(resolve=>{release=resolve;});
  return reply({project:{id:'p',reportEnabled:true},publishStatus:'pending',report:{enabled:true,summary:{published:11,views:1234},buckets:{highView:[{id:'12345678901',title:'visible before receipts',views:1234}]}}});
 });
 vm.runInContext(read('official-group-report.js'),b.context);await flush();
 assert.match(b.node('#highSection').innerHTML,/visible before receipts/);
 assert.match(b.node('#summaryGrid').innerHTML,/1,234/);
 assert.match(b.node('#publishOverview').innerHTML,/发布成功<\/dt><dd>—/);
 assert.match(b.node('#publishStatus').textContent,/读取中/);
 release(reply({publishStatus:'unavailable'}));await flush();
 assert.match(b.node('#publishStatus').textContent,/暂时不可用/);
 assert.match(b.node('#publishOverview').innerHTML,/发布失败<\/dt><dd>—/);
 assert.match(b.node('#highSection').innerHTML,/visible before receipts/);
});

test('changing filters aborts old requests and ignores late receipt results',async()=>{
 const pending=[],signals=[];
 const b=browser('https://factory.test/psychology-effects',async(path,options)=>{
  const q=new URL(path,'https://factory.test').searchParams;signals.push(options.signal);
  if(q.get('view')==='publish')return new Promise(resolve=>pending.push(resolve));
  const views=q.get('group')==='new'?222:111;
  return reply({project:{id:'p',reportEnabled:true},publishStatus:'pending',report:{enabled:true,summary:{views},buckets:{}}});
 });
 vm.runInContext(read('official-group-report.js'),b.context);await flush();
 vm.runInContext('state.groupId="new"; loadReport()',b.context);await flush();
 assert.equal(signals[0].aborted,true);assert.equal(pending.length,2);
 pending[1](reply({publishStatus:'ready',report:{summary:{publishTotal:22,publishSuccess:20,publishFailed:2,riskAccountCount:0}}}));await flush();
 pending[0](reply({publishStatus:'ready',report:{summary:{publishSuccess:999}}}));await flush();
 assert.equal(vm.runInContext('state.data.report.summary.publishSuccess',b.context),20);
 assert.equal(vm.runInContext('state.data.report.summary.views',b.context),222);
 assert.equal(b.node('#publishStatus').textContent,'');
});


test('traffic panel escapes names, paginates all accounts, preserves missing values and rejects stale responses',async()=>{
 let resolveOld;
 const b=browser('https://factory.test/psychology-effects?period=7d&group=old',async(path)=>{
  const query=new URL(path,'https://factory.test').searchParams;
  if(query.get('view')==='traffic')return new Promise(resolve=>{resolveOld=resolve;});
  return reply({project:{id:'p'},report:{enabled:false}});
 });
 vm.runInContext(read('official-group-report.js'),b.context);await flush();
 const traffic={fromKey:'2026-09-22',toKey:'2026-09-28',summary:{videoViews:0,profileViews:null,ratio:null,coveredAccounts:0,totalAccounts:12,pairedDays:0,pairedProfileViews:0,pairedVideoViews:0},accounts:Array.from({length:12},(_,i)=>({label:'<name>'+i,videoViews:null,profileViews:null,ratio:null,pairedDays:0,expectedDays:7,syncStatus:'pending'}))};
 b.context.trafficFixture=traffic;
 vm.runInContext('state.traffic=trafficFixture; renderTraffic()',b.context);
 let html=b.node('#trafficPanel').innerHTML;
 assert.match(html,/&lt;name&gt;0/);assert.doesNotMatch(html,/<name>/);assert.doesNotMatch(html,/&lt;name&gt;10/);assert.match(html,/第 1 \/ 2 页/);assert.match(html,/—/);
 vm.runInContext('state.trafficPage=2; renderTraffic(); reportRequest++',b.context);
 html=b.node('#trafficPanel').innerHTML;assert.match(html,/&lt;name&gt;10/);assert.doesNotMatch(html,/&lt;name&gt;0</);
 resolveOld(reply({report:{enabled:true},traffic:{...traffic,accounts:[]}}));await flush();
 assert.equal(b.node('#trafficPanel').innerHTML,html);
});


test('profile traffic summary follows total views and details start collapsed at the bottom',async()=>{
 const html=read('official-group-report.html');
 assert.match(html,/<details[^>]*id="trafficDetails"[^>]*hidden>/);
 assert.doesNotMatch(html,/<details[^>]*id="trafficDetails"[^>]* open/);
 assert.ok(html.indexOf('id="trafficDetails"')>html.indexOf('id="normalSection"'));
 const b=browser('https://factory.test/psychology-effects',async()=>reply({project:{},report:{enabled:false}}));
 vm.runInContext(read('official-group-report.js'),b.context);await flush();
 vm.runInContext('state.data={report:{enabled:true,summary:{views:500}}}; state.traffic={summary:{profileViews:17,ratio:0.0067}}; renderSummary()',b.context);
 const result=b.node('#summaryGrid').innerHTML;
 assert.ok(result.indexOf('总播放')<result.indexOf('主页访问次数'));
 assert.ok(result.indexOf('主页访问次数')<result.indexOf('主页访问比'));
 assert.doesNotMatch(result,/均播/);
 assert.match(b.node('#performanceOverview').innerHTML,/均播/);
 assert.equal((result.match(/class="metric"/g)||[]).length,4);
 assert.match(result,/0.67%/);assert.match(result,/>17</);
 vm.runInContext('state.traffic=null; renderSummary()',b.context);
 assert.doesNotMatch(b.node('#summaryGrid').innerHTML,/0.67%/);
});


test('psychology overview has no pool component, rendering or requests',async()=>{
 const queries=[],b=browser('https://factory.test/psychology-effects?period=7d&group=g',async path=>{
  const q=new URL(path,'https://factory.test').searchParams;queries.push(q);
  return reply({project:{id:'p',name:'心理学',reportEnabled:true},report:{enabled:true,summary:{views:123},buckets:{}}});
 });vm.runInContext(read('official-group-report.js'),b.context);await flush();
 assert.deepEqual(queries.map(q=>q.get('view')).sort(),['analytics','publish','traffic']);
 assert.ok(queries.every(q=>q.get('module')==='psychology'&&q.get('group')==='g'&&q.get('period')==='7d'));
 assert.equal(b.nodes.has('#matchingOverview'),false);assert.match(b.node('#summaryGrid').innerHTML,/>123</);
 assert.doesNotMatch(read('official-group-report.html'),/matchingOverview|账号池与内容池概览/);
 assert.doesNotMatch(read('official-group-report.js'),/loadMatchingOverview|renderMatchingOverview|账号池 × 内容池|q\.set\('view','pools'\)/);
 assert.doesNotMatch(read('official-group-report.css'),/matching-overview|matching-readiness|matchingOverview/);
 assert.match(b.node('#pageCopy').textContent,/发布、播放、互动与主页访问/);
});

test('psychology overview names its project scope and keeps the path authoritative over a spoofed module', async () => {
  const queries = [];
  const data = {
    project: { id: 'p', name: '心理学', reportEnabled: true },
    groups: [{ id: 'g', name: '心理组' }],
    scopes: [{ id: '', name: '全部项目' }, { id: 'g', name: '心理组' }],
    canSeeProjectTotal: true,
    report: { enabled: true, groupName: '全部项目', summary: {}, buckets: {} },
  };
  const b = browser('https://factory.test/psychology-effects?module=novel-promotion', async path => {
    const query = new URL(path, 'https://factory.test').searchParams;
    queries.push(query);
    return reply(data);
  });
  vm.runInContext(read('official-group-report.js'), b.context);
  await flush();
  assert.equal(queries.length, 3);
  assert.ok(queries.every(query => query.get('module') === 'psychology'));
  assert.match(b.node('#groupSelect').innerHTML, /value="" selected>心理学全部分组<\/option>/);
  assert.match(b.node('#groupSelect').innerHTML, /value="g">心理组<\/option>/);
  assert.doesNotMatch(b.node('#groupSelect').innerHTML, /全部项目/);
  assert.match(b.node('#reportMeta').textContent, /心理学全部分组/);
  assert.doesNotMatch(b.node('#reportMeta').textContent, /全部项目/);
  vm.runInContext('state.data.scopes = null; fillSelects(state.data)', b.context);
  assert.match(b.node('#groupSelect').innerHTML, /value="" selected>心理学全部分组<\/option>/);
});

test('psychology overview preserves selected group identities, labels and request scope', async () => {
  const queries = [];
  const data = {
    project: { id: 'p', name: '心理学', reportEnabled: true },
    groups: [{ id: 'g&1', name: '<心理组>' }],
    scopes: [{ id: '', name: '全部项目' }, { id: 'g&1', name: '<心理组>' }],
    report: { enabled: true, groupId: 'g&1', groupName: '<心理组>', summary: {}, buckets: {} },
  };
  const b = browser('https://factory.test/psychology-effects?module=mid-video&group=g%261', async path => {
    const query = new URL(path, 'https://factory.test').searchParams;
    queries.push(query);
    return reply(data);
  });
  b.node('#groupSelect').value = 'g&1';
  vm.runInContext(read('official-group-report.js'), b.context);
  await flush();
  assert.ok(queries.every(query => query.get('module') === 'psychology' && query.get('group') === 'g&1'));
  assert.match(b.node('#groupSelect').innerHTML, /value="g&amp;1" selected>&lt;心理组&gt;<\/option>/);
  assert.equal(vm.runInContext('state.groupId', b.context), 'g&1');
  assert.match(b.node('#reportMeta').textContent, /心理学 · <心理组>/);
  assert.equal(vm.runInContext('reportScopeName({groupName:"全部项目"}, state.data.groups)', b.context), '心理学 · <心理组>');
});

test('other report paths retain their module, project-wide labels and request views', async () => {
  for (const [path, module] of [['novel-ops-report', 'novel-promotion'], ['mid-video-ops-report', 'mid-video'], ['psychology-ops-report', 'psychology']]) {
    const queries = [];
    const b = browser('https://factory.test/' + path + '?module=invalid', async url => {
      queries.push(new URL(url, 'https://factory.test').searchParams);
      return reply({ project: { id: 'p', reportEnabled: true }, scopes: [{ id: '', name: '全部项目' }], report: { enabled: true, groupName: '全部项目', summary: {}, buckets: {} } });
    });
    vm.runInContext(read('official-group-report.js'), b.context);
    await flush();
    assert.ok(queries.every(query => query.get('module') === module));
    assert.deepEqual(queries.map(query => query.get('view')).sort(), ['analytics', 'publish']);
    assert.match(b.node('#groupSelect').innerHTML, /value="" selected>全部项目<\/option>/);
    assert.match(b.node('#reportMeta').textContent, /全部项目/);
    assert.equal(b.nodes.has('#matchingOverview'), false);
  }
});


test('compact psychology overview separates four core metrics, existing evidence and archived account coverage', async () => {
  const b = browser('https://factory.test/psychology-effects', async path => {
    const q = new URL(path, 'https://factory.test').searchParams;
    if (q.get('view') === 'traffic') return reply({ report: { enabled: true }, traffic: {
      fromKey: '2026-10-01', toKey: '2026-10-01', accounts: [],
      summary: { profileViews: 0, ratio: 0, videoViews: 500, coveredAccounts: 180, totalAccounts: 188, pairedDays: 180 },
    } });
    return reply({ project: { id: 'p', name: '<心理学>', reportEnabled: true }, groups: [{ id: 'g', name: '<Group>' }],
      publishStatus: 'ready', report: { enabled: true, summary: { published: 5, views: 7000, avgView: 1400, accountCount: 2,
      highView: 1, lowView: 2, zeroView: 0, midView: 2, anomalyAccountCount: 0,
      publishTotal: 8, publishSuccess: 7, publishFailed: 1, riskAccountCount: 0 }, buckets: { highView: [] } } });
  });
  vm.runInContext(read('official-group-report.js'), b.context); await flush();
  const core = b.node('#summaryGrid').innerHTML;
  assert.equal((core.match(/class="metric"/g) || []).length, 4);
  assert.match(core, /发布作品<\/span><strong>5/);
  assert.match(core, /总播放<\/span><strong>7,000/);
  assert.match(core, /主页访问次数<\/span><strong>0/);
  assert.match(core, /主页访问比<\/span><strong>0\.00%/);
  assert.doesNotMatch(core, /发布成功|发布失败|均播/);
  assert.match(b.node('#performanceOverview').innerHTML, /均播<\/dt><dd>1,400/);
  assert.match(b.node('#performanceOverview').innerHTML, /正常播放<\/dt><dd>2/);
  assert.match(b.node('#publishOverview').innerHTML, /发布总数<\/dt><dd>8/);
  assert.match(b.node('#publishOverview').innerHTML, /发布成功<\/dt><dd>7/);
  assert.equal(b.node('#overviewSecondary').hidden, false);
  assert.match(b.node('#groupPanel').innerHTML, /日报范围账号 188/);
  assert.match(b.node('#groupPanel').innerHTML, /&lt;心理学&gt;/);
  assert.match(b.node('#groupPanel').innerHTML, /&lt;Group&gt;/);
  assert.doesNotMatch(b.node('#groupPanel').innerHTML, /<Group>|<心理学>/);
  vm.runInContext('state.data.report.summary.views=null; state.data.report.summary.publishSuccess=null; state.data.report.summary.publishTotal=null; renderSummary()', b.context);
  assert.match(b.node('#summaryGrid').innerHTML, /总播放<\/span><strong>—/);
  assert.match(b.node('#publishOverview').innerHTML, /发布总数<\/dt><dd>—/);
  assert.match(b.node('#publishOverview').innerHTML, /发布成功<\/dt><dd>—/);
});

test('psychology custom dates preserve all three request scopes and video return navigation', async () => {
  const queries = [];
  const b = browser('https://factory.test/psychology-effects?period=range&from=2026-09-16&to=2026-09-18&group=g&tab=low', async path => {
    const q = new URL(path, 'https://factory.test').searchParams; queries.push(q);
    return reply({ project: { id: 'p', reportEnabled: true }, report: { enabled: true,
      period: 'range', fromKey: q.get('from'), toKey: q.get('to'), summary: {}, buckets: {} } });
  });
  b.node('#groupSelect').value = 'g';
  vm.runInContext(read('official-group-report.js'), b.context); await flush();
  assert.equal(b.node('#customRange').hidden, false);
  assert.equal(b.node('#effectsFromDate').value, '2026-09-16');
  assert.equal(b.node('#effectsToDate').value, '2026-09-18');
  assert.deepEqual(queries.map(q => q.get('view')).sort(), ['analytics', 'publish', 'traffic']);
  assert.ok(queries.every(q => q.get('from') === '2026-09-16' && q.get('to') === '2026-09-18' && q.get('group') === 'g' && q.get('module') === 'psychology'));
  const detail = new URL(vm.runInContext('videoDetailHref({account:"a",id:"12345678901"})', b.context), b.location);
  const back = new URL(detail.searchParams.get('returnTo'), b.location);
  assert.equal(back.searchParams.get('period'), 'range');
  assert.equal(back.searchParams.get('from'), '2026-09-16');
  assert.equal(back.searchParams.get('to'), '2026-09-18');
  assert.equal(back.searchParams.get('tab'), 'low');
  b.node('#effectsFromDate').value = '2026-09-20';
  b.node('#effectsToDate').value = '2026-09-19';
  b.node('#queryBtn').events.click(); await flush();
  assert.equal(queries.length, 3, 'invalid dates must not trigger any reads');
  assert.match(b.node('#reportMeta').textContent, /有效日期/);
  b.node('#effectsFromDate').value = '2026-09-17';
  b.node('#effectsToDate').value = '2026-09-19';
  b.node('#queryBtn').events.click(); await flush();
  assert.equal(queries.length, 6);
  assert.ok(queries.slice(3).every(q => q.get('from') === '2026-09-17' && q.get('to') === '2026-09-19'));
  assert.equal(b.location.searchParams.get('from'), '2026-09-17');
  assert.equal(b.location.searchParams.get('to'), '2026-09-19');
});

test('historical single-day psychology URLs survive preset-shaped API responses and range tab waits for query', async () => {
  const queries = [];
  const b = browser('https://factory.test/psychology-effects?date=2026-09-16', async path => {
    const q = new URL(path, 'https://factory.test').searchParams; queries.push(q);
    return reply({ project: { id: 'p', reportEnabled: true }, report: { enabled: true,
      period: 'today', fromKey: '2026-09-16', toKey: '2026-09-16', summary: {}, buckets: {} } });
  });
  vm.runInContext(read('official-group-report.js'), b.context); await flush();
  assert.ok(queries.every(q => q.get('from') === '2026-09-16' && q.get('to') === '2026-09-16'));
  assert.equal(vm.runInContext('state.fromKey', b.context), '2026-09-16');
  assert.equal(vm.runInContext('state.toKey', b.context), '2026-09-16');
  assert.equal(vm.runInContext('state.period', b.context), 'range');
  assert.match(b.node('#reportMeta').textContent, /自定日期 · 2026-09-16/);
  b.periods[4].events.click(); await flush();
  assert.equal(queries.length, 3);
});

test('psychology secondary panels clear on a new read and stay absent for other report routes', async () => {
  let unavailable = false;
  const b = browser('https://factory.test/psychology-effects', async () => unavailable
    ? reply({ error: 'failed' }, false)
    : reply({ project: { id: 'p', reportEnabled: true }, report: { enabled: true, summary: { views: 500 }, buckets: {} } }));
  vm.runInContext(read('official-group-report.js'), b.context); await flush();
  assert.equal(b.node('#overviewSecondary').hidden, false);
  unavailable = true;
  await vm.runInContext('loadReport()', b.context); await flush();
  assert.equal(b.node('#overviewSecondary').hidden, true);
  assert.equal(b.node('#publishOverview').innerHTML, '');
  assert.equal(b.node('#performanceOverview').innerHTML, '');
  assert.equal(b.node('#summaryGrid').innerHTML, '');
  const other = browser('https://factory.test/mid-video-ops-report', async () => reply({ project: { id: 'p', reportEnabled: true }, report: { enabled: true, summary: { publishSuccess: 0 }, buckets: {} } }));
  vm.runInContext(read('official-group-report.js'), other.context); await flush();
  assert.match(other.node('#summaryGrid').innerHTML, /发布成功<\/span><strong>0/);
  assert.equal(other.nodes.has('#overviewSecondary'), false);
  assert.equal(other.nodes.has('#customRange'), false);
  assert.match(read('official-group-report.css'), /\.lf-console\.psychology-effects-page #summaryGrid/);
});

test('existing backend analytics, publish and UTC traffic views honor the same authorized custom range', async t => {
  const [{ fixture }, { kvSet }, { upsertOfficialAccounts }, { buildModuleReport, loadGroupStore }] = await Promise.all([
    import('../factory-cloud/src/psychology-cloud-test-fixture.js'), import('../factory-cloud/src/kv.js'),
    import('../factory-cloud/src/official-archive-store.js'), import('../factory-cloud/src/official.js'),
  ]);
  const f = await fixture(t);
  f.env.ARCHIVE.put = async () => {};
  await kvSet(f.db, 'official-account-groups', {
    projects: [{ id: 'range-psych', moduleKey: 'psychology', name: 'Psychology', reportEnabled: true },
      { id: 'range-novel', moduleKey: 'novel-promotion', name: 'Novel', reportEnabled: true }],
    groups: [{ id: 'range-allowed', projectId: 'range-psych', name: 'Allowed' },
      { id: 'range-denied', projectId: 'range-psych', name: 'Denied' },
      { id: 'range-foreign', projectId: 'range-novel', name: 'Foreign project' }],
  });
  const ids = ['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000103'];
  f.sqlite.exec('DELETE FROM official_account_assignments');
  for (const [index, group] of ['range-allowed', 'range-denied', 'range-foreign'].entries()) {
    f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id) VALUES(?,?)').run(ids[index], group);
  }
  const millis = date => Date.parse(date + 'T10:00:00+08:00');
  await upsertOfficialAccounts(f.env, f.db, ids.map((id, index) => ({
    schema: 'tiktok:' + id, label: 'Range account ' + index, latestSyncAt: Date.now(),
    profile: { insights: { _daily_traffic: { status: 'ready', days: [
      { date: '2026-09-15', videoViews: 99999, profileViews: 9999 },
      { date: '2026-09-16', videoViews: 100, profileViews: 5 },
      { date: '2026-09-17', videoViews: 0, profileViews: 0 },
      { date: '2026-09-18', videoViews: 400, profileViews: null },
      { date: '2026-09-19', videoViews: 99999, profileViews: 9999 },
    ] } } },
    videos: [
      { id: id + '-before', createTime: millis('2026-09-15'), views: 99999 },
      { id: id + '-first', createTime: millis('2026-09-16'), views: index ? 99999 : 100 },
      { id: id + '-last', createTime: millis('2026-09-18'), views: index ? 99999 : 400 },
      { id: id + '-after', createTime: millis('2026-09-19'), views: 99999 },
    ],
  })));
  const receiptRequests = [];
  t.mock.method(globalThis, 'fetch', async (address, init = {}) => {
    const url = new URL(address);
    assert.equal(init.method || 'GET', 'GET', 'only mocked receipt reads are permitted');
    assert.equal(url.pathname, '/api/v1/publish/stats');
    assert.equal(url.searchParams.get('connectionIds'), ids[0]);
    assert.equal(Number(url.searchParams.get('from')), Date.parse('2026-09-16T00:00:00+08:00'));
    assert.equal(Number(url.searchParams.get('to')), Date.parse('2026-09-19T00:00:00+08:00'));
    receiptRequests.push(url);
    return Response.json({ total: 3, success: 2, failed: 1, riskAccounts: 0 });
  });
  const store = await loadGroupStore(f.db), user = { role: 'operator', allowedAccountGroups: ['range-allowed', 'range-foreign'] };
  const outputs = {};
  for (const view of ['analytics', 'publish', 'traffic']) {
    const query = new URLSearchParams({ module: 'psychology', view, period: 'range', from: '2026-09-16', to: '2026-09-18', group: 'range-allowed' });
    const before = f.sqlite.prepare('SELECT total_changes() n').get().n;
    outputs[view] = await buildModuleReport(f.env, f.db, store, query, user);
    assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n, before, 'custom range reads must not write report state');
    assert.equal(outputs[view].report.period, 'range');
    assert.equal(outputs[view].report.fromKey, '2026-09-16');
    assert.equal(outputs[view].report.toKey, '2026-09-18');
    assert.equal(outputs[view].report.groupId, 'range-allowed');
    query.set('group', 'range-denied');
    await assert.rejects(buildModuleReport(f.env, f.db, store, query, user), error => error.statusCode === 403);
  }
  assert.equal(outputs.analytics.report.summary.published, 2);
  assert.equal(outputs.analytics.report.summary.views, 500);
  assert.equal(outputs.analytics.report.summary.lowView, 1);
  assert.equal(outputs.analytics.report.summary.midView, 1);
  assert.deepEqual(outputs.publish.report.summary, { publishTotal: 3, publishSuccess: 2, publishFailed: 1, riskAccountCount: 0 });
  assert.equal(outputs.traffic.traffic.timezone, 'UTC');
  assert.equal(outputs.traffic.traffic.summary.totalAccounts, 1);
  assert.equal(outputs.traffic.traffic.summary.videoViews, 500);
  assert.equal(outputs.traffic.traffic.summary.profileViews, 5);
  assert.equal(outputs.traffic.traffic.summary.pairedDays, 2);
  assert.equal(outputs.traffic.traffic.summary.ratio, 0.05);
  assert.equal(receiptRequests.length, 1);
  assert.equal(f.requests.length, 0, 'no publication requests were created');
});

test('normalized psychology route uses the same compact layout and authoritative request module', async () => {
  const queries = [], b = browser('https://factory.test/psychology-effects/?module=novel-promotion', async path => {
    queries.push(new URL(path, 'https://factory.test').searchParams);
    return reply({ project: { id: 'p', reportEnabled: true }, report: { enabled: true, summary: { views: 0 }, buckets: {} } });
  });
  vm.runInContext(read('official-group-report.js'), b.context); await flush();
  assert.deepEqual(queries.map(query => query.get('view')).sort(), ['analytics', 'publish', 'traffic']);
  assert.ok(queries.every(query => query.get('module') === 'psychology'));
  assert.equal((b.node('#summaryGrid').innerHTML.match(/class="metric"/g) || []).length, 4);
  assert.match(b.node('#summaryGrid').innerHTML, /总播放<\/span><strong>0/);
  assert.equal(vm.runInContext('reportTitle()', b.context), '数据概览');
});
test('late receipt and traffic reads keep loaded project scope until a pending group filter is queried', async () => {
  const pending = [], signals = [];
  const b = browser('https://factory.test/psychology-effects?period=7d', async (path, options) => {
    const query = new URL(path, 'https://factory.test').searchParams;
    signals.push(options.signal);
    if (query.get('view') !== 'analytics') return new Promise(resolve => pending.push({ query, resolve }));
    return reply({ project: { id: 'p', name: '心理学', reportEnabled: true },
      groups: [{ id: 'new', name: 'New group' }],
      scopes: [{ id: '', name: '全部项目' }, { id: 'new', name: 'New group' }], publishStatus: 'pending',
      report: { enabled: true, groupId: query.get('group') || '', period: '7d', fromKey: query.get('from'), toKey: query.get('to'),
        summary: { published: 2, views: query.get('group') ? 200 : 100 }, buckets: {} } });
  });
  vm.runInContext(read('official-group-report.js'), b.context); await flush();
  const originalMeta = b.node('#reportMeta').textContent;
  b.node('#groupSelect').value = 'new';
  b.node('#groupSelect').events.change({ target: { value: 'new' } });
  b.periods[4].events.click();
  pending.find(item => item.query.get('view') === 'publish').resolve(reply({ publishStatus: 'ready', report: { summary: { publishTotal: 3, publishSuccess: 2, publishFailed: 1, riskAccountCount: 0 } } }));
  await flush();
  assert.match(b.node('#groupPanel').innerHTML, /心理学全部分组/);
  assert.doesNotMatch(b.node('#groupPanel').innerHTML, /心理学 · New group|分组日报范围账号/);
  pending.find(item => item.query.get('view') === 'traffic').resolve(reply({ report: { enabled: true }, traffic: {
    fromKey: '2026-09-25', toKey: '2026-10-01', accounts: [], summary: { totalAccounts: 188, coveredAccounts: 180,
      profileViews: 17, videoViews: 1000, ratio: 0.017, pairedDays: 180 },
  } }));
  await flush();
  assert.match(b.node('#groupPanel').innerHTML, /日报范围账号 188/);
  assert.doesNotMatch(b.node('#groupPanel').innerHTML, /心理学 · New group|分组日报范围账号/);
  assert.equal(b.node('#reportMeta').textContent, originalMeta);
  assert.match(vm.runInContext('rangeLabel(state.data.report)', b.context), /近7天/);
  b.node('#queryBtn').events.click(); await flush();
  assert.ok(signals.slice(0, 3).every(signal => signal.aborted));
  assert.match(b.node('#groupPanel').innerHTML, /心理学 · New group/);
  assert.match(b.node('#groupPanel').innerHTML, /分组日报范围账号/);
  assert.match(b.node('#summaryGrid').innerHTML, /总播放<\/span><strong>200/);
});

test('psychology-only toolbar content has an explicit gate against shared admin display rules', () => {
  const css = read('official-group-report.css');
  assert.match(css, /\.lf-console:not\(\.psychology-effects-page\) \.effects-only\{display:none!important\}/);
  assert.doesNotMatch(read('official-group-report.html'), /演示数据|设计预览|effects-preview-badge/);
  assert.doesNotMatch(read('official-group-report.js'), /demo-account|demo_psych/);
});