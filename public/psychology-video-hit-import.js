import {normalizeImportImage,normalizePhotoImport,createPhotoImportSession} from './psychology-video-hit-import-model.js';
const $=id=>document.getElementById(id),BASE='/api/psychology-video-hits',PAGE='/psychology-video-hits';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const images={remix:[],original:[]};let session=null,busy=false,done=false,lookupToken=0,detailToken=0,searchPage=0,searchQuery='',pendingImages=0,currentSourceMode='new',newImporter='gpt-dot';
async function request(path,method='GET',body){
 const response=await fetch(BASE+path,{method,cache:'no-store',signal:AbortSignal.timeout(45000),...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'保存失败，请稍后重试。');return data;
}
async function upload(id,file,type){
 const response=await fetch(BASE+'/assets/'+id,{method:'PUT',headers:{'Content-Type':type},body:file,signal:AbortSignal.timeout(120000)}),data=await response.json();
 if(!response.ok)throw new Error(data.error||'图片上传失败，请重试。');return data;
}
function status(text,error=false){$('importStatus').textContent=text;$('importStatus').dataset.error=String(error);}
function imageStatus(text,error=false){$('imageStatus').textContent=text;$('imageStatus').dataset.error=String(error);}
function renderImages(kind){
 const rows=images[kind];$(kind+'Images').innerHTML=rows.map((image,i)=>'<article class="hi-image"><img src="'+esc(image.preview)+'" alt="'+(kind==='remix'?'二创':'原图')+'第 '+(i+1)+' 张" referrerpolicy="no-referrer"><div class="hi-image-fields"><strong>第 '+(i+1)+' 张'+(i===0?' · 封面':'')+'</strong><small>'+esc(image.file?.name||image.imageUrl)+'</small><label>图片文字<textarea rows="3" maxlength="1500" data-image-text="'+i+'" aria-label="'+(kind==='remix'?'二创':'原图')+'第 '+(i+1)+' 张文字">'+esc(image.text)+'</textarea></label><div class="vh-actions"><button type="button" data-move="'+i+'" data-direction="-1" '+(i===0?'disabled':'')+' aria-label="第 '+(i+1)+' 张上移">上移</button><button type="button" data-move="'+i+'" data-direction="1" '+(i===rows.length-1?'disabled':'')+' aria-label="第 '+(i+1)+' 张下移">下移</button><button type="button" data-remove="'+i+'" aria-label="删除第 '+(i+1)+' 张">移除</button></div><small class="hi-image-error" hidden>图片预览失败，请检查文件或链接。</small></div></article>').join('');
 $(kind+'Images').querySelectorAll('img').forEach(img=>img.onerror=()=>img.closest('article').querySelector('.hi-image-error').hidden=false);
 $('imageCount').textContent=images.remix.length+' / 15 张';$('imagesEmpty').hidden=images.remix.length>0;
}
async function addFiles(kind,files){
 if(session||busy)return;
 const additions=[];pendingImages++;$('saveImport').disabled=true;
 try{
  if(images[kind].length+files.length>15)throw new Error('每套最多 15 张图片，请减少所选文件。');
  for(const file of files){
   const image=normalizeImportImage({file,text:''});image.preview=URL.createObjectURL(file);additions.push(image);
   const preview=new Image();preview.src=image.preview;try{await preview.decode();}catch{throw new Error(file.name+' 无法解码，请选择有效图片。');}
  }
  // A save or another upload may have started while the images decoded.
  if(session||busy||images[kind].length+additions.length>15)throw new Error('页面状态已变化，请重新选择图片。');
  images[kind].push(...additions);renderImages(kind);imageStatus('已添加 '+additions.length+' 张'+(kind==='remix'?'二创图片':'原图')+'，可用上移 / 下移调整顺序。');
 }catch(e){additions.forEach(image=>URL.revokeObjectURL(image.preview));imageStatus(e.message,true);}finally{pendingImages--; $('saveImport').disabled=busy||done||pendingImages>0;}
}
for(const kind of ['remix','original']){
 $(kind+'Files').onchange=async e=>{await addFiles(kind,[...e.target.files]);e.target.value='';};
 $(kind+'Images').oninput=e=>{if(session||busy)return;const index=e.target.dataset.imageText;if(index!==undefined)images[kind][Number(index)].text=e.target.value;};
 $(kind+'Images').onclick=e=>{
  if(session||busy)return;const button=e.target.closest('button');if(!button)return;
  if(button.dataset.remove!==undefined){const [image]=images[kind].splice(Number(button.dataset.remove),1);if(image.file)URL.revokeObjectURL(image.preview);}
  if(button.dataset.move!==undefined){const index=Number(button.dataset.move),next=index+Number(button.dataset.direction);if(next>=0&&next<images[kind].length)[images[kind][index],images[kind][next]]=[images[kind][next],images[kind][index]];}
  renderImages(kind);imageStatus('当前共有 '+images[kind].length+' 张'+(kind==='remix'?'二创图片':'原图')+'。');
 };
}
$('pasteImages').onpaste=e=>{if(session||busy)return;const files=[...(e.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/'));if(files.length){e.preventDefault();addFiles('remix',files);}};
$('addImageUrls').onclick=()=>{
 if(session||busy)return;
 try{const lines=$('imageUrls').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(!lines.length)throw new Error('请填写图片链接。');if(images.remix.length+lines.length>15)throw new Error('每套最多 15 张二创图片。');const additions=lines.map(imageUrl=>normalizeImportImage({imageUrl,text:''}));images.remix.push(...additions.map(image=>({...image,preview:image.imageUrl})));$('imageUrls').value='';renderImages('remix');imageStatus('已添加 '+additions.length+' 张链接图片，请核对预览。');}catch(e){imageStatus(e.message,true);}
};
function sourceMode(){
 if(session)return;detailToken++;const existing=$('sourceMode').value==='existing';
 if(existing&&currentSourceMode==='new')newImporter=$('importSource').value;
 if(!existing&&currentSourceMode==='existing')$('importSource').value=newImporter;
 currentSourceMode=existing?'existing':'new';
 $('newSourceFields').hidden=existing;$('existingSourceFields').hidden=!existing;
 $('newSourceFields').querySelectorAll('input,textarea').forEach(n=>n.disabled=existing);$('existingSource').disabled=!existing;$('existingSource').required=existing;
 $('importSource').disabled=existing;$('importSourceHint').textContent=existing?'沿用原选题的来源标签，不覆盖原选题信息。':'标记素材来自哪个智能体，也可以填写自己的名称。';
 if(existing){if(!$('existingSource').value&&searchPage===0)searchSources(false);else showSelectedSource();}
}
async function searchSources(more){
 const token=++lookupToken;const query=more?searchQuery:$('sourceSearch').value.trim(),page=more?searchPage+1:1;
 $('searchSources').disabled=true;$('moreSources').disabled=true;$('sourceLookupStatus').textContent='正在查找选题…';
 try{
  const data=await request('?scope=active&page='+page+'&q='+encodeURIComponent(query));if(token!==lookupToken||session)return;
  if(!more){$('existingSource').replaceChildren(new Option('请选择原选题',''));detailToken++;}
  for(const source of data.items){if(![...$('existingSource').options].some(o=>o.value===source.id))$('existingSource').add(new Option(source.title+' · '+source.externalId,source.id));}
  searchPage=page;searchQuery=query;$('moreSources').hidden=!data.hasMore;$('sourceLookupStatus').textContent=data.total?'找到 '+data.total+' 个选题，请选择。':'未找到选题，可改为新建。';
 }catch(e){if(token===lookupToken)$('sourceLookupStatus').textContent=e.message;}finally{if(token===lookupToken){$('searchSources').disabled=false;$('moreSources').disabled=false;}}
}
async function showSelectedSource(){
 const token=++detailToken,id=$('existingSource').value;if(!id)return;
 try{const data=await request('/'+id);if(token!==detailToken||session||$('sourceMode').value!=='existing')return;$('importSource').value=data.source.importSource;$('sourceLookupStatus').textContent='已选择：'+data.source.title+' · 原图 '+data.frameCount+' 张 · 下一个版本 '+data.nextVersion+(data.activeVersionCount>=20?'（在库版本已满）':'');}catch(e){if(token===detailToken)$('sourceLookupStatus').textContent=e.message;}
}
$('sourceMode').onchange=sourceMode;$('searchSources').onclick=()=>searchSources(false);$('moreSources').onclick=()=>searchSources(true);$('existingSource').onchange=showSelectedSource;
$('sourceSearch').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();searchSources(false);}};
function collect(){return normalizePhotoImport({sourceMode:$('sourceMode').value,sourceId:$('existingSource').value,importSource:$('importSource').value,externalId:$('externalId').value,videoUrl:$('originalUrl').value,originalTitle:$('originalTitle').value,originalCaption:$('originalCaption').value,originalScript:$('originalScript').value,title:$('remixTitle').value,name:$('remixName').value,caption:$('remixCaption').value,script:$('remixScript').value,images:images.remix,originals:$('sourceMode').value==='new'?images.original:[]});}
$('importForm').onsubmit=async e=>{
 e.preventDefault();if(busy||done||pendingImages)return;
 try{if(!session)session=createPhotoImportSession(collect(),{request,upload,progress:text=>status(text)});}catch(error){status(error.message,true);return;}
 busy=true;$('importFields').disabled=true;$('saveImport').disabled=true;$('saveImport').textContent='正在保存…';
 try{
  const result=await session.run();done=true;$('importForm').hidden=true;$('importResult').hidden=false;$('resultSummary').textContent='已保存「'+result.title+'」· 版本 '+result.version+' · '+result.frameCount+' 张图片。已回读核对，版本保持停用。';
  $('openImported').href=PAGE+'/detail?id='+encodeURIComponent(result.id)+'&version='+result.version;$('importAnother').href=PAGE+'/import?source='+encodeURIComponent(result.id);$('importResult').scrollIntoView({block:'center'});
 }catch(error){status(error.message+'\n本次内容已固定；请保留当前页面，重试会继续保存并核对，不会重复新建。',true);$('saveImport').textContent='重试保存并核对';if(session.sourceId){$('partialRecord').hidden=false;$('partialRecord').href=PAGE+'/recreations?id='+encodeURIComponent(session.sourceId);$('partialRecord').target='_blank';$('partialRecord').rel='noopener';}}
 finally{busy=false;$('saveImport').disabled=done;}
};
window.addEventListener('beforeunload',e=>{if((session&&!done)||busy){e.preventDefault();e.returnValue='';}});
async function start(){
 const id=new URLSearchParams(location.search).get('source');if(id){
  $('sourceMode').value='existing';searchPage=1;sourceMode();
  try{const data=await request('/'+encodeURIComponent(id));$('existingSource').add(new Option(data.source.title+' · '+data.source.externalId,id));$('existingSource').value=id;await showSelectedSource();}catch(e){$('sourceLookupStatus').textContent=e.message;}
 }else sourceMode();
}
start();