import {mountVideoPosters} from './psychology-video-posters.js';
const $=id=>document.getElementById(id),BASE='/api/psychology-video-hits',PAGE='/psychology-video-hits';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const route=location.pathname.replace(/\/$/,''),params=new URLSearchParams(location.search);
const view=route===PAGE+'/recreations'?'recreations':route===PAGE+'/detail'?'detail':'sources';
let inputMode=['video','frames'].includes(params.get('inputMode'))?params.get('inputMode'):'all';
const typeQuery=()=>inputMode==='all'?'':'&inputMode='+inputMode;
const sourceId=params.get('id'),detailUrl=(id,version)=>PAGE+'/detail?id='+encodeURIComponent(id)+'&version='+version+typeQuery(),recreationsUrl=id=>PAGE+'/recreations?id='+encodeURIComponent(id)+typeQuery();
let page=1,list=[],detail=null,n=Number(params.get('version')),framePage=1,editingSource=false,editingVersion=false,frameVersion=0,loadToken=0,listToken=0;
let versionScope="pending";
const pending=new Map(),framePreviews=new Map();
const videoPosters=mountVideoPosters($('readyVideoPanel')),previewAttempts=new Set(),previewErrors=new Map();
let previewData=null,previewPreparing='',jobsTimer=0,jobsRequest=0;
const previewKey=()=>current()?.renderJobId+':'+current()?.revision+':'+detail?.source.revision;
async function api(path='',method='GET',body){
 const response=await fetch(BASE+path,{method,cache:'no-store',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'请求失败');return data;
}
async function write(path,method,body){
 const fingerprint=JSON.stringify({path,method,body});let requestId=pending.get(fingerprint);
 if(!requestId){requestId=crypto.randomUUID();pending.set(fingerprint,requestId);}
 const result=await api(path,method,{...body,requestId});pending.delete(fingerprint);return result;
}
async function action(status,button,fn){
 if(button?.disabled)return;const original=button?.disabled;if(button)button.disabled=true;
 $(status).textContent='正在处理…';try{await fn();}catch(e){$(status).textContent=e.message;}finally{if(button)button.disabled=button.dataset.locked==='true'||original;}
}
const lock=(id,value)=>{$(id).dataset.locked=String(value);$(id).disabled=value;};
const renderCurrent=v=>v.renderRevision===v.revision&&v.renderSourceRevision===detail.source.revision;
const versionState=v=>v.publishState==='published'?(v.cleanedAt?'已发布 · 内容已清理':'已发布 · 待清理'):v.publishItemId?'已提交发布':v.inputMode==='video'?(v.videoAssetId?'成片已上传':'待传入成片'):renderCurrent(v)?({queued:'已提交合成',running:'合成中',done:'已合成视频',failed:'合成失败',cancelled:'已取消合成'}[v.renderState]||'待合成'):(v.enabled?'待合成':'待补全 / 停用');
const current=()=>detail?.versions.find(v=>v.version===n),stamp=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const metric=x=>x==null?'—':Number(x).toLocaleString('zh-CN');
const typeName=mode=>mode==='video'?'视频':'图文';
const typeBadge=(mode,count)=>'<span class="vh-badge vh-type-'+(mode==='video'?'video':'frames')+'">'+typeName(mode)+(count===undefined?'':' '+count)+'</span>';
const sourceTypes=s=>'<div class="vh-type-badges">'+(s.videoVersionCount?typeBadge('video',s.videoVersionCount):'')+(s.frameVersionCount?typeBadge('frames',s.frameVersionCount):'')+'</div>'+(!s.versionCount?'<small>暂无二创</small>':'');
function syncTypeFilter(){
 $('sourceInputMode').value=inputMode;$('recreationInputMode').value=inputMode;
 const url=new URL(location.href);if(inputMode==='all')url.searchParams.delete('inputMode');else url.searchParams.set('inputMode',inputMode);history.replaceState(null,'',url);
 document.querySelector('#pageBreadcrumb a').href=PAGE+(inputMode==='all'?'':'?inputMode='+inputMode);
}

function pageError(error){$('pageStatus').hidden=false;$('pageStatus').textContent=error.message;}
function setupPage(){
 syncTypeFilter();
 const title=view==='sources'?'视频爆款':view==='recreations'?'爆款二创':'二创详情';
 $('pageTitle').textContent=title;document.title=title+' · 心理学';
 $('pageLead').textContent=view==='sources'?'管理爆款来源与视频、图文二创内容，每个来源最多 20 个版本。':view==='recreations'?'查看该爆款视频的全部二创版本，按版本顺序排列。':'对照查看原文案、二创文案，以及每一帧的原图和二创图。';
 $('pageBreadcrumb').hidden=view==='sources';$('breadcrumbCurrent').textContent=title;
 $('sourceList').hidden=view!=='sources';$('newSource').hidden=view!=='sources';
 if(view==='detail'){
  $('recreationBreadcrumb').hidden=false;$('recreationBreadcrumb').href=recreationsUrl(sourceId||'');$('detailSeparator').hidden=false;
  $('backToVersions').hidden=false;$('backToVersions').href=recreationsUrl(sourceId||'');
 }
}
async function load(){
 const token=++listToken;$('listStatus').textContent='正在读取…';
 try{const data=await api('?page='+page+'&q='+encodeURIComponent($('query').value)+'&sort='+$('sort').value+'&scope='+$('sourceScope').value+'&inputMode='+inputMode);if(token!==listToken)return;
 const totalPages=Math.ceil(data.total/data.pageSize);if(page>Math.max(1,totalPages)){page=Math.max(1,totalPages);return load();}
 list=data.items;$('sources').innerHTML=list.map(s=>'<tr><td><strong>'+escape(s.title)+'</strong><small>'+escape(s.externalId)+'</small><small>更新：'+stamp(s.updatedAt)+'（北京时间）</small></td><td data-label="播放 / 互动">'+metric(s.videoData.playCount)+' 播放<small>'+metric(s.videoData.likeCount)+' 赞 · '+metric(s.videoData.commentCount)+' 评论</small><small>'+metric(s.videoData.shareCount)+' 分享</small></td><td data-label="原图">'+s.frameCount+' 帧</td><td data-label="二创类型 / 版本">'+s.versionCount+' / 20'+sourceTypes(s)+'</td><td><a class="vh-link-button" data-recreations="'+escape(s.id)+'" href="'+escape(recreationsUrl(s.id))+'">查看二创</a></td></tr>').join('')||'<tr><td colspan="5">当前条件下暂无来源，可调整二创类型或搜索条件。</td></tr>';
 $('listStatus').textContent='共 '+data.total+' 条来源'+(inputMode==='all'?'':' · 含'+typeName(inputMode)+'二创');$('recordInfo').textContent='共 '+data.total+' 条记录';$('pageInfo').textContent=totalPages?'第 '+page+' / '+totalPages+' 页':'共 0 页';$('previous').disabled=page===1;$('next').disabled=!data.hasMore;
 }catch(e){if(token===listToken)$('listStatus').textContent=e.message;}
}
async function loadDetail(){
 clearTimeout(jobsTimer);jobsRequest++;
 const token=++loadToken,d=await api('/'+sourceId);if(token!==loadToken)return;
 d.versions.sort((a,b)=>a.version-b.version);detail=d;
 if(view==='detail'&&!current())throw new Error('此二创版本尚未创建，请返回二创列表。');
 $('sourceSummary').hidden=false;$('sourceTitle').textContent=d.source.title;$('sourceLink').href=d.source.videoUrl;
 $('sourceMeta').textContent=d.source.externalId+' · '+metric(d.source.videoData.playCount)+' 播放 · '+d.frameCount+' 帧原图';
 $('sourceData').textContent=JSON.stringify(d.source.videoData,null,2);
 lock('editSource',Boolean(d.source.archivedAt));
 lock('archiveSource',Boolean(d.source.archivedAt)||!d.versions.length||d.versions.some(v=>v.publishState!=='published'));
 $('archiveSource').title=d.source.archivedAt?'此来源已结束':'全部已创建版本确认发布成功后，可结束来源并清理原图';
 $('sourceLifecycle').textContent=d.source.originalsCleanedAt?'来源已结束，原文案和原图引用已清理；共享文件继续保留。':d.source.archivedAt?'来源已结束，原文案和原图将在 '+stamp(d.source.archivedAt+86400000)+' 后清理。':'原图保留供后续二创使用。全部已创建版本发布成功后，可点击“结束来源”清理原图。';
 if(view==='recreations')renderRecreations();else await loadVersion();
 $('pageStatus').hidden=true;
}
function renderRecreations(){
 $('recreationList').hidden=false;$('newVersion').disabled=Boolean(detail.source.archivedAt)||detail.versions.length>=20;
 const versions=detail.versions.filter(v=>inputMode==='all'||v.inputMode===inputMode),published=versions.filter(v=>v.publishState==='published'),rows=versionScope==='published'?published:versionScope==='pending'?versions.filter(v=>v.publishState!=='published'):versions;
 document.querySelectorAll('#versionScope [data-scope]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scope===versionScope)));
 $('recreationStatus').textContent=(inputMode==='all'?'全部类型':typeName(inputMode))+' · 显示 '+rows.length+' 个 · 待发布 '+(versions.length-published.length)+' 个 · 已发布 '+published.length+' 个 / 共 '+detail.versions.length+' 个版本';
 $('recreations').innerHTML=rows.map(v=>'<tr data-version-row="'+v.version+'"><td><span class="vh-version-number">'+v.version+'</span></td><td><strong>'+escape(v.name)+'</strong><small>'+escape(v.title)+'</small><p class="vh-script-excerpt">'+escape(v.cleanedAt?'二创内容已清理；保留发布记录':v.script?.replace(/\s+/g,' ').slice(0,90)||'尚未填写二创文案')+(v.script?.length>90?'…':'')+'</p></td><td data-label="二创类型 / 素材">'+typeBadge(v.inputMode)+'<small>'+(v.cleanedAt?'素材引用已清理':v.inputMode==='video'?'直接传入成片 · '+(v.videoAssetId?'已上传':'待上传'):'图片和文案 · '+v.frameCount+' / '+detail.frameCount+' 帧')+'</small>'+'</td><td><span class="vh-badge '+(v.enabled?'is-enabled':'')+'">'+versionState(v)+'</span></td><td><small>'+stamp(v.publishedAt||v.updatedAt)+'</small><small>'+(v.publishedAt?'发布确认时间':'更新时间')+' · 北京时间</small></td><td><a class="vh-link-button" data-detail="'+v.version+'" href="'+escape(detailUrl(detail.source.id,v.version))+'">查看详情</a></td></tr>').join('')||'<tr><td colspan="6"><p class="vh-note">'+(detail.versions.length?'当前筛选暂无版本。':'尚无二创版本。点击“新建二创版本”或通过 API 写入，创建后将按版本编号显示在这里。')+'</p></td></tr>';
}
async function loadVersion(){
 const v=current();$('versionType').textContent=typeName(v.inputMode);$('versionType').className='vh-badge vh-type-'+v.inputMode;$('workspace').hidden=false;$('pageLead').textContent=v.cleanedAt?'查看该版本的发布记录和自动清理结果。':v.inputMode==='video'?'对照查看原文案与二创文案，预览成片并提交发布。':'对照查看原文案、二创文案，以及每一帧的原图和二创图。';$('versionScriptLabel').textContent=v.inputMode==='video'?'视频文案（选填）':'完整配音文案';$('editVersion').textContent=v.inputMode==='video'?'编辑版本与成片':'编辑二创文案';
 $('versionHeading').textContent='版本 '+n+' · '+v.name;$('versionTitle').textContent=v.title;$('versionCaption').textContent=v.cleanedAt?'已按发布后保留期清理':v.caption||'尚未填写发布文案';$('versionScript').textContent=v.cleanedAt?'已按发布后保留期清理':v.script||(v.inputMode==='video'?'成片自带配音，无需填写合成文案':'尚未填写二创配音文案');
 $('originalTitle').textContent=detail.source.title;$('originalCaption').textContent=detail.source.originalsCleanedAt?'来源已结束，原文案已清理':detail.source.caption||'尚未填写发布文案';$('originalScript').textContent=detail.source.originalsCleanedAt?'来源已结束，原文案已清理':detail.source.script||'尚未填写原文';
 $('versionStatus').textContent=versionState(v)+' · '+(v.inputMode==='video'?'直接传入成片':v.frameCount+' / '+detail.frameCount+' 帧');
 $('toggleVersion').textContent=v.enabled?'停用版本':'启用版本';lock('toggleVersion',Boolean(v.publishItemId));lock('editVersion',Boolean(v.publishItemId));
 $('renderVersion').hidden=v.inputMode==='video';$('publishVersion').textContent=v.inputMode==='video'||renderCurrent(v)&&v.renderState==='done'?'发布成片':'合成并发布';
 lock('renderVersion',!v.enabled||Boolean(v.publishItemId)||renderCurrent(v)&&['queued','running','done'].includes(v.renderState));lock('publishVersion',!v.enabled||Boolean(v.publishItemId)||v.inputMode!=='video'&&['queued','running'].includes(v.renderState));
 previewData=null;renderVideoPreview();$('framePanel').hidden=v.inputMode==='video'||Boolean(v.cleanedAt);
 $('versionLifecycle').textContent=v.cleanedAt?'官方发布已确认，二创文案与素材引用已清理；图片和成片的删除进度见“清理状态”。':v.publishedAt?'官方发布已确认，二创文案和素材将在 '+stamp(v.publishedAt+86400000)+' 后自动清理。':'发布成功后自动清理二创内容；提交中、失败和未确认状态会保留。';
 $('publishedLink').hidden=!/^https:\/\//.test(v.publishedUrl||'');$('publishedLink').href=v.publishedUrl||'#';
 for(const id of ['addOriginal','addRemix','jsonFrames'])lock(id,Boolean(v.publishItemId)||Boolean(detail.source.archivedAt));
 await Promise.all([v.inputMode==='video'||v.cleanedAt?Promise.resolve():loadFrames(),loadJobs()]);
}
async function loadFrames(){
 const id=detail.source.id,version=n,p=framePage,token=loadToken;
 $('frameStatus').textContent='正在读取图片…';
 const [original,remix]=await Promise.all([api('/'+id+'/frames/0?page='+p),api('/'+id+'/frames/'+version+'?page='+p)]);
 if(token!==loadToken||version!==n||p!==framePage)return;
 const originals=new Map(original.frames.map(f=>[f.index,f])),recreations=new Map(remix.frames.map(f=>[f.index,f])),indices=[...new Set([...originals.keys(),...recreations.keys()])].sort((a,b)=>a-b);
 framePreviews.clear();
 const image=(f,label,index,imageVersion)=>{
  if(f)framePreviews.set(imageVersion+':'+index,{...f,label,index,version:imageVersion});
  return '<div class="vh-image-column"><p class="vh-image-label">'+label+'</p>'+(f?'<button type="button" class="vh-image-preview" data-preview-frame="'+index+'" data-preview-version="'+imageVersion+'" aria-label="放大查看第 '+index+' 帧 '+label+'" title="放大查看"><img src="'+escape(f.previewUrl)+'" alt="第 '+index+' 帧 '+label+'" loading="lazy" referrerpolicy="no-referrer"><i class="vh-magnifier" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6M10 7v6M7 10h6"/></svg></i></button>':'<span class="vh-image-empty">待补充</span>')+'<p class="vh-frame-text">'+escape(f?.text||'尚未填写画面文字')+'</p><p class="vh-note">'+(f?'参考时长 '+f.durationSeconds+' 秒':'')+'</p><button '+(current().publishItemId||detail.source.archivedAt?'disabled ':'')+'data-frame="'+index+'" data-version="'+imageVersion+'">修改'+(imageVersion?'二创图':'原图')+'</button></div>';
 };
 $('frames').innerHTML=indices.map(index=>'<article class="vh-frame" data-frame-row="'+index+'"><strong>第 '+index+' 帧</strong><div class="vh-images">'+image(originals.get(index),'原图',index,0)+image(recreations.get(index),'版本 '+version+' 二创图',index,version)+'</div></article>').join('')||'<p class="vh-note">尚无图片。先补充原图，再写入对应版本的二创图。</p>';
 $('frameStatus').textContent='原图 '+original.total+' 帧 · 二创图 '+remix.total+' 帧';$('framePageInfo').textContent='第 '+p+' 页 / 每页20帧';$('framePrevious').disabled=p===1;$('frameNext').disabled=!original.hasMore&&!remix.hasMore;
}
function renderVideoPreview(){
 const v=current();if(!v)return;
 const direct=v.inputMode==='video',info=previewData,stale=!direct&&v.renderJobId&&!renderCurrent(v),state=direct?'done':info?.state||v.renderState;
 const visible=!v.cleanedAt&&(direct||Boolean(v.renderJobId));$('readyVideoPanel').hidden=!visible;
 const url=visible?(direct?v.videoPreviewUrl:!stale?info?.previewUrl:'')||'':'';
 const player=$('readyVideoPreview');
 if((player.getAttribute('src')||'')!==url){
  player.pause();player.removeAttribute('poster');delete player.dataset.coverSrc;
  const cover=$('readyVideoPlayer').querySelector('.video-cover-button');cover.hidden=true;cover.querySelector('img').removeAttribute('src');
  if(url){player.src=url;player.dataset.coverSrc=url;}else player.removeAttribute('src');player.load();
 }
 $('readyVideoPlayer').hidden=!url;videoPosters.refresh();
 $('prepareRenderedVideo').hidden=true;$('readyVideoError').hidden=true;
 if(!visible)return;
 $('readyVideoHeading').textContent=direct?'二创成片':'图文合成视频';
 const badge=$('readyVideoBadge');badge.classList.toggle('is-enabled',!stale&&state==='done');
 const busy=previewPreparing===previewKey()||['queued','running'].includes(info?.preparationStatus);
 const error=previewErrors.get(previewKey())||info?.error||'';
 if(direct){badge.textContent=v.videoAssetId?'成片已上传':'待传入成片';$('readyVideoStatus').textContent=url?'可在这里播放、全屏查看视频。':'请编辑版本并传入成片。';}
 else if(stale||state==='stale'){badge.textContent='需重新合成';$('readyVideoStatus').textContent='文案或图片已更新，请重新合成当前版本的视频。';}
 else if(state==='done'){
  badge.textContent='已合成视频';
  $('readyVideoStatus').textContent=url?'可在这里播放、全屏查看视频；下方保留逐帧图片对照。':busy?'视频已合成，正在准备云端预览，完成后会自动显示。':info?.canPrepare?'视频已合成，正在准备详情页预览。':info?'视频已合成，暂时无法取回预览文件。':'视频已合成，正在读取预览状态…';
  $('prepareRenderedVideo').hidden=Boolean(url)||busy||!info?.canPrepare;
  $('prepareRenderedVideo').textContent=error||info?.preparationStatus==='failed'?'重试视频预览':'准备视频预览';
  if(error&&!url){$('readyVideoError').hidden=false;$('readyVideoError').textContent=error;$('readyVideoStatus').textContent='视频已合成，云端预览暂不可用。';}
 }else{badge.textContent=({queued:'已提交合成',running:'合成中',failed:'合成失败',cancelled:'已取消合成'})[state]||'待合成';$('readyVideoStatus').textContent=state==='running'?'正在合成 '+(info?.percent||0)+'%，完成后会在这里显示视频。':state==='queued'?'正在等待合成，完成后会在这里显示视频。':info?.error||'完成合成后，可在这里查看视频。';}
}
async function prepareVideoPreview(){
 const v=current(),info=previewData,key=previewKey();
 if(v?.inputMode==='video'||v?.cleanedAt||!renderCurrent(v)||info?.state!=='done'||!info.canPrepare||info.previewUrl||previewPreparing||['queued','running'].includes(info.preparationStatus))return;
 previewAttempts.add(key);previewErrors.delete(key);previewPreparing=key;renderVideoPreview();
 try{
  const response=await fetch('/api/psychology-video-library/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId:info.jobId,resultIndex:0})});
  const data=await response.json();if(!response.ok)throw Error(data.error||'视频预览准备失败');
 }catch(error){previewErrors.set(key,error.message);}
 finally{previewPreparing='';if(view==='detail'&&current()){renderVideoPreview();refreshPreview();}}
}
function refreshPreview(){return loadJobs().catch(error=>{if(view==='detail'){$('readyVideoError').hidden=false;$('readyVideoError').textContent='状态读取失败：'+error.message+'，请点击刷新状态。';}});}
async function loadJobs(){
 clearTimeout(jobsTimer);
 const id=detail.source.id,version=n,token=loadToken,request=++jobsRequest,data=await api('/'+id+'/versions/'+version+'/jobs');if(token!==loadToken||version!==n||request!==jobsRequest)return;
 if(data.sourceRevision!==detail.source.revision||data.version&&(data.version.revision!==current().revision||data.version.cleanedAt!==current().cleanedAt||data.version.publishedAt!==current().publishedAt)){await loadDetail();return;}
 if(data.version)Object.assign(current(),data.version);
 const v=current();previewData=data.renderedVideo;renderVideoPreview();
 $('versionStatus').textContent=versionState(v)+' · '+(v.inputMode==='video'?'直接传入成片':v.frameCount+' / '+detail.frameCount+' 帧');
 $('publishVersion').textContent=v.inputMode==='video'||renderCurrent(v)&&v.renderState==='done'?'发布成片':'合成并发布';
 lock('renderVersion',!v.enabled||Boolean(v.publishItemId)||renderCurrent(v)&&['queued','running','done'].includes(v.renderState));lock('publishVersion',!v.enabled||Boolean(v.publishItemId)||v.inputMode!=='video'&&['queued','running'].includes(v.renderState));
 if(data.publication){const p=data.publication;$('versionStatus').textContent=({published:'已发布',failed:'发布失败，请重试原任务',submitted:'已提交官方发布',queued:'待发布',running:'发布处理中',cancelled:'发布已取消'}[p.status]||'已提交发布')+' · 每版本仅发布一次'+(v.cleanedAt?' · 内容已清理':v.publishedAt?' · 24小时后自动清理':'');}
 $('jobs').innerHTML=data.jobs.map(j=>'<article><b>'+escape((j.type==='psychology-video-remix'?{queued:'等待合成',running:'合成中',done:'已合成视频',failed:'合成失败',cancelled:'已取消'}:{queued:'等待发布',running:'发布处理中',done:'已转交发布流程',failed:'发布失败',cancelled:'已取消'})[j.status]||j.status)+'</b> · '+j.percent+'%<p>'+escape(j.error||j.message)+'</p><small>'+escape(j.id)+'</small></article>').join('')||'<p>本版本尚无合成任务。</p>';
 if(document.hidden||v.cleanedAt||v.inputMode==='video')return;
 if(renderCurrent(v)&&previewData?.state==='done'&&previewData.canPrepare&&!previewData.previewUrl&&!previewData.assetId&&!previewData.preparationStatus&&!previewAttempts.has(previewKey())){prepareVideoPreview();return;}
 if(renderCurrent(v)&&(['queued','running'].includes(previewData?.state)||['queued','running'].includes(previewData?.preparationStatus)))jobsTimer=setTimeout(refreshPreview,3000);
}
$('prepareRenderedVideo').onclick=prepareVideoPreview;$('refreshVideoPreview').onclick=()=>{videoPosters.retryFailures();refreshPreview();};
window.addEventListener('pagehide',()=>{clearTimeout(jobsTimer);jobsRequest++;});
document.addEventListener('visibilitychange',()=>{clearTimeout(jobsTimer);if(!document.hidden&&view==='detail'&&current())refreshPreview();});
window.addEventListener('pageshow',e=>{if(e.persisted&&view==='detail'&&current())refreshPreview();});

function sourceEditor(edit){
 editingSource=edit;$('sourceForm').reset();const s=edit?detail.source:{externalId:'video-'+Date.now(),videoData:{}};
 for(const name of ['externalId','videoUrl','title','caption','script'])$('sourceForm').elements[name].value=s[name]||'';
 $('sourceForm').dataset.revision=s.revision||0;$('sourceForm').elements.externalId.readOnly=edit;$('sourceForm').elements.videoData.value=JSON.stringify(s.videoData||{},null,2);$('sourceDialogTitle').textContent=edit?'编辑视频原文':'新增视频';$('sourceSaveStatus').textContent='';$('sourceDialog').showModal();
}
function versionEditor(edit){
 editingVersion=edit;const v=edit?current():null,available=edit?[n]:Array.from({length:20},(_,i)=>i+1).filter(i=>!detail.versions.some(v=>v.version===i));
 if(!available.length)return;
 $('versionForm').reset();$('versionNumber').innerHTML=available.map(i=>'<option value="'+i+'">版本 '+i+'</option>').join('');$('versionNumber').disabled=edit;
 const values=v||{name:'二创版本 '+available[0],title:detail.source.title,caption:detail.source.caption};
 for(const key of ['name','title','caption','script'])$('versionForm').elements[key].value=values[key]||'';
 $('versionInputMode').value=v?.inputMode||'frames';$('versionForm').dataset.videoAssetId=v?.videoAssetId||'';delete $('versionForm').dataset.videoUploadId;updateInputMode();
 $('versionForm').dataset.revision=v?.revision||0;$('versionDialogTitle').textContent=edit?'编辑二创版本 '+n:'新建二创版本';$('versionSaveStatus').textContent='';$('versionDialog').showModal();
}
$('filters').addEventListener('submit',e=>{e.preventDefault();page=1;load();});$('previous').onclick=()=>{page--;load();};$('next').onclick=()=>{page++;load();};
$('newSource').onclick=()=>sourceEditor(false);$('editSource').onclick=()=>sourceEditor(true);
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('sourceForm').onsubmit=e=>{e.preventDefault();action('sourceSaveStatus',e.submitter,async()=>{
 const f=e.target.elements,body=Object.fromEntries(['externalId','videoUrl','title','caption','script'].map(k=>[k,f[k].value]));body.videoData=JSON.parse(f.videoData.value||'{}');
 if(editingSource)body.revision=Number(e.target.dataset.revision);
 const result=await write(editingSource?'/'+detail.source.id:'',editingSource?'PATCH':'POST',body);$('sourceDialog').close();
 if(editingSource)await loadDetail();else location.assign(recreationsUrl(result.id));
 });};
$('versionScope').onclick=e=>{const b=e.target.closest('[data-scope]');if(b){versionScope=b.dataset.scope;renderRecreations();}};
$('sourceScope').onchange=()=>{page=1;load();};
$('sourceInputMode').onchange=e=>{inputMode=e.target.value;syncTypeFilter();page=1;load();};
$('recreationInputMode').onchange=e=>{inputMode=e.target.value;syncTypeFilter();renderRecreations();};
$('archiveSource').onclick=()=>{$('archiveStatus').textContent='';$('archiveDialog').showModal();};
$('confirmArchive').onclick=e=>action('archiveStatus',e.target,async()=>{await write('/'+detail.source.id+'/archive','POST',{revision:detail.source.revision});$('archiveDialog').close();await loadDetail();});
$('newVersion').onclick=()=>versionEditor(false);$('editVersion').onclick=()=>versionEditor(true);
$('versionForm').onsubmit=e=>{e.preventDefault();action('versionSaveStatus',e.submitter,async()=>{
 const version=Number($('versionNumber').value),body=Object.fromEntries(['name','title','caption','script'].map(k=>[k,e.target.elements[k].value]));body.revision=Number(e.target.dataset.revision);body.inputMode=$('versionInputMode').value;body.videoAssetId='';body.enabled=false;
 if(body.inputMode==='video'){body.videoAssetId=e.target.dataset.videoAssetId||'';const file=$('versionVideoFile').files[0];if(file){if(file.size>95*1024*1024)throw new Error('成片最多95MB。');$('versionSaveStatus').textContent='正在校验并上传成片…';const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');const id=e.target.dataset.videoUploadId||crypto.randomUUID();e.target.dataset.videoUploadId=id;const type={mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm'}[file.name.split('.').pop().toLowerCase()];const response=await fetch(BASE+'/videos/'+id,{method:'PUT',headers:{'Content-Type':type||file.type,'X-File-Name':encodeURIComponent(file.name),'X-File-Size':String(file.size),'X-Content-SHA256':digest},body:file}),data=await response.json();if(!response.ok)throw new Error(data.error||'成片上传失败');body.videoAssetId=data.videoAssetId;e.target.dataset.videoAssetId=body.videoAssetId;}if(!body.videoAssetId)throw new Error('请先选择成片文件。');body.enabled=true;}
 await write('/'+detail.source.id+'/versions/'+version,'PUT',body);$('versionDialog').close();
 if(editingVersion)await loadDetail();else location.assign(detailUrl(detail.source.id,version));
 });};
$('toggleVersion').onclick=e=>action('versionStatus',e.target,async()=>{await write('/'+detail.source.id+'/versions/'+n,'PATCH',{revision:current().revision,enabled:!current().enabled});await loadDetail();});
function updateInputMode(){const direct=$('versionInputMode').value==='video';$('videoFileLabel').hidden=!direct;$('versionVideoFile').required=direct&&!$('versionForm').dataset.videoAssetId;$('versionForm').elements.script.required=!direct;$('scriptLabel').textContent=direct?'二创视频文案（选填）':'二创完整配音文案';$('existingVideoLabel').textContent=$('versionForm').dataset.videoAssetId?'已绑定成片；选择新文件可替换。':'';$('versionInputHelp').textContent=direct?'上传后保存为可发布成片，无需逐帧图片或配音合成。':'保存为待启用版本。对应的每帧二创图片补齐后，可启用并合成。';}
$('versionInputMode').onchange=updateInputMode;$('versionVideoFile').onchange=()=>delete $('versionForm').dataset.videoUploadId;
$('publishVersion').onclick=e=>action('versionStatus',e.target,async()=>{const response=await fetch('/api/official-tiktok/publish-accounts?module=psychology&media=video',{cache:'no-store'}),data=await response.json();if(!response.ok)throw new Error(data.error||'账号读取失败');$('publishAccount').innerHTML='<option value="">请选择一个账号</option>'+data.accounts.map(a=>'<option value="'+escape(a.connectionId||a.id)+'">'+escape(a.username||a.displayName||a.connectionId||a.id)+'</option>').join('');const date=new Date(Date.now()+2*3600000);date.setMinutes(date.getMinutes()-date.getTimezoneOffset());$('publishSchedule').value=date.toISOString().slice(0,16);$('publishAi').value='';$('publishSaveStatus').textContent='';$('publishDialogTitle').textContent=$('publishVersion').textContent;$('publishDialog').showModal();});
$('publishForm').onsubmit=e=>{e.preventDefault();action('publishSaveStatus',e.submitter,async()=>{const result=await write('/'+detail.source.id+'/versions/'+n+'/publish','POST',{revision:current().revision,connectionIds:[$('publishAccount').value],scheduleAt:Math.floor(new Date($('publishSchedule').value).getTime()/1000),isAiGenerated:$('publishAi').value==='true',voiceGender:'female'});$('publishDialog').close();await loadDetail();$('jobsPanel').open=true;});};
$('renderVersion').onclick=e=>action('versionStatus',e.target,async()=>{const r=await write('/'+detail.source.id+'/versions/'+n+'/render','POST',{revision:current().revision,voiceGender:'female'});$('versionStatus').textContent='已创建合成任务：'+r.jobIds.join(', ');$('jobsPanel').open=true;await loadDetail();});
async function frameEditor(version,index=1,edit=false){
 frameVersion=version;$('frameForm').reset();delete $('frameForm').dataset.uploadId;$('frameSaveStatus').textContent='';$('frameDialogTitle').textContent='第 '+index+' 帧 · '+(edit?'修改':'补充')+(version?'版本 '+version+' 二创图':'原图');
 $('frameForm').elements.index.readOnly=edit;
 $('frameEditHelp').textContent='可替换此帧图片，或保留图片只修改画面文字、参考时长；不会自动生成图片。保存'+(version?'二创图会停用当前二创版本。':'原图会停用该视频的全部二创版本。')+'确认文案和逐帧图片完整后，可重新启用。';
 const data=await api('/'+detail.source.id+'/frames/'+version+'?page='+Math.ceil(index/20)),f=data.frames.find(f=>f.index===index);
 for(const k of ['index','imageUrl','text','durationSeconds'])$('frameForm').elements[k].value=f?.[k]??(k==='index'?index:k==='durationSeconds'?3:'');
 $('frameForm').dataset.revision=version?detail.versions.find(v=>v.version===version).revision:detail.source.revision;$('frameForm').dataset.assetId=f?.assetId||'';$('frameDialog').showModal();
}
$('addOriginal').onclick=()=>frameEditor(0,detail.frameCount+1).catch(e=>$('frameStatus').textContent=e.message);$('addRemix').onclick=()=>frameEditor(n).catch(e=>$('frameStatus').textContent=e.message);
$('frames').onclick=e=>{
 const preview=e.target.closest('[data-preview-frame]');if(preview){const frame=framePreviews.get(preview.dataset.previewVersion+':'+preview.dataset.previewFrame);if(frame)openImagePreview(frame,preview);return;}
 const b=e.target.closest('[data-frame]');if(b)frameEditor(Number(b.dataset.version),Number(b.dataset.frame),true).catch(e=>$('frameStatus').textContent=e.message);
};
$('frameForm').onsubmit=e=>{e.preventDefault();action('frameSaveStatus',e.submitter,async()=>{
 const f=e.target.elements,file=f.file.files[0];let assetId=e.target.dataset.assetId,imageUrl=f.imageUrl.value.trim();
 if(file&&imageUrl)throw new Error('图片文件和链接请只选一个。');
 if(file){if(file.size>8*1024*1024)throw new Error('图片最多8MB。');const uploadId=e.target.dataset.uploadId||crypto.randomUUID();e.target.dataset.uploadId=uploadId;
  const response=await fetch(BASE+'/assets/'+uploadId,{method:'PUT',headers:{'Content-Type':file.type},body:file});const data=await response.json();if(!response.ok)throw new Error(data.error||'上传失败');assetId=data.assetId;
 }else if(imageUrl)assetId='';
 await write('/'+detail.source.id+'/frames/'+frameVersion,'PUT',{revision:Number(e.target.dataset.revision),frames:[{index:Number(f.index.value),...(assetId?{assetId}:{imageUrl}),text:f.text.value,durationSeconds:Number(f.durationSeconds.value)}]});
 delete e.target.dataset.uploadId;$('frameDialog').close();await loadDetail();
 });};
$('frameForm').elements.file.onchange=()=>delete $('frameForm').dataset.uploadId;
$('framePrevious').onclick=()=>{framePage--;loadFrames().catch(e=>$('frameStatus').textContent=e.message);};$('frameNext').onclick=()=>{framePage++;loadFrames().catch(e=>$('frameStatus').textContent=e.message);};
$('jsonFrames').onclick=()=>{$('jsonVersion').innerHTML='<option value="0">原图</option>'+detail.versions.map(v=>'<option value="'+v.version+'">'+escape(v.name)+'</option>').join('');$('jsonVersion').value=n;$('jsonStatus').textContent='';$('jsonDialog').showModal();};
$('jsonForm').onsubmit=e=>{e.preventDefault();action('jsonStatus',e.submitter,async()=>{const version=Number($('jsonVersion').value),fresh=await api('/'+detail.source.id),row=version?fresh.versions.find(v=>v.version===version):fresh.source;
 await write('/'+detail.source.id+'/frames/'+version,'PUT',{revision:row.revision,frames:JSON.parse($('jsonInput').value)});$('jsonDialog').close();await loadDetail();
 });};
$('refreshJobs').onclick=e=>action('versionStatus',e.target,loadDetail);
let previewToken=0,imageScale=1,previewFit=true,previewTrigger=null;
const previewControls=['imageZoomOut','imageZoomIn','imageFit','imageActual'];
function setImageScale(scale,preserveCenter=true){
 const img=$('imagePreview'),viewport=$('imageViewport');if(!img.naturalWidth)return;
 const centerX=(viewport.scrollLeft+viewport.clientWidth/2)/Math.max(viewport.scrollWidth,1),centerY=(viewport.scrollTop+viewport.clientHeight/2)/Math.max(viewport.scrollHeight,1);
 imageScale=Math.min(4,Math.max(0.01,scale));img.style.width=Math.max(1,Math.round(img.naturalWidth*imageScale))+'px';img.style.height=Math.max(1,Math.round(img.naturalHeight*imageScale))+'px';
 $('imageZoomLabel').textContent=Math.round(imageScale*100)+'%';
 $('imageZoomIn').disabled=imageScale>=4;$('imageZoomOut').disabled=imageScale<=0.01;
 if(preserveCenter)requestAnimationFrame(()=>{viewport.scrollLeft=centerX*viewport.scrollWidth-viewport.clientWidth/2;viewport.scrollTop=centerY*viewport.scrollHeight-viewport.clientHeight/2;});
 else{viewport.scrollLeft=0;viewport.scrollTop=0;}
}
function fitImagePreview(){
 const img=$('imagePreview'),viewport=$('imageViewport');if(!img.naturalWidth)return;previewFit=true;
 setImageScale(Math.min(1,Math.max(1,viewport.clientWidth-32)/img.naturalWidth,Math.max(1,viewport.clientHeight-32)/img.naturalHeight),false);
}
function openImagePreview(frame,trigger){
 const token=++previewToken,img=$('imagePreview'),dialog=$('imageDialog');previewTrigger=trigger;previewFit=true;
 $('imageDialogTitle').textContent='第 '+frame.index+' 帧 · '+frame.label;$('imagePreviewStatus').textContent='正在加载图片…';$('imageZoomLabel').textContent='—';
 previewControls.forEach(id=>$(id).disabled=true);img.hidden=true;img.removeAttribute('src');img.style.width='';img.style.height='';img.alt='第 '+frame.index+' 帧 '+frame.label;
 img.onload=()=>{if(token!==previewToken||!dialog.open)return;img.hidden=false;previewControls.forEach(id=>$(id).disabled=false);$('imagePreviewStatus').textContent=img.naturalWidth+' × '+img.naturalHeight+' · 放大后可滚动查看图片';fitImagePreview();};
 img.onerror=()=>{if(token===previewToken&&dialog.open)$('imagePreviewStatus').textContent='图片加载失败，请关闭后重试。';};
 dialog.showModal();img.src=frame.previewUrl;
}
function zoomImage(factor){previewFit=false;setImageScale(imageScale*factor);}
$('imageZoomIn').onclick=()=>zoomImage(1.25);$('imageZoomOut').onclick=()=>zoomImage(0.8);$('imageFit').onclick=fitImagePreview;
$('imageActual').onclick=()=>{previewFit=false;setImageScale(1);};
$('imageDialog').addEventListener('close',()=>{previewToken++;$('imagePreview').removeAttribute('src');$('imagePreview').hidden=true;if(previewTrigger?.isConnected)previewTrigger.focus({preventScroll:true});});
$('imageDialog').addEventListener('click',e=>{if(e.target!==$('imageDialog'))return;const box=e.target.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)e.target.close();});
$('imageDialog').addEventListener('keydown',e=>{if($('imagePreview').hidden)return;if(['+','='].includes(e.key)){e.preventDefault();zoomImage(1.25);}else if(e.key==='-'){e.preventDefault();zoomImage(0.8);}else if(e.key==='0'){e.preventDefault();fitImagePreview();}});
window.addEventListener('resize',()=>{if($('imageDialog').open&&previewFit&&!$('imagePreview').hidden)fitImagePreview();});
let guideText='';
async function guide(){if(guideText)return guideText;const r=await fetch('/docs/psychology-video-hits-api.md',{cache:'no-cache'});if(!r.ok)throw new Error('接入文档加载失败，请稍后重试。');guideText=await r.text();return guideText;}

async function showCleanup(){
 $('cleanupStatus').textContent='正在读取…';const data=await api('/cleanup'),sets=[['原图 / 二创图片',data.images],['传入成片',data.videos],['合成云端预览',data.previews]],sum=(rows,state,key)=>rows.filter(r=>r.state===state).reduce((n,r)=>n+Number(r[key]),0);
 $('cleanupSummary').innerHTML='<p>已发布 '+data.versions.published+' 个版本 · 内容已清理 '+data.versions.cleaned+' 个 · 等待清理 '+data.versions.awaitingCleanup+' 个</p><div class="vh-table"><table><thead><tr><th>素材</th><th>保留文件</th><th>已清理文件</th><th>待重试</th></tr></thead><tbody>'+sets.map(([label,rows])=>'<tr><td>'+label+'</td><td data-label="保留">'+sum(rows,'active','count')+'</td><td data-label="已清理">'+sum(rows,'deleted','count')+'</td><td data-label="待重试">'+sum(rows,'deleting','count')+'</td></tr>').join('')+'</tbody></table></div><p>本机成片已清理 '+data.local.cleaned+' 个 · 等待原渲染工人清理 '+data.local.queued+' 个</p>'+(data.errors.length?'<p>以下文件删除失败，将自动重试：</p>'+data.errors.map(e=>'<p>'+escape(e.kind+' '+e.id+'：'+e.error)+'</p>').join(''):'');$('cleanupStatus').textContent='状态已更新；内容清理与文件删除分别统计，共享文件继续保留，发布次数不会重置。';
}
$('cleanupButton').onclick=()=>{$('cleanupDialog').showModal();showCleanup().catch(e=>$('cleanupStatus').textContent=e.message);};$('refreshCleanup').onclick=e=>action('cleanupStatus',e.target,showCleanup);
$('apiButton').onclick=async()=>{$('apiInstructions').textContent='正在加载完整接入文档…';$('copyApi').disabled=true;$('apiDialog').showModal();try{$('apiInstructions').textContent=await guide();$('copyApi').disabled=false;}catch(e){$('apiInstructions').textContent=e.message;}};$('copyApi').onclick=async()=>{try{await navigator.clipboard.writeText(await guide());$('copyApi').textContent='已复制';}catch{$('copyApi').textContent='请选中下方说明复制';}};
setupPage();
if(view==='sources')load();
else if(!/^vh-[a-f0-9]{32}$/.test(sourceId||''))pageError(new Error('缺少有效的视频来源，请返回视频爆款列表。'));
else if(view==='detail'&&(!Number.isInteger(n)||n<1||n>20))pageError(new Error('二创版本编号须为 1 到 20，请返回二创列表。'));
else{$('pageStatus').hidden=false;$('pageStatus').textContent='正在读取…';loadDetail().catch(pageError);}
