import { shanghaiDateKey } from "./official-group-report.js";
const DAY = 86400000;
export const parseObject = value => { if (value && typeof value === "object") return value; try { return JSON.parse(value || "{}") || {}; } catch { return {}; } };
const millis = value => { const n = Number(value); return Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : Date.parse(value || "") || 0; };
const number = value => Math.max(0, Number(value) || 0);
export function operationsWindow(query, now = Date.now()) {
  const today = shanghaiDateKey(now);
  const preset = query.get("period") || "today";
  const to = preset === "custom" ? query.get("to") : today;
  const from = preset === "custom" ? query.get("from") : shanghaiDateKey(Date.parse(today + "T00:00:00+08:00") - (preset === "today" ? 0 : preset === "30d" ? 29 : 6) * DAY);
  const valid = key => /^\d{4}-\d{2}-\d{2}$/.test(key || "") && shanghaiDateKey(Date.parse(key + "T00:00:00+08:00")) === key;
  if (!["today", "7d", "30d", "custom"].includes(preset) || !valid(from) || !valid(to)) throw new Error("请选择有效日期。");
  const start = Date.parse(from + "T00:00:00+08:00"), end = Date.parse(to + "T00:00:00+08:00") + DAY;
  const days = (end - start) / DAY;
  if (days < 1 || days > 31 || to > today) throw new Error("请选择不超过31天、且不晚于今天的日期范围。");
  return { period: preset, from, to, start, end, days, previousStart: start - days * DAY,
    previousFrom: shanghaiDateKey(start - days * DAY), previousTo: shanghaiDateKey(start - DAY) };
}
export function mediaKind(item = {}) {
  const analytics = parseObject(item.analytics);
  const kind = String(item.mediaType || item.media_type || item.postType || item.post_type || analytics.media_type || "").toLowerCase();
  if (["photo", "image", "images", "photo_post"].includes(kind) || /\/photo\//.test(item.shareUrl || item.shareLink || "") || item.photoCount > 0) return "photo";
  if (kind === "video" || number(item.duration || item.videoDuration || analytics.duration) > 0 || /\.mp4(?:$|\?)/i.test(item.fileName || "")) return "video";
  return "unknown";
}
export function publishOutcome(record = {}) {
  const status = String(record.officialRemoteStatus || record.status || "").toLowerCase();
  if (["published", "publish_complete"].includes(status)) return "published";
  if (["failed", "rejected", "status_timeout", "needs_review", "canceled", "cancelled", "enqueue_failed"].includes(status)) return "failed";
  return "pending";
}
const ratio = (n, total) => total ? n / total : null;
function median(values) { if (!values.length) return null; const s = [...values].sort((a,b)=>a-b), m = Math.floor(s.length/2); return s.length%2 ? s[m] : (s[m-1]+s[m])/2; }
function summarize(videos, records) {
  const mature = videos.filter(v => !v.fresh);
  const published = records.filter(r => r.outcome === "published").length, failed = records.filter(r=>r.outcome==="failed").length;
  return { count: videos.length, fresh: videos.length-mature.length, sample: mature.length,
    views: videos.reduce((s,v)=>s+v.views,0), medianViews: median(mature.map(v=>v.views)),
    averageViews: mature.length ? mature.reduce((s,v)=>s+v.views,0)/mature.length : null,
    highRate: ratio(mature.filter(v=>v.views>=1000).length,mature.length),
    zeroRate: ratio(mature.filter(v=>v.views===0).length,mature.length),
    attempts: records.length, published, failed, pending: records.length-published-failed,
    successRate: ratio(published,published+failed), failureRate: ratio(failed,published+failed) };
}
function sameAccount(record, account) {
  const keys = [account.schema, account.connectionId, String(account.schema || "").replace(/^tiktok:/,""), account.username, account.profile?.username].filter(Boolean).map(v=>String(v).replace(/^@/,""));
  // Prefer the stable connection ID. Never fall through to a display name if it points elsewhere.
  const primary = record.connectionId || record.assignedEnvId || record.account;
  return primary ? keys.includes(String(primary).replace(/^@/,"")) : keys.includes(String(record.accountUsername || record.username || "").replace(/^@/,""));
}
export function buildOperationsReport({ window, accounts = [], videosByAccount = new Map(), records = [], items = [], media = "all", now = Date.now() }) {
  const inRange = (time, start=window.start) => time >= start && time < window.end;
  const recordMap = new Map();
  for (const raw of records) {
    const account = accounts.find(a=>sameAccount(raw,a));
    if (!account || !raw.id) continue;
    const record = { ...raw, account: account.schema, media: mediaKind(raw), time: millis(raw.createdAt || raw.publishedAt), outcome: publishOutcome(raw) };
    recordMap.set(String(raw.id),record);
  }
  const allRecords = [...recordMap.values()];
  const recordByVideo = new Map(allRecords.filter(r=>r.videoId||r.tiktokVideoId).map(r=>[r.account+"|"+(r.videoId||r.tiktokVideoId),r]));
  const allVideos = [];
  for (const account of accounts) {
    const seen = new Set();
    for (const raw of videosByAccount.get(account.schema) || []) {
      const id = String(raw.id || raw.videoId || "");
      if (!id || seen.has(id)) continue; seen.add(id);
      const time = millis(raw.createTime || raw.createdAt || raw.create_time);
      if (!inRange(time,window.previousStart)) continue;
      const record = recordByVideo.get(account.schema+"|"+id);
      const mediaType = mediaKind(raw) === "unknown" ? mediaKind(record) : mediaKind(raw);
      const username = String(account.profile?.username || account.username || "").replace(/^@/,"");
      const share = raw.shareUrl || raw.shareLink || raw.videoUrl || raw.url || (/^[\w.]+$/.test(username) && /^\d{10,}$/.test(id) ? "https://www.tiktok.com/@"+encodeURIComponent(username)+"/"+(mediaType==="photo"?"photo":"video")+"/"+id : "");
      allVideos.push({ id, account: account.schema, username: account.profile?.username || account.username || account.label || account.schema,
        title: String(raw.title || raw.caption || raw.description || "未命名作品"), time, views: number(raw.views ?? raw.playCount),
        media: mediaType, fresh: now-time<DAY, share: /^https:\/\/(?:www\.)?tiktok\.com\//i.test(share) ? share : "" });
    }
  }
  const matches = item => media === "all" || item.media === media;
  const currentVideos = allVideos.filter(v=>inRange(v.time) && matches(v));
  const currentRecords = allRecords.filter(r=>inRange(r.time) && matches(r));
  const previousVideos = allVideos.filter(v=>v.time>=window.previousStart && v.time<window.start && matches(v));
  const previousRecords = allRecords.filter(r=>r.time>=window.previousStart && r.time<window.start && matches(r));
  const daily = Array.from({length:window.days},(_,i)=>{
    const date = shanghaiDateKey(window.start+i*DAY);
    return {date,...summarize(currentVideos.filter(v=>shanghaiDateKey(v.time)===date),currentRecords.filter(r=>shanghaiDateKey(r.time)===date))};
  });
  const accountRows = accounts.map(account=>{
    const videos=currentVideos.filter(v=>v.account===account.schema), outcomes=currentRecords.filter(r=>r.account===account.schema);
    const stats=summarize(videos,outcomes);
    return { id:account.schema, name:account.profile?.username || account.username || account.label || account.schema,
      group:account.groupName || "", ...stats,
      hint:stats.failed ? "排查发布失败" : stats.sample<5 ? "样本不足，继续观察" : stats.zeroRate>=.5 ? "优先检查0播作品" : stats.highRate>=.2 ? "高播表现较好" : "持续观察",
      videos };
  }).filter(row=>row.count || row.attempts).sort((a,b)=>(b.medianViews??-1)-(a.medianViews??-1)||b.views-a.views);
  const batchMap=new Map();
  for(const item of items) {
    const account=accounts.find(a=>sameAccount({connectionId:item.connection_id},a));
    const config=parseObject(item.config_json), receipt=parseObject(item.receipt_json);
    const kind=mediaKind(config);
    if(!account || !inRange(Number(item.created_at)) || (media!=="all" && kind!==media)) continue;
    const record=allRecords.find(r=>r.account===account.schema && (
      (receipt.batchId && [r.batchId,...(r.officialBatchIds||[])].includes(receipt.batchId)) ||
      (item.id && [r.autoTaskId,r.taskId,r.jobId].includes(item.id)) || (item.job_id && [r.autoTaskId,r.taskId,r.jobId].includes(item.job_id))
    ));
    const outcome=record?.outcome;
    const submitted=Boolean(record || receipt.batchId || (!item.publish_group_id && item.type==="official-publish" && item.status==="done" && !item.publish_failed));
    const generated=submitted || item.type==="official-publish" || (kind==="video" && item.status==="done") || (kind==="photo" && item.type==="psychology" && item.status==="done");
    const failed=Boolean(outcome==="failed" || (!submitted && (item.status==="failed" || item.publish_failed)));
    const state=outcome==="published" ? "published" : failed ? "failed" : submitted ? "submitted" : generated ? "generated" : ["running","queued"].includes(item.status) ? item.status : "pending";
    if(!batchMap.has(item.batch_id)) batchMap.set(item.batch_id,{id:item.batch_id,name:String(config.name||"自动发布批次"),media:kind,template:String(config.template||""),createdAt:Number(item.created_at),planned:0,generated:0,submitted:0,published:0,failed:0,items:[]});
    const batch=batchMap.get(item.batch_id);
    batch.planned++;batch.generated+=Number(generated);batch.submitted+=Number(submitted);batch.published+=Number(state==="published");batch.failed+=Number(failed);
    const video=allVideos.find(v=>v.account===account.schema && v.id===String(record?.videoId||""));
    batch.items.push({id:item.id,account:account.schema,accountName:account.profile?.username||account.username||account.label,
      title:String(item.title||"待生成"),state,error:failed?String(record?.publishError||item.error||item.publish_error||"任务失败，暂无详细原因").slice(0,300):"",
      video:video||null});
  }
  const batches=[...batchMap.values()].sort((a,b)=>b.createdAt-a.createdAt);
  return {window, media, summary:summarize(currentVideos,currentRecords), previous:summarize(previousVideos,previousRecords),daily,
    accounts:accountRows,batches,unknownMedia:allVideos.filter(v=>v.media==="unknown"&&inRange(v.time)).length,
    unknownRecordMedia:allRecords.filter(r=>r.media==="unknown"&&inRange(r.time)).length,
    funnel:batches.reduce((s,b)=>{for(const key of Object.keys(s))s[key]+=b[key];return s;},{planned:0,generated:0,submitted:0,published:0,failed:0})};
}
