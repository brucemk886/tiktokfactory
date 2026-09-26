import * as cards from './psychology-text-card.js';
import * as renderer from './psychology-card-renderer.js';
import {renderAutomationCard} from './psychology-card-runtime.js';
window.cards=cards;window.renderer=renderer;
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const views={directions:['内容方向','/photo-factory'],library:['文案库','/photo-factory/library'],templates:['模板工作台','/photo-factory/templates'],autopilot:['自动运营','/photo-factory/autopilot'],reports:['运营报表','/photo-factory/reports']};
const view=Object.keys(views).find(k=>views[k][1]===location.pathname)||'directions';
let catalog={},selected='',revision=0,copyPage=1,reportPage=1,editingDirection=null,copySource='',copyItems=[],pilotItems=[],groupItems=[],previewUrls=[],pilotRequestIds=new Map();
const split=v=>v.split(/[,，\n]/).map(x=>x.trim()).filter(Boolean),pages=v=>v.split(/^\s*---\s*$/m).map(x=>x.trim()).filter(Boolean);
const metric=v=>v==null?'—':Number(v).toLocaleString('zh-CN'),date=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
const stateLabels={draft:'草稿',active:'运行中',paused:'已暂停',ended:'已结束',queued:'等待制作',dispatching:'待执行',rendering:'制作中',ready:'准备提交',submitting:'提交核对中',submitted:'TikTok 处理中',published:'已发布',failed:'失败',stopped:'已停止'};
const strategyLabels={balanced:'A · 原文与改写',original:'B · 只用原文',rewrite:'C · 只用改写'};
const direction=()=>catalog.directions?.find(d=>d.id===selected);
function status(message='',error=false){$('status').textContent=message;$('status').classList.toggle('pf-error',error);}
async function api(path,{method='GET',body,params={},directionId=selected}={}){
 const q=new URLSearchParams({...params,...(directionId?{directionId}:{})});
 const response=await fetch('/api/photo-factory'+path+'?'+q,{method,headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
 let data;try{data=await response.json();}catch{throw new Error('服务返回异常，请重试。');}if(!response.ok||data.error)throw new Error(data.error||'读取失败');return data;
}
function showDialog(id){const el=$(id);el.querySelectorAll('.formStatus').forEach(p=>p.textContent='');el.showModal();}
function wireForm(id,fn){$(id).addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);const notice=form.querySelector('.formStatus');if(notice)notice.textContent='处理中…';try{const message=await fn();if(notice)notice.textContent=message||'';}catch(error){if(notice)notice.textContent=error.message;else status(error.message,true);}finally{buttons.forEach(b=>b.disabled=false);}});}
function metrics(id,items){$(id).innerHTML=items.map(([label,value])=>'<div><span>'+esc(label)+'</span><strong>'+esc(metric(value))+'</strong></div>').join('');}
function pager(prefix,page,total){$(prefix+'Page').textContent='第 '+page+' 页 / '+Math.max(1,Math.ceil(total/20))+' 页 · '+total+' 条';$(prefix+'Prev').disabled=page<=1;$(prefix+'Next').disabled=page*20>=total;}
function option(value,label){return '<option value="'+esc(value)+'">'+esc(label)+'</option>';}
async function boot(){
 catalog=await api('/directions',{directionId:''});
 const previous=selected||localStorage.getItem('photo-factory-direction')||'';selected=catalog.directions.some(d=>d.id===previous)?previous:(catalog.directions[0]?.id||'');
 $('direction').innerHTML=catalog.directions.length?catalog.directions.map(d=>option(d.id,d.name+(d.enabled?'':'（已停用）'))).join(''):option('','暂无内容方向');$('direction').value=selected;
 $('directionModel').innerHTML=catalog.models.map(m=>option(m.id,m.label)).join('');
 $('styleChoices').innerHTML=catalog.styles.map(s=>'<label><input type="checkbox" name="style" value="'+esc(s.id)+'">'+esc(s.label)+'</label>').join('');
 await loadView();
}
async function loadView(){
 const current=++revision;status('正在读取…');for(const key of Object.keys(views))$(key).hidden=true;
 $('empty').hidden=Boolean(selected)||view==='directions';$(view).hidden=!selected&&view!=='directions';
 $('keyResult').hidden=true;$('keyResult').textContent='';
 if(!selected&&view!=='directions'){status('');return;}
 try{
  if(view==='directions')renderDirections();
  if(view==='library'){$('copyRows').innerHTML='<tr><td colspan=7>正在读取…</td></tr>';await loadLibrary(current);}
  if(view==='templates'){
   $('previewStyle').innerHTML=direction().config.styleIds.map(id=>option(id,catalog.styles.find(s=>s.id===id)?.label||id)).join('');clearPreviews();
  }
  if(view==='autopilot')await loadPilots(current);
  if(view==='reports'){$('reportRows').innerHTML='<tr><td colspan=6>正在读取…</td></tr>';await loadReport(current);}
  if(current===revision)status('');
 }catch(error){if(current===revision)status(error.message,true);}
}
function renderDirections(){
 $('directionCards').innerHTML=catalog.directions.map(d=>'<article class="pf-card"><div class="pf-heading"><h2>'+esc(d.name)+'</h2><span>'+esc(d.enabled?'启用':'停用')+'</span></div><p>'+esc(d.config.audience)+'</p><p>'+esc(d.config.language)+' · '+esc(d.config.aspect)+' · 最多 '+d.config.maxPages+' 页</p><p>'+esc(d.config.tags.join(' · '))+'</p><div class="pf-actions"><button data-edit="'+esc(d.id)+'">编辑配置</button><button data-use="'+esc(d.id)+'">进入文案库</button></div></article>').join('')||'<div class="pf-panel">还没有内容方向。点击“新增方向”，选择星座或心理学预设开始。</div>';
 $('createKey').disabled=!selected;$('revokeKey').disabled=!selected;
 $('apiExample').textContent=JSON.stringify({items:[{externalId:'source-001',title:'A concrete hook',caption:'Your caption',pages:['Cover text','First idea','Closing thought'],tags:direction()?.config.tags.slice(0,1)||[],metadata:{sourceUrl:'https://www.tiktok.com/@example/photo/123',accountName:'example',views:12000,likes:600,saves:120,shares:30}}]},null,2);
}
function fillDirection(config={}){
 $('directionLanguage').value=config.language||'en';$('directionAudience').value=config.audience||'社交媒体读者';$('directionRules').value=config.rewriteRules||'保留核心观点，强化开头吸引力和阅读节奏。';$('directionTags').value=(config.tags||[]).join(', ');$('directionModel').value=config.model||'claude-sonnet-5';$('directionStructure').value=config.structure||'list';$('directionAspect').value=config.aspect||'9:16';$('directionPages').value=config.maxPages||6;$('directionChars').value=config.maxChars||400;
 document.querySelectorAll('[name=style]').forEach(el=>el.checked=(config.styleIds||['classic','editorial','night']).includes(el.value));
}
function editDirection(id=''){
 editingDirection=catalog.directions.find(d=>d.id===id)||null;$('directionForm').reset();$('directionName').value=editingDirection?.name||'';$('directionSlug').value=editingDirection?.slug||'';$('directionSlug').disabled=!!editingDirection;$('preset').disabled=!!editingDirection;$('directionEnabled').checked=editingDirection?!!editingDirection.enabled:true;fillDirection(editingDirection?.config);showDialog('directionDialog');
}
$('newDirection').onclick=()=>editDirection();
$('preset').onchange=()=>{const preset=catalog.presets[$('preset').value];if(!preset)return;$('directionName').value=preset.name;$('directionSlug').value=$('preset').value;fillDirection(preset);};
$('directionCards').onclick=e=>{const edit=e.target.closest('[data-edit]'),use=e.target.closest('[data-use]');if(edit)editDirection(edit.dataset.edit);if(use){localStorage.setItem('photo-factory-direction',use.dataset.use);location.assign('/photo-factory/library');}};
wireForm('directionForm',async()=>{
 const config={language:$('directionLanguage').value,audience:$('directionAudience').value,rewriteRules:$('directionRules').value,tags:split($('directionTags').value),model:$('directionModel').value,structure:$('directionStructure').value,aspect:$('directionAspect').value,maxPages:Number($('directionPages').value),maxChars:Number($('directionChars').value),styleIds:[...document.querySelectorAll('[name=style]:checked')].map(e=>e.value)};
 const payload={name:$('directionName').value,slug:$('directionSlug').value,enabled:$('directionEnabled').checked,config};
 if(editingDirection)await api('/direction',{method:'PATCH',directionId:editingDirection.id,body:{...payload,revision:editingDirection.revision}});
 else{const result=await api('/directions',{method:'POST',body:payload,directionId:''});selected=result.id;}
 $('directionDialog').close();await boot();
});
$('createKey').onclick=async()=>{try{const result=await api('/key',{method:'POST',body:{}});$('keyResult').textContent='此密钥只显示一次，请妥善保存。更换后旧密钥失效。\n\nEndpoint: '+location.origin+result.endpoint+'\nAuthorization: Bearer '+result.key+'\nDirection: '+result.directionId;$('keyResult').hidden=false;}catch(e){status(e.message,true);}};
$('revokeKey').onclick=async()=>{try{await api('/key',{method:'DELETE'});$('keyResult').hidden=true;$('keyResult').textContent='';status('当前方向写入密钥已撤销。');}catch(e){status(e.message,true);}};
async function loadLibrary(current){
 const data=await api('/copies',{params:{page:copyPage,q:$('copyQuery').value,kind:$('copyKind').value,period:$('copyPeriod').value,sort:$('copySort').value}});if(current!==revision)return;
 copyItems=data.items;
 $('copyComparison').innerHTML=['original','rewrite'].map(kind=>{const r=data.comparison.find(x=>x.kind===kind)||{};return '<tr><td>'+(kind==='original'?'原文':'改写')+'</td><td>'+metric(r.samples||0)+'</td><td>'+metric(r.median)+'</td><td>'+metric(r.highest)+'</td><td>'+(r.thousand==null?'—':(r.thousand*100).toFixed(1)+'%')+'</td></tr>';}).join('');
 const i=data.inventory;metrics('inventory',[['原文',i.originals||0],['改写',i.rewrites||0],['待启用 / 已停用',i.disabled||0],['已抽取版本',i.used||0]]);
 $('copyRows').innerHTML=data.items.map(c=>'<tr><td>'+esc(c.title)+'<small>'+esc(c.tags.join(' · '))+'</small></td><td>'+esc(c.kind==='original'?'原文':'改写')+'<small>'+esc(c.model||'—')+'</small></td><td>'+esc(c.enabled?'可抽取':'未启用')+'</td><td>'+metric(c.draws)+'</td><td>'+metric(c.samples)+'</td><td>'+metric(c.highest_views)+'</td><td><button data-copy="'+c.id+'" data-action="detail">查看</button><button data-copy="'+c.id+'" data-action="preview">预览</button><button data-copy="'+c.id+'" data-action="toggle">'+(c.enabled?'停用':'审核启用')+'</button>'+(c.kind==='original'?'<button data-copy="'+c.id+'" data-action="rewrite">AI 改写</button><button data-copy="'+c.id+'" data-action="manual">手动改写</button>':'')+'</td></tr>').join('')||'<tr><td colspan="7">当前方向暂无匹配文案。添加或导入后即可测试。</td></tr>';pager('copy',copyPage,data.total);
}
$('copyFilters').onsubmit=e=>{e.preventDefault();copyPage=1;loadView();};
$('copyPrev').onclick=()=>{copyPage--;loadView();};$('copyNext').onclick=()=>{copyPage++;loadView();};
$('newCopy').onclick=()=>{copySource='';$('copyDialogTitle').textContent='添加原文';$('copyForm').reset();showDialog('copyDialog');};
wireForm('copyForm',async()=>{
 const result=await api('/copies',{method:'POST',body:{title:$('copyTitle').value,caption:$('copyCaption').value,pages:pages($('copyPages').value),tags:split($('copyTags').value),kind:copySource?'rewrite':'original',...(copySource?{sourceId:copySource}:{}),externalId:crypto.randomUUID()}});
 if(!result.results[0].ok)throw new Error(result.results[0].error);$('copyDialog').close();copyPage=1;await loadView();
});
$('bulkCopy').onclick=()=>{$('bulkResult').textContent='';showDialog('bulkDialog');};
wireForm('bulkForm',async()=>{let input;try{input=JSON.parse($('bulkJson').value);}catch{throw new Error('JSON 格式不正确。');}const result=await api('/copies',{method:'POST',body:Array.isArray(input)?{items:input}:input});$('bulkResult').textContent=JSON.stringify(result,null,2);await loadView();});
$('copyRows').onclick=async e=>{
 const button=e.target.closest('[data-copy]');if(!button)return;const c=copyItems.find(c=>c.id===button.dataset.copy);if(!c)return;
 const action=button.dataset.action;
 if(action==='detail'){$('detailTitle').textContent=c.title;$('detailText').textContent=c.pages.join('\n\n---\n\n')+'\n\n发布文案：\n'+c.caption+'\n\n来源信息：\n'+JSON.stringify(c.metadata,null,2)+'\n\n文案编号：'+c.id;showDialog('detailDialog');return;}
 if(action==='manual'){copySource=c.id;$('copyDialogTitle').textContent='新增改写 · '+c.title;$('copyTitle').value=c.title;$('copyCaption').value=c.caption;$('copyPages').value=c.pages.join('\n---\n');$('copyTags').value=c.tags.join(', ');showDialog('copyDialog');return;}
 if(action==='preview'){sessionStorage.setItem('photo-factory-preview',JSON.stringify({direction:selected,pages:c.pages}));location.assign('/photo-factory/templates');return;}
 button.disabled=true;const current=revision;
 try{if(action==='toggle')await api('/copy',{method:'PATCH',body:{id:c.id,enabled:!c.enabled}});if(action==='rewrite'){status('正在生成改写，完成后保存在当前原文下，审核启用后才会抽取…');await api('/rewrite',{method:'POST',body:{sourceId:c.id}});}if(current===revision)await loadView();}catch(error){if(current===revision)status(error.message,true);}finally{button.disabled=false;}
};
function clearPreviews(){for(const url of previewUrls)URL.revokeObjectURL(url);previewUrls=[];$('previewCards').innerHTML='<p>填写文案后生成预览。</p>';const saved=JSON.parse(sessionStorage.getItem('photo-factory-preview')||'null');if(saved?.direction===selected){$('previewPages').value=saved.pages.join('\n---\n');sessionStorage.removeItem('photo-factory-preview');}else $('previewPages').value='';}
wireForm('previewForm',async()=>{
 const config=direction().config,parts=pages($('previewPages').value),style=$('previewStyle').value,current=revision;
 if(!parts.length||parts.length>config.maxPages||parts.some(p=>p.length>config.maxChars))throw new Error('请控制在 '+config.maxPages+' 页内，每页最多 '+config.maxChars+' 字符。');
 for(const url of previewUrls)URL.revokeObjectURL(url);previewUrls=[];$('previewCards').replaceChildren();
 for(let i=0;i<parts.length;i++){
  const data=await renderAutomationCard({source:{title:i===0?parts[i]:'',body:i===0?'':parts[i]},index:i,template:'photo-text',styleId:style,aspectRatio:config.aspect});if(current!==revision)return;
  const fig=document.createElement('figure'),img=new Image();img.src=data;img.alt='第 '+(i+1)+' 页图文预览';const a=document.createElement('a');a.href=data;a.download='photo-page-'+(i+1)+'.jpg';a.textContent='下载第 '+(i+1)+' 页';fig.append(img,a);$('previewCards').append(fig);
 }
});
async function loadPilots(current){const data=await api('/pilots');if(current!==revision)return;pilotItems=data.items;
 $('pilotList').innerHTML=data.items.map(p=>'<article class="pf-panel"><div class="pf-heading"><div><h2>'+esc(p.group_name)+'</h2><span>'+esc(strategyLabels[p.strategy])+' · '+p.accounts.length+' 个账号 · '+esc(stateLabels[p.status])+'</span></div><div class="pf-actions">'+(p.status!=='ended'?'<button data-pilot="'+p.id+'" data-state="'+(p.status==='active'?'paused':'active')+'">'+(p.status==='active'?'暂停并停止未提交任务':p.status==='draft'?'启动测试':'恢复后续排期')+'</button><button data-pilot="'+p.id+'" data-state="ended">结束测试</button>':'')+'</div></div><p>北京时间 '+esc(p.config.times.join(' / '))+' · 每号每天 '+p.config.times.length+' 条 · 账号间隔 '+p.config.staggerSeconds+' 秒</p><p>'+esc(p.config.startDay)+' 起 '+p.config.days+' 天</p>'+(p.error?'<p class="pf-error">'+esc(p.error)+'</p>':'')+'</article>').join('')||'<div class="pf-panel">尚未创建图文测试。可以选择新的星座分组，或未在旧任务中使用的心理学分组。</div>';
}
$('pilotList').onclick=async e=>{const b=e.target.closest('[data-pilot]');if(!b)return;b.disabled=true;try{await api('/pilot',{method:'PATCH',body:{id:b.dataset.pilot,status:b.dataset.state}});await loadView();}catch(error){status(error.message,true);}finally{b.disabled=false;}};
function strategyHelp(){const v=$('pilotStrategy').value;$('strategyHelp').textContent=v==='balanced'?'A：原文与改写共同测试，冷启动轮换两类版本；有成熟样本后约 70% 优先高平均播放版本、30% 探索。每个未验证版本最多占用 3 个样本。':v==='original'?'B：只抽取当前方向已启用的原文。每个账号不会重复抽取同一来源，每个未验证版本最多占用 3 个样本。':'C：只抽取当前方向已审核启用的改写。每个账号不会重复抽取同一来源，每个未验证版本最多占用 3 个样本。';}
$('pilotStrategy').onchange=strategyHelp;
async function loadGroups(refresh=false){const current=revision;const data=await api('/directory',{params:{refresh:refresh?'1':'0'}});if(current!==revision)return;
 groupItems=data.groups;$('groupChoices').innerHTML=data.groups.map(g=>'<div><label class="pf-inline"><input type="checkbox" data-group="'+esc(g.id)+'" '+(!g.accounts||g.legacyBusy||g.photoBusy?'disabled':'')+'>'+esc(g.name)+' · '+g.accounts+' 个账号'+(g.legacyBusy?' · 旧心理学任务占用':g.photoBusy?' · 图文任务占用':'')+'</label><input type="text" data-times="'+esc(g.id)+'" placeholder="留空则使用默认时间并按所选分组错峰" aria-label="'+esc(g.name)+' 独立发布时间"></div>').join('')||'<p>暂无分组，请先在账号管理中新建测试分组。</p>';
}
$('newPilot').onclick=async()=>{$('pilotForm').reset();pilotRequestIds=new Map();$('pilotStart').value=new Date(Date.now()+8*3600000).toISOString().slice(0,10);strategyHelp();showDialog('pilotDialog');try{await loadGroups();}catch(e){$('pilotForm').querySelector('.formStatus').textContent=e.message;}};
$('refreshGroups').onclick=async()=>{try{await loadGroups(true);}catch(e){$('pilotForm').querySelector('.formStatus').textContent=e.message;}};
wireForm('pilotForm',async()=>{
 const ids=[...document.querySelectorAll('[data-group]:checked')].map(e=>e.dataset.group),directionId=selected;
 if(!ids.length)throw new Error('请选择至少一个可用分组。');
 const base=split($('pilotTimes').value),offset=Number($('pilotOffset').value),startDay=$('pilotStart').value,strategy=$('pilotStrategy').value,days=Number($('pilotDays').value),staggerSeconds=Number($('pilotStagger').value),results=[];
 for(let i=0;i<ids.length;i++){
  const custom=document.querySelector('[data-times="'+CSS.escape(ids[i])+'"]').value;
  const times=custom?split(custom):base.map(t=>{if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))throw new Error('默认发布时间格式应为 HH:mm。');const n=Number(t.slice(0,2))*60+Number(t.slice(3))+i*offset;if(n>=1440)throw new Error('分组错峰跨日，请为该分组单独设置时间。');return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');});
  try{await api('/pilots',{method:'POST',directionId,body:{requestId:pilotRequestIds.get(ids[i])||(()=>{const id=crypto.randomUUID();pilotRequestIds.set(ids[i],id);return id;})(),groupId:ids[i],strategy,startDay,days,staggerSeconds,times}});results.push(groupItems.find(g=>g.id===ids[i]).name+'：草稿已创建');document.querySelector('[data-group="'+CSS.escape(ids[i])+'"]').checked=false;}catch(e){results.push(groupItems.find(g=>g.id===ids[i]).name+'：'+e.message);}
 }
 await loadView();return results.join('；');
});
async function loadReport(current){const data=await api('/report',{params:{period:$('reportPeriod').value,page:reportPage}});if(current!==revision)return;const x=data.execution,f=data.effects;
 metrics('reportMetrics',[['计划发布',x.total],['已发布',x.published||0],['待处理',x.pending||0],['失败',x.failed||0],['有效样本',f.samples],['总播放',f.views],['最高播放',f.highest],['收藏',f.saves]]);
 $('groupRows').innerHTML=data.groups.map(g=>'<tr><td>'+esc(g.group_name)+'</td><td>'+esc(strategyLabels[g.strategy])+'</td><td>'+metric(g.total)+'</td><td>'+metric(g.published)+'</td><td>'+metric(g.failed)+'</td><td>'+metric(g.samples)+'</td><td>'+metric(g.highest)+'</td></tr>').join('')||'<tr><td colspan="7">当前时间范围没有测试数据。</td></tr>';
 $('reportRows').innerHTML=data.items.map(j=>'<tr><td>'+esc(j.title)+'<small>'+esc(j.account_name||j.connection_id)+'</small></td><td>'+esc(j.group_name)+'</td><td>'+esc(date(j.schedule_at))+'</td><td>'+esc(stateLabels[j.state]||j.state)+(j.error?'<small class="pf-error">'+esc(j.error)+'</small>':'')+'</td><td>'+esc(j.video_id||'尚未返回')+'</td><td>'+[j.views,j.likes,j.saves,j.shares].map(metric).join(' / ')+'</td></tr>').join('')||'<tr><td colspan="6">当前时间范围没有发布记录。</td></tr>';pager('report',reportPage,data.total);
}
$('reportPeriod').onchange=()=>{reportPage=1;loadView();};$('reportPrev').onclick=()=>{reportPage--;loadView();};$('reportNext').onclick=()=>{reportPage++;loadView();};
$('direction').onchange=()=>{revision++;selected=$('direction').value;localStorage.setItem('photo-factory-direction',selected);copyPage=1;reportPage=1;document.querySelectorAll('dialog[open]').forEach(d=>d.close());loadView();};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('pageTitle').textContent=views[view][0];$('tabs').innerHTML=Object.entries(views).map(([key,[name,url]])=>'<a href="'+url+'" '+(key===view?'aria-current="page"':'')+'>'+name+'</a>').join('');
$('refreshView').onclick=()=>loadView();
boot().catch(e=>status(e.message,true));
