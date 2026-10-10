// Shared non-advertising field contract for the Factory One report and detail UI.
export const ONE_METRICS = [
 ['video_views','播放次数','number','video_views_organic'],
 ['reach','观看人数','number','reach_organic'],
 ['engagement_count','互动总数','number'],
 ['engagement_rate','互动率','percent','engagement_rate_organic'],
 ['likes','点赞','number','likes_organic'],
 ['comments','评论','number','comments_organic'],
 ['shares','分享','number','shares_organic'],
 ['favorites','收藏','number','favorites_organic'],
 ['video_completion_rate','完播率','percent','video_completion_rate_organic'],
 ['total_play_time','总观看时长（秒）','number'],
 ['average_view_time','平均观看时长（秒）','number','average_view_time_organic'],
 ['two_seconds_views','2 秒观看率','percent','organic_two_seconds_views'],
 ['six_seconds_views','6 秒观看率','percent','organic_six_seconds_views'],
];
export const ONE_AUDIENCE = {countries:'国家 / 地区',genders:'性别',age:'年龄分组',device:'设备系统',language:'语言代码',locale:'地域明细',interest:'兴趣标签'};
export const ONE_SOURCES = {for_you:'推荐页',search:'搜索',following:'关注页',personal_profile:'个人主页',hashtag:'话题',sound:'音乐',other:'其他'};
const keys=[...new Set(ONE_METRICS.flatMap(([key,,,organic])=>organic?[key,organic]:[key]))];
const metric=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
export function oneAnalysis(value={}) {
 const metrics=Object.fromEntries(keys.map(k=>[k,metric(value.metrics?.[k])]));
 const series=(rows,percent=false)=>Array.isArray(rows)?rows.filter(r=>r&&typeof r==='object'&&metric(r.value)!==null&&(!percent||r.value<=1)).map(r=>({label:String(r.label??'未知').slice(0,160),value:r.value})):[];
 const audience=Object.fromEntries(Object.keys(ONE_AUDIENCE).map(k=>[k,series(value.audience?.[k],true)]));
 const sources=series(value.sources).filter(r=>Object.hasOwn(ONE_SOURCES,r.label));
 const retention=Array.isArray(value.retention)?value.retention.map(v=>metric(v)!==null&&v<=1?v:null):[];
 const daily=Array.isArray(value.daily)?value.daily.filter(r=>r&&/^\d{4}-\d{2}-\d{2}$/.test(String(r.date))).map(r=>({date:r.date,...Object.fromEntries(['views',...keys].map(k=>[k,metric(r[k])]))})).sort((a,b)=>a.date.localeCompare(b.date)):[];
 return {metrics,audience,sources,retention,daily};
}
export function oneAvailability(analysis){
 return {audience:Object.values(analysis.audience).some(r=>r.length>0),retention:analysis.retention.some(v=>v!==null),daily:analysis.daily.some(d=>Object.entries(d).some(([k,v])=>k!=='date'&&v!==null)),sources:analysis.sources.length>0,watch:analysis.metrics.average_view_time!==null||analysis.metrics.video_completion_rate!==null};
}
export function oneMediaUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}}
