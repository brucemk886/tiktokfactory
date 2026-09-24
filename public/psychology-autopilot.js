const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = value => value == null ? '—' : Number(value).toLocaleString('zh-CN', { maximumFractionDigits:1 });
const pct = value => value == null ? '—' : (value * 100).toFixed(1) + '%';
const time = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone:'Asia/Shanghai', hour12:false, month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
const STATUS = { active:'运行中', paused:'已暂停', ended:'已结束' };
const SLOT = { creating:'创建中', created:'已创建排期', failed:'创建失败', skipped:'已跳过' };
const ITEM = { queued:'等待制作', producing:'制作中', publishing:'提交 / 处理中', scheduled:'等待官方发布', published:'已发布', production_failed:'制作失败', publish_failed:'发布失败', cancelled:'已停止', missing:'结果待核对' };
let data = null, loading = false, pendingPause = null, creating = false;
const selectedGroups = new Set(), createdGroups = new Set();
async function api(path = '', method = 'GET', body) {
  const response = await fetch('/api/psychology-autopilot' + path, { method, cache:'no-store', ...(body ? { headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败');
  return result;
}
function table(headers, rows) { return '<div class="table-wrap"><table class="ops-table"><thead><tr>' + headers.map(h => '<th scope="col">' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>'; }
function notice(text, error = false) { $('#status').textContent = text; $('#status').classList.toggle('pilot-error', error); }
function totals(c = {}) { return `计划 ${c.planned||0} · 已发布 ${c.published||0} · 制作 ${Number(c.queued||0)+Number(c.producing||0)} · 待发布 ${c.pending||0} · 失败 ${c.failed||0} · 已停止 ${c.stopped||0}${c.unknown ? ' · 待核对 '+c.unknown : ''}`; }
async function load(quiet = false, refreshGroups = false) {
  if (loading || creating) return;
  loading = true; $('#reload').disabled = true; $('#refreshGroups').disabled = true;
  if (!quiet) notice(refreshGroups ? '正在更新账号分组与发布状态…' : '正在读取本地发布回执…');
  if (refreshGroups) { $('#groupDirectoryStatus').textContent='正在同步授权账号目录…'; $('#createButton').disabled=true; }
  try { const next = await api(refreshGroups ? '?refreshGroups=1' : ''); data = next; for(const p of data.pilots) if(p.status==='ended')createdGroups.delete(p.groupId); render(); if (refreshGroups) $('#groupDirectoryStatus').textContent='账号分组已更新。'; if (!quiet) notice(data.pilots.length ? '状态已更新。' : '还没有自动运营，点击右侧新建。'); }
  catch (error) { notice('更新失败，保留上次数据：'+error.message, true); if(refreshGroups) $('#groupDirectoryStatus').textContent='账号目录更新失败，保留上次结果：'+error.message; }
  finally { loading = false; $('#reload').disabled = false; $('#refreshGroups').disabled = false; updateCreateControls(); }
}
function renderStrategyRules() {
  const strategy = $('#strategy').value || 'evolve', selected = data?.strategyRules?.[strategy];
  $('#strategyRulesTitle').textContent = '当前策略规则 · ' + (data?.strategies?.[strategy] || strategy);
  $('#strategySummary').textContent = selected?.summary || '正在读取策略规则…';
  $('#strategyRules').innerHTML = (selected?.rules || []).map(rule => '<li>' + esc(rule) + '</li>').join('');
}
$('#strategy').addEventListener('change', renderStrategyRules);
function availableGroups() {
  const live = new Set((data?.pilots || []).filter(p => p.status !== 'ended').map(p => p.groupId));
  return (data?.groups || []).filter(g => g.accounts > 0 && !live.has(g.id) && !createdGroups.has(g.id));
}
function updateCreateControls() {
  const count = selectedGroups.size;
  $('#groupSelectionCount').textContent = `已选 ${count} 个分组 · ${availableGroups().filter(g=>selectedGroups.has(g.id)).reduce((sum,g)=>sum+g.accounts,0)} 个账号`;
  $('#createButton').textContent = creating ? '正在批量启动…' : `启动所选 ${count} 个分组`;
  $('#createButton').disabled = creating || loading || !count;
  for (const id of ['selectAllGroups','clearGroups','strategy','days','refreshGroups']) $('#'+id).disabled = creating || loading;
  for (const input of document.querySelectorAll('[data-create-group]')) input.disabled = creating || !availableGroups().some(g=>g.id===input.value);
}
function renderGroupChoices() {
  const allowed = new Set(availableGroups().map(g=>g.id));
  for (const id of selectedGroups) if (!allowed.has(id)) selectedGroups.delete(id);
  $('#groupChoices').innerHTML = (data?.groups || []).map(g => `<label class="pilot-group-choice"><input type="checkbox" data-create-group value="${esc(g.id)}" ${selectedGroups.has(g.id)?'checked':''} ${allowed.has(g.id)?'':'disabled'}><span>${esc(g.name)}<small>${g.accounts} 个账号${allowed.has(g.id)?'':g.accounts?' · 已托管':' · 无可发布账号'}</small></span></label>`).join('') || '<p class="section-hint">暂无可用账号分组。</p>';
  updateCreateControls();
}
$('#groupChoices').addEventListener('change', event => {
  const input = event.target;
  if (creating || !input.matches('[data-create-group]')) return;
  if (input.checked && availableGroups().some(g=>g.id===input.value)) selectedGroups.add(input.value);
  else selectedGroups.delete(input.value);
  updateCreateControls();
});
$('#selectAllGroups').onclick = () => { if(creating || loading)return; for(const g of availableGroups())selectedGroups.add(g.id); renderGroupChoices(); };
$('#clearGroups').onclick = () => { if(creating || loading)return; selectedGroups.clear(); renderGroupChoices(); };
$('#createDialog').addEventListener('cancel', event => { if(creating)event.preventDefault(); });
function render() {
  const pilots = data.pilots;
  renderGroupChoices();
  if (!$('#strategy').options.length) $('#strategy').innerHTML = Object.entries(data.strategies).map(([id,label])=>`<option value="${id}">${esc(label)}</option>`).join('');
  renderStrategyRules();
  const r = data.rules, evolution = data.evolutionRules;
  $('#rules').innerHTML = [
    '每号每天 3 条，北京时间 '+r.slots.map(s=>String(s.hour).padStart(2,'0')+':'+String(s.minute).padStart(2,'0')).join(' / ')+'；各账号错开 '+r.staggerSeconds+' 秒。',
    '每天 0 点、8 点检查并排期，从图文文案库抽取，同一个账号不重复发同一篇爆款。',
    '配对选题：同一运营人、同一时段的分组使用共同候选排序，再按所选策略挑版本；各账号用过的选题和可用版本不同，最终内容不保证完全相同。',
    ...(evolution ? [`选题顺序：约 ${Math.round(evolution.exploitShare*100)}% 倾向已有成熟表现的选题，约 ${Math.round((1-evolution.exploitShare)*100)}% 倾向尚无成熟表现的选题。成熟选题按最佳成熟版本的平均播放排序，未成熟选题按入库顺序；这与 A 的版本选择比例是两层规则。`] : []),
    '同一个账号不会重复使用同一篇选题，不论原版或改写；同一批次不重复使用同一个版本。只能选择文案库中可用的内容，不会因启动运营自动生成新改写。',
    '三种策略的发布时间、每日数量、配对选题和停发条件相同。切换策略只改变版本选择方式。',
    `连续 ${r.lowPosts} 条满24小时低于 ${r.lowViews} 播放，或连续 ${r.failStreak} 次发布失败，自动停发该号并停止本地尚未提交的任务。`,
  ].map(t=>'<li>'+esc(t)+'</li>').join('');
  const sum = pilots.reduce((s,p)=>{ for(const [k,v] of Object.entries(p.today||{}))s[k]=(s[k]||0)+v;return s; },{});
  const active = pilots.filter(p=>p.status==='active').reduce((n,p)=>n+p.accounts.filter(a=>a.status==='active').length,0);
  const stopped = pilots.filter(p=>p.status!=='ended').reduce((n,p)=>n+p.accounts.filter(a=>a.status==='paused'||p.status==='paused').length,0);
  $('#overview').innerHTML = [['运营账号',active],['今日已排',sum.planned||0],['制作中 / 待制作',(sum.producing||0)+(sum.queued||0)],['待发布 / 处理中',sum.pending||0],['已发布',sum.published||0],['失败 / 待核对',(sum.failed||0)+(sum.unknown||0)],['停发账号',stopped],['已停止任务',sum.stopped||0]].map(([label,n])=>`<div class="pilot-metric"><span>${label}</span><strong>${fmt(n)}</strong></div>`).join('');
  const next = pilots.map(p=>p.nextCheckAt).filter(Boolean).sort((a,b)=>a-b)[0];
  $('#freshness').textContent = `回执读取于 ${time(data.fetchedAt)} · 下次计划检查 ${time(next)}（北京时间，实际以后台调度为准）。今日数量为已创建任务，未成功创建的排期见下方异常。页面每 30 秒读取本地记录，不主动查询 TikTok。`;
  const alerts = [];
  for(const p of pilots) {
    if(p.lastRunError)alerts.push([esc(p.groupName),'最近检查异常',esc(p.lastRunError),`<a href="#${p.id}">查看日志并处理</a>`]);
    if(p.status==='active' && p.latest?.at && data.fetchedAt-p.latest.at>32*3600000)alerts.push([esc(p.groupName),'分析数据未更新','最近分析超过 32 小时，请检查后台日志。',`<a href="#${p.id}">查看运营日志</a>`]);
    for(const s of p.schedule.filter(s=>s.detail||s.status==='failed'))alerts.push([esc(p.groupName), '排期异常', esc(s.detail||'创建失败'), `<a href="#${p.id}">查看分组并重新检查</a>`]);
    for(const a of p.accounts.filter(a=>a.status==='paused'&&p.status!=='ended'))alerts.push([esc(p.groupName), '@'+esc(a.name)+' 已停发', esc(a.reason), `<a href="#${p.id}">查看账号</a>`]);
    for(const i of p.attention||[])alerts.push([esc(p.groupName)+'<small>@'+esc(i.account)+'</small>', esc(i.retrying?'自动恢复中':ITEM[i.state]||i.state), esc(i.retrying ? (i.retryAt?'计划重试 '+time(i.retryAt):'后台正在重试') : i.error||'暂无详细原因'), `<button data-detail="${p.id}" data-slot="${i.slotAt}">查看内容</button>`]);
    if(p.status==='active' && p.lastRunAt && data.fetchedAt-p.lastRunAt>26*3600000)alerts.push([esc(p.groupName),'检查延迟','超过 26 小时没有自动检查，请核对后台运行情况。',`<a href="#${p.id}">立即检查</a>`]);
  }
  $('#attention').innerHTML = alerts.length ? `<p>${alerts.length} 项待核对 / 恢复中</p>`+table(['分组 / 账号','情况','原因 / 下一步','操作'],alerts.slice(0,30))+(alerts.length>30?'<p>先显示前 30 项，展开各组排期查看全部明细。</p>':'') : '<p class="section-hint">最近排期没有待处理异常。</p>';
  $('#compare').innerHTML = pilots.length ? table(['分组 / 策略','状态','今日执行','近7天成熟作品','中位播放 / 破千率','最近检查','详情'],pilots.map(p=>[esc(p.groupName)+'<small>'+esc(p.strategyLabel)+'</small>',STATUS[p.status],esc(totals(p.today)),fmt(p.latest?.overview?.n),fmt(p.latest?.overview?.medianViews)+' / '+pct(p.latest?.overview?.potentialRate),time(p.lastRunAt),`<a href="#${p.id}">查看运营详情</a>`])) : '<p>创建运营计划后，会在这里显示各组执行和效果。</p>';
  const opened = new Set([...document.querySelectorAll('#pilots details[open]')].map(d=>d.id));
  const slotBodies = new Map([...document.querySelectorAll('[data-slot-body]')].map(e=>[e.id,e.innerHTML]));
  $('#pilots').innerHTML = pilots.map(p=>{
    const actions = p.status==='ended' ? '' : (p.status==='active' ? `<button data-run="${p.id}">立即检查并排期</button><button data-pause="${p.id}">暂停…</button>` : `<button data-status="active" data-pilot="${p.id}">恢复运营</button><button data-pause="${p.id}">停止未提交任务…</button>`) + `<button data-status="ended" data-pilot="${p.id}">结束运营</button>`;
    const schedule = [...p.schedule].sort((a,b)=>b.slotAt-a.slotAt);
    return `<section class="panel data-section pilot" id="${p.id}"><div class="section-title"><div><h2>${esc(p.groupName)} <span class="ops-chip">${STATUS[p.status]}</span></h2><p class="section-hint">${esc(p.strategyLabel)} · 运行至 ${time(p.endsAt)}${p.status==='paused'?' · '+(p.stopPending?'已停止本地未提交任务':'仅暂停新增排期，已排任务继续'):''}</p></div><div class="pilot-actions">${actions}</div></div>
    <h3>最近 12 个发布排期</h3>${schedule.length?schedule.map(s=>`<details class="pilot-slot" id="slot-${p.id}-${s.slotAt}" data-slot-details data-pilot="${p.id}" data-slot="${s.slotAt}"><summary>${time(s.slotAt)} · ${SLOT[s.status]||esc(s.status)}<span>${esc(totals(s.counts))}</span></summary>${s.detail?'<p class="pilot-error">'+esc(s.detail)+'</p>':''}<div id="body-${p.id}-${s.slotAt}" data-slot-body><button data-detail="${p.id}" data-slot="${s.slotAt}">读取内容明细</button></div></details>`).join(''):'<p>还没有排期。</p>'}
    <details id="accounts-${p.id}" class="ops-daily"><summary>账号状态（${p.accounts.length}）</summary>${table(['账号','状态','原因 / 暂停范围','操作'],p.accounts.map(a=>['@'+esc(a.name),a.status==='active'?(p.status==='active'?'参与排期':'随运营暂停'):'已停发',esc(a.reason||'—')+(a.status==='paused'?'<small>'+(a.stopPending?'本地未提交任务已停止':'仅停止新增排期')+'</small>':''),p.status==='ended'?'':a.status==='active'?`<button data-pause="${p.id}" data-account="${esc(a.connectionId)}">停发…</button>`:`<button data-pilot="${p.id}" data-account="${esc(a.connectionId)}" data-account-status="active">恢复</button>`]))}</details>
    <details id="logs-${p.id}" class="ops-daily"><summary>运营日志与分析</summary>${p.latest?.findings?.length?'<ul>'+p.latest.findings.map(f=>'<li>'+esc(f)+'</li>').join('')+'</ul>':''}<ul class="pilot-log">${p.logs.map(l=>`<li class="is-${esc(l.kind)}"><time>${time(l.at)}</time>${esc(l.message)}</li>`).join('')}</ul></details></section>`;
  }).join('');
  for(const id of opened){const d=document.getElementById(id);if(d)d.open=true;}
  for(const [id,html] of slotBodies){const el=document.getElementById(id);if(el&&opened.has(id.replace('body-','slot-')))el.innerHTML=html;}
}
async function detail(pilot,slot){
  const section=document.getElementById(`slot-${pilot}-${slot}`),body=document.getElementById(`body-${pilot}-${slot}`);
  section.open=true;body.textContent='正在读取明细…';section.scrollIntoView({block:'nearest'});
  try { const r=await api(`/${pilot}/slots/${slot}`);body.innerHTML=`<p class="section-hint">读取于 ${time(Date.now())} <button data-detail="${pilot}" data-slot="${slot}">刷新明细</button></p>`+table(['账号 / 内容','文案版本','计划发布时间','实际状态','视频 ID','原因 / 处理'],r.items.map(i=>['@'+esc(i.account)+'<small>'+esc(i.title)+'</small>',esc(i.version),time(i.scheduleAt),esc(ITEM[i.state]||i.state)+(i.retrying?'<small>系统自动恢复中</small>':''),esc(i.videoId||'尚未返回'),esc(i.error||'—')+`<small><a href="/psychology-publish-sources">查看发布记录</a> · <a href="/psychology-publish">进入自动发布处理</a></small>`])); }
  catch(e){body.textContent=e.message;}
}
async function openPause(pilot,account=''){
  pendingPause={pilot,account};$('#pauseTitle').textContent=account?'停发此账号':'暂停自动运营';$('#pauseChoices').hidden=Boolean(account);$('#pauseImpact').textContent='正在计算影响范围…';$('#confirmPause').disabled=true;$('#pauseDialog').showModal();
  try { const r=await api(`/${pilot}/impact${account?'?account='+encodeURIComponent(account):''}`);$('#pauseImpact').textContent=`当前可停止 ${r.stoppable} 条本地未提交任务；${r.protected} 条已进入提交或需要核对结果，不能直接撤回。数量以确认时为准。`;$('#confirmPause').disabled=false; }
  catch(e){$('#pauseImpact').textContent=e.message;}
}
document.addEventListener('click',async event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.close){if(b.dataset.close==='createDialog' && creating)return;$('#'+b.dataset.close).close();return;}
  if(b.dataset.detail){await detail(b.dataset.detail,b.dataset.slot);return;}
  if(b.dataset.pause){await openPause(b.dataset.pause,b.dataset.account);return;}
  const pilot=b.dataset.pilot||b.dataset.run;if(!pilot)return;
  if(b.dataset.status==='ended'&&!confirm('结束后不再新增排期，已排好的任务继续。如需停止本地未提交任务，请先使用暂停。结束后不可恢复，确定结束？'))return;
  b.disabled=true;
  try {
    if(b.dataset.run){const r=await api('/'+pilot+'/run','POST');notice(`检查完成：新增 ${r.batches.length} 个批次，停发 ${r.paused.length} 个账号${r.errors.length?'；'+r.errors.join('；'):''}`,Boolean(r.errors.length));}
    else if(b.dataset.account)await api('/'+pilot+'/accounts/'+encodeURIComponent(b.dataset.account),'PATCH',{status:b.dataset.accountStatus});
    else await api('/'+pilot,'PATCH',{status:b.dataset.status});
    await load(true);
  }catch(e){notice(e.message,true);b.disabled=false;}
});
$('#confirmPause').onclick=async()=>{
  const {pilot,account}=pendingPause;$('#confirmPause').disabled=true;
  try{const r=await api('/'+pilot+(account?'/accounts/'+encodeURIComponent(account):''),'PATCH',{status:'paused',stopPending:account?true:document.querySelector('[name="pauseMode"]:checked').value==='pending'});$('#pauseDialog').close();notice(`已暂停，实际停止本地未提交任务 ${r.stopped||0} 条。已进入提交的任务仍会继续。`);await load(true);}
  catch(e){$('#pauseImpact').textContent=e.message;$('#confirmPause').disabled=false;}
};
$('#openCreate').onclick=()=>{$('#createDialog').showModal();load(true,true);};
$('#refreshGroups').onclick=()=>load(false,true);
$('#createForm').addEventListener('submit',async event=>{
  event.preventDefault();
  if (creating || loading) return;
  const groups = availableGroups().filter(g=>selectedGroups.has(g.id));
  const strategy = $('#strategy').value, days = Number($('#days').value);
  if (!groups.length) { $('#createStatus').textContent='请至少选择一个可用分组。'; return; }
  if (!data.strategies[strategy] || !Number.isInteger(days) || days<1 || days>30) { $('#createStatus').textContent='请选择策略，并填写 1–30 天。'; return; }
  creating = true; updateCreateControls();
  const closeButton = document.querySelector('[data-close="createDialog"]'); closeButton.disabled=true;
  const results = []; let succeeded=0, warnings=0;
  $('#createResults').innerHTML='';
  try {
    for (const [index,group] of groups.entries()) {
      $('#createStatus').textContent=`正在启动 ${index+1}/${groups.length}：${group.name}，请保持页面打开…`;
      try {
        const r=await api('','POST',{groupId:group.id,strategy,days});
        succeeded++; createdGroups.add(group.id); selectedGroups.delete(group.id);
        const errors=r.run?.errors || []; if(errors.length)warnings++;
        results.push({name:group.name,error:errors.length>0,message:`已创建，新增 ${r.run?.batches?.length || 0} 个批次${errors.length?'；排期需处理：'+errors.join('；'):''}`});
      } catch(e) {
        results.push({name:group.name,error:true,message:'未确认创建成功：'+e.message+'；请核对下方运营分组后再重试。'});
      }
      $('#createResults').innerHTML=results.map(r=>`<li class="${r.error?'pilot-error':''}"><strong>${esc(r.name)}</strong>：${esc(r.message)}</li>`).join('');
    }
    const summary=`已创建 ${succeeded}/${groups.length} 个分组${groups.length-succeeded?'，'+(groups.length-succeeded)+' 个未确认成功':''}${warnings?'，'+warnings+' 个排期需处理':''}。`;
    $('#createStatus').textContent=summary; notice(summary,succeeded<groups.length || warnings>0);
  } finally {
    creating=false; closeButton.disabled=false;
    renderGroupChoices(); await load(true); updateCreateControls();
  }
});
$('#reload').onclick=()=>load(false,true);
setInterval(()=>{if(!document.hidden&&!document.querySelector('dialog[open]'))load(true);},30000);
load(false,true);
