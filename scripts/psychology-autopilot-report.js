import { parseObject, publishOutcome } from './psychology-operations.js';
import { normalizeAccountKey } from './official-account-group-store.js';
const DAY=86400000;
export const AUTOPILOT_STRATEGIES={evolve:'A · 优胜放量',original:'B · 原版测试',rewrite:'C · 改写测试'};
const ms=v=>{if(!v)return 0;const n=Number(v);return Number.isFinite(n)?(n<1e12?n*1000:n):Date.parse(v)||0;};
const metric=(v,...keys)=>{const a=parseObject(v?.analytics);for(const k of keys){const n=v?.[k]??a[k];if(n!==undefined&&n!==null&&n!==''&&Number.isFinite(Number(n)))return Math.max(0,Number(n));}return null;};
const mean=a=>a.length?a.reduce((n,v)=>n+v,0)/a.length:null;
const median=a=>{if(!a.length)return null;const s=[...a].sort((a,b)=>a-b),i=Math.floor(s.length/2);return s.length%2?s[i]:(s[i-1]+s[i])/2;};
function summarize(rows){
 const metrics=[],seen=new Set();
 for(const r of rows)if(r.published&&r.views!==null&&!seen.has(r.account+'|'+r.videoId)){seen.add(r.account+'|'+r.videoId);metrics.push(r);}
 const values=metrics.map(r=>r.views);
 return {planned:rows.length,accounts:new Set(rows.map(r=>r.account)).size,published:rows.filter(r=>r.published).length,
  failed:rows.filter(r=>r.state==='failed').length,pending:rows.filter(r=>r.state==='pending').length,stopped:rows.filter(r=>r.state==='stopped').length,
  observing:rows.filter(r=>r.published&&r.time&&!r.mature).length,unknownAge:rows.filter(r=>r.published&&!r.time).length,
  synced:metrics.length,missingMetrics:rows.filter(r=>r.published&&r.views===null).length,
  views:values.length?values.reduce((a,b)=>a+b,0):null,averageViews:mean(values),medianViews:median(values),
  likes:sumMetric(metrics,'likes'),comments:sumMetric(metrics,'comments'),shares:sumMetric(metrics,'shares'),
  potentialRate:metrics.length?metrics.filter(r=>r.views>=1000).length/metrics.length:null,
  hitRate:metrics.length?metrics.filter(r=>r.views>=10000).length/metrics.length:null,
  original:rows.filter(r=>r.variant==='').length,rewrite:rows.filter(r=>r.variant).length,
  assessment:metrics.length<5?'已同步样本不足，继续积累':'按当前累计数据比较；不同发布时间的作品增长时长不同'};
}
function sumMetric(rows,key){const values=rows.map(r=>r[key]).filter(v=>v!==null);return values.length?values.reduce((a,b)=>a+b,0):null;}

// Execution is counted by each item's planned publication day, not batch creation
// or maturity. Strategy/group attribution comes from the persisted pilot-slot link.
export function buildAutopilotReport({items=[],records=[],accounts=[],videosByAccount=new Map(),window,media='photo',now=Date.now()}){
 const accountMap=new Map(accounts.map(a=>[normalizeAccountKey(a.schema||a.connectionId),a]));
 const recordMap=new Map(records.filter(r=>r.autoTaskId).map(r=>[r.autoTaskId,r]));
 const videos=new Map();for(const [account,list]of videosByAccount)for(const v of list)videos.set(normalizeAccountKey(account)+'|'+String(v.id||v.videoId),v);
 const rows=[],seen=new Set();
 for(const i of items){
  const account=normalizeAccountKey(i.connection_id),a=accountMap.get(account),scheduleAt=ms(i.schedule_at);
  if(!a||seen.has(i.id)||i.media_type!==media||scheduleAt<window.start||scheduleAt>=window.end)continue;
  seen.add(i.id);
  let record=parseObject(i.record_json);if(!record.autoTaskId)record=recordMap.get(i.id)||{};
  if(record.autoTaskId!==i.id||(record.autoBatchId&&record.autoBatchId!==i.batch_id)||(record.connectionId&&normalizeAccountKey(record.connectionId)!==account))record={};
  const videoId=String(record.videoId||record.tiktokVideoId||record.itemId||''),v=videoId?videos.get(account+'|'+videoId):null;
  const outcome=publishOutcome(record),published=outcome==='published'||Boolean(v),receipt=parseObject(i.receipt_json);
  const remoteFailure=outcome==='failed',localFailure=!record.batchId&&!receipt.batchId&&(i.status==='failed'||i.execution_status==='failed'||i.group_status==='failed');
  const state=published?'published':remoteFailure?'failed':i.deleted_at?'stopped':localFailure?'failed':'pending';
  const time=published?ms(v?.createTime||v?.createdAt||v?.create_time||record.officialPublishedAt||record.completedAt||record.publishedAt):0;
  rows.push({id:i.id,pilotId:i.pilot_id,groupId:i.group_id,groupName:i.group_name,strategy:i.strategy,account,videoId,scheduleAt,state,published,time,
   mature:Boolean(time&&now-time>=DAY),variant:i.variant_id??null,views:published?metric(v,'views','viewCount','view_count','playCount'):null,
   likes:metric(v,'likes','like_count','diggCount'),comments:metric(v,'comments','comment_count','commentCount'),shares:metric(v,'shares','share_count','shareCount')});
 }
 const groupMap=new Map();for(const r of rows){const key=r.pilotId+'|'+r.strategy;if(!groupMap.has(key))groupMap.set(key,{pilotId:r.pilotId,groupId:r.groupId,name:r.groupName,strategy:r.strategy,rows:[]});groupMap.get(key).rows.push(r);}
 const groups=[...groupMap.values()].map(({rows,...g})=>({...g,strategyLabel:AUTOPILOT_STRATEGIES[g.strategy]||'未记录策略',...summarize(rows)})).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
 const strategies=Object.entries(AUTOPILOT_STRATEGIES).map(([id,label])=>({id,label,groups:groups.filter(g=>g.strategy===id).length,...summarize(rows.filter(r=>r.strategy===id))}));
 return {summary:summarize(rows),groups,strategies,basis:'按计划发布时间统计自动运营任务；发布以回执为准。当天发布的作品有数据即可参与对比，不限制满24小时；缺失指标不记为0，播放为最近同步的累计值。'};
}
