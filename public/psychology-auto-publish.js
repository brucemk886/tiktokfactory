import { VISUAL_STYLES } from './psychology-visual-styles.js';
const $ = s => document.querySelector(s);
const state = { mediaType:'video', templates:{}, counts:{}, accounts:[], groups:[], selectedAccounts:new Set(), accountGroup:"", accountQuery:"", accountsLoadId:0, accountsLoading:false, accountsMedia:"", accountsLoaded:false, batches:[], batchesLoaded:false, batchesError:false, requestId:crypto.randomUUID(), busy:false, submittedInput:null };
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
function message(text,error=false) { $('#message').textContent=text; $('#message').classList.toggle('error',error);$('#queueMessage').textContent=text;$('#queueMessage').classList.toggle('error',error);if(error)globalThis.LFUI?.toast(text,true); }
function renderTemplates() {
  $('#template').innerHTML=(state.templates[state.mediaType]||[]).map(t=>`<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('');
  $('#sourceHint').textContent=`选题来源：同行${state.mediaType==='photo'?'图文':'视频'}爆款库，共 ${state.counts[state.mediaType]||0} 条。每条爆款生成一条新内容。`;
  renderSources();
  const extras=$('#photoOptions');
  if(extras){extras.hidden=state.mediaType!=='photo';extras.open=false;}
}

function sourceType(){return (state.mediaType==='photo'?$('#photoSource').value:$('#sourceType').value)||'peer';}
function renderSources(){
  $('#sourceTypeField').hidden=state.mediaType!=='video';
  $('#photoSourceField').hidden=state.mediaType!=='photo';
  if(!state.canUseTopics&&$('#sourceType').value==='topic-bank')$('#sourceType').value='copy-library';
  $('#sourceType option[value="topic-bank"]').disabled=!state.canUseTopics;
  const bank=sourceType()==='topic-bank',evolving=sourceType()==='library',fromLibrary=['copy-bank','copy-library','library'].includes(sourceType()),previous=$('#selection').value;
  $('#libraryMediaField').hidden=sourceType()!=='copy-library';
  if(fromLibrary)$('#rewriteCopy').checked=false;
  $('#rewriteCopy').disabled=fromLibrary;
  $('#rewriteCopyField').hidden=fromLibrary;
  const originalPhoto=$('#template option[value="photo-original"]');
  if(originalPhoto)originalPhoto.disabled=fromLibrary;
  if(state.mediaType==='photo'&&fromLibrary)$('#template').value='photo-text';
  const choices=bank?[['random','随机抽取'],['priority','优先级优先'],['recent','最近入库优先'],['least-used','最少使用优先']]:evolving?[['evolve','按表现进化 · 原版优先']]:fromLibrary?[['random','随机抽取'],['recent','最近导入优先']]:[['random','随机抽取'],['popular','播放量优先'],['recent','最近入库优先']];
  $('#selection').innerHTML=choices.map(([v,label])=>'<option value="'+v+'">'+label+'</option>').join('');
  if(choices.some(([v])=>v===previous))$('#selection').value=previous;
  $('#topicBankField').hidden=!bank;
  $('#templateField').hidden=bank;
  const banks=state.templates.video||[];
  $('#topicBank').innerHTML=banks.map((t,index)=>{
    const c=state.topicCounts?.[t.id]||{};
    return `<option value="${esc(t.id)}">${String(index+1).padStart(2,'0')} · ${esc(t.label)}题库（已启用 ${c.enabled||0} / 共 ${c.total||0} 题）</option>`;
  }).join('');
  $('#topicBank').value=bank?$('#template').value:'';
  $('#topicBankLink').href='/psychology-topic-bank?template='+encodeURIComponent($('#topicBank').value);
  $('#unusedField').hidden=!bank;
  $('#peerReuseField').hidden=bank;
  $('#query').placeholder=bank?'筛选题目、内容或分类，不填则从所选题库抽取':'筛选爆款标题或同行账号';
  if(sourceType()==='copy-bank')$('#query').placeholder='筛选文案标题或来源编号';
  if(sourceType()==='copy-library'||evolving)$('#query').placeholder='搜索文案标题、正文或原帖链接，不填则从整个文案库抽取';
  const c=state.topicCounts?.[$('#template').value]||{};
  const label=banks.find(t=>t.id===$('#topicBank').value)?.label||'';
  $('#sourceHint').textContent=evolving?'从文案库图文爆款抽取：已提取原文 '+(state.libraryCounts?.photo||0)+' 篇，启用的改写版本 '+(state.libraryRewrites||0)+' 个。每篇先用原版，原版攒够 3 条满 24 小时的数据后开始试改写版本；表现最好的版本拿约 70%，其余继续试新版本；平均播放低于原版一半的改写不再抽。同一账号不会重复发同一篇爆款（原版或任一改写）。数据每天 0 点、8 点更新。':sourceType()==='copy-library'?'复用已提取文字（图文 '+(state.libraryCounts?.photo||0)+' 篇 / 视频 '+(state.libraryCounts?.video||0)+' 篇），不重复获取原素材。图文优先按原分页或视频口播生成，最多6页；视频以正文编排模板，最多5000字符。题目揭晓评论仍需选择模板题库。':sourceType()==='copy-bank'?'从已启用的改写版本抽取。图文直接使用已保存分页；视频以版本正文为依据生成。':bank?label+'题库：已启用 '+(c.enabled||0)+' 条，未使用 '+(c.unused||0)+' 条。只从所选题库抽取；不足时不会创建任务。':'选题来源：同行'+(state.mediaType==='photo'?'图文':'视频')+'爆款库，共 '+(state.counts[state.mediaType]||0)+' 条。';
}
$('#sourceType').addEventListener('change',renderSources);
$('#styleId').innerHTML=VISUAL_STYLES.map(s=>`<option value="${s.id}">${s.label}</option>`).join('');
$('#styleId').disabled=true;$('#styleMode').onchange=()=>{$('#styleId').disabled=$('#styleMode').value!=='fixed';};
$('#photoSource').onchange=renderSources;
$('#libraryMediaType').onchange=renderSources;
$('#template').addEventListener('change',renderSources);
$('#topicBank').addEventListener('change',()=>{
  if(state.busy||sourceType()!=='topic-bank')return;
  $('#template').value=$('#topicBank').value;
  resetAccountInput();renderSources();summary();
});

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
  // Submitted describes the batch handoff; individual publication results are separate.
  const active=items.some(i=>['queued','running','handoff','ready','done'].includes(i.status))||groups.some(g=>g.retrying||g.status==='submitting');
  if(!active && items.some(i=>i.status==='submitted'))return 'done';
  if(groups.some(g=>g.status==='failed'&&!g.retrying))return 'failed';
  if(items.some(i=>i.status==='missing'))return 'unknown';
  if(groups.some(g=>g.retrying))return 'running';
  if(!items.length)return 'cancelled';
  if(items.some(i=>i.status==='failed'))return 'failed';
  if(items.some(i=>['running','handoff','ready','done'].includes(i.status)))return 'running';
  if(items.every(i=>i.status==='submitted'||i.status==='cancelled'))return items.every(i=>i.status==='cancelled')?'cancelled':'done';
  return items.some(i=>i.status==='queued')?'queued':'unknown';
}
function publicationCounts(items){
  const counts={published:0,failed:0,pending:0,unavailable:0};
  for(const item of items)counts[Object.hasOwn(counts,item.publishOutcome)?item.publishOutcome:'unavailable']++;
  return counts;
}
function publicationSummary(items){
  const c=publicationCounts(items);
  return '发布成功 '+c.published+' 条 · 发布失败 '+c.failed+' 条'+(c.pending?' · 发布中 '+c.pending+' 条':'')+(c.unavailable?' · 未返回结果 '+c.unavailable+' 条':'');
}
function statusLabel(status){
  return {unknown:'状态待核实',queued:'排队中',running:'执行中',done:'已提交',failed:'待处理',cancelled:'已取消'}[status]||status;
}
let batchPage=1,batchLoadVersion=0;
$('#batchPrev').addEventListener('click',()=>{batchPage=Math.max(1,batchPage-1);loadBatches().catch(e=>message(e.message,true));});
$('#batchNext').addEventListener('click',()=>{batchPage++;loadBatches().catch(e=>message(e.message,true));});
$('#batchFilter').addEventListener('change',()=>{batchPage=1;loadBatches().catch(e=>message(e.message,true));});
async function loadBatches() {
  const version=++batchLoadVersion;
  if(!state.batchesLoaded){state.batchesError=false;renderBatches();}
  let data;
  try{data=await api('/api/psychology-auto-publish?page='+batchPage+'&attention='+($('#batchFilter').value==='attention'?'1':'0'));}
  catch(error){if(version===batchLoadVersion&&!state.batchesLoaded){state.batchesError=true;renderBatches();}throw error;}
  if(version!==batchLoadVersion)return;
  const signature=JSON.stringify(data.batches||[]),changed=signature!==state.lastBatchJSON;state.lastBatchJSON=signature;
  state.batches=data.batches||[];state.batchesLoaded=true;state.batchesError=false;
  $('#batchPrev').disabled=batchPage<=1;$('#batchNext').disabled=!data.pagination?.hasMore;
  $('#batchPage').textContent='第 '+batchPage+' 页 / 共 '+(data.pagination?.total||0)+' 个任务';
  if(changed)renderBatches();
}
function renderBatches() {
  if(!state.batchesLoaded){
    for(const id of ['pageTotalCount','queuedCount','runningCount','attentionCount','doneCount'])$('#'+id).textContent='—';
    $('#safetySummary').textContent=state.batchesError?'任务加载失败，请点击刷新重试。':'正在加载发布任务…';
    $('#batches').setAttribute('aria-busy',String(!state.batchesError));
    $('#batches').innerHTML='<div class="empty-state" role="status"><strong>'+(state.batchesError?'任务加载失败':'正在加载发布任务…')+'</strong><span>'+(state.batchesError?'请点击上方刷新重试。':'正在读取任务和发布结果，请稍候。')+'</span></div>';
    $('#batchPrev').disabled=true;$('#batchNext').disabled=true;
    return;
  }
  $('#batches').setAttribute('aria-busy','false');
  const tones=state.batches.map(b=>batchStatus(b.items||[],b.groups||[]));
  $('#queuedCount').textContent=tones.filter(s=>s==='queued').length;
  $('#runningCount').textContent=tones.filter(s=>s==='running').length;
  $('#attentionCount').textContent=tones.filter(s=>s==='failed'||s==='unknown').length;
  $('#doneCount').textContent=tones.filter(s=>s==='done'||s==='cancelled').length;
  $('#safetySummary').textContent=state.batches.length?`本页 ${state.batches.length} 个任务，关闭页面不影响已入队任务。`:'生成完成后自动提交官方发布中台';
  $('#pageTotalCount').textContent=state.batches.length;
  const query=($('#batchSearch').value||'').trim().toLowerCase(),media=$('#batchMedia').value||'all';
  const rows=state.batches.filter(b=>(media==='all'||b.config.mediaType===media)&&(!query||[b.config.name,...(b.items||[]).map(i=>accountName(i.connectionId))].join(' ').toLowerCase().includes(query)));
  $('#batches').innerHTML=rows.length?'<div class="batch-table-wrap"><table class="batch-table"><thead><tr><th>批次名称</th><th>内容类型</th><th>账号 / 内容</th><th>生成进度</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>'+rows.map(b=>{
    const items=b.items||[],tone=batchStatus(items,b.groups||[]),accounts=[...new Set(items.map(i=>i.connectionId).filter(Boolean))];
    const percent=items.length?Math.max(0,Math.min(100,Math.round(items.reduce((n,i)=>n+(i.status==='submitted'?100:Number(i.percent)||0),0)/items.length))):0;
    return `<tr data-batch-row="${esc(b.id)}"><td><button type="button" class="batch-name" data-batch-open="${esc(b.id)}">${esc(b.config.name||'心理学自动发布')}</button><small>${esc((state.templates[b.config.mediaType]||[]).find(t=>t.id===b.config.template)?.label||b.config.template||'')}</small></td><td><span class="batch-kind">${b.config.mediaType==='photo'?'图文':'视频'}</span></td><td><span title="${esc(accounts.map(accountName).join('、'))}">${accounts.length} 个账号</span><small>${items.length} 条内容</small></td><td><span>${percent}%</span><progress value="${percent}" max="100" aria-label="生成进度">${percent}%</progress></td><td><span class="task-status-badge" data-tone="${tone}">${esc(statusLabel(tone))}</span><small>${esc(publicationSummary(items))}</small></td><td class="batch-time">${esc(time(b.createdAt/1000))}</td><td><button type="button" data-batch-open="${esc(b.id)}" aria-label="查看批次：${esc(b.config.name||'心理学自动发布')}">查看</button></td></tr>`;
  }).join('')+'</tbody></table></div>':'<div class="empty-state"><strong>'+ (state.batches.length?'本页没有匹配任务':'暂无发布任务')+'</strong><span>'+(state.batches.length?'调整搜索或内容类型筛选后重试。':'点击右上角“新建发布任务”开始。')+'</span></div>';
  if($('#batchDetail').open)renderSelectedBatch();

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
async function handleBatchAction(event){
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
}
$('#batchDetailBody').addEventListener('click',handleBatchAction);
$('#batchDetailItems').addEventListener('click',handleBatchAction);
$('#batchForm').addEventListener('submit',async event=>{
  event.preventDefault();if(state.busy)return;
  if(state.accountsLoading||state.accountsMedia!==state.mediaType)return message('请等待当前内容类型的发布账号加载完成，或点击刷新账号重试。',true);
  const ids=selected();
  if(!ids.length)return message('请先选择发布账号。',true);
  if(Number($('#count').value)<ids.length)return message('生成总数不能少于所选账号数。',true);
  if(sourceType()==='topic-bank'&&(!$('#topicBank').value||$('#topicBank').value!==$('#template').value))return message('请选择与生成模板对应的具体题库。',true);
  const body=state.submittedInput||{styleMode:$('#styleMode').value,styleId:$('#styleId').value,allowPeerReuse:$('#allowPeerReuse').value==='yes',requestId:state.requestId,name:$('#batchName').value,mediaType:state.mediaType,template:$('#template').value,sourceType:sourceType(),...(sourceType()==='copy-library'?{libraryMediaType:$('#libraryMediaType').value}:{}),onlyUnused:sourceType()==='topic-bank'&&$('#onlyUnused').checked,count:Number($('#count').value),connectionIds:ids,selection:$('#selection').value,query:$('#query').value,scheduleAt:Math.floor(new Date($('#scheduleAt').value).getTime()/1000),intervalMinutes:Number($('#intervalMinutes').value),rewriteCopy:state.mediaType==='photo'&&$('#rewriteCopy')?.checked===true,musicIds:state.mediaType==='photo'?musicPool():[]};
  state.submittedInput=body;state.busy=true;$('#closeCreateBatch').disabled=true;
  const controls=[...$('#batchForm').querySelectorAll('input,select,textarea,button')];controls.forEach(n=>n.disabled=true);
  message('正在抽取选题并创建自动发布任务…');
  try {
    const data=await api('/api/psychology-auto-publish',body);
    $('#createBatchDialog').close();globalThis.LFUI?.toast('发布任务已创建，可以在列表中查看进度。');
    state.requestId=crypto.randomUUID();state.submittedInput=null;
    message(data.duplicate?'该批次已创建，已恢复任务状态。':'任务已加入队列，每20条素材就绪后整批提交。');
    try {
      const options=await api('/api/psychology-auto-publish/options');state.topicCounts=options.topicCounts;state.libraryCounts=options.libraryCounts;renderSources();
      await loadBatches();
    } catch(error) { message('批次已创建，刷新状态失败：'+error.message+'。请使用刷新进度查看。',true); }
  } catch(e){message(e.message+'；若是网络错误，直接再次提交会恢复同一批次。',true);}
  finally{state.busy=false;$('#closeCreateBatch').disabled=false;controls.forEach(n=>n.disabled=false);renderSources();$('#styleId').disabled=$('#styleMode').value!=='fixed';renderAccountControls();}
});

function renderBatchDetail(b){
 const labels={queued:'等待执行',running:'执行中',done:'生成完成',submitted:'已提交中台',failed:'失败',cancelled:'已取消',missing:'任务记录缺失，发布结果待核实',handoff:'等待卡片渲染'};

    const items=b.items||[];
    const status=batchStatus(items,b.groups||[]);
    const submitted=items.filter(i=>i.status==='submitted').length;
    const running=items.filter(i=>['running','handoff','done'].includes(i.status)).length;
    const ready=items.filter(i=>i.status==='ready').length;
    const failed=items.filter(i=>i.status==='failed');
    const missing=items.filter(i=>i.status==='missing').length;
    const retryItems=items.filter(i=>['failed','handoff'].includes(i.status));
    const percent=items.length?Math.round(items.reduce((sum,i)=>sum+(i.status==='submitted'?100:Number(i.percent)||0),0)/items.length):0;
    const template=(state.templates[b.config.mediaType]||[]).find(t=>t.id===b.config.template)?.label||b.config.template;
    const accounts=[...new Set(items.map(i=>i.connectionId).filter(Boolean))].map(accountName);
    const schedule=Object.entries(items.reduce((map,i)=>{const key=time(i.scheduleAt);map[key]=(map[key]||0)+1;return map;},{})).map(([when,count])=>`<span><b>${esc(when)}</b><em>${count} 条</em></span>`).join('');
    const message=missing?publicationSummary(items):(b.groups||[]).find(g=>g.error)?.error||failed[0]?.error||items.find(i=>i.message)?.message||(!items.length?'该批次内容已全部删除。':submitted===items.length?'已全部提交官方发布中台。':`${labels[items[0]?.status]||'等待执行'} · ${submitted} / ${items.length} 已提交`);
    return `<article class="auto-task-item" data-status="${esc(status)}">
      <div class="task-item-head"><div><strong>${esc(b.config.name||'心理学自动发布')}</strong><small>${esc(time(b.createdAt/1000))} · ${b.config.mediaType==='photo'?'图文':'视频'} · ${esc(template)}</small></div><div class="task-head-actions"><span class="task-status-badge" data-tone="${esc(status)}">${esc(statusLabel(status))}</span></div></div>
      ${accounts.length?`<details class="task-accounts"><summary>${accounts.length} 个发布账号</summary><div class="task-groups">${accounts.map(name=>`<b>${esc(name)}</b>`).join('')}</div></details>`:''}
      <div class="detail-summary"><div><strong>${accounts.length}</strong><span>发布账号</span></div><div><strong>${items.length}</strong><span>本批内容</span></div><div><strong>${submitted}</strong><span>已提交中台</span></div></div>
      <div class="detail-progress-label"><span>生成进度</span><b>${Math.max(0,Math.min(100,percent))}%</b></div>
      <div class="task-progress"><div style="width:${Math.max(0,Math.min(100,percent))}%"></div></div>
      <p>${esc(publicationSummary(items))}</p>${message!==publicationSummary(items)?`<p>${esc(message)}</p>`:''}
      <div class="task-counts"><span>预计 ${b.config.count} 条${b.deletedCount?' · 已删除 '+b.deletedCount+' 条':''}</span><span>执行中 ${running}</span><span>待合批 ${ready}</span><span>已提交中台 ${submitted}</span><span>失败 ${failed.length}</span>${missing?`<span>未返回结果 ${missing}</span>`:''}${items.some(i=>i.retryAt)?`<span>自动重试 ${Math.max(...items.map(i=>i.retryCount||0))}/2 · 等待排队</span>`:''}${b.config.mediaType==='photo'?`<span>${b.config.rewriteCopy?'改写文案':'保留原文'}</span><span>${b.config.musicIds?.length?'音乐池 '+b.config.musicIds.length+' 首':'自动配乐'}</span>`:''}<span>${b.config.sourceType==='library'?'文案库 · 按表现进化':b.config.sourceType==='copy-library'?'文案库原文':b.config.sourceType==='copy-bank'?'文案库改写':b.config.sourceType==='topic-bank'?'模板题库':'同行爆款'}</span></div>
      ${(b.groups||[]).length?`<div class="publish-groups"><strong>中台发布分组 · 每组最多20条</strong>${b.groups.map(g=>{const members=items.filter(i=>i.groupId===g.id);const n=members.filter(i=>['ready','submitted'].includes(i.status)).length;return `<div class="publish-group"><span>第 ${g.number} 批 · ${g.count} 条 · ${g.retrying?'自动重试 '+g.retryCount+'/2 · '+(g.retryAt?'等待排队':'执行中'):g.status==='cancelled'?'已删除全部内容':g.status==='submitted'?'已提交':g.status==='submitting'?'提交中':g.status==='failed'?'提交失败':members.some(i=>i.status==='missing')?'未返回发布结果':'已就绪 '+n+'/'+g.count}${g.remoteBatchId?`<small>中台编号：${esc(g.remoteBatchId)}</small>`:''}${g.error?`<small class="error">${esc(g.error)}</small>`:''}</span>${g.canRetry?`<button type="button" data-group-retry="${esc(g.id)}">${g.status==='waiting'?'提交剩余内容':'重试整批提交'}</button>`:''}</div>`;}).join('')}</div>`:''}
      ${schedule?`<details class="task-schedule"><summary>具体排期</summary>${schedule}</details>`:''}
      ${retryItems.length?`<div class="manual-items"><strong>待人工处理</strong>${retryItems.map(i=>`<div class="manual-item"><span>${esc(i.title||i.sourceId)}<small>${esc(i.error||i.message||labels[i.status])}</small></span><div class="manual-actions"><button type="button" data-retry="${esc(i.id)}">重试</button>${i.status==='failed'?`<button type="button" data-delete="${esc(i.id)}">删除</button>`:''}</div></div>`).join('')}</div>`:''}
    </article>`;
}
let selectedBatchId='';
function renderSelectedBatch(){
 const b=state.batches.find(b=>b.id===selectedBatchId);if(!b){$('#batchDetailBody').innerHTML='<div class="empty-state">该任务已不在当前页，请关闭详情并刷新列表。</div>';$('#batchDetailItems').innerHTML='';return;}
 $('#batchDetailBody').innerHTML=renderBatchDetail(b);
 $('#batchDetailItems').innerHTML=(b.items||[]).map(i=>`<article class="detail-item"><strong>${esc(i.title||i.sourceId||'未命名内容')}</strong><p>${esc(accountName(i.connectionId))} · ${esc(time(i.scheduleAt))}</p><p>${esc(({published:'发布成功',failed:'发布失败'})[i.publishOutcome]||({missing:'未返回发布结果',submitted:'已提交中台',failed:'失败',queued:'排队中',ready:'等待合批',running:'执行中',done:'生成完成',handoff:'等待卡片渲染',cancelled:'已取消'})[i.status]||i.status)}</p>${i.error?'<details><summary>查看失败原因</summary><pre>'+esc(i.error)+'</pre></details>':''}</article>`).join('')||'<div class="empty-state">该任务内容已全部删除。</div>';
}
function detailTab(items){$('#batchDetailBody').hidden=items;$('#batchDetailItems').hidden=!items;$('#detailOverviewTab').setAttribute('aria-selected',String(!items));$('#detailItemsTab').setAttribute('aria-selected',String(items));$('#detailOverviewTab').tabIndex=items?-1:0;$('#detailItemsTab').tabIndex=items?0:-1;}
$('#detailOverviewTab').addEventListener('click',()=>detailTab(false));$('#detailItemsTab').addEventListener('click',()=>detailTab(true));
for(const id of ['detailOverviewTab','detailItemsTab'])$('#'+id).addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const items=e.key==='End'||(e.key!=='Home'&&id==='detailOverviewTab');detailTab(items);$('#'+(items?'detailItemsTab':'detailOverviewTab')).focus();}});
$('#newBatch').addEventListener('click',()=>{$('#photoOptions').open=false;$('#createBatchDialog').showModal();$('#batchName').focus();});
$('#closeCreateBatch').addEventListener('click',()=>{if(!state.busy)$('#createBatchDialog').close();});
$('#createBatchDialog').addEventListener('cancel',e=>{if(state.busy)e.preventDefault();});
$('#closeBatchDetail').addEventListener('click',()=>$('#batchDetail').close());
$('#batchDetail').addEventListener('close',()=>{document.querySelector('[data-batch-open="'+CSS.escape(selectedBatchId)+'"]')?.focus();});
$('#batches').addEventListener('click',event=>{const button=event.target.closest('[data-batch-open]');if(!button)return;selectedBatchId=button.dataset.batchOpen;renderSelectedBatch();detailTab(false);$('#batchDetail').showModal();});
$('#batchSearch').addEventListener('input',renderBatches);$('#batchMedia').addEventListener('change',renderBatches);
const start=new Date(Date.now()+2*3600000);start.setMinutes(start.getMinutes()-start.getTimezoneOffset());$('#scheduleAt').value=start.toISOString().slice(0,16);
// Task-list loading is independent of creation-form options and account lookups.
const initialLoads=await Promise.allSettled([
  loadBatches(),
  loadAccounts(),
  (async()=>{
    const data=await api('/api/psychology-auto-publish/options');Object.assign(state,{templates:data.templates,counts:data.counts,libraryCounts:data.libraryCounts,libraryRewrites:data.libraryRewrites,topicCounts:data.topicCounts,canUseTopics:data.canUseTopics});
    if($('#musicIds')&&Array.isArray(data.musicPool))$('#musicIds').value=data.musicPool.join('\n');
    renderTemplates();renderBatches();
  })(),
]);
for(const result of initialLoads)if(result.status==='rejected')message(result.reason.message,true);
setInterval(()=>{if(!document.hidden)loadBatches().catch(e=>message(e.message,true));},15000);
