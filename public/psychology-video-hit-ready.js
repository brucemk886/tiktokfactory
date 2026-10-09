import {mountVideoPosters} from './psychology-video-posters.js';
export function mountReadyHits(){
 const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const root=$('readyLibrary'),posters=mountVideoPosters(root);let page=1,rows=[],canPublish=false,more=false,requestId=0,controller,lastSignature='',query='',importer='',kind='all',imageIndex=0,previewRow=null;
 root.hidden=false;
 const detail=r=>'/psychology-video-hits/detail?id='+r.ref.sourceId+'&version='+r.ref.version;
 const publish=(r,type,mode='normal')=>'/psychology-publish?create='+mode+'&readySource='+r.ref.sourceId+'&readyVersion='+r.ref.version+'&readyRevision='+r.ref.revision+'&readyType='+type;
 function render(){
  $('readyCards').innerHTML=rows.map((r,i)=>{
   const photo=r.canPhoto&&kind!=='video';
   const cover=photo?'<button class="vr-photo-cover" data-preview="'+i+'" aria-label="预览图文：'+esc(r.title)+'"><img src="'+esc(r.frames[0].previewUrl)+'" alt="'+esc(r.title)+' · 第1张" loading="lazy" referrerpolicy="no-referrer"><span>'+r.frames.length+' 张图片 · 点击预览</span></button>':'<div class="vr-player"><video controls playsinline preload="none" src="'+esc(r.previewUrl)+'" data-cover-src="'+esc(r.previewUrl)+'" aria-label="预览 '+esc(r.title)+'"></video><span class="video-cover-status" role="status">读取封面…</span><button type="button" class="video-cover-button" aria-label="播放视频预览" hidden><img alt="成片封面"><span aria-hidden="true">▶</span></button></div>';
   return '<article class="vr-card">'+cover+'<div class="vr-card-body"><div class="vr-badges">'+(r.canPhoto?'<span>图文 · '+r.frames.length+' 张</span>':'')+(r.canVideo?'<span>视频成片</span>':'')+'<span class="vr-ready">待发布</span></div><h3>'+esc(r.title)+'</h3><p class="vr-provenance">'+esc(r.importSource)+' · '+esc(r.ownerUsername||'未知用户')+' · '+esc(r.name)+'</p><details class="vr-caption"><summary>查看发布文案</summary><p>'+esc(r.caption)+'</p></details><div class="vr-card-actions">'+(canPublish?(r.canPhoto?'<a class="vr-primary" href="'+publish(r,'photo')+'">创建图文任务</a>':'')+(r.canVideo?'<a class="vr-primary" href="'+publish(r,'video')+'">创建视频任务</a>':''):'<span class="vh-note">需要心理学发布权限才能创建任务</span>')+'</div><div class="vr-secondary"><a href="'+detail(r)+'">查看二创详情</a>'+(photo&&r.canVideo?'<button data-preview-video="'+i+'">播放成片</button>':'')+(canPublish&&r.canVideo?'<a href="'+publish(r,'video','one')+'">TikTok One 发布</a>':'')+'</div></div></article>';
  }).join('')||'<div class="vr-empty"><strong>暂无符合条件的待发布素材</strong><p>仅展示已启用、素材齐全且未提交发布的二创。可调整筛选，或到来源管理补齐并启用版本。</p><a href="/psychology-video-hits?view=sources">查看来源管理 →</a></div>';
  posters.refresh();
 }
 async function load(){
  const seq=++requestId;controller?.abort();controller=new AbortController();$('readyStatus').textContent='正在读取待发布素材…';$('readyPrev').disabled=true;$('readyNext').disabled=true;
  try{
   const response=await fetch('/api/psychology-video-hits/ready?'+new URLSearchParams({page,mediaType:kind,q:query,importSource:importer}),{cache:'no-store',signal:controller.signal}),data=await response.json();if(!response.ok)throw Error(data.error||'待发布素材读取失败');if(seq!==requestId)return;
   if(page>Math.max(1,Math.ceil(data.total/data.pageSize))){page=1;return load();}
   rows=data.items;canPublish=data.canPublish;more=data.hasMore;
   for(const [k,value] of Object.entries({all:data.counts.total,photo:data.counts.photos,video:data.counts.videos}))$('readyCount-'+k).textContent=value;
   const signature=JSON.stringify([rows,canPublish,kind]);if(signature!==lastSignature){lastSignature=signature;render();}
   $('readyStatus').textContent='当前筛选共 '+data.total+' 个待发布版本 · 已排除已发布、已提交任务和未准备好的内容';$('readyPage').textContent='第 '+(data.total?page:0)+' / '+Math.ceil(data.total/data.pageSize)+' 页';
  }catch(e){if(seq!==requestId||e.name==='AbortError')return;$('readyStatus').textContent=e.message;rows=[];more=false;lastSignature='';$('readyCards').innerHTML='<div class="vr-empty">读取失败，请点击刷新重试。</div>';for(const k of ['all','photo','video'])$('readyCount-'+k).textContent='—';}
  finally{if(seq===requestId){$('readyPrev').disabled=page<=1;$('readyNext').disabled=!more;}}
 }
 function showPhoto(){const frame=previewRow.frames[imageIndex];$('readyPreviewImage').src=frame.previewUrl;$('readyPreviewImage').alt=previewRow.title+' · 第 '+(imageIndex+1)+' 张';$('readyPreviewText').textContent=frame.text||'';$('readyPreviewPosition').textContent=(imageIndex+1)+' / '+previewRow.frames.length;$('readyImagePrev').disabled=imageIndex===0;$('readyImageNext').disabled=imageIndex===previewRow.frames.length-1;}
 function preview(row,video){previewRow=row;imageIndex=0;$('readyPreviewTitle').textContent=row.title;$('readyPreviewCaption').textContent=row.caption;$('readyPreviewPhotos').hidden=video;$('readyPreviewVideo').hidden=!video;if(video)$('readyPreviewVideo').src=row.previewUrl;else showPhoto();$('readyPreviewDialog').showModal();}
 $('readyCards').onclick=e=>{const image=e.target.closest('[data-preview]'),video=e.target.closest('[data-preview-video]');if(image)preview(rows[Number(image.dataset.preview)],false);if(video)preview(rows[Number(video.dataset.previewVideo)],true);};
 $('readyClosePreview').onclick=()=>$('readyPreviewDialog').close();$('readyPreviewDialog').addEventListener('close',()=>{$('readyPreviewVideo').pause();$('readyPreviewVideo').removeAttribute('src');$('readyPreviewImage').removeAttribute('src');});
 $('readyImagePrev').onclick=()=>{if(imageIndex>0){imageIndex--;showPhoto();}};$('readyImageNext').onclick=()=>{if(imageIndex<previewRow.frames.length-1){imageIndex++;showPhoto();}};
 $('readyFilters').onsubmit=e=>{e.preventDefault();query=$('readyQuery').value.trim();importer=$('readyImporter').value.trim();page=1;load();};
 $('readyTypes').onclick=e=>{const b=e.target.closest('[data-ready-type]');if(!b)return;kind=b.dataset.readyType;page=1;for(const n of $('readyTypes').querySelectorAll('button'))n.setAttribute('aria-pressed',String(n===b));load();};
 $('readyRefresh').onclick=()=>{posters.retryFailures();load();};$('readyPrev').onclick=()=>{page--;load();};$('readyNext').onclick=()=>{page++;load();};
 root.addEventListener('play',e=>{if(e.target.tagName==='VIDEO')root.querySelectorAll('video').forEach(v=>{if(v!==e.target)v.pause();});},true);
 window.addEventListener('pageshow',e=>{if(e.persisted)load();});document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
 load();
}
