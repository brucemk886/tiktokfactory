import { renderContentPerformance } from './psychology-content-performance.js';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = value => value === null || value === undefined ? "—" : Number(value).toLocaleString("zh-CN",{maximumFractionDigits:1});
const pct = value => value === null || value === undefined ? "—" : (value*100).toFixed(1)+"%";
const time = value => new Date(value).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false});
const params = new URLSearchParams(location.search);
const state = { data:null,tab:["trend","accounts","batches","content","insights"].includes(params.get("tab"))?params.get("tab"):"trend",accountPage:1,batchPage:1,videoPage:1,selectedAccount:"",request:0 };
for(const key of ["period","media","group","from","to"]) if(params.has(key) && key!=="group") $("#"+key).value=params.get(key);
if(!$("#period").value)$("#period").value="7d";
if(!$("#media").value)$("#media").value="all";
$("#period").addEventListener("change",toggleDates);
$("#filters").addEventListener("submit",event=>{event.preventDefault();load();});
$("#trendMetric").addEventListener("change",renderTrend);
$("#accountSort").addEventListener("change",()=>{state.accountPage=1;renderAccounts();});
$("#closeDialog").addEventListener("click",()=>$("#videoDialog").close());
document.querySelectorAll("[data-tab]").forEach((button,index,buttons)=>{
  button.addEventListener("click",()=>selectTab(button.dataset.tab));
  button.addEventListener("keydown",event=>{
    const next=event.key==="ArrowRight"?(index+1)%buttons.length:event.key==="ArrowLeft"?(index+buttons.length-1)%buttons.length:event.key==="Home"?0:event.key==="End"?buttons.length-1:-1;
    if(next>=0){event.preventDefault();buttons[next].focus();selectTab(buttons[next].dataset.tab);}
  });
});
toggleDates();selectTab(state.tab,false);load();
function toggleDates(){const custom=$("#period").value==="custom";$("#fromLabel").hidden=!custom;$("#toLabel").hidden=!custom;$("#from").required=custom;$("#to").required=custom;}
function selectTab(tab,save=true){
  state.tab=tab;
  document.querySelectorAll("[data-tab]").forEach(button=>{const active=button.dataset.tab===tab;button.setAttribute("aria-selected",String(active));button.tabIndex=active?0:-1;button.classList.toggle("is-active",active);$("#"+button.dataset.tab).hidden=!active;});
  if(save){const url=new URL(location.href);url.searchParams.set("tab",tab);history.replaceState({},"",url);}
}
async function load(){
  const request=++state.request;$("#query").disabled=true;$("#report").hidden=true;$("#videoDialog").close();$("#status").textContent="正在读取运营报表…";
  const query=new URLSearchParams({period:$("#period").value,media:$("#media").value,group:state.data?$("#group").value:(params.get("group")||"")});
  if(query.get("period")==="custom"){query.set("from",$("#from").value);query.set("to",$("#to").value);}
  try{
    const response=await fetch("/api/psychology-operations?"+query,{cache:"no-store"});const data=await response.json();
    if(!response.ok)throw new Error(data.error||"读取失败");
    if(request!==state.request)return;
    state.data=data;state.accountPage=state.batchPage=1;
    $("#group").innerHTML='<option value="">全部授权分组</option>'+data.groups.map(g=>'<option value="'+esc(g.id)+'">'+esc(g.name)+'</option>').join("");
    $("#group").value=query.get("group");$("#from").value=data.window.from;$("#to").value=data.window.to;
    const url=new URL(location.href);url.search=query.toString();url.searchParams.set("tab",state.tab);history.replaceState({},"",url);
    $("#status").textContent=data.window.from+" 至 "+data.window.to+" · 对比上期 "+data.window.previousFrom+" 至 "+data.window.previousTo+
      (data.archiveAt?" · 最早账号同步 "+time(data.archiveAt):" · 暂无作品同步记录")+(data.limited?" · 数据量超过读取上限，请缩短周期，当前为部分数据":"");
    render();$("#report").hidden=false;
  }catch(error){if(request===state.request)$("#status").textContent=error.message||"读取失败，请重试。";}
  finally{if(request===state.request)$("#query").disabled=false;}
}
function render(){
  const data=state.data,s=data.summary,p=data.previous;
  const cards=[["发布作品",s.count,p.count,fmt,s.fresh+" 条未满24小时"],["发布成功率",s.successRate,p.successRate,pct,s.published+" 成功 / "+s.failed+" 失败 / "+s.pending+" 待确认"],["高播率",s.highRate,p.highRate,pct,"满24小时样本 "+s.sample+" 条"],["单条播放中位数",s.medianViews,p.medianViews,fmt,s.sample<5?"样本不足5条，继续观察":"统计发布满24小时的作品"]];
  $("#metrics").innerHTML=cards.map(([label,value,previous,format,note])=>'<div class="metric"><span>'+label+'</span><strong>'+format(value)+'</strong><small>上期 '+format(previous)+(value!==null&&previous!==null?" · "+(value>=previous?"+":"")+(format===pct?((value-previous)*100).toFixed(1)+" 个百分点":fmt(value-previous)):"")+'<br>'+esc(note)+'</small></div>').join("");
  $("#coverage").textContent=data.coverage;
  $("#unknown").textContent=(data.unknownMedia||data.unknownRecordMedia)?"有 "+data.unknownMedia+" 条作品、"+data.unknownRecordMedia+" 条发布记录缺少内容类型，仅计入“全部内容”，不猜测为图文或视频。":"";
  renderTrend();renderAccounts();renderBatches();renderContentPerformance(data.content);renderInsights(data.insights);
}
const seconds=value=>value===null||value===undefined?"—":Number(value).toFixed(1)+" 秒";
const summaryCells=s=>[fmt(s.n),fmt(s.medianViews)+"<small>平均 "+fmt(s.avgViews)+"</small>",pct(s.potentialRate),pct(s.hitRate),seconds(s.averageWatch),pct(s.completion),fmt(s.likes)+" / "+fmt(s.comments)+" / "+fmt(s.shares)];
const SUMMARY_HEADERS=["作品数","中位播放","破千率","破万率","平均播放时长","完播率","平均 赞 / 评 / 转"];
function renderInsights(data){
  const ids=["insightFindings","insightStages","insightTiers","insightPotential","insightReuse","insightVariation","insightRewrite","insightPosts","insightStageTable"];
  if(!data){ids.forEach(id=>$("#"+id).innerHTML="");$("#insightFindings").innerHTML='<div class="empty">运营规律只分析图文，请把内容类型切到“全部内容”或“图文”。</div>';return;}
  $("#insightFindings").innerHTML='<ul>'+data.findings.map(f=>'<li>'+esc(f)+'</li>').join("")+'</ul><p class="section-hint">本期 '+data.sample.rows+' 条图文，满24小时 '+data.sample.mature+' 条，其中重复使用 '+data.sample.repeats+' 条。</p>';
  const stageNames={launch:"起号期",normal:"普通账号",potential:"潜力账号",burst:"爆发期"};
  $("#insightStages").innerHTML=Object.entries(stageNames).map(([key,label])=>'<div class="metric"><span>'+label+'</span><strong>'+fmt(data.currentStages[key])+'</strong><small>按本期发布、满24小时的作品判断（全部类型）</small></div>').join("");
  const o=data.overall;
  $("#insightTiers").innerHTML=table(["流量池","播放区间","作品数","占比"],data.tiers.map((t,i)=>{const next=data.tiers[i+1];return [esc(t.label),fmt(t.min)+(next?" – "+fmt(next.min):" 以上"),fmt(o.tiers[t.id]),o.n?pct(o.tiers[t.id]/o.n):"—"];}))+
    table(["整体",...SUMMARY_HEADERS],[["本期满24小时图文",...summaryCells(o)]]);
  $("#insightPotential").innerHTML=data.potentialAccounts.length?table(["账号","阶段","本期满24小时作品（全部类型）","本期平均播放","本期最高播放"],data.potentialAccounts.map(a=>["@"+esc(a.name),stageNames[a.stage],fmt(a.posts),fmt(a.avgViews),fmt(a.best)])):'<div class="empty">本期还没有潜力账号：需要本期发布满10条且平均播放破千，或近10条出过10万+。</div>';
  $("#insightReuse").innerHTML=table(["这篇爆款第几次使用",...SUMMARY_HEADERS],data.reuse.map(r=>[esc(r.label)+(r.label===data.dropAt?' <span class="ops-chip">明显下滑</span>':""),...summaryCells(r)]));
  const v=data.version,s=data.style;
  $("#insightVariation").innerHTML=table(["重复使用时",...SUMMARY_HEADERS],[["换一个没用过的版本",v.fresh],["沿用已经用过的版本",v.same],["换了图文样式",s.changed],["和上次同样式",s.same]].map(([label,row])=>[label,...summaryCells(row)]));
  const w=data.rewrite;
  $("#insightRewrite").innerHTML=table(["内容",...SUMMARY_HEADERS],[["全部原版",w.original],["全部改写版",w.rewrite],["在我们号上破万的爆款 · 原版（"+w.hitSources+" 篇）",w.hitOriginal],["在我们号上破万的爆款 · 改写版",w.hitRewrite]].map(([label,row])=>[esc(label),...summaryCells(row)]));
  $("#insightPosts").innerHTML=table(["账号第几条作品",...SUMMARY_HEADERS],data.postIndex.map(r=>[esc(r.label),...summaryCells(r)]));
  const kinds={first:"爆款首发",repeatOriginal:"重复 · 原版",rewrite:"改写版本"};
  $("#insightStageTable").innerHTML=table(["发布时账号阶段",...Object.values(kinds),"中位播放最高"],data.stages.map(st=>[esc(st.label),
    ...Object.keys(kinds).map(k=>{const x=st.kinds[k];return fmt(x.medianViews)+"<small>"+x.n+" 条 · 破千 "+pct(x.potentialRate)+" · 完播 "+pct(x.completion)+"</small>";}),st.best?esc(kinds[st.best]):"样本不足"]));
}
function renderTrend(){
  if(!state.data)return;
  const key=$("#trendMetric").value,rows=state.data.daily,percent=key.endsWith("Rate"),format=percent?pct:fmt;
  const values=rows.map(r=>r[key]).filter(v=>v!==null),max=Math.max(...values,percent?1:1);
  if(!values.length)$("#trendChart").innerHTML='<div class="empty">当前周期暂无可计算该指标的样本。</div>';
  else {
    const x=i=>50+i*900/Math.max(1,rows.length-1),y=v=>235-v/max*190;
    // Individual segments keep unavailable days as gaps instead of inventing zeroes.
    const segments=rows.slice(1).map((r,i)=>r[key]!==null&&rows[i][key]!==null?'<line class="line" x1="'+x(i)+'" y1="'+y(rows[i][key])+'" x2="'+x(i+1)+'" y2="'+y(r[key])+'"/>':"").join("");
    const dots=rows.map((r,i)=>r[key]===null?"":'<circle cx="'+x(i)+'" cy="'+y(r[key])+'" r="4"><title>'+r.date+"："+format(r[key])+'</title></circle>').join("");
    const ticks=rows.map((r,i)=>i===0||i===rows.length-1||i===Math.floor(rows.length/2)?'<text x="'+x(i)+'" y="265" text-anchor="middle">'+r.date.slice(5)+'</text>':"").join("");
    $("#trendChart").innerHTML='<svg viewBox="0 0 1000 285" role="img" aria-label="'+esc($("#trendMetric").selectedOptions[0].text)+'趋势"><line class="grid" x1="50" y1="235" x2="950" y2="235"/><text x="50" y="25">'+format(max)+'</text>'+segments+dots+ticks+'</svg>';
  }
  $("#dailyTable").innerHTML=table(["日期","发布作品","当前累计播放","发布成功","发布失败","待确认","成功率","高播率"],rows.map(r=>[r.date,fmt(r.count),fmt(r.views),fmt(r.published),fmt(r.failed),fmt(r.pending),pct(r.successRate),pct(r.highRate)]));
}
function table(headers,rows){return '<table class="ops-table"><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join("")+'</tr></thead><tbody>'+rows.map(cells=>'<tr>'+cells.map(c=>'<td>'+c+'</td>').join("")+'</tr>').join("")+'</tbody></table>';}
function page(items,key,id,render){
  const count=Math.max(1,Math.ceil(items.length/10));state[key]=Math.min(count,Math.max(1,state[key]));
  const current=state[key];$("#"+id).innerHTML=items.length?'<span>每页10条 · '+current+' / '+count+' · 共'+items.length+'条</span><button class="table-action" data-step="-1" '+(current===1?"disabled":"")+'>上一页</button><button class="table-action" data-step="1" '+(current===count?"disabled":"")+'>下一页</button>':"";
  $("#"+id).querySelectorAll("[data-step]").forEach(button=>button.addEventListener("click",()=>{state[key]+=Number(button.dataset.step);render();}));
  return items.slice((current-1)*10,current*10);
}
function renderAccounts(){
  if(!state.data)return;
  const sort=$("#accountSort").value,all=[...state.data.accounts].sort((a,b)=>(b[sort]??-1)-(a[sort]??-1));
  const rows=page(all,"accountPage","accountPager",renderAccounts);
  $("#accountTable").innerHTML=rows.length?table(["账号 / 分组","发布 / 观察中","满24小时样本","均播 / 中位播放","高播率","0播率","发布失败率","建议关注","作品"],rows.map(r=>[
    "@"+esc(r.name)+"<small>"+esc(r.group)+"</small>",fmt(r.count)+" / "+fmt(r.fresh),fmt(r.sample),fmt(r.averageViews)+" / "+fmt(r.medianViews),pct(r.highRate),pct(r.zeroRate),pct(r.failureRate),esc(r.hint),
    '<button type="button" class="table-action" data-account="'+esc(r.id)+'">查看作品</button>'
  ])):'<div class="empty">当前筛选范围没有账号作品或发布记录。</div>';
  $("#accountTable").querySelectorAll("[data-account]").forEach(button=>button.addEventListener("click",()=>{state.selectedAccount=button.dataset.account;state.videoPage=1;renderVideos();$("#videoDialog").showModal();}));
}
function detailLink(video){
  const query=new URLSearchParams({account:video.account,video:video.id,module:"psychology",returnTo:location.pathname+location.search});
  return '<a class="table-action" href="/official-video-detail?'+esc(query.toString())+'">视频详情</a>'+(video.share?'<a class="table-action" target="_blank" rel="noreferrer" href="'+esc(video.share)+'">打开</a>':"");
}
function renderVideos(){
  const account=state.data.accounts.find(a=>a.id===state.selectedAccount);if(!account)return;
  $("#dialogTitle").textContent="@"+account.name+" · 本期作品";
  const rows=page([...account.videos].sort((a,b)=>b.time-a.time),"videoPage","videoPager",renderVideos);
  $("#dialogTable").innerHTML=rows.length?'<table class="ops-table"><thead><tr><th>作品</th><th>类型</th><th>发布时间</th><th>播放</th><th>状态</th><th>操作</th></tr></thead><tbody>'+rows.map(v=>'<tr><td class="title">'+esc(v.title)+'</td><td>'+({photo:"图文",video:"视频",unknown:"未标注"}[v.media])+'</td><td>'+time(v.time)+'</td><td>'+fmt(v.views)+'</td><td>'+(v.fresh?'<span class="ops-chip">观察中</span>':"已满24小时")+'</td><td>'+detailLink(v)+'</td></tr>').join("")+'</tbody></table>':'<div class="empty">该账号本期暂无已归档作品。</div>';
}
function renderBatches(){
  if(!state.data)return;
  const labels={planned:"计划生成",generated:"生成完成",submitted:"已提交中台",published:"已确认发布",failed:"失败"};
  $("#funnel").innerHTML=Object.entries(labels).map(([key,label])=>'<div><span>'+label+'</span><strong>'+fmt(state.data.funnel[key])+'</strong></div>').join("");
  const rows=page(state.data.batches,"batchPage","batchPager",renderBatches),names={published:"发布成功",failed:"失败",submitted:"已提交，待回执",generated:"生成完成",running:"生成中",queued:"等待执行",pending:"等待状态"};
  $("#batchList").innerHTML=rows.length?rows.map(b=>'<details class="ops-batch"><summary>'+esc(b.name)+'<span>'+({photo:"图文",video:"视频"}[b.media]||"未知类型")+" · "+time(b.createdAt)+" · "+b.planned+" 条</span></summary><p class=\"section-hint\">生成完成 "+b.generated+" · 已提交 "+b.submitted+" · 发布成功 "+b.published+" · 失败 "+b.failed+'</p>'+table(["任务","账号","状态","失败原因","作品"],b.items.map(i=>[esc(i.title),"@"+esc(i.accountName),names[i.state],'<div class="ops-error">'+esc(i.error||"—")+'</div>',i.video?detailLink(i.video):"暂无归档作品"]))+'</details>').join(""):'<div class="empty">当前周期没有自动发布批次。手动发布作品仍计入趋势和账号分析。</div>';
}
