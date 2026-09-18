const $ = s => document.querySelector(s);
const state = { mediaType:'video', templates:{}, counts:{}, accounts:[], batches:[], requestId:crypto.randomUUID(), busy:false, submittedInput:null };
const esc = v => String(v ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time = seconds => new Date(seconds*1000).toLocaleString('zh-CN',{hour12:false});
async function api(path, body) {
  const response = await fetch(path,{...(body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})});
  const data = await response.json();
  if(!response.ok) throw new Error(data.error || '请求失败');
  return data;
}
function selected() { return [...document.querySelectorAll('#accounts input:checked')].map(n=>n.value); }
function musicPool() { return [...new Set(($('#musicIds')?.value||'').split(/[\s,，;；]+/).map(v=>v.trim()).filter(Boolean))]; }
function message(text,error=false) { $('#message').textContent=text; $('#message').classList.toggle('error',error); }
function renderTemplates() {
  $('#template').innerHTML=(state.templates[state.mediaType]||[]).map(t=>`<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('');
  $('#sourceHint').textContent=`选题来源：同行${state.mediaType==='photo'?'图文':'视频'}爆款库，共 ${state.counts[state.mediaType]||0} 条。每条爆款生成一条新内容。`;
  if($('#rewriteCopyField')) $('#rewriteCopyField').hidden=state.mediaType!=='photo';
  if($('#musicPoolField')) $('#musicPoolField').hidden=state.mediaType!=='photo';
}
async function loadAccounts() {
  const ids=new Set(selected());
  const data=await api('/api/official-tiktok/publish-accounts?module=psychology&media='+state.mediaType);
  state.accounts=data.accounts||[];
  $('#accounts').innerHTML=state.accounts.length ? state.accounts.map(a=>{
    const id=String(a.connectionId||a.id);
    return `<label class="account-choice"><input type="checkbox" value="${esc(id)}" ${ids.has(id)?'checked':''}><span><strong>${esc(a.displayName||a.label||a.username||id)}</strong><small>${esc(a.username?'@'+a.username:'')} · ${esc(a.groupName||'未分组')}</small></span></label>`;
  }).join('') : '<div class="empty-state">心理学项目还没有可发布账号，请先在 TikTok 账号页分配分组。</div>';
  summary();
}
function accountName(id) { const a=state.accounts.find(a=>String(a.connectionId||a.id)===id); return a?.displayName||a?.label||a?.username||id; }
function summary() {
  const ids=selected(), count=Number($('#count').value)||0;
  $('#summary').textContent=ids.length ? `本批共生成 ${count} 条${state.mediaType==='photo'?'图文':'视频'}，分配到 ${ids.length} 个账号。 `+
    ids.map((id,i)=>accountName(id)+'：'+Math.max(0,Math.floor((count+ids.length-1-i)/ids.length))+' 条').join('；') : '选择账号后显示本批内容分配。';
}
async function loadBatches() {
  const open=new Set([...document.querySelectorAll('details[open]')].map(n=>n.dataset.id));
  const data=await api('/api/psychology-auto-publish'); state.batches=data.batches||[];
  const labels={queued:'等待执行',running:'执行中',done:'生成完成',submitted:'已提交中台',failed:'失败',cancelled:'已取消',missing:'任务已清理',handoff:'等待卡片渲染'};
  $('#batches').innerHTML=state.batches.length?state.batches.map(b=>{
    const done=b.items.filter(i=>i.status==='submitted').length;
    const failures=b.items.filter(i=>i.status==='failed').length;
    return `<details class="batch-card" data-id="${esc(b.id)}" ${open.has(b.id)?'open':''}><summary><span>${esc(b.config.name)} <small>· ${b.config.mediaType==='photo'?'图文':'视频'} ${b.config.count} 条</small></span><small>已提交 ${done} / ${b.config.count}${failures?' · 失败 '+failures:''}</small></summary><p class="batch-meta">${esc(time(b.createdAt/1000))} 创建 · ${esc((state.templates[b.config.mediaType]||[]).find(t=>t.id===b.config.template)?.label||b.config.template)}${b.config.mediaType==='photo'?` · ${b.config.rewriteCopy?'改写文案':'保留原文'} · ${b.config.musicIds?.length?'音乐池 '+b.config.musicIds.length+' 首随机':'自动推荐配乐'}`:''} · 同账号间隔 ${b.config.intervalMinutes} 分钟</p><div class="queue-wrap"><table class="queue-table"><thead><tr><th>选题</th><th>发布账号</th><th>计划时间</th><th>进度</th><th></th></tr></thead><tbody>${b.items.map(i=>`<tr><td>${esc(i.title||i.sourceId)}</td><td>${esc(accountName(i.connectionId))}</td><td>${esc(time(i.scheduleAt))}</td><td>${esc(labels[i.status]||i.status)}<progress max="100" value="${Number(i.percent)||0}"></progress><small class="${i.error?'error':''}">${esc(i.error||i.message)}</small></td><td>${['failed','handoff'].includes(i.status)?`<button type="button" data-retry="${esc(i.id)}">重试</button>`:''}</td></tr>`).join('')}</tbody></table></div></details>`;
  }).join(''):'<div class="empty-state">还没有自动发布批次。配置内容和账号后，创建第一批任务。</div>';
}
$('#batchForm').addEventListener('input',()=>{ if(!state.busy){state.requestId=crypto.randomUUID();state.submittedInput=null;} summary(); });
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
  const button=event.target.closest('[data-retry]');if(!button)return;button.disabled=true;
  try{await api('/api/psychology-auto-publish/'+encodeURIComponent(button.dataset.retry)+'/retry',{});await loadBatches();}
  catch(e){message(e.message,true);button.disabled=false;}
});
$('#batchForm').addEventListener('submit',async event=>{
  event.preventDefault();if(state.busy)return;
  const ids=selected();
  if(!ids.length)return message('请先选择发布账号。',true);
  if(Number($('#count').value)<ids.length)return message('生成总数不能少于所选账号数。',true);
  const body=state.submittedInput||{requestId:state.requestId,name:$('#batchName').value,mediaType:state.mediaType,template:$('#template').value,count:Number($('#count').value),connectionIds:ids,selection:$('#selection').value,query:$('#query').value,scheduleAt:Math.floor(new Date($('#scheduleAt').value).getTime()/1000),intervalMinutes:Number($('#intervalMinutes').value),rewriteCopy:state.mediaType==='photo'&&$('#rewriteCopy')?.checked===true,musicIds:state.mediaType==='photo'?musicPool():[]};
  state.submittedInput=body;state.busy=true;
  const controls=[...$('#batchForm').querySelectorAll('input,select,button')];controls.forEach(n=>n.disabled=true);
  message('正在抽取选题并创建自动发布任务…');
  try {
    const data=await api('/api/psychology-auto-publish',body);
    state.requestId=crypto.randomUUID();state.submittedInput=null;
    message(data.duplicate?'该批次已创建，已恢复任务状态。':'批次已加入队列，生成完成后自动发布。');
    await loadBatches();
  } catch(e){message(e.message+'；若是网络错误，直接再次提交会恢复同一批次。',true);}
  finally{state.busy=false;controls.forEach(n=>n.disabled=false);}
});
const start=new Date(Date.now()+2*3600000);start.setMinutes(start.getMinutes()-start.getTimezoneOffset());$('#scheduleAt').value=start.toISOString().slice(0,16);
try {
  const data=await api('/api/psychology-auto-publish/options');Object.assign(state,{templates:data.templates,counts:data.counts});
  if($('#musicIds')&&Array.isArray(data.musicPool))$('#musicIds').value=data.musicPool.join('\n');
  renderTemplates();
  await Promise.all([loadAccounts(),loadBatches()]);
} catch(e){message(e.message,true);}
setInterval(()=>{if(!document.hidden)loadBatches().catch(e=>message(e.message,true));},15000);
