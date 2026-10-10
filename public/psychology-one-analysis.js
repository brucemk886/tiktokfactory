import {beijingTime} from './report-time.js';
import {ONE_METRICS,ONE_AUDIENCE,ONE_SOURCES} from './psychology-one-analysis-schema.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,kind='number')=>v===null||v===undefined?'—':kind==='percent'?(v*100).toFixed(2)+'%':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
const empty=()=>'<p class="one-analysis-empty">暂无数据 · 官方接口尚未返回</p>';
const table=(headers,rows)=>'<div class="one-report-table"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const card=(label,value,note='')=>'<article><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></article>';
const retentionPlot={width:820,height:220,left:60,right:22,top:20,bottom:36};
function chart(rows,{percent=false,label='',seconds=false}){
 if(!rows.some(r=>r.value!==null))return empty();
 const max=percent?1:Math.max(1,...rows.map(r=>r.value??0)),w=820,h=seconds?retentionPlot.height:180,left=seconds?retentionPlot.left:40,right=seconds?retentionPlot.right:40,top=20,bottom=seconds?retentionPlot.bottom:25;
 const step=(w-left-right)/Math.max(1,rows.length-1),x=i=>left+i*step,y=v=>h-bottom-v/max*(h-bottom-top);let line='',active=false;
 for(let i=0;i<rows.length;i++){const v=rows[i].value;if(v===null){active=false;continue;}line+=(active?'L':'M')+x(i).toFixed(2)+','+y(v).toFixed(2)+' ';active=true;}
 const last=rows.length-1,tickStep=[1,2,5,10,15,30,60].find(n=>n>=Math.ceil(last/19))||Math.ceil(last/19)||1;
 let ticks=seconds?Array.from({length:Math.floor(last/tickStep)+1},(_,i)=>i*tickStep):last?[0,last]:[0];
 if(seconds&&ticks.at(-1)!==last){if(ticks.length>1&&last-ticks.at(-1)<tickStep*.65)ticks.pop();ticks.push(last);}
 const axis=ticks.map(i=>'<g class="one-chart-tick"><line x1="'+x(i)+'" x2="'+x(i)+'" y1="'+(h-bottom)+'" y2="'+(h-bottom+5)+'" stroke="#c6d5eb"/><text x="'+x(i)+'" y="'+(h-10)+'" text-anchor="'+(seconds?'middle':i===0?'start':'end')+'">'+esc(rows[i].label)+'</text></g>').join('');
 const svg='<svg class="one-analysis-chart" viewBox="0 0 '+w+' '+h+'" role="'+(seconds?'group':'img')+'" '+(seconds?'tabindex="0" data-retention-chart aria-describedby="oneRetentionTooltip" ':'')+'aria-label="'+esc(label)+(seconds?'，左右方向键查看每秒数据':'')+'">'+(seconds?'':'<title>'+esc(label)+'</title>')+[0,.5,1].map(n=>'<line x1="'+left+'" x2="'+(w-right)+'" y1="'+y(n*max)+'" y2="'+y(n*max)+'" stroke="#e7eef8"/><text x="4" y="'+(y(n*max)+4)+'">'+esc(fmt(n*max,percent?'percent':'number'))+'</text>').join('')+'<path d="'+line+'" fill="none" stroke="#2563eb" stroke-width="2.5"/>'+rows.map((r,i)=>r.value===null?'':'<circle cx="'+x(i)+'" cy="'+y(r.value)+'" r="2.3" fill="#2563eb">'+(seconds?'':'<title>'+esc(r.label)+'：'+esc(fmt(r.value,percent?'percent':'number'))+'</title>')+'</circle>').join('')+axis+(seconds?'<g data-retention-hover hidden><line y1="'+top+'" y2="'+(h-bottom)+'" stroke="#7fa6ea" stroke-dasharray="4 4"/><circle r="5" fill="#2563eb" stroke="white" stroke-width="2"/></g><rect data-retention-hit x="'+left+'" y="'+top+'" width="'+(w-left-right)+'" height="'+(h-bottom-top)+'" fill="transparent" pointer-events="all"/>':'')+'</svg>';
 return seconds?'<div class="one-retention-plot">'+svg+'<div class="one-retention-tooltip" id="oneRetentionTooltip" role="tooltip" hidden></div></div>':svg;
}
function bindRetention(target,values){
 const svg=target.querySelector('[data-retention-chart]');if(!svg)return;
 const container=svg.parentElement,tooltip=container.querySelector('.one-retention-tooltip'),hover=svg.querySelector('[data-retention-hover]'),cursor=hover.querySelector('line'),marker=hover.querySelector('circle');
 const {width,height,left,right,top,bottom}=retentionPlot,last=values.length-1;let current=0;
 const hide=()=>{hover.setAttribute('hidden','');tooltip.hidden=true;};
 const show=index=>{
  current=Math.max(0,Math.min(last,index));const value=values[current],x=left+current*(width-left-right)/Math.max(1,last),y=value===null?top:height-bottom-value*(height-bottom-top);
  cursor.setAttribute('x1',x);cursor.setAttribute('x2',x);marker.setAttribute('cx',x);marker.setAttribute('cy',y);marker.style.display=value===null?'none':'';hover.removeAttribute('hidden');
  tooltip.textContent='第 '+current+' 秒\n留存率 '+(value===null?'暂无数据':fmt(value,'percent'));tooltip.hidden=false;
  const point=new DOMPoint(x,y).matrixTransform(svg.getScreenCTM()),box=container.getBoundingClientRect();
  tooltip.style.left=Math.max(0,Math.min(box.width-tooltip.offsetWidth,point.x-box.left+14))+'px';tooltip.style.top=Math.max(4,point.y-box.top-tooltip.offsetHeight-12)+'px';
 };
 svg.addEventListener('pointermove',event=>{const matrix=svg.getScreenCTM();if(!matrix)return;const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());if(p.x<left-.5||p.x>width-right+.5||p.y<top-.5||p.y>height-bottom+.5){hide();return;}show(Math.round((p.x-left)/(width-left-right)*last));});
 svg.addEventListener('pointerleave',hide);svg.addEventListener('blur',hide);svg.addEventListener('focus',()=>show(current));
 svg.addEventListener('keydown',event=>{if(event.key==='Escape'){hide();return;}if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();show(event.key==='Home'?0:event.key==='End'?last:current+(event.key==='ArrowRight'?1:-1));});
}
function bars(rows,labels,percent=true){
 if(!rows.length)return empty();const max=percent?1:Math.max(1,...rows.map(r=>r.value));
 return '<div class="one-analysis-bars">'+[...rows].sort((a,b)=>b.value-a.value).map(r=>'<div class="one-analysis-bar"><span title="'+esc(r.label)+'">'+esc(labels(r.label))+'</span><div><i style="width:'+Math.min(100,r.value/max*100).toFixed(3)+'%"></i></div><b>'+esc(fmt(r.value,percent?'percent':'number'))+'</b></div>').join('')+'</div>';
}
function audienceLabel(group,label){
 const names={MALE:'男性',FEMALE:'女性',ios:'iOS',android:'Android'};
 if(group==='countries'&&/^[A-Z]{2}$/.test(label)){try{return new Intl.DisplayNames(['zh-CN'],{type:'region'}).of(label)+' · '+label;}catch{}}
 if(group==='age'&&/^\d+$/.test(label))return '年龄分组 '+label;
 return names[label]||label;
}
export function renderOneAnalysis(target,data,{backUrl,onRefresh}){
 const v=data.detail,a=v.analysis,m=a.metrics;
 const videoUrl=/^[\w.]+$/.test(v.accountName)&&/^\d+$/.test(v.videoId)?'https://www.tiktok.com/@'+encodeURIComponent(v.accountName)+'/video/'+v.videoId:'';
 const sections=[['watch','观看与互动'],['audience','受众画像'],['retention','留存与来源'],['daily','官方日报'],['anchor','锚点效果']];
 target.innerHTML='<div class="one-analysis-head"><a class="one-back-link" href="'+esc(backUrl)+'">← 返回视频列表</a><button type="button" data-detail-refresh>刷新数据</button></div>'+
  '<section class="one-analysis-hero">'+(v.thumbnailUrl?'<img src="'+esc(v.thumbnailUrl)+'" alt="视频封面" referrerpolicy="no-referrer">':'<div class="one-analysis-cover-empty">暂无封面</div>')+'<div><p class="one-analysis-eyebrow">TikTok One · 视频数据详情</p><h2>@'+esc(v.accountName)+'</h2><p>视频 ID '+esc(v.videoId)+'</p><p>发布于 '+esc(beijingTime(v.publishedAt))+'（北京时间）'+(v.timeSource==='receipt'?' · 发布回执时间，作品时间待同步':'')+' · 项目 '+esc(v.campaignId)+'</p><div class="one-analysis-links">'+(videoUrl?'<a href="'+esc(videoUrl)+'" target="_blank" rel="noopener noreferrer">打开 TikTok 视频 ↗</a>':'')+(v.embedUrl?'<a href="'+esc(v.embedUrl)+'" target="_blank" rel="noopener noreferrer">打开官方预览 ↗</a>':'')+'</div></div></section>'+
  '<nav class="one-analysis-nav" aria-label="视频分析章节">'+sections.map(([id,label])=>'<a href="#one-'+id+'">'+label+'</a>').join('')+'</nav>'+
  '<p class="one-report-note">只展示这条视频的数据。指标为官方累计值；“—”表示未返回，0 保留接口原值。受众比例不与其他视频合并。</p>'+
  '<section id="one-watch" class="one-analysis-section"><h2>观看与互动</h2><div class="one-report-kpis">'+card('播放次数',fmt(v.views))+card('观看人数',fmt(m.reach),'该视频去重观看人数')+card('平均观看时长',fmt(m.average_view_time)+' 秒')+card('完播率',fmt(m.video_completion_rate,'percent'))+'</div>'+table(['指标','全部流量','自然流量'],ONE_METRICS.map(([key,label,kind,organic])=>[esc(label),fmt(m[key],kind),organic?fmt(m[organic],kind):'—']))+'<p class="one-report-note">2 秒 / 6 秒观看率为达到相应时长的播放比例。互动总数、比例、时长均保留官方口径。</p></section>'+
  '<section id="one-audience" class="one-analysis-section"><h2>受众画像</h2><p class="one-report-note">按官方返回的单条视频观众分布展示。年龄编码和语言代码暂保留原值，不推测年龄段或语言。</p><div class="one-analysis-audience">'+Object.entries(ONE_AUDIENCE).map(([group,label])=>'<article><h3>'+esc(label)+'</h3>'+bars(a.audience[group],value=>audienceLabel(group,value))+'</article>').join('')+'</div></section>'+
  '<section id="one-retention" class="one-analysis-section"><h2>留存与流量来源</h2><h3>逐秒留存</h3>'+chart(a.retention.map((value,i)=>({label:i+' 秒',value})),{percent:true,seconds:true,label:'逐秒留存曲线，空值断开'})+'<details class="one-analysis-values"><summary>查看逐秒数值（'+a.retention.length+' 个时间点）</summary>'+table(['时间','留存比例'],a.retention.map((value,i)=>[i+' 秒',fmt(value,'percent')]))+'</details><h3>流量来源</h3>'+bars(a.sources,value=>ONE_SOURCES[value]||value,false)+'</section>'+
  '<section id="one-daily" class="one-analysis-section"><div class="one-report-heading"><div><h2>官方日报 · 时区待确认</h2><p>查询日期 '+esc(data.dateRange?.start_date||data.window.from)+' 至 '+esc(data.dateRange?.end_date||data.window.to)+'；官方仅提供按日汇总且未返回时区，暂不能换算为北京自然日；下方保留来源日期，未返回的日期不补 0。</p></div><label>趋势指标<select data-daily-metric>'+ONE_METRICS.map(([key,label])=>'<option value="'+key+'">'+esc(label)+'</option>').join('')+'</select><select data-daily-traffic aria-label="每日流量口径"><option value="all">全部流量</option><option value="organic">自然流量</option></select></label></div><div data-daily-chart></div><div data-daily-values></div><details class="one-analysis-values"><summary>全部每日指标（'+a.daily.length+' 天）</summary>'+table(['日期',...ONE_METRICS.flatMap(([,label,,organic])=>organic?[label,label+' · 自然']:[label])],a.daily.map(d=>[esc(d.date),...ONE_METRICS.flatMap(([key,,kind,organic])=>{const value=key==='video_views'?d.views??d[key]:d[key];return organic?[fmt(value,kind),fmt(d[organic],kind)]:[fmt(value,kind)];})]))+'</details></section>'+
  '<section id="one-anchor" class="one-analysis-section"><h2>锚点效果</h2><p class="one-report-note">锚点 ID '+esc(v.anchorId||'—')+'</p>'+table(['指标','返回值'],[['展示次数',fmt(v.anchorViews)],['点击次数',fmt(v.anchorClicks)],['点击率',fmt(v.anchorCtr,'percent')],['去重展示人数',fmt(v.anchorUniqueViews)],['去重点击人数',fmt(v.anchorUniqueClicks)],['去重点击率',fmt(v.anchorUniqueViews>0&&v.anchorUniqueClicks!==null?v.anchorUniqueClicks/v.anchorUniqueViews:null,'percent')]])+'<p class="one-report-note">去重点击率 = 去重点击人数 / 去重展示人数。锚点点击不等于独立站进站、完成测试或付款。</p></section>';
 bindRetention(target,a.retention);
 target.querySelector('[data-detail-refresh]').onclick=onRefresh;
 target.querySelector('img')?.addEventListener('error',e=>{const el=document.createElement('div');el.className='one-analysis-cover-empty';el.textContent='封面暂不可用';e.currentTarget.replaceWith(el);});
 const metric=target.querySelector('[data-daily-metric]'),traffic=target.querySelector('[data-daily-traffic]');
 const daily=()=>{const [key,label,kind,organic]=ONE_METRICS.find(r=>r[0]===metric.value),natural=traffic.value==='organic';const rows=a.daily.map(d=>({label:d.date,value:natural?organic?d[organic]:null:key==='video_views'?d.views??d[key]:d[key]}));target.querySelector('[data-daily-chart]').innerHTML=chart(rows,{percent:kind==='percent',label:label+'每日趋势'});target.querySelector('[data-daily-values]').innerHTML=rows.length?table(['日期',label+(natural?' · 自然':'')],rows.map(r=>[esc(r.label),fmt(r.value,kind)])):empty();};
 metric.onchange=traffic.onchange=daily;daily();
}
