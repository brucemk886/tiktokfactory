import {parseObject,publishOutcome} from './psychology-operations.js';
const ms=v=>{const n=Number(v);return Number.isFinite(n)&&n>0?(n<1e12?n*1000:n):Date.parse(v||'')||0;};
const metric=(v,...keys)=>{const a=parseObject(v?.analytics);for(const key of keys){const x=v?.[key]??a[key];if(x!==undefined&&x!==null&&x!==''&&Number.isFinite(Number(x)))return Number(x);}return null;};
// Share of viewers still watching at `second`, read from TikTok's per-second
// retention curve (points may be 0-1 or 0-100). Null when the curve is too short.
export function retentionAt(curve,second=3){
 const raw=parseObject(curve),list=Array.isArray(curve)?curve:Array.isArray(raw)?raw:Object.entries(raw).map(([s,p])=>({second:s,percentage:p}));
 const points=list.map((p,i)=>({s:Number(typeof p==='number'?i:p?.second??i),p:Number(typeof p==='number'?p:p?.percentage)})).filter(p=>Number.isFinite(p.s)&&Number.isFinite(p.p)).sort((a,b)=>a.s-b.s);
 if(!points.length||points[points.length-1].s<second)return null;
 const scale=points.some(p=>p.p>1)?100:1,after=points.find(p=>p.s>=second),before=[...points].reverse().find(p=>p.s<=second)||after;
 const value=after.s===before.s?after.p:before.p+(after.p-before.p)*(second-before.s)/(after.s-before.s);
 return value/scale;
}
export function buildContentPerformance({items=[],records=[],accounts=[],videosByAccount=new Map(),now=Date.now(),media='photo'}){
 const accountMap=new Map();for(const a of accounts)for(const key of [a.schema,a.connectionId,String(a.schema||'').replace(/^tiktok:/,'')])if(key)accountMap.set(key,a);
 const recordMap=new Map();for(const r of records){const id=r.autoTaskId;if(id)recordMap.set(id,r);}
 const rows=[];
 for(const i of items){const a=accountMap.get(i.connection_id),config=parseObject(i.config_json);if(!a||config.mediaType!==media)continue;
  const r=recordMap.get(i.id)||{},primary=r.connectionId||r.assignedEnvId;if(primary&&accountMap.get(primary)!==a)continue;
  const videoId=String(r.videoId||r.tiktokVideoId||r.itemId||''),v=(videosByAccount.get(a.schema)||[]).find(v=>String(v.id||v.videoId)===videoId);
  const time=ms(v?.createTime||v?.createdAt||v?.create_time||r.publishedAt),views=metric(v,'views','viewCount','view_count','playCount');
  const copy=parseObject(i.copy_json),share=String(v?.shareUrl||v?.shareLink||r.shareLink||r.videoUrl||'');
  rows.push({id:i.id,media,account:a.schema,accountName:a.profile?.username||a.username||a.label,group:a.groupName||'',source:i.source_key||i.source_id,variant:i.variant_id||'',rewriteModel:i.rewrite_model||'',style:i.style_id||'unknown',copyHash:i.copy_hash||'',title:copy.title||i.title||'未命名',copy,
   videoId,share:/^https:\/\/(www\.)?tiktok\.com\//.test(share)?share:'',time,createdAt:i.created_at,status:videoId?'published':r.id?publishOutcome(r):i.status,
   views,likes:metric(v,'likes','like_count','diggCount'),comments:metric(v,'comments','comment_count','commentCount'),shares:metric(v,'shares','share_count','shareCount'),saves:metric(v,'favorites','saves','favorites_count','collectCount'),
   completion:metric(v,'fullWatchRate','full_video_watched_rate','fullVideoWatchedRate'),averageWatch:metric(v,'averageTimeWatched','average_time_watched'),
   duration:metric(v,'duration','video_duration'),retention3:media==='video'&&v?retentionAt(v.retention||v.videoViewRetention||v.video_view_retention,3):null,
   mature:Boolean(time&&now-time>=86400000),synced:Boolean(v)});
 }
 return {rows,coverage:{total:rows.length,matched:rows.filter(r=>r.synced).length,copyKnown:rows.filter(r=>r.copyHash).length,styleKnown:rows.filter(r=>r.style!=='unknown').length}};
}
