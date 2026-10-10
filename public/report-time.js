export const REPORT_TIME_ZONE='Asia/Shanghai';
export function beijingTime(value){
 if(!value)return '—';const d=new Date(value);return Number.isFinite(+d)?d.toLocaleString('zh-CN',{timeZone:REPORT_TIME_ZONE,hour12:false}):'—';
}
export function sourceDayWindow(from,to=from){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(to||''))return '暂无时间范围';
 const end=new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 return from+' 08:00 至 '+end+' 08:00（北京时间）';
}
