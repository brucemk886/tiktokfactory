const $=id=>document.getElementById(id),BASE='/api/psychology-video-hits',PAGE='/psychology-video-hits';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const route=location.pathname.replace(/\/$/,''),params=new URLSearchParams(location.search);
const view=route===PAGE+'/recreations'?'recreations':route===PAGE+'/detail'?'detail':'sources';
const sourceId=params.get('id'),detailUrl=(id,version)=>PAGE+'/detail?id='+encodeURIComponent(id)+'&version='+version,recreationsUrl=id=>PAGE+'/recreations?id='+encodeURIComponent(id);
let page=1,list=[],detail=null,n=Number(params.get('version')),framePage=1,editingSource=false,editingVersion=false,frameVersion=0,loadToken=0,listToken=0;
const pending=new Map();
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
 $(status).textContent='正在处理…';try{await fn();}catch(e){$(status).textContent=e.message;}finally{if(button)button.disabled=original;}
}
const current=()=>detail?.versions.find(v=>v.version===n),stamp=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const metric=x=>x==null?'—':Number(x).toLocaleString('zh-CN');
function pageError(error){$('pageStatus').hidden=false;$('pageStatus').textContent=error.message;}
function setupPage(){
 const title=view==='sources'?'视频爆款':view==='recreations'?'爆款二创':'二创详情';
 $('pageTitle').textContent=title;document.title=title+' · 心理学';
 $('pageLead').textContent=view==='sources'?'保存爆款视频、原文与分镜原图，对照管理最多 20 套二创文案和图片。':view==='recreations'?'查看该爆款视频的全部二创版本，按版本顺序排列。':'对照查看原文案、二创文案，以及每一帧的原图和二创图。';
 $('pageBreadcrumb').hidden=view==='sources';$('breadcrumbCurrent').textContent=title;
 $('sourceList').hidden=view!=='sources';$('newSource').hidden=view!=='sources';
 if(view==='detail'){
  $('recreationBreadcrumb').hidden=false;$('recreationBreadcrumb').href=recreationsUrl(sourceId||'');$('detailSeparator').hidden=false;
  $('backToVersions').hidden=false;$('backToVersions').href=recreationsUrl(sourceId||'');
 }
}
async function load(){
 const token=++listToken;$('listStatus').textContent='正在读取…';
 try{const data=await api('?page='+page+'&q='+encodeURIComponent($('query').value)+'&sort='+$('sort').value);if(token!==listToken)return;
 list=data.items;$('sources').innerHTML=list.map(s=>'<tr><td><strong>'+escape(s.title)+'</strong><small>'+escape(s.externalId)+'</small><small>更新：'+stamp(s.updatedAt)+'（北京时间）</small></td><td data-label="播放 / 互动">'+metric(s.videoData.playCount)+' 播放<small>'+metric(s.videoData.likeCount)+' 赞 · '+metric(s.videoData.commentCount)+' 评论</small><small>'+metric(s.videoData.shareCount)+' 分享</small></td><td data-label="原图">'+s.frameCount+' 帧</td><td data-label="二创版本">'+s.versionCount+' / 20</td><td><a class="vh-link-button" data-recreations="'+escape(s.id)+'" href="'+escape(recreationsUrl(s.id))+'">查看二创</a></td></tr>').join('')||'<tr><td colspan="5">暂无视频。新增来源后，可通过 API 写入二创文案与逐帧图片。</td></tr>';
 $('listStatus').textContent='共 '+data.total+' 条视频';$('pageInfo').textContent='第 '+page+' 页';$('previous').disabled=page===1;$('next').disabled=!data.hasMore;
 }catch(e){if(token===listToken)$('listStatus').textContent=e.message;}
}
async function loadDetail(){
 const token=++loadToken,d=await api('/'+sourceId);if(token!==loadToken)return;
 d.versions.sort((a,b)=>a.version-b.version);detail=d;
 if(view==='detail'&&!current())throw new Error('此二创版本尚未创建，请返回二创列表。');
 $('sourceSummary').hidden=false;$('sourceTitle').textContent=d.source.title;$('sourceLink').href=d.source.videoUrl;
 $('sourceMeta').textContent=d.source.externalId+' · '+metric(d.source.videoData.playCount)+' 播放 · '+d.frameCount+' 帧原图';
 $('sourceData').textContent=JSON.stringify(d.source.videoData,null,2);
 if(view==='recreations')renderRecreations();else await loadVersion();
 $('pageStatus').hidden=true;
}
function renderRecreations(){
 $('recreationList').hidden=false;$('newVersion').disabled=detail.versions.length>=20;
 $('recreationStatus').textContent='共 '+detail.versions.length+' 个二创版本 / 最多 20 个';
 $('recreations').innerHTML=detail.versions.map(v=>'<tr data-version-row="'+v.version+'"><td><span class="vh-version-number">'+v.version+'</span></td><td><strong>'+escape(v.name)+'</strong><small>'+escape(v.title)+'</small><p class="vh-script-excerpt">'+escape(v.script?.replace(/\s+/g,' ').slice(0,90)||'尚未填写二创文案')+(v.script?.length>90?'…':'')+'</p></td><td data-label="图片进度">'+v.frameCount+' / '+detail.frameCount+' 帧</td><td><span class="vh-badge '+(v.enabled?'is-enabled':'')+'">'+(v.enabled?'已启用':'待补全 / 停用')+'</span></td><td><small>'+stamp(v.updatedAt)+'</small><small>北京时间</small></td><td><a class="vh-link-button" data-detail="'+v.version+'" href="'+escape(detailUrl(detail.source.id,v.version))+'">查看详情</a></td></tr>').join('')||'<tr><td colspan="6"><p class="vh-note">尚无二创版本。点击“新建二创版本”或通过 API 写入，创建后将按版本编号显示在这里。</p></td></tr>';
}
async function loadVersion(){
 const v=current();$('workspace').hidden=false;
 $('versionHeading').textContent='版本 '+n+' · '+v.name;$('versionTitle').textContent=v.title;$('versionCaption').textContent=v.caption||'尚未填写发布文案';$('versionScript').textContent=v.script||'尚未填写二创配音文案';
 $('originalTitle').textContent=detail.source.title;$('originalCaption').textContent=detail.source.caption||'尚未填写发布文案';$('originalScript').textContent=detail.source.script||'尚未填写原文';
 $('versionStatus').textContent=(v.enabled?'已启用':'未启用')+' · '+v.frameCount+' / '+detail.frameCount+' 帧';
 $('toggleVersion').textContent=v.enabled?'停用版本':'启用版本';$('toggleVersion').disabled=false;$('renderVersion').disabled=!v.enabled;
 await Promise.all([loadFrames(),loadJobs()]);
}
async function loadFrames(){
 const id=detail.source.id,version=n,p=framePage,token=loadToken;
 $('frameStatus').textContent='正在读取图片…';
 const [original,remix]=await Promise.all([api('/'+id+'/frames/0?page='+p),api('/'+id+'/frames/'+version+'?page='+p)]);
 if(token!==loadToken||version!==n||p!==framePage)return;
 const originals=new Map(original.frames.map(f=>[f.index,f])),recreations=new Map(remix.frames.map(f=>[f.index,f])),indices=[...new Set([...originals.keys(),...recreations.keys()])].sort((a,b)=>a-b);
 const image=(f,label,index,imageVersion)=>'<div class="vh-image-column"><p class="vh-image-label">'+label+'</p>'+(f?'<a href="'+escape(f.previewUrl)+'" target="_blank" rel="noopener noreferrer"><img src="'+escape(f.previewUrl)+'" alt="第 '+index+' 帧 '+label+'" loading="lazy" referrerpolicy="no-referrer"></a>':'<span class="vh-image-empty">待补充</span>')+'<p class="vh-frame-text">'+escape(f?.text||'尚未填写画面文字')+'</p><p class="vh-note">'+(f?'参考时长 '+f.durationSeconds+' 秒':'')+'</p><button data-frame="'+index+'" data-version="'+imageVersion+'">编辑'+(imageVersion?'二创图':'原图')+'</button></div>';
 $('frames').innerHTML=indices.map(index=>'<article class="vh-frame" data-frame-row="'+index+'"><strong>第 '+index+' 帧</strong><div class="vh-images">'+image(originals.get(index),'原图',index,0)+image(recreations.get(index),'版本 '+version+' 二创图',index,version)+'</div></article>').join('')||'<p class="vh-note">尚无图片。先补充原图，再写入对应版本的二创图。</p>';
 $('frameStatus').textContent='原图 '+original.total+' 帧 · 二创图 '+remix.total+' 帧';$('framePageInfo').textContent='第 '+p+' 页 / 每页20帧';$('framePrevious').disabled=p===1;$('frameNext').disabled=!original.hasMore&&!remix.hasMore;
}
async function loadJobs(){
 const id=detail.source.id,version=n,token=loadToken,data=await api('/'+id+'/versions/'+version+'/jobs');if(token!==loadToken||version!==n)return;
 $('jobs').innerHTML=data.jobs.map(j=>'<article><b>'+escape({queued:'等待合成',running:'合成中',done:'已合成',failed:'失败',cancelled:'已取消'}[j.status]||j.status)+'</b> · '+j.percent+'%<p>'+escape(j.error||j.message)+'</p><small>'+escape(j.id)+'</small>'+(j.status==='done'&&j.result.results?.[0]?'<button data-preview-job="'+escape(j.id)+'">准备云端预览</button>':'')+'</article>').join('')||'<p>本版本尚无合成任务。</p>';
}
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
$('newVersion').onclick=()=>versionEditor(false);$('editVersion').onclick=()=>versionEditor(true);
$('versionForm').onsubmit=e=>{e.preventDefault();action('versionSaveStatus',e.submitter,async()=>{
 const version=Number($('versionNumber').value),body=Object.fromEntries(['name','title','caption','script'].map(k=>[k,e.target.elements[k].value]));body.revision=Number(e.target.dataset.revision);body.enabled=false;
 await write('/'+detail.source.id+'/versions/'+version,'PUT',body);$('versionDialog').close();
 if(editingVersion)await loadDetail();else location.assign(detailUrl(detail.source.id,version));
 });};
