const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = value => value == null ? '—' : Number(value).toLocaleString('zh-CN', { maximumFractionDigits:1 });
const pct = value => value == null ? '—' : (value * 100).toFixed(1) + '%';
const ZONES={ 'Asia/Shanghai':'北京时间', 'America/Los_Angeles':'美国太平洋时间' };
const zoneFor=value=>Object.hasOwn(ZONES,value)?value:'Asia/Shanghai';
function selectedZone(id){const value=$('#'+id).value;if(!Object.hasOwn(ZONES,value))throw Error('请选择北京时间或美国太平洋时间。');return value;}
const time=(value,zone='Asia/Shanghai')=>value?new Date(value).toLocaleString('zh-CN',{timeZone:zoneFor(zone),hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
function zonedTime(value,zone='Asia/Shanghai'){
 if(!value||!Number.isFinite(new Date(value).getTime()))return '—';zone=zoneFor(zone);
 if(zone==='Asia/Shanghai')return time(value)+' 北京时间';
 const abbreviation=new Intl.DateTimeFormat('en-US',{timeZone:zone,timeZoneName:'short'}).formatToParts(new Date(value)).find(part=>part.type==='timeZoneName')?.value||zone;
 return time(value,zone)+' 美国太平洋时间（'+abbreviation+'） · '+time(value)+' 北京时间';
}
const pilotZoneAt=(pilot,value)=>zoneFor(pilot.pendingTimeZone&&pilot.scheduleEffectiveAt&&value>=pilot.scheduleEffectiveAt?pilot.pendingTimeZone:pilot.timeZone);
const pilotTime=(pilot,value)=>zonedTime(value,pilotZoneAt(pilot,value));
const projectSlots=zone=>zoneFor(zone)==='America/Los_Angeles'?'08:00 / 11:30 / 20:00':'08:00 / 14:00 / 20:00';
const STATUS = { active:'运行中', paused:'已暂停', ended:'已结束' };
const SLOT = { creating:'创建中', created:'已创建排期', failed:'创建失败', skipped:'已跳过' };
const ITEM = { queued:'等待制作', producing:'制作中', publishing:'提交 / 处理中', scheduled:'等待官方发布', published:'已发布', production_failed:'制作失败', publish_failed:'发布失败', cancelled:'已停止', missing:'结果待核对' };
const TASK_ROLES = {
 review:{label:'内容评审',action:'成熟中强号固定版本验证，默认每天2轮复评、1轮优胜产出'},
 strong:{label:'强号产出',action:'优胜内容保产出，少量优化与探索'},
 normal:{label:'中号产出',action:'优胜基准与优化验证'},
 'rescue-hook':{label:'首图救援',action:'成熟基准下单独验证首图或标题'},
 'rescue-content':{label:'内页救援',action:'成熟基准下单独改善内页与页序'},
 diagnostic:{label:'近零诊断',action:'最多六条成熟基准测试后复查'},
 observing:{label:'待观察',action:'等待成熟样本，无优胜基准时等待'},
 launch:{label:'新号起量',action:'正式优胜内容建立基准，无基准时等待'},
};
let taskGroupsData=null,taskGroupRequest=0,taskMemberRequest=0,taskGroupRole='',taskGroupPage=1,taskGroupPages=1;
let taskConfigBusy=false,taskConfigReady=false,taskPreview=null;

let selectedPeriod = 'today';
const PERIOD_LABELS={today:'今天',yesterday:'昨天','7d':'近7天'};
let data = null, loading = false, pendingPause = null, creating = false, switchingPools = false;
const selectedGroups = new Set(), createdGroups = new Set(), groupSchedules = new Map();
let defaultTimes = ['08:00','21:00'], editTimes = [], editingPilot = '', savingSchedule = false;
const hm = slot => `${String(slot.hour).padStart(2,'0')}:${String(slot.minute).padStart(2,'0')}`;
function timesForCount(current, count) {
  if(!Number.isInteger(count) || count<1 || count>10)throw Error('每号每天应发布 1–10 条。');
  return Array.from({length:count},(_,i)=>current[i] || hm({hour:Math.floor((480+i*Math.floor(900/count))/60),minute:(480+i*Math.floor(900/count))%60}));
}
function timeFields(times, scope) { return times.map((t,i)=>`<label>第 ${i+1} 条<input type="time" value="${esc(t)}" data-time-scope="${esc(scope)}" data-time-index="${i}" required></label>`).join(''); }
function slotsFromTimes(times, accounts=1) {
  if(!times.length || times.length>10 || times.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))throw Error('请为每条内容填写有效的发布时间。');
  if(new Set(times).size!==times.length)throw Error('每天的发布时间不能重复。');
  const slots=times.map(t=>({hour:Number(t.slice(0,2)),minute:Number(t.slice(3))})).sort((a,b)=>a.hour*60+a.minute-b.hour*60-b.minute);
  const last=slots.at(-1);if((last.hour*60+last.minute)*60+Math.max(0,accounts-1)*45>=86400)throw Error('最后的时间过晚，组内错峰后会跨天，请提前。');
  return slots;
}
function renderGroupSchedules() {
  const groups=availableGroups().filter(g=>selectedGroups.has(g.id));
  for(const g of groups)if(!groupSchedules.has(g.id))groupSchedules.set(g.id,[...defaultTimes]);
  $('#groupSchedules').innerHTML=groups.map(g=>`<div class="pilot-group-schedule"><strong>${esc(g.name)} · ${g.accounts} 个账号</strong><label>每号每天<input type="number" min="1" max="10" value="${groupSchedules.get(g.id).length}" data-group-count="${esc(g.id)}"> 条</label><div class="pilot-time-inputs">${timeFields(groupSchedules.get(g.id),g.id)}</div></div>`).join('') || '<p class="section-hint">选择分组后可分别调整时间和数量。</p>';
}
$('#createTimeZone').value='Asia/Shanghai';
$('#defaultTimes').innerHTML=timeFields(defaultTimes,'default');
$('#defaultDailyCount').addEventListener('change',e=>{try{defaultTimes=timesForCount(defaultTimes,Number(e.target.value));$('#defaultTimes').innerHTML=timeFields(defaultTimes,'default');}catch(err){$('#createStatus').textContent=err.message;}});
$('#editDailyCount').addEventListener('change',e=>{try{editTimes=timesForCount(editTimes,Number(e.target.value));$('#editTimes').innerHTML=timeFields(editTimes,'edit');}catch(err){$('#scheduleStatus').textContent=err.message;}});
document.addEventListener('change',e=>{
  if(creating || savingSchedule)return;
  const input=e.target;
  if(input.dataset.timeScope){const times=input.dataset.timeScope==='default'?defaultTimes:input.dataset.timeScope==='edit'?editTimes:groupSchedules.get(input.dataset.timeScope);if(times)times[Number(input.dataset.timeIndex)]=input.value;}
  if(input.dataset.groupCount){try{groupSchedules.set(input.dataset.groupCount,timesForCount(groupSchedules.get(input.dataset.groupCount),Number(input.value)));renderGroupSchedules();}catch(err){$('#createStatus').textContent=err.message;input.value=groupSchedules.get(input.dataset.groupCount).length;}}
});
function applyGroupSchedule(stagger=false) {
  if(creating || loading)return;
  try {
    slotsFromTimes(defaultTimes);
    const offset=stagger?Number($('#groupOffset').value):0;
    if(stagger&&(!Number.isInteger(offset)||offset<1||offset>180))throw Error('组间错开应为 1–180 分钟。');
    const groups=availableGroups().filter(g=>selectedGroups.has(g.id)), updates=[];
    for(const [index,g] of groups.entries()){
      const times=defaultTimes.map(t=>{const m=Number(t.slice(0,2))*60+Number(t.slice(3))+index*offset;if(m>=1440)throw Error('错峰后超过当天，请提前默认时间或减少组间间隔。');return hm({hour:Math.floor(m/60),minute:m%60});});
      slotsFromTimes(times,g.accounts);updates.push([g.id,times]);
    }
    for(const [id,times] of updates)groupSchedules.set(id,times);
    renderGroupSchedules();$('#createStatus').textContent=`已${stagger?'错峰分配':'应用设置到'} ${groups.length} 个分组。`;
  }catch(err){$('#createStatus').textContent=err.message;}
}
$('#applySchedule').onclick=()=>applyGroupSchedule();$('#staggerGroups').onclick=()=>applyGroupSchedule(true);

async function api(path = '', method = 'GET', body) {
  const response = await fetch('/api/psychology-autopilot' + path, { method, cache:'no-store', ...(body ? { headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败');
  return result;
}
function table(headers, rows) { return '<div class="table-wrap"><table class="ops-table"><thead><tr>' + headers.map(h => '<th scope="col">' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>'; }
function notice(text, error = false) { $('#status').textContent = text; $('#status').classList.toggle('pilot-error', error); }
function totals(c = {}) { return `计划 ${c.planned||0} · 已发布 ${c.published||0} · 制作 ${Number(c.queued||0)+Number(c.producing||0)} · 待发布 ${c.pending||0} · 失败 ${c.failed||0} · 已停止 ${c.stopped||0}${c.unknown ? ' · 待核对 '+c.unknown : ''}`; }
async function load(quiet = false, refreshGroups = false, refreshTaskGroups = true) {
  if (loading || creating || switchingPools || taskConfigBusy) return;
  const period=selectedPeriod;
  loading = true; $('#reload').disabled = true; $('#refreshGroups').disabled = true;
  if (!quiet) notice(refreshGroups ? '正在更新账号分组与发布状态…' : '正在读取本地发布回执…');
  if (refreshGroups) { $('#groupDirectoryStatus').textContent='正在同步授权账号目录…'; $('#createButton').disabled=true; }
  try { const query=(period==='today'?'':'period='+period)+(refreshGroups?(period==='today'?'':'&')+'refreshGroups=1':''); const pending=api(query?'?'+query:''); if(refreshTaskGroups)void loadTaskGroups(); const next = await pending; if(period!==selectedPeriod)return; data = next; for(const p of data.pilots) if(p.status==='ended')createdGroups.delete(p.groupId); render(); if (refreshGroups) $('#groupDirectoryStatus').textContent='账号分组已更新。'; if (!quiet) notice(data.pilots.length ? '状态已更新。' : '暂无原发布计划。可在项目设置中预览并启用项目自动运营。'); }
  catch (error) { if(period!==selectedPeriod)return; notice('更新失败，保留上次数据：'+error.message, true); if(refreshGroups) $('#groupDirectoryStatus').textContent='账号目录更新失败，保留上次结果：'+error.message; }
  finally { loading = false; $('#reload').disabled = false; $('#refreshGroups').disabled = false; updateCreateControls(); if(period!==selectedPeriod)load(); }
}
function renderProductionCapacity(){
 const target=$('#productionCapacity'),capacity=data.productionCapacity;
 if(capacity==null){target.hidden=!Object.hasOwn(data,'productionCapacity');target.innerHTML=target.hidden?'':'尚未完成生成准备检查；每天美西05:00/08:30/17:00更新。';return;}
 if(!Number.isFinite(capacity.leadMs)){target.hidden=true;target.innerHTML='';return;}
 const hours=value=>fmt(Number.isFinite(value)?value/3600000:null),risk=capacity.capacityRisk||capacity.shortLead;
 const samples=Number.isFinite(capacity.sampleCount)?capacity.sampleCount:null;
 const basis=samples==null?'完成样本数未记录。':samples<20?'完成样本不足20条，采用保守估算（单条按至少5分钟参考）。':'最近7天P95单条耗时 '+fmt(Number.isFinite(capacity.serviceMs)?capacity.serviceMs/60000:null)+' 分钟参考。';
 const warnings=[capacity.capacityRisk?'积压风险：容量估算超过当前准备窗口。':'',capacity.shortLead?'临近排期准备时间偏短。':''].filter(Boolean).join(' ');
 target.hidden=false;
 target.innerHTML='<strong>生成准备 · 最近检查预计提前 '+hours(capacity.leadMs)+' 小时</strong><br>参与账号 '+fmt(capacity.accountCount)+' 个 · 同窗口预估任务 '+fmt(capacity.forecastJobs)+' 条 · 共享积压 '+fmt(capacity.backlogJobs)+' 条<br><span class="section-hint">'+esc(basis)+(samples==null?'':' 完成样本 '+fmt(samples)+' 条。')+' 最近检查于 '+esc(zonedTime(capacity.asOf))+'。</span>'+(risk?'<br><span class="pilot-error">'+esc(warnings)+' 估算所需 '+hours(capacity.requiredLeadMs)+' 小时，准备提前量上限3小时；当前提前量可能不足，不能保证准时。</span>':'')+(capacity.reason?'<br><span class="section-hint">'+esc(capacity.reason)+'</span>':'')+'<br><span class="section-hint">最近检查估算与所选统计日期无关。每天检查3次：美西05:00/08:30/17:00（每轮前3小时），复算只提前、不推迟；任务按保存的生成时间执行，计划开始时间见内容明细。</span>';
}
function generationCell(item,pilot){
 if(!Number.isFinite(item.generationStartAt)||item.generationStartAt<=0)return '—';
 const zone=item.timeZone||pilotZoneAt(pilot,item.scheduleAt);
 return esc(zonedTime(item.generationStartAt,zone))+(Number.isFinite(item.productionLeadMs)?'<small>计划提前 '+fmt(item.productionLeadMs/3600000)+' 小时'+(item.productionPolicy==='adaptive-v1'?' · 动态估算':'')+'</small>':'')+(item.productionRisk?'<small class="pilot-error">准备时间可能不足，不能保证准时。</small>':'');
}
function renderStrategyRules() {
  const strategy = $('#strategy').value || (data?.strategies?.pools ? 'pools' : 'evolve'), selected = data?.strategyRules?.[strategy];
  $('#strategyRulesTitle').textContent = '当前策略规则 · ' + (data?.strategies?.[strategy] || strategy);
  $('#strategySummary').textContent = selected?.summary || '正在读取策略规则…';
  $('#strategyRules').innerHTML = (selected?.rules || []).map(rule => '<li>' + esc(rule) + '</li>').join('');
  $('#poolQuotaGuide').hidden=strategy!=='pools';
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
  for (const id of ['selectAllGroups','clearGroups','strategy','days','startNow','refreshGroups','createTimeZone','defaultDailyCount','groupOffset','applySchedule','staggerGroups']) $('#'+id).disabled = creating || loading;
  for(const input of document.querySelectorAll('#groupSchedules input, #defaultTimes input'))input.disabled=creating;
  for (const input of document.querySelectorAll('[data-create-group]')) input.disabled = creating || !availableGroups().some(g=>g.id===input.value);
}
function renderGroupChoices() {
  const allowed = new Set(availableGroups().map(g=>g.id));
  for (const id of selectedGroups) if (!allowed.has(id)) selectedGroups.delete(id);
  $('#groupChoices').innerHTML = (data?.groups || []).map(g => `<label class="pilot-group-choice"><input type="checkbox" data-create-group value="${esc(g.id)}" ${selectedGroups.has(g.id)?'checked':''} ${allowed.has(g.id)?'':'disabled'}><span>${esc(g.name)}<small>${g.accounts} 个账号${allowed.has(g.id)?'':g.accounts?' · 已托管':' · 无可发布账号'}</small></span></label>`).join('') || '<p class="section-hint">暂无可用账号分组。</p>';
  renderGroupSchedules(); updateCreateControls();
}
$('#groupChoices').addEventListener('change', event => {
  const input = event.target;
  if (creating || !input.matches('[data-create-group]')) return;
  if (input.checked && availableGroups().some(g=>g.id===input.value)) selectedGroups.add(input.value);
  else selectedGroups.delete(input.value);
  renderGroupSchedules(); updateCreateControls();
});
$('#selectAllGroups').onclick = () => { if(creating || loading)return; for(const g of availableGroups())selectedGroups.add(g.id); renderGroupChoices(); };
$('#clearGroups').onclick = () => { if(creating || loading)return; selectedGroups.clear(); renderGroupChoices(); };
$('#createDialog').addEventListener('cancel', event => { if(creating)event.preventDefault(); });
function executionName(p){
 const accounts=p.accounts||[],first=accounts.find(a=>a.name)?.name;
 return first?'@'+String(first).replace(/^@/,'')+(accounts.length>1?' 等 '+accounts.length+' 个账号':''):'发布记录（'+accounts.length+' 个账号）';
}
function render() {
  const pilots = data.pilots;
  renderGroupChoices();
  if (!$('#strategy').options.length) { const preferred=data.strategies.pools?'pools':'evolve',current=$('#strategy').value;$('#strategy').innerHTML = Object.entries(data.strategies).map(([id,label])=>`<option value="${esc(id)}"${id===preferred?' selected':''}>${esc(label)}</option>`).join('');$('#strategy').value=Object.hasOwn(data.strategies,current)?current:preferred; }
  renderStrategyRules();
  renderProductionCapacity();
  const r = data.rules;
  $('#rules').innerHTML = [
    '发布数量与当地时间按计划所选时区设置，每个时间点每号发 1 条；组内账号依次错开 '+r.staggerSeconds+' 秒；生成准备按参与账号、预计任务与共享积压动态提前2–3小时估算，保留26小时预排窗口。每天检查3次：美西05:00/08:30/17:00（每轮前3小时），复算只提前、不推迟；任务按保存的生成时间执行，估算不保证准时。',
    '后台定期检查并排期，从图文文案库抽取，同一个账号不重复发同一篇爆款。',
    '配对选题：同一运营人、同一计划时区的当地日期、当天同一轮次的分组（允许错开时间）使用共同候选排序，再按所选策略挑版本；各账号用过的选题和可用版本不同，最终内容不保证完全相同。',
    '测试名额按所选策略限制；排队中、生成中、已发布但未成熟的任务都占位，确认失败才释放。结果不明确时继续保留名额。',
    '每个选题最多同时测试 2 个未成熟改写版，优先完成已开始的测试。账号池匹配用满72小时的最新累计样本；历史 A / B / C 保留原评估规则。',
    '同一个账号不会重复使用同一篇选题，不论原版或改写；同一批次不重复使用同一个版本。只能选择文案库中可用的内容，不会因启动运营自动生成新改写。',
    '发布时间与每日数量按分组设置；账号池匹配按账号表现分配优胜、优化与新内容配额，历史策略保留兼容。',
    `连续 ${r.failStreak} 次发布失败，自动停发该号并停止本地尚未提交的任务。低播放只进入分析，不中途停号。`,
  ].map(t=>'<li>'+esc(t)+'</li>').join('');
  const sum = pilots.reduce((s,p)=>{ for(const [k,v] of Object.entries(p.execution||p.today||{}))s[k]=(s[k]||0)+v;return s; },{});
  const active = pilots.filter(p=>p.status==='active').reduce((n,p)=>n+p.accounts.filter(a=>a.status==='active').length,0);
  const stopped = pilots.filter(p=>p.status!=='ended').reduce((n,p)=>n+p.accounts.filter(a=>a.status==='paused'||p.status==='paused').length,0);
  $('#overview').innerHTML = [['当前运营账号',active],[PERIOD_LABELS[data.window?.period||'today']+'已排',sum.planned||0],['制作中 / 待制作',(sum.producing||0)+(sum.queued||0)],['待发布 / 处理中',sum.pending||0],['已发布',sum.published||0],['失败 / 待核对',(sum.failed||0)+(sum.unknown||0)],['当前停发账号',stopped],['已停止任务',sum.stopped||0]].map(([label,n])=>`<div class="pilot-metric"><span>${label}</span><strong>${fmt(n)}</strong></div>`).join('');
  const next = pilots.map(p=>p.nextCheckAt).filter(Boolean).sort((a,b)=>a-b)[0];
  $('#freshness').textContent = `回执读取于 ${time(data.fetchedAt)} · 下次计划检查 ${time(next)}（北京时间，实际以后台调度为准）。${PERIOD_LABELS[data.window?.period||'today']}（${data.window?.from||''} 至 ${data.window?.to||''}）数量为已创建任务，未成功创建的排期见下方异常。页面每 30 秒读取本地记录，不主动查询 TikTok。`;
  const alerts = [];
  for(const p of pilots) {
    if(p.lastRunError)alerts.push([esc(executionName(p)),'最近检查异常',esc(p.lastRunError),`<a href="#${p.id}">查看日志并处理</a>`]);
    if(p.status==='active' && p.latest?.at && data.fetchedAt-p.latest.at>32*3600000)alerts.push([esc(executionName(p)),'分析数据未更新','最近分析超过 32 小时，请检查后台日志。',`<a href="#${p.id}">查看运营日志</a>`]);
    for(const s of p.schedule.filter(s=>s.detail||s.status==='failed'))alerts.push([esc(executionName(p)), '排期异常', esc(s.detail||'创建失败'), `<a href="#${p.id}">查看发布记录并重新检查</a>`]);
    for(const a of p.accounts.filter(a=>a.status==='paused'&&p.status!=='ended'))alerts.push([esc(executionName(p)), '@'+esc(a.name)+' 已停发', esc(a.reason), `<a href="#${p.id}">查看账号</a>`]);
    for(const i of p.attention||[])alerts.push([esc(executionName(p))+'<small>@'+esc(i.account)+'</small>', esc(i.retrying?'自动恢复中':ITEM[i.state]||i.state), esc(i.retrying ? (i.retryAt?'计划重试 '+pilotTime(p,i.retryAt):'后台正在重试') : i.error||'暂无详细原因'), `<button data-detail="${p.id}" data-slot="${i.slotAt}">查看内容</button>`]);
    if(p.status==='active' && p.lastRunAt && data.fetchedAt-p.lastRunAt>26*3600000)alerts.push([esc(executionName(p)),'检查延迟','超过 26 小时没有自动检查，请核对后台运行情况。',`<a href="#${p.id}">立即检查</a>`]);
  }
  $('#attention').innerHTML = alerts.length ? `<p>${alerts.length} 项待核对 / 恢复中</p>`+table(['发布记录 / 账号','情况','原因 / 下一步','操作'],alerts.slice(0,30))+(alerts.length>30?'<p>先显示前 30 项，展开发布排期查看全部明细。</p>':'') : '<p class="section-hint">最近排期没有待处理异常。</p>';
  $('#compare').innerHTML = pilots.length ? table(['发布记录 / 策略','状态',PERIOD_LABELS[data.window?.period||'today']+'执行',PERIOD_LABELS[data.window?.period||'today']+'已同步作品','中位播放 / 破千率','最近检查','详情'],pilots.map(p=>[esc(executionName(p))+'<small>'+esc(p.strategyLabel)+'</small>',STATUS[p.status],esc(totals(p.execution||p.today)),fmt(p.performance?.n??0),fmt(p.performance?.medianViews)+' / '+pct(p.performance?.potentialRate),pilotTime(p,p.lastRunAt),`<a href="#${p.id}">查看运营详情</a>`])) : '<p>创建运营计划后，会在这里显示发布执行和效果。</p>';
  const opened = new Set([...document.querySelectorAll('#pilots details[open]')].map(d=>d.id));
  const slotBodies = new Map([...document.querySelectorAll('[data-slot-body]')].map(e=>[e.id,e.innerHTML]));
  $('#pilots').innerHTML = pilots.map(p=>{
    const actions = p.status==='ended' ? '' : `<button data-schedule="${p.id}">发布设置</button><button data-pool-switch="${p.id}">账号池匹配…</button>` + (p.status==='active' ? `<button data-run="${p.id}">立即检查并排期</button><button data-pause="${p.id}">暂停…</button>` : `<button data-status="active" data-pilot="${p.id}">恢复运营</button><button data-pause="${p.id}">停止未提交任务…</button>`) + `<button data-status="ended" data-pilot="${p.id}">结束运营</button>`;
    const schedule = [...p.schedule].sort((a,b)=>b.slotAt-a.slotAt);
    return `<section class="panel data-section pilot" id="${p.id}"><div class="section-title"><div><h2>发布记录 · ${esc(executionName(p))} <span class="ops-chip">${STATUS[p.status]}</span></h2><p class="section-hint">${esc(p.strategyLabel)} · 每号每天 ${(p.slots||[]).length} 条 · ${esc((p.slots||[]).map(hm).join(' / '))}（${ZONES[zoneFor(p.timeZone)]}）${p.pendingSlots?'<br>新设置：每天 '+p.pendingSlots.length+' 条 · '+esc(p.pendingSlots.map(hm).join(' / '))+'（'+ZONES[zoneFor(p.pendingTimeZone||p.timeZone)]+'），'+zonedTime(p.scheduleEffectiveAt,p.pendingTimeZone||p.timeZone)+' 起生效':''}${p.pendingStrategy?'<br>未来策略：'+esc(data.strategies[p.pendingStrategy]||p.pendingStrategy)+' · '+pilotTime(p,p.strategyEffectiveAt)+' 起生效':''} · 运行至 ${pilotTime(p,p.endsAt)}${p.status==='paused'?' · '+(p.stopPending?'已停止本地未提交任务':'仅暂停新增排期，已排任务继续'):''}</p></div><div class="pilot-actions">${actions}</div></div>
    <details id="origin-${p.id}" class="ops-daily"><summary>原授权归属</summary><p class="section-hint">${esc(p.groupName||p.groupId)} · 用于核对账号权限和原发布记录；运营策略按项目及账号数据分配。</p></details>
    <h3>${PERIOD_LABELS[data.window?.period||'today']}发布排期（统计日期按北京时间）</h3>${schedule.length?schedule.map(s=>`<details class="pilot-slot" id="slot-${p.id}-${s.slotAt}" data-slot-details data-pilot="${p.id}" data-slot="${s.slotAt}"><summary>${pilotTime(p,s.slotAt)} · ${SLOT[s.status]||esc(s.status)}<span>${esc(totals(s.counts))}</span></summary>${s.detail?'<p class="pilot-error">'+esc(s.detail)+'</p>':''}<div id="body-${p.id}-${s.slotAt}" data-slot-body><button data-detail="${p.id}" data-slot="${s.slotAt}">读取内容明细</button></div></details>`).join(''):'<p>所选时间没有排期。</p>'}
    <details id="accounts-${p.id}" class="ops-daily"><summary>账号状态（${p.accounts.length}）</summary>${table(['账号','状态','原因 / 暂停范围','操作'],p.accounts.map(a=>['@'+esc(a.name),a.status==='active'?(p.status==='active'?'参与排期':'随运营暂停'):'已停发',esc(a.reason||'—')+(a.status==='paused'?'<small>'+(a.stopPending?'本地未提交任务已停止':'仅停止新增排期')+'</small>':''),p.status==='ended'?'':a.status==='active'?`<button data-pause="${p.id}" data-account="${esc(a.connectionId)}">停发…</button>`:`<button data-pilot="${p.id}" data-account="${esc(a.connectionId)}" data-account-status="active">恢复</button>`]))}</details>
    <details id="logs-${p.id}" class="ops-daily"><summary>所选时间日志（最近60条）与最近分析</summary>${p.latest?.findings?.length?'<ul>'+p.latest.findings.map(f=>'<li>'+esc(f)+'</li>').join('')+'</ul>':''}<ul class="pilot-log">${p.logs.map(l=>`<li class="is-${esc(l.kind)}"><time>${pilotTime(p,l.at)}</time>${esc(l.message)}</li>`).join('')}</ul></details></section>`;
  }).join('');
  for(const id of opened){const d=document.getElementById(id);if(d)d.open=true;}
  for(const [id,html] of slotBodies){const el=document.getElementById(id);if(el&&opened.has(id.replace('body-','slot-')))el.innerHTML=html;}
}
async function detail(pilot,slot){
  const section=document.getElementById(`slot-${pilot}-${slot}`),body=document.getElementById(`body-${pilot}-${slot}`);
  section.open=true;body.textContent='正在读取明细…';section.scrollIntoView({block:'nearest'});
  try { const r=await api(`/${pilot}/slots/${slot}`);body.innerHTML=`<p class="section-hint">计划开始生成显示当前保存时间；等待中可安全提前，发布时间保持原计划。读取于 ${time(Date.now())} <button data-detail="${pilot}" data-slot="${slot}">刷新明细</button></p>`+table(['账号 / 内容','文案版本','计划发布时间','计划开始生成','实际状态','视频 ID','原因 / 处理'],r.items.map(i=>['@'+esc(i.account)+'<small>'+esc(i.title)+'</small>',esc(i.version),zonedTime(i.scheduleAt,i.timeZone||pilotZoneAt(data.pilots.find(p=>p.id===pilot)||{},i.scheduleAt)),generationCell(i,data.pilots.find(p=>p.id===pilot)||{}),esc(ITEM[i.state]||i.state)+(i.retrying?'<small>系统自动恢复中</small>':''),esc(i.videoId||'尚未返回'),esc(i.error||'—')+`<small><a href="/psychology-publish-sources">查看发布记录</a> · <a href="/psychology-publish">进入自动发布处理</a></small>`])); }
  catch(e){body.textContent=e.message;}
}
async function openPause(pilot,account=''){
  pendingPause={pilot,account};$('#pauseTitle').textContent=account?'停发此账号':'暂停自动运营';$('#pauseChoices').hidden=Boolean(account);$('#pauseImpact').textContent='正在计算影响范围…';$('#confirmPause').disabled=true;$('#pauseDialog').showModal();
  try { const r=await api(`/${pilot}/impact${account?'?account='+encodeURIComponent(account):''}`);$('#pauseImpact').textContent=`当前可停止 ${r.stoppable} 条本地未提交任务；${r.protected} 条已进入提交或需要核对结果，不能直接撤回。数量以确认时为准。`;$('#confirmPause').disabled=false; }
  catch(e){$('#pauseImpact').textContent=e.message;}
}
document.addEventListener('click',async event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.close){if((b.dataset.close==='createDialog' && creating)||(b.dataset.close==='scheduleDialog'&&savingSchedule)||(b.dataset.close==='poolSwitchDialog'&&switchingPools)||(b.dataset.close==='taskGroupDialog'&&taskConfigBusy))return;$('#'+b.dataset.close).close();return;}
  if(b.dataset.schedule){openSchedule(b.dataset.schedule);return;}
  if(b.dataset.poolSwitch){openPoolSwitch(b.dataset.poolSwitch);return;}
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
  const strategy = $('#strategy').value, days = Number($('#days').value), startNow = $('#startNow').checked === true;
  let timeZone;try{timeZone=selectedZone('createTimeZone');}catch(error){$('#createStatus').textContent=error.message;return;}
  if (!groups.length) { $('#createStatus').textContent='请至少选择一个可用分组。'; return; }
  if (!data.strategies[strategy] || !Number.isInteger(days) || days<1 || days>30) { $('#createStatus').textContent='请选择策略，并填写 1–30 天。'; return; }
  let configs;try{configs=new Map(groups.map(g=>[g.id,slotsFromTimes(groupSchedules.get(g.id)||defaultTimes,g.accounts)]));}catch(e){$('#createStatus').textContent=e.message;return;}
  creating = true; updateCreateControls();
  const closeButton = document.querySelector('[data-close="createDialog"]'); closeButton.disabled=true;
  const results = []; let succeeded=0, warnings=0;
  $('#createResults').innerHTML='';
  try {
    for (const [index,group] of groups.entries()) {
      $('#createStatus').textContent=`正在启动 ${index+1}/${groups.length}：${group.name}，请保持页面打开…`;
      try {
        const r=await api('','POST',{groupId:group.id,strategy,days,startNow,timeZone,slots:configs.get(group.id)});
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
function openSchedule(id) {
  const p=data.pilots.find(p=>p.id===id);if(!p)return;
  editingPilot=id;editTimes=(p.pendingSlots||p.slots||data.rules.slots).map(hm);
  $('#editTimeZone').value=zoneFor(p.pendingSlots?p.pendingTimeZone||p.timeZone:p.timeZone);
  renderScheduleZoneHint();$('#scheduleTitle').textContent=executionName(p)+' · 发布设置';$('#editDailyCount').value=editTimes.length;
  $('#editTimes').innerHTML=timeFields(editTimes,'edit');$('#scheduleStatus').textContent='';$('#scheduleDialog').showModal();
}
$('#scheduleDialog').addEventListener('cancel',e=>{if(savingSchedule)e.preventDefault();});
$('#scheduleForm').addEventListener('submit',async e=>{
  e.preventDefault();if(savingSchedule)return;
  let slots,timeZone;try{slots=slotsFromTimes(editTimes);timeZone=selectedZone('editTimeZone');}catch(err){$('#scheduleStatus').textContent=err.message;return;}
  savingSchedule=true;$('#saveSchedule').disabled=true;for(const input of document.querySelectorAll('#scheduleForm input, #scheduleForm select'))input.disabled=true;
  try{const r=await api('/'+editingPilot+'/schedule','PATCH',{slots,timeZone});$('#scheduleStatus').textContent=`已保存：每号每天 ${r.slots.length} 条，${zonedTime(r.effectiveAt,r.timeZone||timeZone)}起生效。已创建任务继续原计划。`;await load(true);}
  catch(err){$('#scheduleStatus').textContent=err.message;}
  finally{savingSchedule=false;$('#saveSchedule').disabled=false;for(const input of document.querySelectorAll('#scheduleForm input, #scheduleForm select'))input.disabled=false;}
});
$('#reload').onclick=()=>load();
$('#period').value=selectedPeriod;
$('#period').addEventListener('change',()=>{selectedPeriod=$('#period').value;load();});
setInterval(()=>{if(!document.hidden&&!document.querySelector('dialog[open]'))load(true);},30000);
load();

function openPoolSwitch(pilotId=''){
 if(loading||creating||switchingPools)return;
 const pilots=(data?.pilots||[]).filter(p=>p.status!=='ended'&&(!pilotId||p.id===pilotId));
 $('#poolSwitchChoices').innerHTML=pilots.map(p=>'<label class="pilot-group-choice"><input type="checkbox" data-pool-pilot="'+esc(p.id)+'" checked><span>'+esc(p.groupName)+'<small>'+esc(p.strategyLabel)+' · 每号每天 '+(p.slots||[]).length+' 条'+(p.pendingStrategy?' · '+pilotTime(p,p.strategyEffectiveAt)+' 已配置生效':'')+'</small></span></label>').join('')||'<p>当前没有可接续的运营组。</p>';
 $('#poolSwitchStatus').textContent='保存后显示各组实际生效日期。';$('#poolSwitchResults').innerHTML='';$('#confirmPoolSwitch').disabled=!pilots.length;$('#poolSwitchDialog').showModal();
}
$('#openPoolSwitch').onclick=()=>openPoolSwitch();
$('#poolSwitchDialog').addEventListener('cancel',event=>{if(switchingPools)event.preventDefault();});
$('#confirmPoolSwitch').onclick=async()=>{
 if(switchingPools)return;
 const ids=[...document.querySelectorAll('[data-pool-pilot]:checked')].filter(n=>!n.disabled).map(n=>n.dataset.poolPilot),pilots=ids.map(id=>data.pilots.find(p=>p.id===id)).filter(Boolean);
 if(!pilots.length){$('#poolSwitchStatus').textContent='请至少选择一个运营组。';return;}
 switchingPools=true;$('#confirmPoolSwitch').disabled=true;const results=[];
 try{
  for(const p of pilots){
   $('#poolSwitchStatus').textContent='正在保存 '+(results.length+1)+' / '+pilots.length+'：'+p.groupName;
   try{const r=await api('/'+encodeURIComponent(p.id)+'/strategy','PATCH',{strategy:'pools',days:7,revision:p.revision});for(const choice of document.querySelectorAll('[data-pool-pilot]'))if(choice.dataset.poolPilot===p.id){choice.checked=false;choice.disabled=true;}results.push('<li>'+esc(p.groupName)+'：'+pilotTime(p,r.effectiveAt||r.strategyEffectiveAt)+' 起账号池匹配，运行至 '+pilotTime(p,r.endsAt)+'</li>');}
   catch(error){results.push('<li class="pilot-error">'+esc(p.groupName)+'：未保存 · '+esc(error.message)+'</li>');}
   $('#poolSwitchResults').innerHTML=results.join('');
  }
  $('#poolSwitchStatus').textContent='配置提交完成；请核对各组生效日期和未保存项。';
 }finally{switchingPools=false;$('#confirmPoolSwitch').disabled=false;await load(true);}
};

function taskRoleLabel(role){return TASK_ROLES[role]?.label||role||'—';}
function taskRoleRows(result=taskGroupsData){
 return Object.entries(TASK_ROLES).map(([role,fallback])=>({...fallback,accounts:0,active:0,paused:0,...(result?.groups||[]).find(g=>(g.role||g.id)===role),role,label:fallback.label}));
}
function renderTaskGroupCards(){
 $('#taskGroupCards').innerHTML=taskRoleRows().map(g=>'<button type="button" class="ops-pool-card ops-pool-card-button" data-task-role="'+esc(g.role)+'" aria-controls="taskGroupAccounts" aria-pressed="'+(taskGroupRole===g.role)+'" aria-label="查看'+esc(g.label)+'的'+fmt(g.accounts)+'个账号"><span>'+esc(g.label)+'</span><strong>'+fmt(g.accounts)+'</strong><small>'+esc(g.action)+'</small><small>参与 '+fmt(g.active)+' · 暂停 '+fmt(g.paused)+'</small><small class="ops-pool-card-link">查看账号 →</small></button>').join('');
}
function renderTaskGroups(){
 const p=taskGroupsData?.policy,t=taskGroupsData?.totals||{},project=taskGroupsData?.project;
 $('#taskGroupProjectSummary').textContent=project?'绑定项目：'+(project.name||'心理学')+' · '+(p?.enrollmentMode==='project'?'项目账号按数据自动纳入与分层。':p?'当前沿用原计划范围，保存项目设置后改为项目账号自动纳入。':'预览后启用，项目账号自动纳入与分层。'):'正在读取绑定项目…';
 $('#taskGroupSummary').innerHTML=[['纳入账号',t.enrolled],['排除账号',t.excluded],['合格账号',t.eligible],['待处理账号',t.blocked]].map(([label,value])=>'<div class="pilot-metric"><span>'+label+'</span><strong>'+fmt(value)+'</strong></div>').join('');
 $('#taskGroupStatus').textContent=p?(p.endsAt&&p.endsAt<=Date.now()?'本轮已结束':p.enabled?'已启用':'未启用')+' · '+zonedTime(p.startsAt,p.timeZone)+' 至 '+zonedTime(p.endsAt,p.timeZone)+' · 角色生效 '+zonedTime(taskGroupsData.effectiveAt||p.startsAt,p.timeZone)+' · '+(p.cycleDays||7)+'天周期 / 每'+(p.reviewDays||3)+'天复评 · 最近复评 '+zonedTime(p.lastReviewAt,p.timeZone)+' · 下次复评 '+zonedTime(p.nextReviewAt,p.timeZone):'尚未配置项目自动运营。请先预览项目账号纳入范围与生效日期。';
 if(p)$('#taskGroupStatus').textContent+='。展示已保存的下一次生效账号分层；具体账号以生效时间为准。';
 $('#taskGroupStatus').classList.toggle('pilot-error',false);renderTaskGroupCards();
}
async function loadTaskGroups(){
 const request=++taskGroupRequest;
 try{const result=await api('/task-groups');if(request!==taskGroupRequest)return;taskGroupsData=result;renderTaskGroups();return result;}
 catch(error){if(request!==taskGroupRequest)return;$('#taskGroupStatus').textContent='项目运营读取失败，保留上次数据：'+error.message;$('#taskGroupStatus').classList.toggle('pilot-error',true);if(!taskGroupsData)renderTaskGroupCards();}
}
async function loadTaskMembers(role=taskGroupRole,page=1){
 if(!Object.hasOwn(TASK_ROLES,role)||!Number.isInteger(page)||page<1)return;
 const request=++taskMemberRequest;taskGroupRole=role;taskGroupPage=page;
 $('#taskGroupAccounts').hidden=false;$('#taskGroupAccountsTitle').textContent=taskRoleLabel(role)+' · 账号';
 $('#taskGroupMemberStatus').textContent='正在读取账号…';$('#taskGroupMemberTable').innerHTML='';$('#taskGroupMemberPage').textContent='';
 $('#taskGroupPrev').disabled=true;$('#taskGroupNext').disabled=true;$('#taskGroupMembersRetry').hidden=true;renderTaskGroupCards();
 try{
  const result=await api('/task-groups?group='+encodeURIComponent(role)+'&page='+page);if(request!==taskMemberRequest)return;
  const m=result.membership||{rows:[],page:1,total:0,totalPages:1};taskGroupPage=m.page||1;taskGroupPages=Math.max(1,m.totalPages||1);
  $('#taskGroupMemberTable').innerHTML=m.rows?.length?table(['账号','账号分层 / 成熟表现','参与状态','原因 / 生效时间'],m.rows.map(r=>['@'+esc(r.name||r.connectionId),esc(taskRoleLabel(r.role))+'<small>'+esc(({strong:'强号',normal:'中号','rescue-hook':'首图救援','rescue-content':'内页救援',diagnostic:'近零诊断',observing:'待观察'}[r.accountPool])||r.accountPool||'—')+'</small>',r.blocked?'待处理'+(r.paused?' · 已暂停':''):r.paused?'已暂停':'可参与未来分配',esc(r.reason||'—')+'<small>'+esc(zonedTime(r.effectiveAt,r.timeZone||result.policy?.timeZone||taskGroupsData?.policy?.timeZone))+' 起生效</small>'])):'<p class="section-hint">当前分层暂无账号。</p>';
  $('#taskGroupMemberStatus').textContent='账号统一绑定心理学项目，分层用于未来尚未创建的任务。';
  $('#taskGroupMemberPage').textContent='第 '+fmt(taskGroupPage)+' / '+fmt(taskGroupPages)+' 页 · 共 '+fmt(m.total)+' 个账号 · 每页20条';
  $('#taskGroupPrev').disabled=taskGroupPage<=1;$('#taskGroupNext').disabled=taskGroupPage>=taskGroupPages;
 }catch(error){if(request!==taskMemberRequest)return;$('#taskGroupMemberStatus').textContent='账号读取失败：'+error.message;$('#taskGroupMembersRetry').hidden=false;}
}
$('#taskGroupCards').addEventListener('click',event=>{const card=event.target.closest('[data-task-role]');if(card&&$('#taskGroupCards').contains(card))void loadTaskMembers(card.dataset.taskRole);});
$('#taskGroupPrev').onclick=()=>loadTaskMembers(taskGroupRole,taskGroupPage-1);
$('#taskGroupNext').onclick=()=>loadTaskMembers(taskGroupRole,taskGroupPage+1);
$('#taskGroupMembersRetry').onclick=()=>loadTaskMembers(taskGroupRole,taskGroupPage);
function taskConfigBody(){
 if(!taskConfigReady)throw Error('请先成功读取项目设置。');
 const reviewTarget=Number($('#taskGroupReviewTarget').value),enabled=$('#taskGroupEnabled').checked===true;
 if(!Number.isInteger(reviewTarget)||reviewTarget<5||reviewTarget>60)throw Error('内容评审目标人数应为5–60的整数。');
 const projectId=taskGroupsData?.project?.id;
 if(typeof projectId!=='string'||!projectId.trim())throw Error('绑定项目不可用，请重新读取项目设置。');
 return {revision:taskGroupsData?.policy?.revision??0,enabled,enrollmentMode:'project',projectId,timeZone:selectedZone('taskGroupTimeZone'),reviewTarget,admitNewAccounts:$('#taskGroupAdmitNew').checked===true};
}
function updateTaskConfigControls(){
 for(const id of ['taskGroupEnabled','taskGroupTimeZone','taskGroupReviewTarget','taskGroupAdmitNew','retryTaskGroupConfig'])$('#'+id).disabled=taskConfigBusy;
 $('#previewTaskGroups').disabled=taskConfigBusy||!taskConfigReady;
 $('#saveTaskGroups').disabled=taskConfigBusy||!taskPreview;
 document.querySelector('[data-close="taskGroupDialog"]').disabled=taskConfigBusy;
}
function invalidateTaskPreview(){
 if(taskConfigBusy)return;taskPreview=null;$('#taskGroupPreview').innerHTML='<p class="section-hint">配置已更改，请重新预览生效日期与纳入人数。</p>';$('#taskGroupConfigStatus').textContent='';updateTaskConfigControls();
}
function taskPreviewHtml(result,label='配置预览'){
 const p=result.policy||{},t=result.totals||{},zone=zoneFor(p.timeZone);
 return '<h3>'+label+'</h3><p>绑定项目：'+esc(result.project?.name||taskGroupsData?.project?.name||'心理学')+' · 账号按数据自动分层 · 每日目标3条 · 基准时段 '+projectSlots(zone)+'（'+ZONES[zone]+'）</p><p>生效：'+esc(zonedTime(result.effectiveAt||p.startsAt,zone))+' · 周期：'+esc(zonedTime(p.startsAt,zone))+' 至 '+esc(zonedTime(p.endsAt,zone))+'</p><p>'+(p.admitNewAccounts===false?'暂不自动纳入新授权账号。':'新授权账号默认从'+ZONES[zone]+'次日的新一期排期开始参与，不插入当天任务。')+'</p><p>纳入 '+fmt(t.enrolled)+' 个账号 · 排除 '+fmt(t.excluded)+' 个账号 · 合格 '+fmt(t.eligible)+' 个账号 · 待处理 '+fmt(t.blocked)+' 个账号。</p>'+table(['任务角色','账号数','参与 / 暂停'],taskRoleRows(result).map(g=>[esc(g.label),fmt(g.accounts),fmt(g.active)+' / '+fmt(g.paused)]))+'<p class="section-hint">7天周期，每3天复评，按项目时区计算。只调整未来尚未创建的任务；保存时重新核对权限和已保留排期，实际生效日期以保存结果为准。</p>';
}
async function openTaskGroupConfig(){
 if(taskConfigBusy||creating||switchingPools)return;
 taskConfigBusy=true;taskConfigReady=false;taskPreview=null;$('#taskGroupConfigStatus').textContent='正在读取项目设置…';$('#taskGroupPreview').innerHTML='';$('#taskGroupProject').textContent='正在读取绑定项目…';$('#retryTaskGroupConfig').hidden=true;
 if(!$('#taskGroupDialog').open)$('#taskGroupDialog').showModal();updateTaskConfigControls();
 const request=++taskGroupRequest;
 try{
  const result=await api('/task-groups');if(request!==taskGroupRequest)return;
  taskGroupsData=result;renderTaskGroups();const p=result.policy;
  $('#taskGroupTimeZone').value=zoneFor(p?p.timeZone:'America/Los_Angeles');renderProjectZoneHint();
  $('#taskGroupEnabled').checked=p?.enabled??true;$('#taskGroupReviewTarget').value=p?.reviewTarget??60;$('#taskGroupAdmitNew').checked=p?.admitNewAccounts??true;
  taskConfigReady=typeof result.project?.id==='string'&&Boolean(result.project.id.trim());
  $('#taskGroupProject').textContent=result.project?'绑定项目：'+(result.project.name||'心理学')+'。项目账号按数据自动分层，无需选择原发布计划。':'绑定项目不可用，请重新读取。';
  if(!taskConfigReady)throw Error('绑定项目不可用，请重新读取项目设置。');
  $('#taskGroupConfigStatus').textContent='先预览生效日期及纳入人数，再保存。';
 }catch(error){$('#taskGroupConfigStatus').textContent='配置读取失败：'+error.message;$('#retryTaskGroupConfig').hidden=false;}
 finally{taskConfigBusy=false;updateTaskConfigControls();}
}
$('#openTaskGroupConfig').onclick=openTaskGroupConfig;$('#retryTaskGroupConfig').onclick=openTaskGroupConfig;
$('#taskGroupDialog').addEventListener('cancel',event=>{if(taskConfigBusy)event.preventDefault();});
for(const id of ['taskGroupEnabled','taskGroupReviewTarget','taskGroupAdmitNew'])$('#'+id).addEventListener('change',invalidateTaskPreview);
$('#taskGroupReviewTarget').addEventListener('input',invalidateTaskPreview);
$('#previewTaskGroups').onclick=async()=>{
 if(taskConfigBusy)return;let body;try{body=taskConfigBody();}catch(error){$('#taskGroupConfigStatus').textContent=error.message;return;}
 taskConfigBusy=true;taskPreview=null;$('#taskGroupPreview').innerHTML='';$('#taskGroupConfigStatus').textContent='正在预览生效日期与人数…';updateTaskConfigControls();
 try{const result=await api('/task-groups/preview','POST',body);if(JSON.stringify(body)!==JSON.stringify(taskConfigBody()))throw Error('配置已更改，请重新预览。');taskPreview={body,fingerprint:JSON.stringify(body)};$('#taskGroupPreview').innerHTML=taskPreviewHtml(result);$('#taskGroupConfigStatus').textContent='预览完成。核对生效日期及人数后保存。';}
 catch(error){taskPreview=null;$('#taskGroupConfigStatus').textContent='预览失败：'+error.message;}
 finally{taskConfigBusy=false;updateTaskConfigControls();}
};
$('#saveTaskGroups').onclick=async()=>{
 if(taskConfigBusy||!taskPreview)return;let body;try{body=taskConfigBody();if(JSON.stringify(body)!==taskPreview.fingerprint)throw Error('配置或版本已变化，请重新预览。');}catch(error){taskPreview=null;$('#taskGroupConfigStatus').textContent=error.message;updateTaskConfigControls();return;}
 let saved=false;taskConfigBusy=true;$('#taskGroupConfigStatus').textContent='正在保存项目设置…';updateTaskConfigControls();
 try{const result=await api('/task-groups','PATCH',body);++taskGroupRequest;taskGroupsData=result;taskPreview=null;renderTaskGroups();$('#taskGroupPreview').innerHTML=taskPreviewHtml(result,'已保存的实际配置');$('#taskGroupConfigStatus').textContent='已保存：'+zonedTime(result.effectiveAt||result.policy?.startsAt,result.policy?.timeZone)+' 起生效，运行至 '+zonedTime(result.policy?.endsAt,result.policy?.timeZone)+'。已创建任务继续原配置。';saved=true;if(taskGroupRole)void loadTaskMembers(taskGroupRole,1);}
 catch(error){taskPreview=null;$('#taskGroupConfigStatus').textContent='保存失败：'+error.message+'。请重新预览后重试；版本冲突时重新打开配置读取最新版本。';}
 finally{taskConfigBusy=false;updateTaskConfigControls();}
 if(saved)await load(true,false,false);
};
function renderProjectZoneHint(){const zone=zoneFor($('#taskGroupTimeZone').value);$('#taskGroupTimeZoneHint').textContent='每天3条基准时段：'+projectSlots(zone)+'（'+ZONES[zone]+'）。'+(zone==='America/Los_Angeles'?'按America/Los_Angeles自动处理PDT/PST；预览与保存会同时显示北京时间。':'现有北京时间配置保留，选择太平洋时间后须重新预览并保存。')+' 已冻结任务保留；开始后的周期或冲突排期由服务校验，实际边界以保存结果为准。';}
$('#taskGroupTimeZone').addEventListener('change',()=>{invalidateTaskPreview();renderProjectZoneHint();});
function renderScheduleZoneHint(){const zone=zoneFor($('#editTimeZone').value);$('#scheduleZoneHint').textContent='当前输入按'+ZONES[zone]+'解释。'+(zone==='America/Los_Angeles'?'夏令时自动调整；生效时间同时显示北京时间。':'')+' 修改时区不会改变输入的当地钟点，已创建任务继续原计划。项目自动运营期间须保持项目时区及每天3条；统一改时区请使用项目设置。';}
$('#editTimeZone').addEventListener('change',renderScheduleZoneHint);
