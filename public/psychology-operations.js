import { renderContentPerformance } from './psychology-content-performance.js';
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
for(const id of ["accountSort","accountFilter"]) $("#"+id).addEventListener("change",()=>{state.accountPage=1;renderAccounts();});
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
  if(save){const url=new URL(location.href);url.searchParams.set("tab",tab);history.replaceState({},"",url);}
}
let reportController=null,detailController=null,detailLoaded=false,currentQuery="";
$("#contentDetail").addEventListener("toggle",()=>{if($("#contentDetail").open)loadDetail();});
async function loadDetail(){
  if(detailLoaded||detailController||!state.data||state.media!=="photo")return;
  const request=state.request,query=currentQuery,controller=new AbortController();detailController=controller;
  $("#contentCoverage").textContent="正在读取明细对比…";
  try{
    const response=await fetch("/api/psychology-operations?"+query+"&details=1",{cache:"no-store",signal:controller.signal});const result=await response.json();
    if(!response.ok)throw new Error(result.error||"读取明细失败");
    if(request!==state.request)return;
    detailLoaded=true;renderContentPerformance(result.content);
  }catch(error){if(request===state.request&&error.name!=="AbortError")$("#contentCoverage").textContent="明细读取失败："+error.message+"，请收起后重新展开。";}
  finally{if(detailController===controller)detailController=null;}
}
async function load(){
  reportController?.abort();detailController?.abort();detailController=null;detailLoaded=false;$("#contentDetail").open=false;
  const controller=new AbortController();reportController=controller;
  const request=++state.request;$("#query").disabled=true;$("#report").hidden=true;$("#status").textContent="正在读取运营报表…";
  const query=new URLSearchParams({period:$("#period").value,media:state.media,group:state.data?$("#group").value:(params.get("group")||"")});
  if(query.get("period")==="custom"){query.set("from",$("#from").value);query.set("to",$("#to").value);}
  try{
    const response=await fetch("/api/psychology-operations?"+query,{cache:"no-store",signal:controller.signal});const data=await response.json();
    if(!response.ok)throw new Error(data.error||"读取失败");
    if(request!==state.request)return;
    state.data=data;currentQuery=query.toString();state.accountPage=state.batchPage=state.sourcePage=1;
    $("#group").innerHTML='<option value="">全部授权分组</option>'+data.groups.map(g=>'<option value="'+esc(g.id)+'">'+esc(g.name)+'</option>').join("");
    $("#group").value=query.get("group");$("#from").value=data.window.from;$("#to").value=data.window.to;
    const url=new URL(location.href);url.search=query.toString();url.searchParams.set("tab",state.tab);history.replaceState({},"",url);
    $("#status").textContent=data.window.from+" 至 "+data.window.to+" · 对比上期 "+data.window.previousFrom+" 至 "+data.window.previousTo+
      (data.archiveAt?" · 最早账号同步 "+time(data.archiveAt):" · 暂无作品同步记录")+(data.limited?" · 数据量超过读取上限，请缩短周期，当前为部分数据":"");
    render();$("#report").hidden=false;
  }catch(error){if(request===state.request)$("#status").textContent=error.message||"读取失败，请重试。";}
  finally{if(request===state.request)$("#query").disabled=false;}
}
load();
function table(headers,rows){return '<table class="ops-table"><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join("")+'</tr></thead><tbody>'+rows.map(cells=>'<tr>'+cells.map(c=>'<td>'+c+'</td>').join("")+'</tr>').join("")+'</tbody></table>';}
function page(items,key,id,render){
  const count=Math.max(1,Math.ceil(items.length/10));state[key]=Math.min(count,Math.max(1,state[key]));
  const current=state[key];$("#"+id).innerHTML=items.length?'<span>每页10条 · '+current+' / '+count+' · 共'+items.length+'条</span><button class="table-action" data-step="-1" '+(current===1?"disabled":"")+'>上一页</button><button class="table-action" data-step="1" '+(current===count?"disabled":"")+'>下一页</button>':"";
  $("#"+id).querySelectorAll("[data-step]").forEach(button=>button.addEventListener("click",()=>{state[key]+=Number(button.dataset.step);render();}));
  return items.slice((current-1)*10,current*10);
}
const isVideo=()=>state.data?.framework?.media==="video";
const summaryCells=s=>[fmt(s.n),fmt(s.medianViews)+"<small>平均 "+fmt(s.avgViews)+"</small>",pct(s.potentialRate),pct(s.hitRate),sec(s.averageWatch),pct(s.completion),...(isVideo()?[pct(s.retention3)]:[]),fmt(s.likes)+" / "+fmt(s.comments)+" / "+fmt(s.shares)];
const summaryHeaders=()=>["作品数","中位播放","破千率","破万率","平均播放时长","完播率",...(isVideo()?["3秒留存"]:[]),"平均 赞 / 评 / 转"];
const summaryTable=(first,rows)=>table([first,...summaryHeaders()],rows.map(([label,s])=>[label,...summaryCells(s)]));

function render(){
  const f=state.data.framework;
  $("#contentDetail").hidden=f.media==="video";
  const trend=$("#trendMetric");trend.querySelectorAll("[data-video]").forEach(o=>o.hidden=f.media!=="video");if(trend.selectedOptions[0]?.hidden)trend.value="potentialRate";
  $("#coverage").textContent=state.data.coverage;$("#completionLine").textContent=f.overview.completionLine==null?"暂无完播数据":pct(f.overview.completionLine);
  renderOverview(f);renderAccounts();renderContent(f);renderStrategy(f);renderBatches();renderContentPerformance(state.data.content);
}
function renderOverview(f){
  const c=f.overview.current,p=f.overview.previous;
  $("#findings").innerHTML='<ul>'+f.strategy.findings.map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul>';
  const delta=(a,b,format,points)=>a===null||b===null||a===undefined||b===undefined?"":" · "+(a>=b?"+":"")+(points?((a-b)*100).toFixed(1)+" 个百分点":format(a-b));
  const cards=[["满24小时作品",c.n,p.n,fmt,f.overview.observing+" 条观察中"],["破千率",c.potentialRate,p.potentialRate,pct,"潜力及以上",true],["破万率",c.hitRate,p.hitRate,pct,"待爆及以上",true],
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
  if(!values.length){$("#trendChart").innerHTML='<div class="empty">当前周期暂无满24小时的作品。</div>';return;}
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
  const filter=$("#accountFilter").value,sort=$("#accountSort").value;
  const list=a.rows.filter(r=>filter==="all"||(filter==="issue"?r.issue&&!/潜力号/.test(r.issue):filter==="potential"?["potential","burst"].includes(r.endStage):r.endStage===filter)).sort((x,y)=>(y.stats[sort]??-1)-(x.stats[sort]??-1));
  const rows=page(list,"accountPage","accountPager",renderAccounts);
  $("#accountTable").innerHTML=rows.length?table(["账号 / 分组","阶段（期初 → 期末）","累计作品","本期作品","中位播放","破千率","完播率","平均时长","主要象限","建议"],rows.map(r=>[
    "@"+esc(r.name)+"<small>"+esc(r.group)+"</small>",(r.startStage?esc(names[r.startStage])+" → ":"新号 → ")+esc(names[r.endStage]),fmt(r.totalPosts),fmt(r.stats.n),fmt(r.stats.medianViews),pct(r.stats.potentialRate),pct(r.stats.completion),sec(r.stats.averageWatch),
    r.stats.n?esc(f.quadrants[r.quadrant].label):"—",esc(r.issue||"—")])):'<div class="empty">没有符合条件的账号。</div>';
}
function renderContent(f){
  const c=f.content;
  $("#topicTable").innerHTML=(c.topics||[]).length?table(["题材",...summaryHeaders()],c.topics.map(t=>[esc(t.label),...summaryCells(t)])):'<div class="empty">这期作品还没有题材标签。grokbot 给爆款打上标签后，这里按题材比较破千率。</div>';
  const rows=page(c.sources,"sourcePage","sourcePager",()=>renderContent(state.data.framework));
  $("#sourceTable").innerHTML=rows.length?table(["爆款","累计使用","本期账号 / 版本",...summaryHeaders().slice(1),"主要象限"],rows.map(s=>['<div class="title">'+esc(s.title||s.source)+'</div>',fmt(s.totalUses),fmt(s.accounts)+" / "+fmt(s.versions),...summaryCells(s.stats).slice(1),esc(f.quadrants[s.quadrant].label)])):'<div class="empty">本期没有满24小时的作品。</div>';
  $("#reuseTable").innerHTML=table(["这篇爆款第几次使用",...summaryHeaders()],c.reuse.map(r=>[esc(r.label)+(r.label===c.dropAt?' <span class="ops-chip">明显下滑</span>':""),...summaryCells(r)]));
  $("#variationTable").innerHTML=summaryTable("重复使用时",[["换一个没用过的版本",c.version.fresh],["沿用已经用过的版本",c.version.same],["换了图文样式",c.style.changed],["和上次同样式",c.style.same]]);
  const w=c.rewrite;
  $("#rewriteTable").innerHTML=summaryTable("内容",[["全部原版",w.original],["全部改写版",w.rewrite],["破万爆款 · 原版（"+w.hitSources+" 篇）",w.hitOriginal],["破万爆款 · 改写版",w.hitRewrite]]);
  $("#postIndexTable").innerHTML=summaryTable("账号第几条作品",c.postIndex.map(r=>[esc(r.label),r]));
}
function renderStrategy(f){
  const e=state.data.evolution;
  if(isVideo())$("#evolutionRules").innerHTML='<ul><li>视频自动发布目前按创建批次时选的来源抽取，还没有接入“按表现进化”；等视频开始发、数据够了再接入。</li><li>下面的阶段对照照常统计视频数据。</li></ul>';
  else $("#evolutionRules").innerHTML='<ul><li>同一账号不会重复发同一篇爆款（原版或任一改写都算同一篇）。</li><li>原版优先：原版满 '+e.matureNeeded+' 条满24小时作品后才开始试改写版。</li><li>之后约 '+Math.round(e.exploitShare*100)+'% 用表现最好的版本 / 爆款，'+Math.round((1-e.exploitShare)*100)+'% 试没数据的。</li><li>改写版平均播放低于原版的 '+Math.round(e.retireRatio*100)+'% 不再抽。</li><li>表现数据按近 '+e.windowDays+' 天计算，每天北京时间 0 点、8 点更新。</li></ul>';
  const kinds=f.kinds;
  $("#stageTable").innerHTML=table(["阶段","当前打法（假设）",...Object.values(kinds),"数据显示最好"],f.strategy.stages.map(st=>[esc(st.label),esc(st.playbook),
    ...Object.keys(kinds).map(k=>{const x=st.kinds[k];return fmt(x.medianViews)+"<small>"+x.n+" 条 · 破千 "+pct(x.potentialRate)+" · 完播 "+pct(x.completion)+"</small>";}),st.best?esc(kinds[st.best]):"样本不足"]));
}
function detailLink(video){
  const query=new URLSearchParams({account:video.account,video:video.id,module:"psychology",returnTo:location.pathname+location.search});
  return '<a class="table-action" href="/official-video-detail?'+esc(query.toString())+'">视频详情</a>'+(video.share?'<a class="table-action" target="_blank" rel="noreferrer" href="'+esc(video.share)+'">打开</a>':"");
}
function renderBatches(){
  if(!state.data)return;
  const labels={planned:"计划生成",generated:"生成完成",submitted:"已提交中台",published:"已确认发布",failed:"失败"};
  $("#funnel").innerHTML=Object.entries(labels).map(([key,label])=>'<div><span>'+label+'</span><strong>'+fmt(state.data.funnel[key])+'</strong></div>').join("");
  const rows=page(state.data.batches,"batchPage","batchPager",renderBatches),names={published:"发布成功",failed:"失败",submitted:"已提交，待回执",generated:"生成完成",running:"生成中",queued:"等待执行",pending:"等待状态"};
  $("#batchList").innerHTML=rows.length?rows.map(b=>'<details class="ops-batch"><summary>'+esc(b.name)+'<span>'+({photo:"图文",video:"视频"}[b.media]||"未知类型")+" · "+time(b.createdAt)+" · "+b.planned+" 条</span></summary><p class=\"section-hint\">生成完成 "+b.generated+" · 已提交 "+b.submitted+" · 发布成功 "+b.published+" · 失败 "+b.failed+'</p>'+table(["任务","账号","状态","失败原因","作品"],b.items.map(i=>[esc(i.title),"@"+esc(i.accountName),names[i.state],'<div class="ops-error">'+esc(i.error||"—")+'</div>',i.video?detailLink(i.video):"暂无归档作品"]))+'</details>').join(""):'<div class="empty">当前周期没有自动发布批次。</div>';
}
