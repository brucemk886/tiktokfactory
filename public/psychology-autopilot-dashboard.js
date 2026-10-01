const dashEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dashNumber=value=>value==null?'—':Number(value).toLocaleString('zh-CN',{maximumFractionDigits:1});
const dashPercent=value=>value==null?'—':(Number(value)*100).toFixed(1)+'%';
const dashRoles={review:'内容评审',strong:'强号产出',normal:'中号产出','rescue-hook':'首图救援','rescue-content':'内页救援',diagnostic:'近零诊断',observing:'待观察',launch:'新号起量'};
const dashColors={strong:'#16a34a',normal:'#377ff5','rescue-hook':'#f59e0b','rescue-content':'#f97316',diagnostic:'#ef4444',observing:'#94a3b8',winner:'#16a34a',optimize:'#377ff5',potential:'#a855f7',explore:'#f59e0b',revise:'#ef4444'};
const dashLabel={strong:'强号池',normal:'中号池','rescue-hook':'首图救援池','rescue-content':'内页救援池',diagnostic:'近零诊断池',observing:'待观察池',winner:'优胜池',optimize:'优化池',potential:'潜力验证池',explore:'待验证池',revise:'待修订池'};
const dashDate=(value,zone='America/Los_Angeles')=>!value?'—':new Date(value).toLocaleString('zh-CN',{timeZone:zone,hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const dashStats=row=>row?.stats||row||{};
const dashPoolName=id=>dashLabel[id]||id||'—';
const dashContentName=row=>row.title||row.source||'未命名版本';
function dashPools(pools,type,total){
 return (pools||[]).map(p=>{
  const n=type==='accounts'?p.accounts:p.versions,share=total>0?n/total:0,label=dashPoolName(p.id);
  return '<button type="button" class="dash-pool-row" data-dash-pool="'+dashEscape(p.id)+'" data-dash-view="'+type+'" aria-label="查看'+dashEscape(label)+'，'+dashNumber(n)+'个'+(type==='accounts'?'账号':'版本')+'"><span class="dash-pool-label"><i class="dash-pool-dot" style="background:'+dashColors[p.id]+'"></i>'+dashEscape(label)+'</span><strong>'+dashNumber(n)+'</strong><span class="dash-track"><span style="width:'+Math.min(100,share*100)+'%;background:'+dashColors[p.id]+'"></span></span><span class="dash-percent">'+Math.round(share*100)+'%</span><span class="dash-chevron" aria-hidden="true">›</span></button>';
 }).join('')+'<div class="dash-total-row"><span>合计</span><strong>'+dashNumber(total)+'</strong><span class="dash-track"><span style="width:'+(total?'100':'0')+'%"></span></span><span class="dash-percent">'+(total?'100':'0')+'%</span><span></span></div>';
}
function dashChart(trend){
 const points=Array.isArray(trend)?trend:(trend?.rows||trend?.days||trend?.publication||[]);
 if(!points.length)return '<div class="dash-empty"><strong>尚无可展示的趋势</strong><p>已发布满72小时且已同步指标的作品才进入评估；缺失数据不会按0处理。</p></div>';
 const rows=points.map(p=>({...p,median:p.medianViews??p.stats?.medianViews??null,rate:p.potentialRate??p.highRate??p.stats?.potentialRate??null}));
 const ceiling=Math.max(500,...rows.map(p=>p.median||0)),top=Math.ceil(ceiling/100)*100,maxRate=Math.max(.08,...rows.map(p=>p.rate||0));
 const x=i=>rows.length===1?450:i*900/(rows.length-1),y=(v,max)=>190-Number(v)/max*180;
 function paths(key,max,color){let segments=[],current=[];rows.forEach((p,i)=>{if(p[key]==null){if(current.length)segments.push(current);current=[];}else current.push(x(i)+','+y(p[key],max));});if(current.length)segments.push(current);
  return segments.map(s=>'<polyline points="'+s.join(' ')+'" fill="none" stroke="'+color+'" stroke-width="2.5" vector-effect="non-scaling-stroke"/>').join('')+rows.map((p,i)=>p[key]==null?'':'<circle cx="'+x(i)+'" cy="'+y(p[key],max)+'" r="4" fill="'+color+'" stroke="white" stroke-width="1.5"><title>'+dashEscape(p.date||p.day)+' · 成熟样本 '+dashNumber(p.n??p.stats?.n)+' · 中位播放 '+dashNumber(p.median)+' · 千播率 '+dashPercent(p.rate)+'</title></circle>').join('');
 }
 return '<div class="dash-chart-wrap"><span class="dash-axis-label">播放数</span><span class="dash-axis-label is-right">千播率</span><div class="dash-axis-left">'+[1,.75,.5,.25,0].map(v=>'<span>'+dashNumber(top*v)+'</span>').join('')+'</div><div class="dash-axis-right">'+[1,.75,.5,.25,0].map(v=>'<span>'+Math.round(maxRate*v*100)+'%</span>').join('')+'</div><div class="dash-chart"><svg viewBox="0 0 900 190" preserveAspectRatio="none" role="img" aria-label="近七天各发布日成熟作品的最新累计中位播放和千播率">'+[10,55,100,145,190].map(v=>'<line x1="0" y1="'+v+'" x2="900" y2="'+v+'" stroke="#e9eef7" vector-effect="non-scaling-stroke"/>').join('')+paths('median',top,'#1767ff')+paths('rate',maxRate,'#10b981')+'</svg></div><div class="dash-chart-days">'+rows.map(p=>'<span>'+dashEscape((p.date||p.day||'').slice(5).replace('-','/'))+'</span>').join('')+'</div></div><p class="dash-note">按美西发布日分组 · 仅满72小时的已同步作品 · 指标为最新累计值；空缺表示尚无可评估样本。</p>';
}
function dashOverview(result){
 const s=result.summary||{},t=s.today||{},m=s.mature||{},progress=result.contentProgress||{},inventory=s.eligibleWinnerVersions??result.readiness?.eligibleWinnerVersions??0;
 const a=result.accountPools||[],c=result.contentPools||[],contentTotal=c.reduce((n,p)=>n+Number(p.versions||0),0);
 return '<div class="dash-metrics">'+[
 ['users','项目账号',dashNumber(s.projectAccounts),'当前有权限 · 项目账号去重'],
 ['send','今日发布',dashNumber(t.published),'美西 '+dashEscape(result.operatingDate||'')+' · 已排 '+dashNumber(t.planned)+' 条'],
 ['chart','可评估样本',dashNumber(m.n),'近30天 · 已发布满72小时'],
 ['trophy','优胜版本',dashNumber(s.winnerVersions),'待补测 '+dashNumber(s.testingVersions)+' · 当前可用 '+dashNumber(inventory)+' 个']
 ].map(([icon,label,value,hint])=>'<div class="dash-metric"><div class="dash-metric-icon" aria-hidden="true">'+dashIcon(icon)+'</div><div><span class="dash-metric-label">'+label+'</span><strong class="dash-metric-number">'+value+'</strong><small class="dash-muted">'+hint+'</small></div></div>').join('')+'</div>'+
 '<section class="dash-panel"><div class="dash-heading"><h2>近7天运营表现</h2><div class="dash-legend"><span><i class="dash-legend-dot" style="background:#1767ff"></i>中位播放（左轴）</span><span><i class="dash-legend-dot" style="background:#10b981"></i>千播率（右轴）</span></div></div>'+dashChart(result.trend)+'</section>'+
 '<div class="dash-pools"><section class="dash-panel"><div class="dash-heading"><div class="dash-inline-head"><h2>账号池</h2><span class="dash-muted">近30天成熟样本分层</span></div><button class="dash-text-action" data-dash-view="accounts">查看全部账号 →</button></div>'+dashPools(a,'accounts',s.projectAccounts||0)+'<div class="dash-account-foot"><div><strong>流量池</strong><small>账号可观察流量表现</small></div><div><strong>运营任务角色</strong><small>评审、产出、恢复等任务</small></div></div>'+dashMovement(result)+'</section>'+
 '<section class="dash-panel"><div class="dash-heading"><div class="dash-inline-head"><h2>内容池</h2><span class="dash-muted">具体版本 × 样式</span></div><button class="dash-text-action" data-dash-view="content">查看全部内容 →</button></div>'+dashPools(c,'content',contentTotal)+
 '<div class="dash-evidence"><div class="dash-evidence-title"><strong>优胜版本补测</strong><button class="dash-text-action" data-dash-view="content" data-dash-pool="explore">查看补测详情 →</button></div><div class="dash-evidence-counts">'+[[progress.reserved,'尚未发布占位'],[progress.waiting,'已发布待成熟'],[progress.missingMetrics,'已成熟待同步'],[progress.mature,'有效成熟样本']].map(([n,label])=>'<div><strong>'+dashNumber(n)+'</strong><small>'+label+'</small></div>').join('')+'</div><p class="dash-note">至少5个不同账号的成熟证据，达到效果门槛且版本当前可用，才能作为正式基准。</p></div></section></div>'+
 '<section class="dash-panel"><div class="dash-heading"><h2>匹配与卡点</h2><span class="dash-tag">达标后启用</span></div><div class="dash-match-row"><div class="dash-match-step"><strong>中强评审账号</strong><small>强号 / 中号固定版本验证</small></div><span class="dash-match-arrow">→</span><div class="dash-match-step"><strong>待验证版本</strong><small>补齐不同账号成熟样本</small></div><span class="dash-match-arrow">→</span><div class="dash-match-step"><strong>筛选优胜内容</strong><small>效果与当前库存资格均达标</small></div><button class="dash-primary" data-dash-view="content" data-dash-pool="explore">查看补测进度</button></div><div class="dash-match-row is-rescue"><div class="dash-match-step"><strong>起号 / 救援账号</strong><small>按流量池与任务角色分配</small></div><span class="dash-match-arrow">→</span><div class="dash-match-step"><strong>合格优胜版本</strong><small>当前可用 '+dashNumber(inventory)+' 个</small></div><span class="dash-match-arrow">→</span><div class="dash-match-step"><strong>达标后启用</strong><small>'+ (inventory?'仍需校验账号与内容匹配':'基准不足时等待并记录原因')+'</small></div><button class="dash-amber" data-dash-view="content" data-dash-pool="winner">查看优胜基准</button></div></section>';
}
function dashList(result,view,state){
 const isA=view==='accounts',details=result.details||{},rows=details.rows||[],pools=isA?result.accountPools:result.contentPools,total=isA?result.summary?.projectAccounts:(result.contentPools||[]).reduce((n,p)=>n+(p.versions||0),0);
 const q=state.q[view],pool=state.pool[view];
 const filters='<div class="dash-filters"><button data-dash-view="'+view+'" data-dash-pool="" class="'+(!pool?'is-active':'')+'">全部 '+dashNumber(total)+'</button>'+ (pools||[]).map(p=>'<button data-dash-view="'+view+'" data-dash-pool="'+dashEscape(p.id)+'" class="'+(pool===p.id?'is-active':'')+'">'+dashPoolName(p.id)+' '+dashNumber(isA?p.accounts:p.versions)+'</button>').join('')+'</div>';
 const toolbar='<form id="dashSearch" class="dash-list-toolbar"><label>搜索'+(isA?'账号':'内容')+'<input name="q" value="'+dashEscape(q)+'" placeholder="'+(isA?'账号名称或ID':'标题或版本')+'" maxlength="120"></label><button class="dash-primary" type="submit">查询</button><span role="status">共 '+dashNumber(details.total)+' 个'+(isA?'账号':'版本')+'</span></form>';
 const rowHTML=rows.map((row,i)=>{const st=dashStats(row);return isA?
 '<tr><td><button class="dash-text-action" data-dash-row="'+i+'">'+dashEscape(row.name||row.account||row.account_key)+'</button></td><td>'+dashEscape(dashPoolName(row.pool))+'</td><td>'+dashEscape(dashRoles[row.currentRole]||'尚未生效')+(row.futureRole?'<small>未来：'+dashEscape(dashRoles[row.futureRole]||row.futureRole)+' · '+dashDate(row.futureEffectiveAt??row.effectiveAt,result.timeZone)+'</small>':'')+'</td><td>'+dashNumber(st.n)+'</td><td>'+dashNumber(st.medianViews)+'</td><td>'+dashPercent(st.completion)+'</td><td>'+dashEscape(row.paused?'已暂停':row.enrolled===false?'未纳入':row.eligibleAt>Date.now()?'次日起参与':'参与 / 按内容资格')+'</td><td><button class="dash-text-action" data-dash-row="'+i+'">查看详情</button></td></tr>':
 '<tr><td><button class="dash-text-action" data-dash-row="'+i+'">'+dashEscape(dashContentName(row))+'</button><small>'+dashEscape(row.variant||row.version||'原版')+' · '+dashEscape(row.style||'样式未知')+' · 修订 '+dashNumber(row.styleRevision??row.style_revision)+'</small></td><td>'+dashEscape(dashPoolName(row.pool))+'</td><td>'+dashNumber(row.published)+'</td><td>'+dashNumber(row.distinctAccounts??row.accounts)+' / 5<small>'+dashNumber(st.n)+' 条有效样本</small></td><td>'+dashNumber(row.waiting)+' / '+dashNumber(row.missingMetrics)+'</td><td>'+dashNumber(st.medianViews)+'</td><td>'+dashEscape(row.eligibilityReason||row.reason||'按成熟证据判断')+'</td><td><button class="dash-text-action" data-dash-row="'+i+'">证据</button></td></tr>';
 }).join('');
 const headers=isA?['账号','流量池','运营任务角色','成熟样本','中位播放','完成率','参与状态','详情']:['具体版本','内容池','累计已发布','有效成熟账号','待成熟 / 待同步','中位播放','可用 / 补测原因','详情'];
 return '<section class="dash-panel"><div class="dash-heading"><h2>'+ (isA?'账号池':'内容池')+'</h2><span class="dash-muted">'+(isA?'流量分层与任务角色分别展示':'文本、样式与修订分别验证')+'</span></div>'+filters+toolbar+
 (rows.length?'<div class="dash-table-wrap"><table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rowHTML+'</tbody></table></div>':'<div class="dash-empty"><strong>'+(!isA&&pool==='winner'?'尚无合格优胜版本':'暂无符合条件的数据')+'</strong><p>'+(!isA?'至少5个不同账号的成熟证据；待成熟、待同步与未发布占位分别展示。':'可更换流量池或清空搜索后查看项目账号。')+'</p><button class="dash-primary" data-dash-view="'+view+'" data-dash-pool="'+(isA?'':'explore')+'">'+(isA?'查看全部账号':'查看待验证版本')+'</button></div>')+
 '<div class="dash-pagination"><span>第 '+dashNumber(details.page||1)+' / '+dashNumber(details.pages||1)+' 页</span><button data-dash-page="-1" '+((details.page||1)<=1?'disabled':'')+'>上一页</button><button data-dash-page="1" '+((details.page||1)>=(details.pages||1)?'disabled':'')+'>下一页</button></div></section>';
}

function dashIcon(name){
 const paths={users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M21 20v-2a5 5 0 0 0-3-4"/>',send:'<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/>',chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',trophy:'<path d="M8 3h8v5a4 4 0 0 1-8 0V3ZM8 4H4v3a4 4 0 0 0 4 4M16 4h4v3a4 4 0 0 1-4 4M12 12v6M8 21h8M9 18h6"/>'};
 return '<svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[name]+'</svg>';
}
function dashDetailsHTML(row,kind,result,linked=[]){
 const stats=dashStats(row),isA=kind==='accounts';
 const facts=isA?[
 ['流量池',dashPoolName(row.pool)],['当前任务角色',dashRoles[row.currentRole]||'尚未生效'],
 ['未来任务角色',row.futureRole?(dashRoles[row.futureRole]||row.futureRole)+' · '+dashDate(row.futureEffectiveAt??row.effectiveAt,result.timeZone):'—'],
 ['成熟样本 / 中位播放',dashNumber(stats.n)+' / '+dashNumber(stats.medianViews)],
 ['千播率 / 完成率',dashPercent(stats.potentialRate)+' / '+dashPercent(stats.completion)],
 ['账号参与',row.paused?'已暂停':row.enrolled===false?'未纳入':'按当前权限和内容资格'],
 ['起始资格日期',dashDate(row.eligibleAt,result.timeZone)],['判断依据',row.reason||'基于近30天满72小时作品的最新累计指标；样本不足时保持观察。']
 ]:[
 ['内容池',dashPoolName(row.pool)],['具体版本', (row.variant||row.version||'原版')+' · '+(row.style||'样式未知')+' · 修订 '+dashNumber(row.styleRevision??row.style_revision)],
 ['累计已发布 / 不同成熟账号',dashNumber(row.published)+' 条 / '+dashNumber(row.distinctAccounts??row.accounts)+' 个'],
 ['中位播放 / 完成率',dashNumber(stats.medianViews)+' / '+dashPercent(stats.completion)],
 ['可用与补测原因',row.eligibilityReason||row.reason||'按当前内容库存与成熟证据核对'],
 ['资格要求','至少5个不同账号的成熟证据，效果达标且文本和样式当前可用']
 ];
 const counters=isA?'':'<div class="dash-evidence-counts">'+[[row.reserved,'尚未发布占位'],[row.waiting,'已发布待满72h'],[row.missingMetrics,'已成熟待同步'],[stats.n,'有效成熟样本']].map(([n,label])=>'<div><strong>'+dashNumber(n)+'</strong><small>'+label+'</small></div>').join('')+'</div>';
 return '<div class="dash-dialog-header"><h2 id="dashDialogTitle">'+dashEscape(isA?(row.name||row.account||row.account_key):dashContentName(row))+'</h2><button type="button" data-dash-close aria-label="关闭详情">关闭</button></div>'+counters+'<dl class="dash-facts">'+facts.map(([k,v])=>'<div><dt>'+dashEscape(k)+'</dt><dd>'+dashEscape(v)+'</dd></div>').join('')+'<h3>'+(isA?'已匹配的具体版本':'关联测试账号')+'</h3>'+
 (linked.length?'<div class="dash-linked">'+linked.map((r,i)=>'<button class="dash-text-action" data-dash-linked="'+i+'">'+dashEscape(isA?dashContentName(r):(r.name||r.account||r.account_key))+' →</button>').join('')+'</div>':'<p class="dash-note">暂无关联记录。</p>')+'<p class="dash-dialog-note">详情只读取本地记录，不触发测试或发布。关联记录每页最多10条，版本证据仍按整个授权范围计算。</p>';
}
const dashRoot=typeof document==='undefined'?null:document.querySelector('#poolDashboard');
if(dashRoot){
 const state={view:'overview',renderedView:'overview',pool:{accounts:'',content:''},q:{accounts:'',content:''},page:{accounts:1,content:1},account:'',data:null,seq:0,controller:null,busy:false,modalSeq:0,linked:[],linkedKind:''};
 const dialog=document.querySelector('#dashDialog');
 dashRoot.innerHTML='<nav class="dash-tabs" role="tablist" aria-label="自动运营视图">'+[['overview','项目总览'],['accounts','账号池'],['content','内容池']].map(([id,label])=>'<button type="button" role="tab" id="dash-tab-'+id+'" data-dash-view="'+id+'" aria-selected="'+(id==='overview')+'" aria-controls="dashBody">'+label+'</button>').join('')+'<span id="dashCycle" class="dash-tag"></span></nav><p id="dashStatus" class="dash-status" role="status">正在读取项目账号与内容数据…</p><div id="dashBody" role="tabpanel" aria-labelledby="dash-tab-overview"></div><p id="dashFreshness" class="dash-freshness"></p>';
 const body=document.querySelector('#dashBody'),status=document.querySelector('#dashStatus'),freshness=document.querySelector('#dashFreshness');
 function paramsFor(view=state.view){const p=new URLSearchParams();if(view!=='overview'){p.set('view',view);p.set('page',state.page[view]);if(state.pool[view])p.set(view==='accounts'?'accountPool':'contentPool',state.pool[view]);if(state.q[view])p.set('q',state.q[view]);if(view==='accounts'&&state.account)p.set('account',state.account);}return p;}
 async function request(params,signal){const r=await fetch('/api/psychology-autopilot/dashboard?'+params,{method:'GET',credentials:'same-origin',cache:'no-store',signal});const value=await r.json();if(!r.ok)throw Error(value.error||value.message||'读取失败，请稍后重试。');return value;}
 function paint(result){state.data=result;state.renderedView=state.view;document.querySelectorAll('[data-dash-view][role="tab"]').forEach(b=>{const active=b.dataset.dashView===state.view;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});body.setAttribute('aria-labelledby','dash-tab-'+state.view);body.innerHTML=state.view==='overview'?dashOverview(result):dashList(result,state.view,state);
  const p=result.policy||{},zone=result.timeZone||'America/Los_Angeles';document.querySelector('#dashCycle').textContent=!result.policy?'尚未设置项目运营':p.enabled===false?'项目自动运营已关闭':p.startsAt>Date.now()?dashDate(p.startsAt,zone).split(' ')[0]+' 起 · 7天运营，每3天复评':p.endsAt<=Date.now()?'周期已结束':'7天运营，每3天复评';freshness.textContent='项目数据读取于 '+dashDate(result.asOf,zone)+'（美西） · 分池采用近30天成熟样本 · '+(p.startsAt>Date.now()?'未来周期 '+dashDate(p.startsAt,zone)+' 起生效 · ':'')+'7天运营，每3天复评。新账号从美西次日参与；每天检查05:00 / 08:30 / 17:00，发布08:00 / 11:30 / 20:00，动态提前2–3小时准备。';
  const renderedView=state.renderedView;const form=document.querySelector('#dashSearch');if(form)form.addEventListener('submit',event=>{event.preventDefault();state.view=renderedView;state.q[renderedView]=form.querySelector('input').value.trim();state.page[renderedView]=1;state.account='';void load();});
 }
 async function load(quiet=false){const seq=++state.seq;state.controller?.abort();state.controller=new AbortController();state.busy=true;dashRoot.setAttribute('aria-busy','true');const view=state.view;if(!quiet)status.textContent='正在读取…';try{const result=await request(paramsFor(),state.controller.signal);if(seq!==state.seq||view!==state.view)return;paint(result);status.textContent='';}catch(error){if(seq!==state.seq||error.name==='AbortError')return;state.view=state.renderedView;status.textContent=(state.data?'保留上次数据；':'')+'读取失败：'+error.message;}finally{if(seq===state.seq){state.busy=false;dashRoot.setAttribute('aria-busy','false');}}}
 function select(view,pool){if(!['overview','accounts','content'].includes(view))return;state.view=view;state.account='';if(pool!==undefined&&view!=='overview'){state.pool[view]=pool;state.q[view]='';state.page[view]=1;}void load();}
 async function show(row,kind){const seq=++state.modalSeq;state.linked=[];state.linkedKind=kind==='accounts'?'content':'accounts';dialog.innerHTML=dashDetailsHTML(row,kind,state.data)+'<p role="status" id="dashDetailStatus">正在读取关联证据…</p>';if(!dialog.open)dialog.showModal();const p=new URLSearchParams({view:kind});
  if(kind==='accounts')p.set('account',row.account||row.account_key||row.id);
  else{p.set('source',row.source||'');p.set('variant',row.variant??row.version??'');p.set('style',row.style||'');p.set('copyHash',row.copyHash??row.copy_hash??'');p.set('styleRevision',row.styleRevision??row.style_revision??0);}
  try{const result=await request(p);if(seq!==state.modalSeq||!dialog.open)return;const record=result.details?.rows?.[0]||row;const links=kind==='accounts'?result.matchedVersions:result.linkedAccounts;state.linked=Array.isArray(links)?links:(links?.rows||[]);dialog.innerHTML=dashDetailsHTML(record,kind,result,state.linked);}
  catch(error){if(seq===state.modalSeq&&dialog.open)document.querySelector('#dashDetailStatus').textContent='关联记录读取失败：'+error.message;}
 }
 dashRoot.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.dataset.dashView){select(b.dataset.dashView,b.dataset.dashPool);return;}if(b.dataset.dashPage){state.view=state.renderedView;state.page[state.view]=Math.max(1,state.page[state.view]+Number(b.dataset.dashPage));void load();return;}if(b.dataset.dashRow!==undefined){const row=state.data?.details?.rows?.[Number(b.dataset.dashRow)];if(row)void show(row,state.renderedView);}});
 dashRoot.addEventListener('keydown',event=>{const current=event.target.closest('[role="tab"]');if(!current||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const views=['overview','accounts','content'],index=views.indexOf(state.view),next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;document.querySelector('#dash-tab-'+views[next]).focus();select(views[next]);});
 dialog.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;if(b.hasAttribute('data-dash-close')){++state.modalSeq;dialog.close();}else if(b.dataset.dashLinked!==undefined){const row=state.linked[Number(b.dataset.dashLinked)];if(row)void show(row,state.linkedKind);}});
 dialog.addEventListener('cancel',()=>{++state.modalSeq;});
 document.querySelector('#reload')?.addEventListener('click',()=>void load());
 setInterval(()=>{if(!document.hidden&&!document.querySelector('dialog[open]')&&!state.busy&&document.activeElement?.closest('#dashSearch')==null)void load(true);},30000);
 void load();
}

function dashMovement(result){
 const rows=(result.poolTrend?.rows||result.observations?.rows||[]).filter(r=>r.observedAt!=null&&r.accounts!=null);
 if(rows.length<2)return '<p class="dash-note">分池变化从上线后的每日三次检查开始记录；有两个运营日的记录后展示跨日变化。</p>';
 const previous=rows[rows.length-2],latest=rows[rows.length-1],delta=latest.accounts-previous.accounts,sign=n=>(n>0?'+':'')+dashNumber(n);
 return '<p class="dash-note">检查快照 '+dashEscape(latest.date)+' 较 '+dashEscape(previous.date)+'：项目账号 '+sign(delta)+'，强号 '+sign((latest.pools?.strong||0)-(previous.pools?.strong||0))+'，中号 '+sign((latest.pools?.normal||0)-(previous.pools?.normal||0))+'。记录于 '+dashDate(latest.observedAt,result.timeZone)+'（美西）。</p>';
}
