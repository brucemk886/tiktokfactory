import {mountReceivingReport} from './psychology-receiving-report.js';
import {beijingTime} from './report-time.js';
import {renderOneAnalysis} from './psychology-one-analysis.js';
const path=location.pathname.replace(/\/$/,'');
if(['/psychology-effects','/psychology-ops-report'].includes(path))mountOneReport();
function mountOneReport(){
 const surface=path==='/psychology-effects'?'effects':'operations',params=new URLSearchParams(location.search),active=params.get('channel')==='tiktok-one',receiving=surface==='operations'&&params.get('channel')==='receiving';
 const standard=document.querySelector('#standardReport'),header=document.querySelector('main > header');
 if(!standard||!header)return;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=v=>v===null||v===undefined?'—':Number(v).toLocaleString('zh-CN',{maximumFractionDigits:1});
 const pct=v=>v===null||v===undefined?'—':(v*100).toFixed(1)+'%';
 const time=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
 const link=one=>{const u=new URL(location.href);if(one)u.searchParams.set('channel',one===true?'tiktok-one':one);else {u.searchParams.delete('channel');u.searchParams.delete('oneVideo');}return u.pathname+u.search;};
 const tabs=document.createElement('nav');tabs.className='one-report-tabs';tabs.setAttribute('aria-label','发布渠道');
 tabs.innerHTML=`<a href="${esc(link(false))}" ${!active&&!receiving?'aria-current="page"':''}>全部数据</a><a href="${esc(link(true))}" ${active?'aria-current="page"':''}>TikTok One</a>`;
 if(surface==='operations')tabs.insertAdjacentHTML('beforeend',`<a href="${esc(link('receiving'))}" ${receiving?'aria-current="page"':''}>承接引流</a>`);
 header.after(tabs);standard.hidden=active||receiving;
 if(receiving){mountReceivingReport(standard,header);return;}
 if(!active)return;
 const title=surface==='effects'?'数据概览':'运营报表';document.title='心理学 · '+title;
 const heading=header.querySelector('h1');if(heading)heading.textContent=title;
 const copy=header.querySelector('#pageCopy,.page-lead');if(copy)copy.textContent='单独查看 TikTok One 官方视频表现与工厂发布进度。';
 const crumb=document.querySelector('.lf-breadcrumb strong');if(crumb)crumb.textContent=title;
 for(const id of ['status','methodToggle','methodPanel']){const el=document.getElementById(id);if(el)el.hidden=true;}
 const root=document.createElement('section');root.className='one-report';root.setAttribute('aria-label','TikTok One 专属数据');standard.after(root);
 root.innerHTML=`<form class="one-report-filters">
 <label>统计周期（北京时间）<select name="period"><option value="all">全部发布日期（One）</option><option value="today">今天</option><option value="7d">近 7 天</option><option value="30d">近 30 天</option><option value="custom">自定义</option></select></label>
 <label>数据来源<select name="source"><option value="official">官方项目数据</option><option value="tasks">工厂发布进度</option></select></label>
 <label data-task-basis>日期口径<select name="basis"><option value="schedule">计划发布时间</option><option value="published">实际发布时间</option></select></label>
 <label>账号分组<select name="group"><option value="">全部授权分组</option></select></label>
 <label>TikTok One 项目<select name="campaign"><option value="">全部 One 项目</option></select></label>
 <button type="submit" class="one-primary">查询 / 刷新</button>
 <div class="one-report-dates" hidden><label>开始日期<input type="date" name="from"></label><label>结束日期<input type="date" name="to"></label></div>
 </form><p class="one-report-status" role="status" aria-live="polite"></p>
 <div class="one-report-data" hidden></div>`;
 const form=root.querySelector('form'),field=k=>form.elements.namedItem(k),status=root.querySelector('[role="status"]'),content=root.querySelector('.one-report-data');
 const detailVideo=params.get('oneVideo')||'',back=new URL(location.href);back.searchParams.delete('oneVideo');
 const backUrl=back.pathname+back.search;
 const fallback=document.createElement('div');fallback.className='one-analysis-head';fallback.hidden=!detailVideo;fallback.innerHTML='<a class="one-back-link" href="'+esc(backUrl)+'">← 返回视频列表</a><button type="button">重新读取详情</button>';form.after(fallback);form.hidden=!!detailVideo;
 if(detailVideo){heading.textContent='TikTok One · 视频数据详情';document.title='心理学 · TikTok One 视频详情';}
 let applied=null,controller=null,request=0;
 fallback.querySelector('button').onclick=()=>load({...fromForm(),source:'official',view:'videos',page:params.get('onePage')||1,refresh:'1'});
 for(const key of ['period','source','basis','group','campaign','from','to']){
  const val=params.get('one'+key[0].toUpperCase()+key.slice(1));if(val){if(['group','campaign'].includes(key))field(key).add(new Option(val,val));field(key).value=val;}
 }
 if(!field('period').value||!params.has('onePeriod'))field('period').value=field('source').value==='tasks'?'7d':'all';
 if(!field('basis').value)field('basis').value='schedule';
 if(!field('source').value)field('source').value='official';
 const sourceChanged=()=>{const official=field('source').value==='official';root.querySelector('[data-task-basis]').hidden=official;field('period').querySelector('[value=all]').disabled=!official;if(!official&&field('period').value==='all')field('period').value='7d';};sourceChanged();field('source').addEventListener('change',sourceChanged);
 const dates=()=>{const custom=field('period').value==='custom';root.querySelector('.one-report-dates').hidden=!custom;field('from').required=field('to').required=custom;};
 dates();field('period').addEventListener('change',dates);
 field('group').addEventListener('change',()=>{field('campaign').innerHTML='<option value="">全部 One 项目</option>';});
 const fromForm=()=>Object.fromEntries(['period','source','basis','group','campaign','from','to'].map(k=>[k,field(k).value]));
 form.addEventListener('submit',e=>{e.preventDefault();load({...fromForm(),view:applied?.view||'videos',page:1,refresh:'1'});});
 function options(key,rows,label,value){const selected=field(key).value;field(key).innerHTML='<option value="">'+(key==='group'?'全部授权分组':'全部 One 项目')+'</option>'+rows.map(r=>`<option value="${esc(r[value])}">${esc(r[label]||r[value])}</option>`).join('');if(selected&&!rows.some(r=>String(r[value])===selected))field(key).add(new Option(selected+'（本期无记录）',selected));field(key).value=selected;}
 async function load(query){
  if(detailVideo)query={...query,source:'official',videoId:detailVideo};
  fallback.hidden=!detailVideo;
  controller?.abort();controller=new AbortController();const abort=controller,id=++request;
  status.textContent='正在读取 TikTok One 数据…';content.hidden=true;root.setAttribute('aria-busy','true');
  try{
   const qs=new URLSearchParams({...query,surface});const response=await fetch('/api/psychology-one-report?'+qs,{cache:'no-store',signal:abort.signal}),data=await response.json();
   if(!response.ok)throw new Error(data.error||'读取失败');if(id!==request||abort.signal.aborted)return;
   applied={...query,campaign:data.campaign,source:data.source,page:data.pagination.page,view:data.view};delete applied.refresh;field('campaign').value=data.campaign;
   // Never apply a delayed result under filters that belong to a different request.
   options('group',data.groups,'name','id');options('campaign',data.projects,'campaignId','campaignId');field('campaign').value=data.campaign;field('campaign').options[0].textContent=data.source==='official'?'自动选择最近项目':'全部 One 项目';
   field('from').value=data.window.from;field('to').value=data.window.to;
   const u=new URL(location.href);for(const key of ['period','source','basis','group','campaign','from','to','view','page'])u.searchParams.set('one'+key[0].toUpperCase()+key.slice(1),String(applied[key]??''));history.replaceState({},'',u);
   status.textContent=data.window.from+' 至 '+data.window.to+' · 按'+(data.basis==='schedule'?'计划':'实际')+'发布时间筛选（北京时间） · 更新于 '+time(data.updatedAt)+(data.summary.updating?' · '+data.summary.updating+' 条状态正在后台同步':'');
   if(data.source==='official')status.textContent='官方项目数据 · 北京时间 · 所选发布日期 '+(applied.period==='all'?'全部':data.window.from+' 至 '+data.window.to)+' · 指标查询 '+(data.dateRange?.start_date||data.window.from)+' 至 '+(data.dateRange?.end_date||data.window.to)+' · '+(data.fetchedAt?'拉取于 '+time(data.fetchedAt):'尚无已绑定的 One 项目')+(data.cached?' · 缓存，点击查询 / 刷新可重新拉取':'')+(data.partial?' · 官方数据尚未读取完整，下方仅为已读取部分':'');
   render(data);content.hidden=false;fallback.hidden=true;
  }catch(e){if(id===request&&e.name!=='AbortError'){status.textContent='读取失败：'+e.message+'。请点击查询 / 刷新重试。';content.hidden=true;}}
  finally{if(id===request)root.setAttribute('aria-busy','false');}
 }
 function table(head,rows){return '<div class="one-report-table"><table><thead><tr>'+head.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(c=>'<tr>'+c.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
 function renderOfficial(d){
  const s=d.summary,groupName=id=>d.groups.find(g=>g.id===id)?.name||'—';
  const cards=[['官方收录视频',fmt(s.total),'当前项目 · 当前授权心理学账号'],['累计播放',fmt(s.views),'已有播放值 '+s.synced+' 条 · 缺失 '+s.missingMetrics+' 条'],['锚点点击',fmt(s.anchorClicks),'有点击数据 '+s.anchorClicksSamples+' 条'],['锚点点击率',pct(s.anchorCtr),'仅按同时有曝光、点击的数据计算']];
  content.innerHTML='<div class="one-report-kpis">'+cards.map(([label,value,note])=>'<article><span>'+label+'</span><strong>'+value+'</strong><small>'+note+'</small></article>').join('')+'</div>'+
   '<div class="one-report-progress"><span>自然播放 '+fmt(s.organicViews)+'</span><span>点赞 '+fmt(s.likes)+' · 评论 '+fmt(s.comments)+' · 分享 '+fmt(s.shares)+'</span></div>'+
   '<div class="one-report-body"><div class="one-report-heading"><div><h2>TikTok One 官方'+(d.view==='accounts'?'账号表现':d.view==='projects'?'项目表现':'视频明细')+'</h2><p>按北京时间发布日期筛选，展示当前累计指标；无审核状态字段。可切换「工厂发布进度」查看上传与发布回执。</p></div><label>查看维度 <select id="oneReportView"><option value="videos">视频明细</option><option value="accounts">账号表现</option><option value="projects">项目表现</option></select></label></div><div class="one-report-results"></div><footer class="one-report-pager"></footer></div>'+
   '<p class="one-report-note">'+(s.availability?'受众画像 '+s.availability.audience+' 条 · 留存 '+s.availability.retention+' 条 · 每日趋势 '+s.availability.daily+' 条。点击视频的数据详情查看。 ':'')+esc(d.coverage)+(d.unknownDates?' '+d.unknownDates+' 条作品时间待同步，仅在全部日期中显示。':'')+(d.partial?' 本次只读取了部分结果，不能据此判断缺少哪些视频。':'')+'</p>';
  const target=content.querySelector('.one-report-results');
  if(!d.rows.length)target.innerHTML='<div class="one-report-empty"><strong>暂无当前授权账号的官方 One 视频数据</strong><p>可选择其他已绑定项目，或稍后刷新。暂无返回不代表发布失败。</p></div>';
  else if(d.view==='videos')target.innerHTML=table(['视频 ID / 发布账号','发布时间（北京时间）','累计播放','自然播放','赞 / 评 / 转','锚点曝光 / 点击','锚点点击率','详细数据'],d.rows.map(r=>{
   const details=new URL(location.href);details.searchParams.set('oneVideo',r.videoId);
   const href=/^[\w.]+$/.test(r.accountName)&&/^\d{10,}$/.test(r.videoId)?'https://www.tiktok.com/@'+encodeURIComponent(r.accountName)+'/video/'+r.videoId:'';
   return [(href?'<a href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">'+esc(r.videoId)+'</a>':esc(r.videoId))+'<small>'+esc(r.accountName)+' · '+esc(groupName(r.groupId))+'</small>',esc(beijingTime(r.publishedAt))+(r.timeSource==='receipt'?'<small>发布回执时间 · 作品时间待同步</small>':!r.publishedAt?'<small>时间待同步</small>':''),fmt(r.views),fmt(r.organicViews),fmt(r.likes)+' / '+fmt(r.comments)+' / '+fmt(r.shares),fmt(r.anchorViews)+' / '+fmt(r.anchorClicks),pct(r.anchorCtr),'<a class="one-detail-link" href="'+esc(details.pathname+details.search)+'">数据详情 →</a><div class="one-available">'+(r.available?.audience?'<span>受众</span>':'')+(r.available?.retention?'<span>留存</span>':'')+(r.available?.daily?'<span>趋势</span>':'')+'</div>'];
  }));
  else target.innerHTML=table([d.view==='accounts'?'账号 / 分组':'One 项目','官方视频','累计播放','单条平均播放','破千率','赞 / 评 / 转','锚点曝光 / 点击','锚点点击率'],d.rows.map(r=>[d.view==='accounts'?esc(r.accountName)+'<small>'+esc(groupName(r.groupId))+'</small>':esc(r.campaignId),fmt(r.total),fmt(r.views),fmt(r.averageViews),pct(r.thousandRate),fmt(r.likes)+' / '+fmt(r.comments)+' / '+fmt(r.shares),fmt(r.anchorViews)+' / '+fmt(r.anchorClicks),pct(r.anchorCtr)]));
  bindResults(d);
 }
 function bindResults(d){
  const view=content.querySelector('#oneReportView');view.value=d.view;view.onchange=()=>load({...applied,view:view.value,page:1});
  const p=d.pagination,pager=content.querySelector('.one-report-pager');pager.innerHTML='<span>共 '+fmt(p.total)+' 条 · 每页 '+p.pageSize+' 条 · 第 '+p.page+' / '+p.pages+' 页</span><button type="button" data-page="'+(p.page-1)+'" '+(p.page<=1?'disabled':'')+'>上一页</button><button type="button" data-page="'+(p.page+1)+'" '+(p.page>=p.pages?'disabled':'')+'>下一页</button>';
  pager.querySelectorAll('button').forEach(b=>b.onclick=()=>load({...applied,page:Number(b.dataset.page)}));
 }
 function render(d){
  if(d.detail)return renderOneAnalysis(content,d,{backUrl,onRefresh:()=>load({...applied,refresh:'1'})});
  if(d.source==='official')return renderOfficial(d);
  const s=d.summary,names={published:'已发布',submitted:'已提交中台',pending:'待处理',failed:'异常',stopped:'已取消'},groupName=id=>d.groups.find(g=>g.id===id)?.name||'—';
  const cards=[['已发布',fmt(s.published),'本期共 '+fmt(s.total)+' 条任务'],['累计播放',fmt(s.views),'已同步 '+fmt(s.synced)+' 条 · 缺指标 '+fmt(s.missingMetrics)+' 条'],['单条平均播放',fmt(s.averageViews),'仅计算已有播放数据的作品'],['破千率',pct(s.thousandRate),'播放 ≥ 1,000 的已同步作品占比']];
  content.innerHTML='<div class="one-report-kpis">'+cards.map(([label,value,note])=>`<article><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`).join('')+'</div>'+`<div class="one-report-progress">${Object.entries(names).map(([key,label])=>`<span class="one-state ${key}">${label} <b>${fmt(s[key])}</b></span>`).join('')}<span>点赞 ${fmt(s.likes)} · 评论 ${fmt(s.comments)} · 分享 ${fmt(s.shares)}</span></div>`+
   `<div class="one-report-body"><div class="one-report-heading"><div><h2>TikTok One ${d.view==='accounts'?'账号表现':d.view==='projects'?'项目表现':'视频明细'}</h2><p>播放与互动为作品当前累计值；不是所选日期内新增流量。</p></div><label>查看维度 <select id="oneReportView"><option value="videos">视频明细</option><option value="accounts">账号表现</option><option value="projects">项目表现</option></select></label></div><div class="one-report-results"></div><footer class="one-report-pager"></footer></div>`+
   `<p class="one-report-note">${esc(d.coverage)} 主页访问、涨粉和独立站转化尚无单条 One 视频归因，不混入这里。</p>`;
  const target=content.querySelector('.one-report-results');
  if(!d.rows.length)target.innerHTML='<div class="one-report-empty"><strong>这个范围内还没有 TikTok One 记录</strong><p>可扩大日期范围或选择其他项目。查看待发布任务时，请选择「计划发布时间」。</p></div>';
  else if(d.view==='videos')target.innerHTML=table(['视频 / ID','发布账号','One 项目','发布状态','发布时间（北京时间）','累计播放','赞 / 评 / 转','完播率'],d.rows.map(r=>{
   const url=/^[\w.]+$/.test(r.accountName)&&/^\d{10,}$/.test(r.videoId)?'https://www.tiktok.com/@'+encodeURIComponent(r.accountName)+'/video/'+r.videoId:'';
   return [`<div class="one-video-title">${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>`:esc(r.title)}</div><small>${esc(r.videoId||'视频 ID 待回传')}</small>`,esc(r.accountName)+'<small>'+esc(groupName(r.groupId))+'</small>',esc(r.campaignId),`<span class="one-state ${esc(r.status)}">${esc(names[r.status]||'待处理')}</span>`+(r.status==='failed'&&r.error?'<details><summary>查看原因</summary>'+esc(r.error)+'</details>':''),'<small>计划 '+time(r.scheduleAt)+'</small><small>实际 '+time(r.publishedAt)+'</small>',fmt(r.views),fmt(r.likes)+' / '+fmt(r.comments)+' / '+fmt(r.shares),pct(r.completion)];
  }));
  else target.innerHTML=table([d.view==='accounts'?'账号 / 分组':'One 项目','任务 / 已发布','待处理 / 已提交','异常','已同步 / 缺指标','累计播放','单条平均播放','破千率','赞 / 评 / 转'],d.rows.map(r=>[d.view==='accounts'?esc(r.accountName)+'<small>'+esc(groupName(r.groupId))+'</small>':esc(r.campaignId),fmt(r.total)+' / '+fmt(r.published),fmt(r.pending)+' / '+fmt(r.submitted),fmt(r.failed),fmt(r.synced)+' / '+fmt(r.missingMetrics),fmt(r.views),fmt(r.averageViews),pct(r.thousandRate),fmt(r.likes)+' / '+fmt(r.comments)+' / '+fmt(r.shares)]));
  bindResults(d);
 }
 load({...fromForm(),view:['videos','accounts','projects'].includes(params.get('oneView'))?params.get('oneView'):'videos',page:params.get('onePage')||1});
}
