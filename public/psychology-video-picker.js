export function mountPsychologyVideoPicker({api,accounts,project,changed}){
 const $=id=>document.getElementById(id),BASE='/api/psychology-video-library';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const chosen=new Map();let active=false,source='generated',page=1,hasMore=false,rows=[],busy=false,version=0,poll;
 const say=(text,error=false)=>{$('videoPickerStatus').textContent=text;$('videoPickerStatus').classList.toggle('error',error);};
 function render(){
  $('videoSource').value=source;$('videoPage').textContent='第 '+page+' 页';$('videoPrev').disabled=busy||page<=1;$('videoNext').disabled=busy||!hasMore;
  $('videoCards').innerHTML=rows.length?rows.map((v,i)=>`<article class="selected-video-card"><div class="selected-video-player">${v.previewUrl?`<video controls preload="none" playsinline src="${esc(v.previewUrl)}" aria-label="预览 ${esc(v.title||v.fileName)}"></video>`:'<span>成片保存在工人机<br>准备后可在这里播放</span>'}</div><strong>${esc(v.title||v.fileName)}</strong><small>${esc(v.fileName)}</small><small>${new Date(v.createdAt).toLocaleString('zh-CN')} · ${v.fileSize?(v.fileSize/1048576).toFixed(1)+' MB':'待取回文件'}</small>${v.previewUrl?`<label><input type="checkbox" data-pick="${i}" ${chosen.has(v.id)?'checked':''} ${busy?'disabled':''}> 选择此视频</label>`:`<button type="button" data-prepare="${i}" ${busy||!v.canPrepare||v.preparationStatus==='running'||v.preparationStatus==='queued'?'disabled':''}>${v.preparationStatus==='running'||v.preparationStatus==='queued'?'正在准备预览…':v.error?'重新准备预览':'准备云端预览'}</button>`}${v.error?`<small class="error">${esc(v.error)}</small>`:''}${!v.canPrepare&&!v.previewUrl?'<small>原工人信息缺失，请下载后从本地上传。</small>':''}</article>`).join(''):'<p class="field-hint">'+(source==='generated'?'暂无已完成的心理学成片。可先去模板工作台生成，或选择本地视频上传。':'暂无上传视频。点击上方“选择本地视频”添加。')+'</p>';
  update();
 }
 async function load(){
  const current=++version;busy=true;render();say('正在读取视频…');
  try{const data=await api(BASE+'?source='+source+'&page='+page);if(current!==version)return;rows=data.videos||[];hasMore=Boolean(data.hasMore);say('已选 '+chosen.size+' 条。准备预览和上传均不会发布。');}
  catch(e){if(current===version)say(e.message,true);}
  finally{if(current===version){busy=false;render();clearTimeout(poll);if(active&&rows.some(v=>['running','queued'].includes(v.preparationStatus)))poll=setTimeout(()=>load(),5000);}}
 }
 function update(){
  $('videoMapping').hidden=!active;if(!active)return;
  const current=accounts(),allowed=new Set(current.map(a=>String(a.connectionId||a.id)));
  for(const value of chosen.values())if(!allowed.has(value.connectionId))value.connectionId='';
  let campaign='请选择项目';try{campaign=project()?.campaignId||campaign;}catch{}
  const start=Math.floor(new Date($('scheduleAt').value).getTime()/1000),gap=Number($('intervalMinutes').value)||60,counts=new Map();
  $('videoMapping').innerHTML=chosen.size?`<p class="field-hint">已选 ${chosen.size} 条 · 项目 ${esc(campaign)} · 每条只发给指定账号。可以逐条修改分配。</p><button type="button" id="assignSelectedVideos" ${!current.length?'disabled':''}>按已选账号轮流分配</button><div class="selected-video-mappings">`+[...chosen.values()].map(v=>{const n=counts.get(v.connectionId)||0;counts.set(v.connectionId,n+1);const date=Number.isFinite(start)?new Date((start+n*gap*60)*1000).toLocaleString('zh-CN'):'请设置发布时间';return `<article data-map="${esc(v.id)}"><strong>${esc(v.fileName)}</strong><label>发布账号<select data-video-account="${esc(v.id)}"><option value="">请选择账号</option>${current.map(a=>{const id=String(a.connectionId||a.id);return `<option value="${esc(id)}" ${id===v.connectionId?'selected':''}>@${esc(a.username||a.displayName||id)} · ${Number(a.followers).toLocaleString()} 粉丝</option>`;}).join('')}</select></label><label>发布文案<textarea data-video-caption="${esc(v.id)}" maxlength="2200" rows="3">${esc(v.caption)}</textarea></label><label><input type="checkbox" data-video-ai="${esc(v.id)}" ${v.isAiGenerated?'checked':''}> 此视频包含 AI 生成内容</label><small>计划发布：${esc(date)}</small><button type="button" data-remove="${esc(v.id)}">移除选择</button></article>`;}).join('')+'</div>':'<p class="field-hint">先预览并勾选视频，再在下方选择账号和 TikTok One 项目。</p>';
  const assign=$('assignSelectedVideos');if(assign)assign.onclick=()=>{[...chosen.values()].forEach((v,i)=>v.connectionId=String(current[i%current.length].connectionId||current[i%current.length].id));changed();update();};
 }
 $('videoMapping').addEventListener('input',e=>{const d=e.target.dataset,v=chosen.get(d.videoAccount||d.videoCaption||d.videoAi);if(!v)return;if(d.videoAccount){v.connectionId=e.target.value;update();}if(d.videoCaption)v.caption=e.target.value;if(d.videoAi)v.isAiGenerated=e.target.checked;changed();});
 $('videoMapping').addEventListener('click',e=>{const id=e.target.dataset.remove;if(id){chosen.delete(id);render();changed();}});
 $('videoCards').addEventListener('change',e=>{if(e.target.dataset.pick===undefined)return;const v=rows[Number(e.target.dataset.pick)];if(!v?.previewUrl)return;if(e.target.checked){if(chosen.size>=20){e.target.checked=false;return say('每批最多20条视频。',true);}chosen.set(v.id,{...v,caption:v.title||'',connectionId:'',isAiGenerated:true});}else chosen.delete(v.id);update();changed();});
 $('videoCards').addEventListener('click',async e=>{const key=e.target.dataset.prepare;if(key===undefined||busy)return;const v=rows[Number(key)];e.target.disabled=true;try{await api(BASE+'/import',{jobId:v.sourceJobId,resultIndex:v.resultIndex});await load();}catch(error){say(error.message,true);e.target.disabled=false;}});
 $('videoSource').onchange=()=>{source=$('videoSource').value;page=1;load();};$('videoRefresh').onclick=()=>load();$('videoPrev').onclick=()=>{page--;load();};$('videoNext').onclick=()=>{page++;load();};
 $('videoFiles').onchange=async()=>{
  const files=[...$('videoFiles').files];if(!files.length)return;busy=true;render();$('videoFiles').disabled=true;
  try{for(const file of files){if(!/\.(mp4|mov|webm)$/i.test(file.name)||file.size<=0||file.size>95*1048576)throw new Error(file.name+'：仅支持95MB以内的 MP4、MOV、WebM。');
   say('上传 '+file.name+'…');const response=await fetch(BASE+'/upload',{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-File-Name':encodeURIComponent(file.name),'X-File-Size':String(file.size)},body:file});const data=await response.json();if(!response.ok)throw new Error(data.error||'上传失败');
  }source='uploaded';page=1;await load();say('上传完成。请播放预览并勾选视频。');}catch(e){say(e.message,true);}finally{busy=false;$('videoFiles').disabled=false;$('videoFiles').value='';render();}
 };
 function items(){
  if(!chosen.size)throw new Error('请先预览并选择视频。');
  const ids=new Set(accounts().map(a=>String(a.connectionId||a.id))),start=Math.floor(new Date($('scheduleAt').value).getTime()/1000),gap=Number($('intervalMinutes').value)||60,counts=new Map();
  return [...chosen.values()].map(v=>{if(!ids.has(v.connectionId))throw new Error('请为每条视频指定一个已勾选的千粉账号。');const n=counts.get(v.connectionId)||0;counts.set(v.connectionId,n+1);return {assetId:v.id,connectionId:v.connectionId,caption:v.caption,isAiGenerated:v.isAiGenerated,scheduleAt:start+n*gap*60};});
 }
 return {get busy(){return busy;},get active(){return active;},open(){active=true;$('batchForm').classList.add('is-video-selection');$('createBatchTitle').textContent='选片确认发布';$('automaticContent').querySelectorAll('input,select,textarea,button').forEach(n=>n.disabled=true);$('videoSelectionSection').hidden=false;$('automaticContent').hidden=true;$('submitBatch').textContent='核对并确认发布';load();},close(){active=false;$('batchForm').classList.remove('is-video-selection');$('createBatchTitle').textContent='新建发布任务';$('automaticContent').querySelectorAll('input,select,textarea,button').forEach(n=>n.disabled=false);$('videoMapping').hidden=true;clearTimeout(poll);$('videoSelectionSection').hidden=true;$('automaticContent').hidden=false;$('submitBatch').textContent='创建并自动发布';},update,items,clear(){chosen.clear();render();}};
}
