const $ = s => document.querySelector(s);
const state = { mediaType:'video', templates:{}, counts:{}, accounts:[], groups:[], selectedAccounts:new Set(), accountGroup:"", accountQuery:"", accountsLoadId:0, accountsLoading:false, accountsMedia:"", accountsLoaded:false, batches:[], requestId:crypto.randomUUID(), busy:false, submittedInput:null };
const esc = v => String(v ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = seconds => new Date(seconds*1000).toLocaleString('zh-CN',{hour12:false});
async function api(path, body, method) {
  const response = await fetch(path,{...(method?{method}:{}),...(body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})});
  const data = await response.json();
  if(!response.ok) throw new Error(data.error || '请求失败');
  return data;
}
const accountId=a=>String(a.connectionId||a.id);
function selected() { return state.accounts.map(accountId).filter(id=>state.selectedAccounts.has(id)); }
function musicPool() { return [...new Set(($('#musicIds')?.value||'').split(/[\s,，;；]+/).map(v=>v.trim()).filter(Boolean))]; }
function message(text,error=false) { $('#message').textContent=text; $('#message').classList.toggle('error',error); }
function renderTemplates() {
  $('#template').innerHTML=(state.templates[state.mediaType]||[]).map(t=>`<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('');
  $('#sourceHint').textContent=`选题来源：同行${state.mediaType==='photo'?'图文':'视频'}爆款库，共 ${state.counts[state.mediaType]||0} 条。每条爆款生成一条新内容。`;
  renderSources();
  const extras=$('#photoOptions');
  if(extras){extras.hidden=state.mediaType!=='photo';if(extras.hidden)extras.open=false;}
}

function sourceType(){return state.mediaType==='video'&&$('#sourceType').value==='topic-bank'?'topic-bank':'peer';}
function renderSources(){
  $('#sourceTypeField').hidden=state.mediaType!=='video';
  if(!state.canUseTopics)$('#sourceType').value='peer';
  $('#sourceType option[value="topic-bank"]').disabled=!state.canUseTopics;
  const bank=sourceType()==='topic-bank',previous=$('#selection').value;
  const choices=bank?[['random','随机抽取'],['priority','优先级优先'],['recent','最近入库优先'],['least-used','最少使用优先']]:[['random','随机抽取'],['popular','播放量优先'],['recent','最近入库优先']];
  $('#selection').innerHTML=choices.map(([v,label])=>'<option value="'+v+'">'+label+'</option>').join('');
  if(choices.some(([v])=>v===previous))$('#selection').value=previous;
  $('#unusedField').hidden=!bank;
  $('#peerReuseField').hidden=bank;
  $('#query').placeholder=bank?'筛选题目、内容或分类，不填则从当前模板题库抽取':'筛选爆款标题或同行账号';
  const c=state.topicCounts?.[$('#template').value]||{};
  $('#sourceHint').textContent=bank?'当前模板题库：已启用 '+(c.enabled||0)+' 条，未使用 '+(c.unused||0)+' 条。只从当前模板抽取；不足时不会创建任务。':'选题来源：同行'+(state.mediaType==='photo'?'图文':'视频')+'爆款库，共 '+(state.counts[state.mediaType]||0)+' 条。';
}
$('#sourceType').addEventListener('change',renderSources);
$('#template').addEventListener('change',renderSources);

function visibleAccounts() {
  const query=state.accountQuery.trim().replace(/^@/,'').toLowerCase();
  return state.accounts.filter(a=>(!state.accountGroup||(state.accountGroup==='__ungrouped__'?!a.groupId:a.groupId===state.accountGroup))&&(!query||[a.username,a.displayName,a.label].some(v=>String(v||'').toLowerCase().includes(query))));
}
function resetAccountInput() { state.requestId=crypto.randomUUID();state.submittedInput=null; }
function renderAccountGroups() {
  const groups=new Map(state.groups.map(g=>[g.id,g.name]));
  for(const a of state.accounts)if(a.groupId&&!groups.has(a.groupId))groups.set(a.groupId,a.groupName||'未命名分组');
  const choices=[['',`全部分组（${state.accounts.length}）`],...[...groups].map(([id,name])=>[id,`${name}（${state.accounts.filter(a=>a.groupId===id).length}）`])];
  if(state.accounts.some(a=>!a.groupId))choices.push(['__ungrouped__','未分组']);
  if(!choices.some(([id])=>id===state.accountGroup))state.accountGroup='';
  $('#accountGroup').innerHTML=choices.map(([id,label])=>`<option value="${esc(id)}">${esc(label)}</option>`).join('');
  $('#accountGroup').value=state.accountGroup;
}
function renderAccountControls() {
  const rows=visibleAccounts(),ids=selected(),visibleSelected=rows.filter(a=>state.selectedAccounts.has(accountId(a))).length;
  const locked=state.busy||state.accountsLoading||state.accountsMedia!==state.mediaType;
  $('#accountGroup').disabled=locked;$('#accountSearch').disabled=locked;
  $('#selectVisibleAccounts').disabled=locked||rows.length===visibleSelected;
  $('#clearVisibleAccounts').disabled=locked||!visibleSelected;
  $('#clearAllAccounts').disabled=locked||!ids.length;
  $('#accountSelectionStatus').textContent=`当前显示 ${rows.length} / ${state.accounts.length} 个账号 · 已选 ${ids.length} 个`+(ids.length>visibleSelected?`（其中 ${ids.length-visibleSelected} 个在其他分组或不符合当前搜索）`:'');
}
function renderAccounts() {
  const rows=visibleAccounts();
  $('#accounts').innerHTML=rows.length ? rows.map(a=>{
    const id=accountId(a),username=String(a.username||'').replace(/^@+/,'');
    return `<label class="account-choice"><input type="checkbox" value="${esc(id)}" ${state.selectedAccounts.has(id)?'checked':''} ${state.busy||state.accountsLoading||state.accountsMedia!==state.mediaType?'disabled':''}><span><strong>${esc(a.displayName||a.label||username||id)}</strong><small>${esc(username?'@'+username:'')} · ${esc(a.groupName||'未分组')}</small></span></label>`;
  }).join('') : '<div class="empty-state">'+(state.accounts.length?'当前分组或搜索条件下没有可发布账号。':'心理学项目还没有可发布账号，请先在 TikTok 账号页分配分组。')+'</div>';
  renderAccountControls();summary();
}
async function loadAccounts() {
  const loadId=++state.accountsLoadId,media=state.mediaType;
  state.accountsLoading=true;renderAccounts();
  try {
    const data=await api('/api/official-tiktok/publish-accounts?module=psychology&media='+media);
    if(loadId!==state.accountsLoadId)return;
    const before=selected().join('|');
    state.accounts=data.accounts||[];state.groups=data.groups||[];
    const valid=new Set(state.accounts.map(accountId));
    state.selectedAccounts=new Set([...state.selectedAccounts].filter(id=>valid.has(id)));
    if(before!==selected().join('|'))resetAccountInput();
    state.accountsLoaded=true;state.accountsMedia=media;
    renderAccountGroups();renderBatches();
  } finally {
    if(loadId===state.accountsLoadId){state.accountsLoading=false;renderAccounts();}
  }
}
$('#accountGroup').addEventListener('change',()=>{state.accountGroup=$('#accountGroup').value;renderAccounts();});
$('#accountSearch').addEventListener('input',()=>{state.accountQuery=$('#accountSearch').value;renderAccounts();});
$('#accounts').addEventListener('input',event=>{
  const input=event.target;
  if(state.busy||state.accountsLoading||input.type!=='checkbox'||!state.accounts.some(a=>accountId(a)===input.value))return;
  if(input.checked)state.selectedAccounts.add(input.value);else state.selectedAccounts.delete(input.value);
  resetAccountInput();renderAccountControls();summary();
});
for(const [selector,action] of [['#selectVisibleAccounts','select'],['#clearVisibleAccounts','clear'],['#clearAllAccounts','all']]){
  $(selector).addEventListener('click',()=>{
    if(state.busy||state.accountsLoading||state.accountsMedia!==state.mediaType)return;
    if(action==='all')state.selectedAccounts.clear();
    else for(const a of visibleAccounts()){if(action==='select')state.selectedAccounts.add(accountId(a));else state.selectedAccounts.delete(accountId(a));}
    resetAccountInput();renderAccounts();
  });
}
function accountName(id) {
  const a=state.accounts.find(a=>String(a.connectionId||a.id)===String(id));
  const username=String(a?.username||'').trim().replace(/^@+/, '');
  return username?'@'+username:a?.displayName||a?.label||(state.accountsLoaded?'账号信息不可用':'账号加载中…');
}
function summary() {
  const ids=selected(), count=Number($('#count').value)||0;
  $('#summary').textContent=ids.length ? `本批共生成 ${count} 条${state.mediaType==='photo'?'图文':'视频'}，分配到 ${ids.length} 个账号，合并为 ${Math.ceil(count/20)} 个中台批次（每批最多20条）。 `+
    ids.map((id,i)=>accountName(id)+'：'+Math.max(0,Math.floor((count+ids.length-1-i)/ids.length))+' 条').join('；') : '选择账号后显示本批内容分配。';
}
function batchStatus(items,groups=[]){
  if(groups.some(g=>g.status==='failed'&&!g.retrying))return 'failed';
  if(groups.some(g=>g.retrying))return 'running';
  if(!items.length)return 'cancelled';
  if(items.some(i=>i.status==='failed'))return 'failed';
  if(items.some(i=>['running','handoff','ready'].includes(i.status)))return 'running';
  if(items.every(i=>i.status==='submitted'||i.status==='cancelled'))return items.every(i=>i.status==='cancelled')?'cancelled':'done';
  return 'queued';
}
function statusLabel(status){
  return {queued:'排队中',running:'执行中',done:'已完成',failed:'待处理',cancelled:'已取消'}[status]||status;
}
let batchPage=1,batchLoadVersion=0;
$('#batchPrev').addEventListener('click',()=>{batchPage=Math.max(1,batchPage-1);loadBatches().catch(e=>message(e.message,true));});
$('#batchNext').addEventListener('click',()=>{batchPage++;loadBatches().catch(e=>message(e.message,true));});
$('#batchFilter').addEventListener('change',()=>{batchPage=1;loadBatches().catch(e=>message(e.message,true));});
async function loadBatches() {
  const version=++batchLoadVersion;
  const data=await api('/api/psychology-auto-publish?page='+batchPage+'&attention='+($('#batchFilter').value==='attention'?'1':'0'));
  if(version!==batchLoadVersion)return;
  state.batches=data.batches||[];
  $('#batchPrev').disabled=batchPage<=1;$('#batchNext').disabled=!data.pagination?.hasMore;
  $('#batchPage').textContent='第 '+batchPage+' 页 / 共 '+(data.pagination?.total||0)+' 个任务';
  renderBatches();
}
function renderBatches() {
  const labels={queued:'等待执行',running:'执行中',done:'生成完成',submitted:'已提交中台',failed:'失败',cancelled:'已取消',missing:'任务已清理',handoff:'等待卡片渲染'};
  const tones=state.batches.map(b=>batchStatus(b.items||[],b.groups||[]));
  $('#queuedCount').textContent=tones.filter(s=>s==='queued').length;
  $('#runningCount').textContent=tones.filter(s=>s==='running').length;
  $('#attentionCount').textContent=tones.filter(s=>s==='failed').length;
  $('#doneCount').textContent=tones.filter(s=>s==='done'||s==='cancelled').length;
  $('#safetySummary').textContent=state.batches.length?`本页 ${state.batches.length} 个任务，关闭页面不影响已入队任务。`:'生成完成后自动提交官方发布中台';
  $('#batches').innerHTML=state.batches.length?state.batches.map(b=>{
    const items=b.items||[];
    const status=batchStatus(items,b.groups||[]);
    const submitted=items.filter(i=>i.status==='submitted').length;
    const running=items.filter(i=>['running','handoff','done'].includes(i.status)).length;
    const ready=items.filter(i=>i.status==='ready').length;
    const failed=items.filter(i=>i.status==='failed');
    const retryItems=items.filter(i=>['failed','handoff'].includes(i.status));
    const percent=items.length?Math.round(items.reduce((sum,i)=>sum+(i.status==='submitted'?100:Number(i.percent)||0),0)/items.length):0;
    const template=(state.templates[b.config.mediaType]||[]).find(t=>t.id===b.config.template)?.label||b.config.template;
    const accounts=[...new Set(items.map(i=>i.connectionId).filter(Boolean))].map(accountName);
    const schedule=Object.entries(items.reduce((map,i)=>{const key=time(i.scheduleAt);map[key]=(map[key]||0)+1;return map;},{})).map(([when,count])=>`<span><b>${esc(when)}</b><em>${count} 条</em></span>`).join('');
    const message=(b.groups||[]).find(g=>g.error)?.error||failed[0]?.error||items.find(i=>i.message)?.message||(!items.length?'该批次内容已全部删除。':submitted===items.length?'已全部提交官方发布中台。':`${labels[items[0]?.status]||'等待执行'} · ${submitted} / ${items.length} 已提交`);
    return `<article class="auto-task-item" data-status="${esc(status)}">
      <div class="task-item-head"><div><strong>${esc(b.config.name||'心理学自动发布')}</strong><small>${esc(time(b.createdAt/1000))} · ${b.config.mediaType==='photo'?'图文':'视频'} · ${esc(template)}</small></div><div class="task-head-actions"><span class="task-status-badge">${esc(statusLabel(status))}</span></div></div>
      ${accounts.length?`<div class="task-groups"><span>TikTok 官方账号</span>${accounts.map(name=>`<b>${esc(name)}</b>`).join('')}</div>`:''}
      <div class="task-progress"><div style="width:${Math.max(0,Math.min(100,percent))}%"></div></div>
      <p>${esc(message)}</p>
      <div class="task-counts"><span>预计 ${b.config.count} 条${b.deletedCount?' · 已删除 '+b.deletedCount+' 条':''}</span><span>执行中 ${running}</span><span>待合批 ${ready}</span><span>已提交中台 ${submitted}</span><span>失败 ${failed.length}</span>${items.some(i=>i.retryAt)?`<span>自动重试 ${Math.max(...items.map(i=>i.retryCount||0))}/2 · 等待排队</span>`:''}${b.config.mediaType==='photo'?`<span>${b.config.rewriteCopy?'改写文案':'保留原文'}</span><span>${b.config.musicIds?.length?'音乐池 '+b.config.musicIds.length+' 首':'自动配乐'}</span>`:''}<span>${b.config.sourceType==='topic-bank'?'模板题库':'同行爆款'}</span></div>
      ${(b.groups||[]).length?`<div class="publish-groups"><strong>中台发布分组 · 每组最多20条</strong>${b.groups.map(g=>{const members=items.filter(i=>i.groupId===g.id);const n=members.filter(i=>['ready','submitted'].includes(i.status)).length;return `<div class="publish-group"><span>第 ${g.number} 批 · ${g.count} 条 · ${g.retrying?'自动重试 '+g.retryCount+'/2 · '+(g.retryAt?'等待排队':'执行中'):g.status==='cancelled'?'已删除全部内容':g.status==='submitted'?'已提交':g.status==='submitting'?'提交中':g.status==='failed'?'提交失败':'已就绪 '+n+'/'+g.count}${g.remoteBatchId?`<small>中台编号：${esc(g.remoteBatchId)}</small>`:''}${g.error?`<small class="error">${esc(g.error)}</small>`:''}</span>${g.canRetry?`<button type="button" data-group-retry="${esc(g.id)}">${g.status==='waiting'?'提交剩余内容':'重试整批提交'}</button>`:''}</div>`;}).join('')}</div>`:''}
      ${schedule?`<div class="task-schedule"><strong>具体排期</strong>${schedule}</div>`:''}
      ${retryItems.length?`<div class="manual-items"><strong>待人工处理</strong>${retryItems.map(i=>`<div class="manual-item"><span>${esc(i.title||i.sourceId)}<small>${esc(i.error||i.message||labels[i.status])}</small></span><div class="manual-actions"><button type="button" data-retry="${esc(i.id)}">重试</button>${i.status==='failed'?`<button type="button" data-delete="${esc(i.id)}">删除</button>`:''}</div></div>`).join('')}</div>`:''}
    </article>`;
  }).join(''):'<div class="empty-state"><strong>队列为空</strong><span>创建任务后会在这里显示实时进度</span></div>';
}
$('#batchForm').addEventListener('input',event=>{ if(['accountGroup','accountSearch'].includes(event.target?.id))return; if(!state.busy){state.requestId=crypto.randomUUID();state.submittedInput=null;} summary(); });
document.querySelectorAll('[data-media]').forEach(button=>button.addEventListener('click',async()=>{
  if(state.busy||state.mediaType===button.dataset.media)return;
  state.mediaType=button.dataset.media;state.requestId=crypto.randomUUID();state.submittedInput=null;
  document.querySelectorAll('[data-media]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});
  renderTemplates();summary();
  try{await loadAccounts();}catch(e){message(e.message,true);}
}));
$('#refreshAccounts').addEventListener('click',()=>loadAccounts().catch(e=>message(e.message,true)));
$('#refreshBatches').addEventListener('click',()=>loadBatches().catch(e=>message(e.message,true)));
$('#batches').addEventListener('click',async event=>{
  const deleteButton=event.target.closest('[data-delete]');
  if(deleteButton){
    if(!confirm('删除这条失败内容？删除后将不再重试，其他内容保留。'))return;
    deleteButton.disabled=true;
    try{await api('/api/psychology-auto-publish/'+encodeURIComponent(deleteButton.dataset.delete),undefined,'DELETE');await loadBatches();}
    catch(e){message(e.message,true);deleteButton.disabled=false;}
    return;
  }
  const groupButton=event.target.closest('[data-group-retry]');
  if(groupButton){groupButton.disabled=true;try{await api('/api/psychology-auto-publish/groups/'+encodeURIComponent(groupButton.dataset.groupRetry)+'/retry',{});await loadBatches();}catch(e){message(e.message,true);groupButton.disabled=false;}return;}
  const button=event.target.closest('[data-retry]');if(!button)return;button.disabled=true;
  try{await api('/api/psychology-auto-publish/'+encodeURIComponent(button.dataset.retry)+'/retry',{});await loadBatches();}
  catch(e){message(e.message,true);button.disabled=false;}
});
$('#batchForm').addEventListener('submit',async event=>{
  event.preventDefault();if(state.busy)return;
  if(state.accountsLoading||state.accountsMedia!==state.mediaType)return message('请等待当前内容类型的发布账号加载完成，或点击刷新账号重试。',true);
  const ids=selected();
  if(!ids.length)return message('请先选择发布账号。',true);
  if(Number($('#count').value)<ids.length)return message('生成总数不能少于所选账号数。',true);
  const body=state.submittedInput||{allowPeerReuse:$('#allowPeerReuse').value==='yes',requestId:state.requestId,name:$('#batchName').value,mediaType:state.mediaType,template:$('#template').value,sourceType:sourceType(),onlyUnused:sourceType()==='topic-bank'&&$('#onlyUnused').checked,count:Number($('#count').value),connectionIds:ids,selection:$('#selection').value,query:$('#query').value,scheduleAt:Math.floor(new Date($('#scheduleAt').value).getTime()/1000),intervalMinutes:Number($('#intervalMinutes').value),rewriteCopy:state.mediaType==='photo'&&$('#rewriteCopy')?.checked===true,musicIds:state.mediaType==='photo'?musicPool():[]};
  state.submittedInput=body;state.busy=true;
  const controls=[...$('#batchForm').querySelectorAll('input,select,textarea,button')];controls.forEach(n=>n.disabled=true);
  message('正在抽取选题并创建自动发布任务…');
  try {
    const data=await api('/api/psychology-auto-publish',body);
    state.requestId=crypto.randomUUID();state.submittedInput=null;
    message(data.duplicate?'该批次已创建，已恢复任务状态。':'任务已加入队列，每20条素材就绪后整批提交。');
    try {
      const options=await api('/api/psychology-auto-publish/options');state.topicCounts=options.topicCounts;renderSources();
      await loadBatches();
    } catch(error) { message('批次已创建，刷新状态失败：'+error.message+'。请使用刷新进度查看。',true); }
  } catch(e){message(e.message+'；若是网络错误，直接再次提交会恢复同一批次。',true);}
  finally{state.busy=false;controls.forEach(n=>n.disabled=false);renderAccountControls();}
});
const start=new Date(Date.now()+2*3600000);start.setMinutes(start.getMinutes()-start.getTimezoneOffset());$('#scheduleAt').value=start.toISOString().slice(0,16);
try {
  const data=await api('/api/psychology-auto-publish/options');Object.assign(state,{templates:data.templates,counts:data.counts,topicCounts:data.topicCounts,canUseTopics:data.canUseTopics});
  if($('#musicIds')&&Array.isArray(data.musicPool))$('#musicIds').value=data.musicPool.join('\n');
  renderTemplates();
  await Promise.all([loadAccounts(),loadBatches()]);
} catch(e){message(e.message,true);}
setInterval(()=>{if(!document.hidden)loadBatches().catch(e=>message(e.message,true));},15000);