$('toggleVersion').onclick=e=>action('versionStatus',e.target,async()=>{await write('/'+detail.source.id+'/versions/'+n,'PATCH',{revision:current().revision,enabled:!current().enabled});await loadDetail();});
$('renderVersion').onclick=e=>action('versionStatus',e.target,async()=>{const r=await write('/'+detail.source.id+'/versions/'+n+'/render','POST',{revision:current().revision,voiceGender:'female'});$('versionStatus').textContent='已创建合成任务：'+r.jobIds.join(', ');$('jobsPanel').open=true;await loadJobs();});
async function frameEditor(version,index=1){
 frameVersion=version;$('frameForm').reset();delete $('frameForm').dataset.uploadId;$('frameSaveStatus').textContent='';$('frameDialogTitle').textContent=version?'版本 '+version+' 二创图':'原图';
 const data=await api('/'+detail.source.id+'/frames/'+version+'?page='+Math.ceil(index/20)),f=data.frames.find(f=>f.index===index);
 for(const k of ['index','imageUrl','text','durationSeconds'])$('frameForm').elements[k].value=f?.[k]??(k==='index'?index:k==='durationSeconds'?3:'');
 $('frameForm').dataset.revision=version?detail.versions.find(v=>v.version===version).revision:detail.source.revision;$('frameForm').dataset.assetId=f?.assetId||'';$('frameDialog').showModal();
}
$('addOriginal').onclick=()=>frameEditor(0,detail.frameCount+1).catch(e=>$('frameStatus').textContent=e.message);$('addRemix').onclick=()=>frameEditor(n).catch(e=>$('frameStatus').textContent=e.message);
$('frames').onclick=e=>{const b=e.target.closest('[data-frame]');if(b)frameEditor(Number(b.dataset.version),Number(b.dataset.frame)).catch(e=>$('frameStatus').textContent=e.message);};
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
$('refreshJobs').onclick=e=>action('versionStatus',e.target,loadJobs);
$('jobs').onclick=async e=>{const b=e.target.closest('[data-preview-job]');if(!b)return;await action('versionStatus',b,async()=>{const r=await fetch('/api/psychology-video-library/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobId:b.dataset.previewJob,resultIndex:0})}),data=await r.json();if(!r.ok)throw new Error(data.error);$('versionStatus').textContent='预览已安排准备，请到“成片与发布”查看。';});};
const guide=()=>[
'你负责解析视频并生成原创二创文案和分镜图片，将结果写入 Local Factory。',
'统一入口：https://factory.tiktokaitool.com/api/v1/factory',
'请求头：Authorization: Bearer <PROJECT_API_KEY>，Content-Type: application/json',
'先 GET 统一入口读取 videoHits.* 目录；所有写操作的外层 requestId 使用 UUID，重试沿用原编号。',
'先 videoHits.create 保存来源：externalId、videoUrl、title、caption、script、videoData（播放、点赞、评论、分享等任意对象）。',
'图片直接 PUT https://factory.tiktokaitool.com/api/integrations/psychology/video-hits/assets/UPLOAD_UUID，使用同一Bearer密钥及 Content-Type: image/png、image/jpeg 或 image/webp，body为实际图片字节，返回assetId。每张最多8MB。请确保调用端能读取实际图片文件；无法读取时用持久公开HTTPS图片链接。',
'用 videoHits.frames.write 写原图：params:{id:"SOURCE_ID",version:"0",body:{revision:SOURCE_REVISION,frames:[{index:1,assetId:"UPLOAD_UUID",text:"原画面文字",durationSeconds:3}]}}。',
'用 videoHits.versions.write 创建1–20版本：params:{id:"SOURCE_ID",version:"1",body:{revision:0,name:"二创1",title:"标题",caption:"发布文案",script:"完整配音文案",enabled:false}}。',
'用 videoHits.frames.write 写二创图，version改为对应1–20编号，revision取该版本最新值。每次1–100帧，可分批写到300帧。帧号从1连续编号，必须覆盖全部原图帧号。',
'最后 videoHits.versions.write 提交最新revision与enabled:true。未补齐图片不能启用；之后补图会自动停用。任务冻结图片与文案，后续编辑不改已排期任务。',
'videoHits.render 只合成MP4：params:{id:"SOURCE_ID",version:"1",body:{revision:CURRENT_REVISION,voiceGender:"female"}}。voiceGender可为male或female。',
'videoHits.jobs 查看任务；成片可在心理学发布页准备云端预览。',
'videoHits.publish 才执行合成和自动发布：params:{id:"SOURCE_ID",version:"1",body:{revision:CURRENT_REVISION,connectionIds:["AUTHORIZED_ACCOUNT_ID"],scheduleAt:UNIX_SECONDS,intervalMinutes:60,isAiGenerated:true,voiceGender:"female"}}。',
'发布前先用 publish.accounts 查询当前心理学项目授权账号。排期至少留30分钟合成，整批14天内。每版本同一账号仅分配一次。可选minFollowers:1000及tiktokOne:{connectionId,accountId,campaignId}沿用现有官方校验。',
'仅在用户已授权发布的任务中调用videoHits.publish；图片/文案写入不会发布，也不会恢复旧自动规划。',
'409 REQUEST_IN_PROGRESS或503 RESULT_UNKNOWN不得更换UUID重发，使用requests.get查询原请求状态。'
].join('\n\n');
$('apiButton').onclick=()=>{$('apiInstructions').textContent=guide();$('apiDialog').showModal();};$('copyApi').onclick=async()=>{try{await navigator.clipboard.writeText(guide());$('copyApi').textContent='已复制';}catch{$('copyApi').textContent='请选中下方说明复制';}};
setupPage();
if(view==='sources')load();
else if(!/^vh-[a-f0-9]{32}$/.test(sourceId||''))pageError(new Error('缺少有效的视频来源，请返回视频爆款列表。'));
else if(view==='detail'&&(!Number.isInteger(n)||n<1||n>20))pageError(new Error('二创版本编号须为 1 到 20，请返回二创列表。'));
else{$('pageStatus').hidden=false;$('pageStatus').textContent='正在读取…';loadDetail().catch(pageError);}
