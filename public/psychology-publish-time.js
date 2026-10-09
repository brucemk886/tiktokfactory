// Shared UI/server time-window explanation; this never changes a submitted schedule.
export const publishTimeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
export function formatPublishTime(seconds,timeZone=publishTimeZone()){
 return new Intl.DateTimeFormat('sv-SE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(seconds*1000));
}
export function localPublishInput(milliseconds){
 const date=new Date(milliseconds);date.setMinutes(date.getMinutes()-date.getTimezoneOffset());return date.toISOString().slice(0,16);
}
export function publishScheduleError(times,now=Date.now(),timeZone=publishTimeZone()){
 const earliest=Math.floor(now/1000)+300,latest=Math.floor((now+14*86400000)/1000);
 for(let i=0;i<times.length;i++){
  const value=times[i];
  if(!Number.isSafeInteger(value)||value<=0)return '第 '+(i+1)+' 条发布时间无效，请重新选择日期和时间。';
  if(value<earliest)return '第 '+(i+1)+' 条发布时间 '+formatPublishTime(value,timeZone)+' 距当前 '+formatPublishTime(Math.floor(now/1000),timeZone)+' 不足 5 分钟。请改到 '+formatPublishTime(Math.ceil(earliest/60)*60,timeZone)+' 或更晚（'+timeZone+'，24 小时制）。';
  if(value>latest)return '第 '+(i+1)+' 条发布时间 '+formatPublishTime(value,timeZone)+' 超出未来 14 天；最晚为 '+formatPublishTime(latest,timeZone)+'（'+timeZone+'）。请提前首次时间或缩短同账号间隔。';
 }
 return '';
}
