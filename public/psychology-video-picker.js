import {mountVideoPosters} from './psychology-video-posters.js';
// Shuffle once at submission; the caller freezes this payload for idempotent retries.
export function assignSelectedVideoItems(videos,accounts,{scheduleAt,intervalMinutes,isAiGenerated=false},random=Math.random){
 if(!videos.length)throw new Error('请先选择视频。');
 if(videos.length>20)throw new Error('每批最多20条视频。');
 const ids=[...new Set(accounts.map(a=>String(a.connectionId||a.id||'')).filter(Boolean))];
 if(!ids.length)throw new Error('请先勾选发布账号。');
 if(ids.length>videos.length)throw new Error('账号数不能超过视频数，请减少账号或增加视频，让每个账号至少分配一条。');
 if(!Number.isFinite(scheduleAt)||!Number.isInteger(intervalMinutes)||intervalMinutes<1||intervalMinutes>10080)throw new Error('请设置有效的发布时间和间隔。');
 const shuffle=list=>{const result=[...list];for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;};
 const targets=shuffle(ids);
 return shuffle(videos).map((v,i)=>({...(v.videoHit?{videoHit:v.videoHit}:{}),assetId:v.assetId||v.id,connectionId:targets[i%targets.length],caption:v.caption??v.title??'',isAiGenerated,scheduleAt:scheduleAt+Math.floor(i/targets.length)*intervalMinutes*60}));
}
export function mountPsychologyVideoPicker({api,accounts,changed,isBusy=()=>false}){
 const $=id=>document.getElementById(id),BASE='/api/psychology-video-library';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const posters=mountVideoPosters($('batchForm'));
 const chosen=new Map();let active=false,source='video-hits',page=1,pageSize=20,hasMore=false,rows=[],busy=false,version=0,poll;
 const say=(text,error=false)=>{$('videoPickerStatus').textContent=text;$('videoPickerStatus').classList.toggle('error',error);};
 const selectable=()=>rows.filter(v=>v.id&&v.previewUrl);
 const addVideo=v=>{if(!chosen.has(v.id))chosen.set(v.id,{...v,caption:v.caption??v.title??''});};
 function bulkControls(){
  const ready=selectable(),selectedHere=rows.filter(v=>v.id&&chosen.has(v.id)).length;
  $('selectPageVideos').disabled=busy||isBusy()||chosen.size>=20||!ready.some(v=>!chosen.has(v.id));
  $('clearPageVideos').disabled=busy||isBusy()||!selectedHere;
  $('videoPageSelectionStatus').textContent='本页可选 '+ready.length+' 条 · 本页已选 '+selectedHere+' 条 · 总计 '+chosen.size+' / 20 条';
 }
 function render(){
  $('videoSource').value=source;$('videoPage').textContent='第 '+page+' 页 · 每页 '+pageSize+' 条';$('videoPrev').disabled=busy||page<=1;$('videoNext').disabled=busy||!hasMore;
  $('videoCards').innerHTML=rows.length?rows.map((v,i)=>`<article class="selected-video-card ${chosen.has(v.id)?'is-selected':''}"><div class="selected-video-player">${v.previewUrl?`<video controls preload="none" playsinline src="${esc(v.previewUrl)}" data-cover-src="${esc(v.previewUrl)}" aria-label="预览 ${esc(v.title||v.fileName)}"></video><span class="video-cover-status" role="status">读取封面…</span><button type="button" class="video-cover-button" aria-label="播放视频预览" hidden><img alt=""><span aria-hidden="true">▶</span></button>`:'<span>成片保存在工人机<br>准备后可在这里播放</span>'}</div><div class="video-card-copy"><span class="video-origin-tag">${v.videoHit?'二创成片 · '+esc(v.versionName||'版本 '+v.videoHit.version):source==='generated'?'工厂成片':'本地上传'}</span><strong title="${esc(v.title||v.fileName)}">${esc(v.title||v.fileName)}</strong><small title="${esc(v.fileName)}">${esc(v.fileName)}</small></div><small>${new Date(v.createdAt).toLocaleString('zh-CN')} · ${v.fileSize?(v.fileSize/1048576).toFixed(1)+' MB':'待取回文件'}</small>${v.previewUrl?`<label class="video-pick-control"><input type="checkbox" data-pick="${i}" ${chosen.has(v.id)?'checked':''} ${busy?'disabled':''}> ${chosen.has(v.id)?'已选择':'选择此视频'}</label>`:`<button type="button" data-prepare="${i}" ${busy||!v.canPrepare||v.preparationStatus==='running'||v.preparationStatus==='queued'?'disabled':''}>${v.preparationStatus==='running'||v.preparationStatus==='queued'?'正在准备预览…':v.error?'重新准备预览':'准备云端预览'}</button>`}${v.error?`<small class="error">${esc(v.error)}</small>`:''}${!v.canPrepare&&!v.previewUrl?'<small>原工人信息缺失，请下载后从本地上传。</small>':''}</article>`).join(''):'<div class="video-empty-state"><span>▷</span><strong>暂无可选视频</strong><p>'+(source==='video-hits'?'请先在视频爆款中传入二创成片并启用版本，或完成图片合成。已提交发布的版本不再显示。':source==='generated'?'暂无已完成的心理学成片。可先去模板工作台生成，或选择本地视频上传。':'暂无上传视频。点击上方“上传本地视频”添加。')+'</p></div>';
  update();
 }
 async function load(){
  const current=++version;busy=true;render();say('正在读取视频…');
  try{const data=await api(BASE+'?source='+source+'&page='+page);if(current!==version)return;rows=data.videos||[];pageSize=data.pageSize||20;hasMore=Boolean(data.hasMore);say('预览后勾选视频，已选内容会保留在下方清单中。');}
  catch(e){if(current===version)say(e.message,true);}
  finally{if(current===version){busy=false;render();clearTimeout(poll);if(active&&rows.some(v=>['running','queued'].includes(v.preparationStatus)))poll=setTimeout(()=>load(),5000);}}
 }
 function update(){
  if(!active)return;
  bulkControls();
  $('selectedVideoCount').textContent=String(chosen.size);$('pickerJumpCount').textContent=String(chosen.size);
  $('selectedVideoList').innerHTML=chosen.size?[...chosen.values()].map(v=>`<li><span title="${esc(v.title||v.fileName)}">${esc(v.title||v.fileName)}</span><button type="button" data-remove="${esc(v.id)}" aria-label="移除 ${esc(v.title||v.fileName)}" ${isBusy()?'disabled':''}>移除</button></li>`).join(''):'<li class="field-hint">还没有选择视频。</li>';
  posters.refresh();
 }
 $('showSelectedVideos').onclick=()=>{$('selectedVideos').open=true;$('selectedVideos').scrollIntoView({block:'center',behavior:'smooth'});};
 $('selectedVideoList').addEventListener('click',e=>{if(isBusy())return;const id=e.target.dataset.remove;if(id){chosen.delete(id);render();changed();}});
 $('selectPageVideos').onclick=()=>{
  if(busy||isBusy())return;
  const remaining=selectable().filter(v=>!chosen.has(v.id)),added=remaining.slice(0,20-chosen.size);
  added.forEach(addVideo);render();if(added.length)changed();
  say(remaining.length>added.length?'已新增 '+added.length+' 条，达到每批 20 条上限；本页还有 '+(remaining.length-added.length)+' 条未选择。':'已选择本页全部可发布视频，其他页的选择已保留。');
 };
 $('clearPageVideos').onclick=()=>{
  if(busy||isBusy())return;
  let removed=0;for(const v of rows)if(chosen.delete(v.id))removed++;
  render();if(removed)changed();say('已取消本页 '+removed+' 条选择，其他页的选择已保留。');
 };
 $('videoCards').addEventListener('change',e=>{if(e.target.dataset.pick===undefined)return;const v=rows[Number(e.target.dataset.pick)];if(!v?.previewUrl)return;if(e.target.checked){if(chosen.size>=20){e.target.checked=false;return say('每批最多20条视频。',true);}addVideo(v);}else chosen.delete(v.id);render();changed();});
 $('videoCards').addEventListener('click',async e=>{const key=e.target.dataset.prepare;if(key===undefined||busy)return;const v=rows[Number(key)];e.target.disabled=true;try{await api(BASE+'/import',{jobId:v.sourceJobId,resultIndex:v.resultIndex});await load();}catch(error){say(error.message,true);e.target.disabled=false;}});
 document.addEventListener('play',e=>{if(e.target.tagName==='VIDEO')document.querySelectorAll('#batchForm video').forEach(v=>{if(v!==e.target)v.pause();});},true);
 $('videoSource').onchange=()=>{source=$('videoSource').value;page=1;rows=[];load();};$('videoRefresh').onclick=()=>{posters.retryFailures();load();};$('videoPrev').onclick=()=>{page--;load();};$('videoNext').onclick=()=>{page++;load();};
 $('videoFiles').onchange=async()=>{
  const files=[...$('videoFiles').files];if(!files.length)return;busy=true;render();$('videoFiles').disabled=true;
  try{for(const file of files){if(!/\.(mp4|mov|webm)$/i.test(file.name)||file.size<=0||file.size>95*1048576)throw new Error(file.name+'：仅支持95MB以内的 MP4、MOV、WebM。');
   say('上传 '+file.name+'…');const response=await fetch(BASE+'/upload',{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','X-File-Name':encodeURIComponent(file.name),'X-File-Size':String(file.size)},body:file});const data=await response.json();if(!response.ok)throw new Error(data.error||'上传失败');
  }source='uploaded';page=1;await load();say('上传完成。请播放预览并勾选视频。');}catch(e){say(e.message,true);}finally{busy=false;$('videoFiles').disabled=false;$('videoFiles').value='';render();}
 };
 function items(){
  return assignSelectedVideoItems([...chosen.values()],accounts(),{scheduleAt:Math.floor(new Date($('scheduleAt').value).getTime()/1000),intervalMinutes:Number($('intervalMinutes').value),isAiGenerated:$('selectedVideosAi').checked});
 }
 return {get count(){return chosen.size;},get busy(){return busy;},get active(){return active;},open(){active=true;$('batchForm').classList.add('is-video-selection');$('createBatchTitle').textContent='TikTok One 发布';$('automaticContent').querySelectorAll('input,select,textarea,button').forEach(n=>n.disabled=true);$('videoSelectionSection').hidden=false;$('automaticContent').hidden=true;$('submitBatch').textContent='发布所选视频';load();},close(){active=false;posters.pause();$('batchForm').classList.remove('is-video-selection');$('createBatchTitle').textContent='新建发布任务';$('automaticContent').querySelectorAll('input,select,textarea,button').forEach(n=>n.disabled=false);clearTimeout(poll);$('videoSelectionSection').hidden=true;$('automaticContent').hidden=false;$('submitBatch').textContent='创建并自动发布';},preselect(r){addVideo({id:r.ref.sourceId+'-v'+r.ref.version,assetId:r.assetId,videoHit:r.ref,title:r.title,caption:r.caption,previewUrl:r.previewUrl});render();changed();},update,items,clear(){chosen.clear();render();}};
}
