import {ONE_METRICS,ONE_AUDIENCE,ONE_SOURCES} from './psychology-one-analysis-schema.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,kind='number')=>v===null||v===undefined?'—':kind==='percent'?(v*100).toFixed(2)+'%':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:2});
const empty=()=>'<p class="one-analysis-empty">暂无数据 · 官方接口尚未返回</p>';
const table=(headers,rows)=>'<div class="one-report-table"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const card=(label,value,note='')=>'<article><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></article>';
function chart(rows,{percent=false,label=''}){
 if(!rows.some(r=>r.value!==null))return empty();
 const max=percent?1:Math.max(1,...rows.map(r=>r.value??0)),w=820,h=180,pad=40,step=(w-pad*2)/Math.max(1,rows.length-1),y=v=>h-25-v/max*(h-45);let line='',active=false;
 for(let i=0;i<rows.length;i++){const v=rows[i].value;if(v===null){active=false;continue;}line+=(active?'L':'M')+(pad+i*step).toFixed(2)+','+y(v).toFixed(2)+' ';active=true;}
 return '<svg class="one-analysis-chart" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc(label)+'"><title>'+esc(label)+'</title>'+[0,.5,1].map(n=>'<line x1="'+pad+'" x2="'+(w-pad)+'" y1="'+y(n*max)+'" y2="'+y(n*max)+'" stroke="#e7eef8"/><text x="4" y="'+(y(n*max)+4)+'">'+esc(fmt(n*max,percent?'percent':'number'))+'</text>').join('')+'<path d="'+line+'" fill="none" stroke="#2563eb" stroke-width="2.5"/>'+rows.map((r,i)=>r.value===null?'':'<circle cx="'+(pad+i*step)+'" cy="'+y(r.value)+'" r="2.3" fill="#2563eb"><title>'+esc(r.label)+'：'+esc(fmt(r.value,percent?'percent':'number'))+'</title></circle>').join('')+'<text x="'+pad+'" y="178">'+esc(rows[0]?.label)+'</text><text x="'+(w-pad)+'" y="178" text-anchor="end">'+esc(rows.at(-1)?.label)+'</text></svg>';
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
 const sections=[['watch','观看与互动'],['audience','受众画像'],['retention','留存与来源'],['daily','每日趋势'],['anchor','锚点效果']];
 target.innerHTML='<div class="one-analysis-head"><a class="one-back-link" href="'+esc(backUrl)+'">← 返回视频列表</a><button type="button" data-detail-refresh>刷新数据</button></div>'+
  '<section class="one-analysis-hero">'+(v.thumbnailUrl?'<img src="'+esc(v.thumbnailUrl)+'" alt="视频封面" referrerpolicy="no-referrer">':'<div class="one-analysis-cover-empty">暂无封面</div>')+'<div><p class="one-analysis-eyebrow">TikTok One · 视频数据详情</p><h2>@'+esc(v.accountName)+'</h2><p>视频 ID '+esc(v.videoId)+'</p><p>发布于 '+esc(v.publishedAt||'—')+'（接口原始时间） · 项目 '+esc(v.campaignId)+'</p><div class="one-analysis-links">'+(videoUrl?'<a href="'+esc(videoUrl)+'" target="_blank" rel="noopener noreferrer">打开 TikTok 视频 ↗</a>':'')+(v.embedUrl?'<a href="'+esc(v.embedUrl)+'" target="_blank" rel="noopener noreferrer">打开官方预览 ↗</a>':'')+'</div></div></section>'+
  '<nav class="one-analysis-nav" aria-label="视频分析章节">'+sections.map(([id,label])=>'<a href="#one-'+id+'">'+label+'</a>').join('')+'</nav>'+
  '<p class="one-report-note">只展示这条视频的数据。指标为官方累计值；“—”表示未返回，0 保留接口原值。受众比例不与其他视频合并。</p>'+
  '<section id="one-watch" class="one-analysis-section"><h2>观看与互动</h2><div class="one-report-kpis">'+card('播放次数',fmt(v.views))+card('观看人数',fmt(m.reach),'该视频去重观看人数')+card('平均观看时长',fmt(m.average_view_time)+' 秒')+card('完播率',fmt(m.video_completion_rate,'percent'))+'</div>'+table(['指标','全部流量','自然流量'],ONE_METRICS.map(([key,label,kind,organic])=>[esc(label),fmt(m[key],kind),organic?fmt(m[organic],kind):'—']))+'<p class="one-report-note">2 秒 / 6 秒观看率为达到相应时长的播放比例。互动总数、比例、时长均保留官方口径。</p></section>'+
  '<section id="one-audience" class="one-analysis-section"><h2>受众画像</h2><p class="one-report-note">按官方返回的单条视频观众分布展示。年龄编码和语言代码暂保留原值，不推测年龄段或语言。</p><div class="one-analysis-audience">'+Object.entries(ONE_AUDIENCE).map(([group,label])=>'<article><h3>'+esc(label)+'</h3>'+bars(a.audience[group],value=>audienceLabel(group,value))+'</article>').join('')+'</div></section>'+
  '<section id="one-retention" class="one-analysis-section"><h2>留存与流量来源</h2><h3>逐秒留存</h3>'+chart(a.retention.map((value,i)=>({label:i+' 秒',value})),{percent:true,label:'逐秒留存曲线，空值断开'})+'<details class="one-analysis-values"><summary>查看逐秒数值（'+a.retention.length+' 个时间点）</summary>'+table(['时间','留存比例'],a.retention.map((value,i)=>[i+' 秒',fmt(value,'percent')]))+'</details><h3>流量来源</h3>'+bars(a.sources,value=>ONE_SOURCES[value]||value,false)+'</section>'+
  '<section id="one-daily" class="one-analysis-section"><div class="one-report-heading"><div><h2>每日趋势</h2><p>查询日期 '+esc(data.dateRange?.start_date||data.window.from)+' 至 '+esc(data.dateRange?.end_date||data.window.to)+'；日期沿用接口原值，未返回的日期不补 0。</p></div><label>趋势指标<select data-daily-metric>'+ONE_METRICS.map(([key,label])=>'<option value="'+key+'">'+esc(label)+'</option>').join('')+'</select><select data-daily-traffic aria-label="每日流量口径"><option value="all">全部流量</option><option value="organic">自然流量</option></select></label></div><div data-daily-chart></div><div data-daily-values></div><details class="one-analysis-values"><summary>全部每日指标（'+a.daily.length+' 天）</summary>'+table(['日期',...ONE_METRICS.flatMap(([,label,,organic])=>organic?[label,label+' · 自然']:[label])],a.daily.map(d=>[esc(d.date),...ONE_METRICS.flatMap(([key,,kind,organic])=>{const value=key==='video_views'?d.views??d[key]:d[key];return organic?[fmt(value,kind),fmt(d[organic],kind)]:[fmt(value,kind)];})]))+'</details></section>'+
  '<section id="one-anchor" class="one-analysis-section"><h2>锚点效果</h2><p class="one-report-note">锚点 ID '+esc(v.anchorId||'—')+'</p>'+table(['指标','返回值'],[['展示次数',fmt(v.anchorViews)],['点击次数',fmt(v.anchorClicks)],['点击率',fmt(v.anchorCtr,'percent')],['去重展示人数',fmt(v.anchorUniqueViews)],['去重点击人数',fmt(v.anchorUniqueClicks)],['去重点击率',fmt(v.anchorUniqueViews>0&&v.anchorUniqueClicks!==null?v.anchorUniqueClicks/v.anchorUniqueViews:null,'percent')]])+'<p class="one-report-note">去重点击率 = 去重点击人数 / 去重展示人数。锚点点击不等于独立站进站、完成测试或付款。</p></section>';
 target.querySelector('[data-detail-refresh]').onclick=onRefresh;
 target.querySelector('img')?.addEventListener('error',e=>{const el=document.createElement('div');el.className='one-analysis-cover-empty';el.textContent='封面暂不可用';e.currentTarget.replaceWith(el);});
 const metric=target.querySelector('[data-daily-metric]'),traffic=target.querySelector('[data-daily-traffic]');
 const daily=()=>{const [key,label,kind,organic]=ONE_METRICS.find(r=>r[0]===metric.value),natural=traffic.value==='organic';const rows=a.daily.map(d=>({label:d.date,value:natural?organic?d[organic]:null:key==='video_views'?d.views??d[key]:d[key]}));target.querySelector('[data-daily-chart]').innerHTML=chart(rows,{percent:kind==='percent',label:label+'每日趋势'});target.querySelector('[data-daily-values]').innerHTML=rows.length?table(['日期',label+(natural?' · 自然':'')],rows.map(r=>[esc(r.label),fmt(r.value,kind)])):empty();};
 metric.onchange=traffic.onchange=daily;daily();
}
