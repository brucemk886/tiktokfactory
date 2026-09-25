
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = value => value === null || value === undefined ? "—" : Number(value).toLocaleString("zh-CN",{maximumFractionDigits:1});
const pct = value => value === null || value === undefined ? "—" : (value*100).toFixed(1)+"%";
const sec = value => value === null || value === undefined ? "—" : Number(value).toFixed(1)+" 秒";
const time = value => new Date(value).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false});
const TABS=["overview","accounts","content","strategy"];
const params = new URLSearchParams(location.search);
const state = { data:null,tab:TABS.includes(params.get("tab"))?params.get("tab"):"overview",accountPage:1,batchPage:1,sourcePage:1,request:0 };
for(const key of ["period","from","to"]) if(params.has(key)) $("#"+key).value=params.get(key);
if(!$("#period").value)$("#period").value="today";
state.media=params.get("media")==="video"?"video":"photo";
function renderMediaTabs(){document.querySelectorAll("[data-media]").forEach(b=>{const on=b.dataset.media===state.media;b.classList.toggle("is-active",on);b.setAttribute("aria-selected",String(on));});}
document.querySelectorAll("[data-media]").forEach(b=>b.addEventListener("click",()=>{if(b.dataset.media===state.media)return;state.media=b.dataset.media;renderMediaTabs();load();}));
renderMediaTabs();
$("#period").addEventListener("change",()=>{toggleDates();if($("#period").value!=="custom")load();});
$("#filters").addEventListener("submit",event=>{event.preventDefault();load();});
$("#trendMetric").addEventListener("change",renderTrend);
for(const id of ["accountSort","accountFilter"]) $("#"+id).addEventListener("change",()=>{state.accountPage=1;loadPanel("accounts");});
document.querySelectorAll("[data-tab]").forEach((button,index,buttons)=>{
  button.addEventListener("click",()=>selectTab(button.dataset.tab));
  button.addEventListener("keydown",event=>{
    const next=event.key==="ArrowRight"?(index+1)%buttons.length:event.key==="ArrowLeft"?(index+buttons.length-1)%buttons.length:event.key==="Home"?0:event.key==="End"?buttons.length-1:-1;
    if(next>=0){event.preventDefault();buttons[next].focus();selectTab(buttons[next].dataset.tab);}
  });
});
const methodToggle=$("#methodToggle"),methodPanel=$("#methodPanel");
const showMethod=open=>{methodPanel.hidden=!open;methodToggle.setAttribute("aria-expanded",String(open));};
methodToggle.addEventListener("click",event=>{event.stopPropagation();showMethod(methodPanel.hidden);});
document.addEventListener("click",event=>{if(!methodPanel.hidden&&!methodPanel.contains(event.target))showMethod(false);});
document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!methodPanel.hidden){showMethod(false);methodToggle.focus();}});
toggleDates();selectTab(state.tab,false);
function toggleDates(){const custom=$("#period").value==="custom";$("#fromLabel").hidden=!custom;$("#toLabel").hidden=!custom;$("#from").required=custom;$("#to").required=custom;}
function selectTab(tab,save=true){
  state.tab=tab;
  document.querySelectorAll("[data-tab]").forEach(button=>{const active=button.dataset.tab===tab;button.setAttribute("aria-selected",String(active));button.tabIndex=active?0:-1;button.classList.toggle("is-active",active);$("#"+button.dataset.tab).hidden=!active;});
  if(save&&state.data&&tab!=="overview")loadPanel(tab);
  if(save){const url=new URL(location.href);url.searchParams.set("tab",tab);history.replaceState({},"",url);}
}
let reportController=null,detailController=null,detailLoaded=false,currentQuery="";
$("#contentDetail").addEventListener("toggle",()=>{if($("#contentDetail").open)loadDetail();});
async function loadDetail(){if(!state.data)return;return loadPanel('details');}
const panelRequests=new Map();
async function loadPanel(panel,page=1){
 const request=state.request,query=new URLSearchParams(currentQuery);query.set('panel',panel);query.set('page',page);
 if(panel==='accounts'){query.set('sort',$('#accountSort').value);query.set('filter',$('#accountFilter').value);}
 if(panel==='details'){query.set('q',$('#contentSearch').value);query.set('mode',$('#contentMode').value);if(state.detailKey)query.set('key',state.detailKey);}
 panelRequests.get(panel)?.abort();const controller=new AbortController();panelRequests.set(panel,controller);
 const target={accounts:'accountTable',content:'sourceTable',strategy:'stageTable',details:'contentTable',batches:'batchList',groups:'autopilotGroups'}[panel];
 $('#'+target).innerHTML='<p role="status">正在加载…</p>';
 try{
  const res=await fetch('/api/psychology-operations?'+query,{cache:'no-store',signal:controller.signal}),data=await res.json();
  if(!res.ok)throw new Error(data.error||'读取失败');if(request!==state.request||controller.signal.aborted)return;
  if(panel==='accounts'){state.data.framework.accounts=data.accounts;state.pages.accounts=data.pagination;renderAccounts();}
  if(panel==='content'){state.data.framework.content=data.content;state.pages.content=data.pagination;renderContent(state.data.framework);}
  if(panel==='strategy'){state.data.framework.strategy={...state.data.framework.strategy,...data.strategy};renderStrategy(state.data.framework);}
  if(panel==='groups'){state.data.autopilot.groups=data.autopilot.groups;state.data.groupPagination=data.groupPagination;renderAutopilot();}
  if(panel==='details')renderDetails(data);
  if(panel==='batches')renderExecution(data);
 }catch(e){if(request===state.request&&e.name!=='AbortError'){$('#'+target).innerHTML='<p role="alert">'+esc(e.message)+' <button class="table-action" data-retry>重试</button></p>';$('#'+target+' [data-retry]').onclick=()=>loadPanel(panel,page);}}
 finally{if(panelRequests.get(panel)===controller)panelRequests.delete(panel);}
}
function remotePager(id,info,panel){
 $('#'+id).innerHTML='<span>每页10条 · '+info.page+' / '+info.pages+' · 共'+info.total+'条</span><button class="table-action" data-step="-1" '+(info.page<=1?'disabled':'')+'>上一页</button><button class="table-action" data-step="1" '+(info.page>=info.pages?'disabled':'')+'>下一页</button>';
 $('#'+id).querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>loadPanel(panel,info.page+Number(b.dataset.step)));
}
function renderDetails(data){
 $('#contentCoverage').textContent=data.comparisons?'全周期统计，每页展示10组。点击查看组内作品。':'每页10条作品；统计不受当前页影响。';
 if(data.comparisons){
  $('#contentTable').innerHTML=table(['对比组','作品数','均播 / 中位','破千 / 破万','操作'],data.comparisons.map((r,i)=>[esc(r.label||r.key||'未知'),fmt(r.n),fmt(r.avgViews)+' / '+fmt(r.medianViews),pct(r.potentialRate)+' / '+pct(r.hitRate),'<button class="table-action" data-drill="'+i+'">查看作品</button>']));
  $('#contentTable').querySelectorAll('[data-drill]').forEach(b=>b.onclick=()=>{state.detailKey=data.comparisons[Number(b.dataset.drill)].key;loadPanel('details');});
 }else{
  $('#contentTable').innerHTML=(state.detailKey!==undefined?'<button class="table-action" id="detailBack">返回对比组</button>':'')+table(['作品 / 视频ID','账号','发布时间（北京）','播放','赞 / 评 / 转','原版 / 改写','样式'],data.items.map(r=>[esc(r.title)+'<small>'+esc(r.video_id||'尚未返回')+'</small>','@'+esc(r.accountName),r.published_at?time(r.published_at):'—',fmt(r.views),fmt(r.likes)+' / '+fmt(r.comments)+' / '+fmt(r.shares),esc(r.variant||'原版')+(r.rewrite_model?'<small>'+esc(r.rewrite_model)+'</small>':''),esc(r.style||'未知')]));
  if($('#detailBack'))$('#detailBack').onclick=()=>{delete state.detailKey;loadPanel('details');};
 }
 remotePager('contentPager',data.pagination,'details');$('#contentBreakdown').innerHTML='';$('#contentDetailPager').innerHTML='';
}
function renderExecution(data){
 const names={published:'已发布',failed:'失败 / 需处理',pending:'处理中',stopped:'已停止'};
 $('#batchList').innerHTML=table(['任务','账号','计划发布时间（北京）','状态','视频ID','失败原因'],data.items.map(r=>[esc(r.title),'@'+esc(r.accountName),time(r.schedule_at),names[r.state]||esc(r.state),esc(r.video_id||'尚未返回'),esc(r.error||'—')]));remotePager('batchPager',data.pagination,'batches');
}
let detailTimer;$('#contentSearch').addEventListener('input',()=>{clearTimeout(detailTimer);detailTimer=setTimeout(()=>{delete state.detailKey;loadDetail();},300);});
$('#contentMode').addEventListener('change',()=>{delete state.detailKey;loadDetail();});
$('#executionDetail').addEventListener('toggle',()=>{if($('#executionDetail').open)loadPanel('batches');});
async function load(){
  for(const c of panelRequests.values())c.abort();panelRequests.clear();delete state.detailKey;$("#executionDetail").open=false;
  reportController?.abort();detailController?.abort();detailController=null;detailLoaded=false;$("#contentDetail").open=false;
  const controller=new AbortController();reportController=controller;
  const request=++state.request;$("#query").disabled=true;$("#report").hidden=true;$("#status").textContent="正在读取运营报表…";
  const query=new URLSearchParams({period:$("#period").value,media:state.media,group:state.data?$("#group").value:(params.get("group")||"")});
  if(query.get("period")==="custom"){query.set("from",$("#from").value);query.set("to",$("#to").value);}
  try{
    const response=await fetch("/api/psychology-operations?"+query,{cache:"no-store",signal:controller.signal});const data=await response.json();
    if(!response.ok)throw new Error(data.error||"读取失败");
    if(request!==state.request)return;
    state.data=data;state.pages={};currentQuery=query.toString();state.accountPage=state.batchPage=state.sourcePage=1;
    $("#group").innerHTML='<option value="">全部授权分组</option>'+data.groups.map(g=>'<option value="'+esc(g.id)+'">'+esc(g.name)+'</option>').join("");
    $("#group").value=query.get("group");$("#from").value=data.window.from;$("#to").value=data.window.to;
    const url=new URL(location.href);url.search=query.toString();url.searchParams.set("tab",state.tab);history.replaceState({},"",url);
    $("#status").textContent=data.window.from+" 至 "+data.window.to+" · 对比上期 "+data.window.previousFrom+" 至 "+data.window.previousTo+
      (data.archiveAt?" · 最早指标同步 "+time(data.archiveAt):"")+(data.progress.ready?"":" · 正在迁移历史数据，当前统计尚未完整")+(data.progress.error?" · 历史迁移正在重试":"")+(data.progress.pending?" · "+data.progress.pending+" 条状态等待后台更新":" · 发布状态已同步");
    render();$("#report").hidden=false;if(state.tab!=="overview")loadPanel(state.tab);
  }catch(error){if(request===state.request)$("#status").textContent=error.message||"读取失败，请重试。";}
  finally{if(request===state.request)$("#query").disabled=false;}
}
load();
function table(headers,rows){return '<table class="ops-table"><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join("")+'</tr></thead><tbody>'+rows.map(cells=>'<tr>'+cells.map(c=>'<td>'+c+'</td>').join("")+'</tr>').join("")+'</tbody></table>';}
const isVideo=()=>state.data?.framework?.media==="video";
const summaryCells=s=>[fmt(s.n),fmt(s.medianViews)+"<small>平均 "+fmt(s.avgViews)+"</small>",pct(s.potentialRate),pct(s.hitRate),sec(s.averageWatch),pct(s.completion),...(isVideo()?[pct(s.retention3)]:[]),fmt(s.likes)+" / "+fmt(s.comments)+" / "+fmt(s.shares)];
const summaryHeaders=()=>["作品数","中位播放","破千率","破万率","平均播放时长","完播率",...(isVideo()?["3秒留存"]:[]),"平均 赞 / 评 / 转"];
const summaryTable=(first,rows)=>table([first,...summaryHeaders()],rows.map(([label,s])=>[label,...summaryCells(s)]));

function render(){
  const f=state.data.framework;
  $("#contentDetail").hidden=f.media==="video";
  const trend=$("#trendMetric");trend.querySelectorAll("[data-video]").forEach(o=>o.hidden=f.media!=="video");if(trend.selectedOptions[0]?.hidden)trend.value="potentialRate";
  $("#coverage").textContent=state.data.coverage;$("#completionLine").textContent=f.overview.completionLine==null?"暂无完播数据":pct(f.overview.completionLine);
  renderAutopilot();renderOverview(f);
}
function renderAutopilot(){
  const a=state.data.autopilot||{summary:{},groups:[],strategies:[],basis:''},s=a.summary;
  $('#autopilotBasis').textContent=a.basis;
  const cards=[['计划发布',s.planned,'按计划发布时间'],['已确认发布',s.published,'以发布回执为准'],['失败 / 需处理',s.failed,'官方回执或执行异常'],['处理中',s.pending,'生成、排队或待回执'],['待同步播放',s.missingMetrics,'已发布但指标尚未同步'],['已同步播放',s.synced,'待同步 '+fmt(s.missingMetrics)+' 条'],['当前累计播放',s.views,'仅合计已同步指标']];
  $('#autopilotMetrics').innerHTML=cards.map(([name,n,note])=>'<div class="metric"><span>'+esc(name)+'</span><strong>'+fmt(n)+'</strong><small>'+esc(note)+'</small></div>').join('');
  const headers=['账号数','计划 / 发布','失败或需处理 / 处理中','已停止','已同步 / 待同步','当前累计播放','当前均播 / 中位','当前破千 / 破万','点赞 / 评论 / 分享','评估'];
  const cells=r=>[fmt(r.accounts),fmt(r.planned)+' / '+fmt(r.published),fmt(r.failed)+' / '+fmt(r.pending),fmt(r.stopped),fmt(r.synced)+' / '+fmt(r.missingMetrics),fmt(r.views),fmt(r.averageViews)+' / '+fmt(r.medianViews),pct(r.potentialRate)+' / '+pct(r.hitRate),fmt(r.likes)+' / '+fmt(r.comments)+' / '+fmt(r.shares),esc(r.assessment)];
  $('#autopilotStrategies').innerHTML=a.summary.planned?table(['策略',...headers],a.strategies.map(r=>[esc(r.label)+'<small>'+fmt(r.groups??'')+' 个运营组 · 原版 '+fmt(r.original)+' / 改写 '+fmt(r.rewrite)+'</small>',...cells(r)])):'<div class="empty">当前日期与分组范围没有自动运营任务。</div>';
  remotePager('autopilotPager',state.data.groupPagination,'groups');
  $('#autopilotGroups').innerHTML=a.groups.length?table(['分组 / 策略',...headers],a.groups.map(r=>[esc(r.name)+'<small>'+esc(r.strategyLabel)+'</small>',...cells(r)])):'<div class="empty">当前范围没有自动运营分组。</div>';
}
function renderOverview(f){
  const c=f.overview.current,p=f.overview.previous;
  $("#findings").innerHTML='<ul>'+f.strategy.findings.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul>';
  const delta=(a,b,format,points)=>a===null||b===null||a===undefined||b===undefined?"":" · "+(a>=b?"+":"")+(points?((a-b)*100).toFixed(1)+" 个百分点":format(a-b));
  const cards=[["已同步作品",c.n,p.n,fmt,f.overview.observing+" 条暂无播放数据"],["破千率",c.potentialRate,p.potentialRate,pct,"潜力及以上",true],["破万率",c.hitRate,p.hitRate,pct,"待爆及以上",true],
    ["中位播放",c.medianViews,p.medianViews,fmt,"平均 "+fmt(c.avgViews)],["完播率",c.completion,p.completion,pct,"平均值",true],["平均播放时长",c.averageWatch,p.averageWatch,sec,"秒"],...(isVideo()?[["3秒留存",c.retention3,p.retention3,pct,"第3秒还在看的比例",true]]:[])];
  $("#metrics").innerHTML=cards.map(([label,value,previous,format,note,points])=>'<div class="metric"><span>'+label+'</span><strong>'+format(value)+'</strong><small>上期 '+format(previous)+delta(value,previous,format,points)+'<br>'+esc(note)+'</small></div>').join("");
  $("#tierTable").innerHTML=table(["流量池","播放区间","本期作品","占比","上期占比"],f.tiers.map((t,i)=>{const next=f.tiers[i+1];return [esc(t.label),fmt(t.min)+(next?" – "+fmt(next.min):" 以上"),fmt(c.tiers[t.id]),c.n?pct(c.tiers[t.id]/c.n):"—",p.n?pct(p.tiers[t.id]/p.n):"—"];}));
  $("#quadrantTable").innerHTML=table(["象限","怎么处理","本期作品","占比","上期占比"],Object.entries(f.quadrants).map(([k,q])=>[esc(q.label),esc(q.action),fmt(c.quadrants[k]),c.n?pct(c.quadrants[k]/c.n):"—",p.n?pct(p.quadrants[k]/p.n):"—"]));
  renderTrend();
  $("#dailyTable").innerHTML=table(["日期",...summaryHeaders()],f.overview.daily.map(d=>[d.date,...summaryCells(d)]));
}
function renderTrend(){
  if(!state.data)return;
  const key=$("#trendMetric").value,rows=state.data.framework.overview.daily,format=["potentialRate","completion","retention3"].includes(key)?pct:key==="averageWatch"?sec:fmt;
  const values=rows.map(r=>r[key]).filter(v=>v!==null&&v!==undefined),max=Math.max(...values,["potentialRate","completion","retention3"].includes(key)?0.01:1);
  if(!values.length){$("#trendChart").innerHTML='<div class="empty">当前周期暂无已同步播放的作品。</div>';return;}
  const x=i=>50+i*900/Math.max(1,rows.length-1),y=v=>235-v/max*190,has=v=>v!==null&&v!==undefined;
  const segments=rows.slice(1).map((r,i)=>has(r[key])&&has(rows[i][key])?'<line class="line" x1="'+x(i)+'" y1="'+y(rows[i][key])+'" x2="'+x(i+1)+'" y2="'+y(r[key])+'"/>':"").join("");
  const dots=rows.map((r,i)=>has(r[key])?'<circle cx="'+x(i)+'" cy="'+y(r[key])+'" r="4"><title>'+r.date+"："+format(r[key])+'</title></circle>':"").join("");
  const ticks=rows.map((r,i)=>i===0||i===rows.length-1||i===Math.floor(rows.length/2)?'<text x="'+x(i)+'" y="265" text-anchor="middle">'+r.date.slice(5)+'</text>':"").join("");
  $("#trendChart").innerHTML='<svg viewBox="0 0 1000 285" role="img" aria-label="'+esc($("#trendMetric").selectedOptions[0].text)+'趋势"><line class="grid" x1="50" y1="235" x2="950" y2="235"/><text x="50" y="25">'+format(max)+'</text>'+segments+dots+ticks+'</svg>';
}
function renderAccounts(){
  if(!state.data)return;
  const f=state.data.framework,names=f.stageNames,a=f.accounts;
  $("#stageCards").innerHTML=Object.entries(names).map(([k,label])=>'<div class="metric"><span>'+label+'</span><strong>'+fmt(a.stages.end[k])+'</strong><small>期初 '+fmt(a.stages.start[k])+'</small></div>').join("");
  const moves=[...a.transitions].sort((x,y)=>y.n-x.n);
  $("#transitionTable").innerHTML=moves.length?table(["期初","期末","账号数"],moves.map(m=>[m.from==="new"?"本期新号":esc(names[m.from]),esc(names[m.to])+(m.from!==m.to&&m.from!=="new"?' <span class="ops-chip">'+(["launch","normal","potential","burst"].indexOf(m.to)>["launch","normal","potential","burst"].indexOf(m.from)?"升级":"下滑")+'</span>':""),fmt(m.n)])):'<div class="empty">没有账号作品数据。</div>';
  const rows=a.rows;remotePager("accountPager",state.pages.accounts,"accounts");
  $("#accountTable").innerHTML=rows.length?table(["账号 / 分组","阶段（期初 → 期末）","累计作品","本期作品","中位播放","破千率","完播率","平均时长","主要象限","建议"],rows.map(r=>[
    "@"+esc(r.name)+"<small>"+esc(r.group)+"</small>",(r.startStage?esc(names[r.startStage])+" → ":"新号 → ")+esc(names[r.endStage]),fmt(r.totalPosts),fmt(r.stats.n),fmt(r.stats.medianViews),pct(r.stats.potentialRate),pct(r.stats.completion),sec(r.stats.averageWatch),
    r.stats.n?esc(f.quadrants[r.quadrant].label):"—",esc(r.issue||"—")])):'<div class="empty">没有符合条件的账号。</div>';
}
function renderContent(f){
  const c=f.content;
  $("#topicTable").innerHTML=(c.topics||[]).length?table(["题材",...summaryHeaders()],c.topics.map(t=>[esc(t.label),...summaryCells(t)])):'<div class="empty">这期作品还没有题材标签。grokbot 给爆款打上标签后，这里按题材比较破千率。</div>';
  const rows=c.sources;remotePager("sourcePager",state.pages.content,"content");
  $("#sourceTable").innerHTML=rows.length?table(["爆款","累计使用","本期账号 / 版本",...summaryHeaders().slice(1),"主要象限"],rows.map(s=>['<div class="title">'+esc(s.title||s.source)+'</div>',fmt(s.totalUses),fmt(s.accounts)+" / "+fmt(s.versions),...summaryCells(s.stats).slice(1),esc(f.quadrants[s.quadrant].label)])):'<div class="empty">本期没有已同步播放的作品。</div>';
  $("#reuseTable").innerHTML=table(["这篇爆款第几次使用",...summaryHeaders()],c.reuse.map(r=>[esc(r.label)+(r.label===c.dropAt?' <span class="ops-chip">明显下滑</span>':""),...summaryCells(r)]));
  $("#variationTable").innerHTML=summaryTable("重复使用时",[["换一个没用过的版本",c.version.fresh],["沿用已经用过的版本",c.version.same],["换了图文样式",c.style.changed],["和上次同样式",c.style.same]]);
  const w=c.rewrite;
  $("#rewriteTable").innerHTML=summaryTable("内容",[["全部原版",w.original],["全部改写版",w.rewrite],["破万爆款 · 原版（"+w.hitSources+" 篇）",w.hitOriginal],["破万爆款 · 改写版",w.hitRewrite]]);
  $("#postIndexTable").innerHTML=summaryTable("账号第几条作品",c.postIndex.map(r=>[esc(r.label),r]));
}
function renderStrategy(f){
  const e=state.data.evolution;
  if(isVideo())$("#evolutionRules").innerHTML='<ul><li>视频自动发布目前按创建批次时选的来源抽取，还没有接入“按表现进化”；等视频开始发、数据够了再接入。</li><li>下面的阶段对照照常统计视频数据。</li></ul>';
  else $("#evolutionRules").innerHTML='<ul><li>同一账号不会重复发布同一来源的原版或改写版。</li><li>自动运营 A：原版与改写并行测试，积累有效样本后约70%使用优胜内容、30%探索。</li><li>自动运营 B：只测原版；C：只测改写。未完成判断的版本限制并行测试数量。</li><li>自动选材沿用满24小时的判断规则；本报表展示当天已经同步的数据。每次同步指标后更新报表，发布状态由后台每分钟分批更新。</li></ul>';
  const kinds=f.kinds;
  $("#stageTable").innerHTML=table(["阶段","当前打法（假设）",...Object.values(kinds),"数据显示最好"],f.strategy.stages.map(st=>[esc(st.label),esc(st.playbook),
    ...Object.keys(kinds).map(k=>{const x=st.kinds[k];return fmt(x.medianViews)+"<small>"+x.n+" 条 · 破千 "+pct(x.potentialRate)+" · 完播 "+pct(x.completion)+"</small>";}),st.best?esc(kinds[st.best]):"样本不足"]));
}
function detailLink(video){
  const query=new URLSearchParams({account:video.account,video:video.id,module:"psychology",returnTo:location.pathname+location.search});
  return '<a class="table-action" href="/official-video-detail?'+esc(query.toString())+'">视频详情</a>'+(video.share?'<a class="table-action" target="_blank" rel="noreferrer" href="'+esc(video.share)+'">打开</a>':"");
}
