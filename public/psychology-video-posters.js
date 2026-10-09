// Private previews stay in this page's memory; no thumbnail upload or persistent cache.
export function mountVideoPosters(root){
 const cache=new Map(),pending=[],running=new Set();let epoch=0;
 const videos=()=>[...root.querySelectorAll('video[data-cover-src]')];
 const needed=()=>new Set(videos().map(v=>v.dataset.coverSrc));
 function show(video,entry){
  if(entry.poster&&video.poster!==entry.poster)video.poster=entry.poster;
  const cover=video.parentElement.querySelector('.video-cover-button');
  if(cover&&entry.poster){cover.querySelector('img').src=entry.poster;cover.hidden=video.played.length>0||!video.paused;}
  video.dataset.coverState=entry.poster?'ready':entry.state==='failed'?'failed':'loading';
  const hint=video.parentElement.querySelector('.video-cover-status');
  if(hint){hint.hidden=Boolean(entry.poster)||!video.paused;hint.textContent=entry.state==='failed'?'封面暂不可用，仍可点击播放':'读取封面…';}
 }
 function apply(url,entry){for(const video of videos())if(video.dataset.coverSrc===url)show(video,entry);}
 function trim(){
  const keep=needed();for(const [url,entry] of cache){if(cache.size<=40)break;if(keep.has(url)||entry.state==='loading')continue;if(entry.poster)URL.revokeObjectURL(entry.poster);cache.delete(url);}
 }
 function pump(){
  while(running.size<2&&pending.length){
   const [url,entry]=pending.shift();if(cache.get(url)!==entry)continue;
   if(!needed().has(url)){cache.delete(url);continue;}
   const controller=new AbortController(),started=epoch;running.add(controller);entry.state='loading';
   captureFrame(url,controller.signal).then(blob=>{
    if(started!==epoch||cache.get(url)!==entry)return;
    entry.poster=URL.createObjectURL(blob);entry.state='ready';apply(url,entry);trim();
   }).catch(()=>{if(started===epoch&&cache.get(url)===entry){entry.state='failed';apply(url,entry);}})
    .finally(()=>{running.delete(controller);pump();});
  }
 }
 function request(video){
  if(!video.isConnected||!root.contains(video))return;
  const url=video.dataset.coverSrc;let entry=cache.get(url);
  if(entry){cache.delete(url);cache.set(url,entry);show(video,entry);return;}
  entry={state:'queued'};cache.set(url,entry);pending.push([url,entry]);show(video,entry);pump();trim();
 }
 const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);request(entry.target);}},{rootMargin:'180px 0px'});
 function refresh(){
  observer.disconnect();
  for(const video of videos()){
   const entry=cache.get(video.dataset.coverSrc);
   if(entry)show(video,entry);else observer.observe(video);
  }
  trim();
 }
 function pause(){
  epoch++;observer.disconnect();pending.length=0;for(const c of running)c.abort();
  for(const [url,entry] of cache)if(!entry.poster&&entry.state!=='failed')cache.delete(url);
 }
 function clear(){pause();for(const entry of cache.values())if(entry.poster)URL.revokeObjectURL(entry.poster);cache.clear();for(const video of videos()){video.removeAttribute('poster');const cover=video.parentElement.querySelector('.video-cover-button');if(cover){cover.hidden=true;cover.querySelector('img').removeAttribute('src');}}}
 root.addEventListener('click',event=>{const cover=event.target.closest('.video-cover-button');if(!cover)return;const video=cover.parentElement.querySelector('video');cover.hidden=true;video.play().catch(()=>{const hint=video.parentElement.querySelector('.video-cover-status');if(hint){hint.hidden=false;hint.textContent='视频暂不可播放，请刷新后重试';}});});
 root.addEventListener('play',event=>{if(event.target.matches('video[data-cover-src]')){const cover=event.target.parentElement.querySelector('.video-cover-button');if(cover)cover.hidden=true;const hint=event.target.parentElement.querySelector('.video-cover-status');if(hint)hint.hidden=true;}},true);
 window.addEventListener('pagehide',clear);window.addEventListener('pageshow',refresh);
 return {refresh,pause,retryFailures(){for(const [url,entry] of cache)if(entry.state==='failed')cache.delete(url);}};
}
function captureFrame(url,signal){
 return new Promise((resolve,reject)=>{
  const video=document.createElement('video');let settled=false,capturing=false;
  video.preload='metadata';video.muted=true;video.playsInline=true;
  function finish(error,blob){
   if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
   video.onloadedmetadata=video.onseeked=video.onerror=null;video.removeAttribute('src');video.load();
   if(error)reject(error);else resolve(blob);
  }
  const abort=()=>finish(new Error('Preview cancelled'));
  const timer=setTimeout(()=>finish(new Error('Preview timed out')),15000);
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted){abort();return;}
  video.onerror=()=>finish(new Error('Preview unavailable'));
  video.onloadedmetadata=()=>{
   if(!Number.isFinite(video.duration)||video.duration<=0){finish(new Error('Invalid video duration'));return;}
   // Seek into the opening frame without playing or producing sound.
   video.currentTime=Math.min(0.5,video.duration/2);
  };
  video.onseeked=()=>{
   if(settled||capturing)return;capturing=true;
   try{
    if(!video.videoWidth||!video.videoHeight)throw new Error('Missing video frame');
    const scale=Math.min(1,360/Math.max(video.videoWidth,video.videoHeight)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
    canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    canvas.toBlob(blob=>blob?finish(null,blob):finish(new Error('Missing preview image')),'image/jpeg',0.78);
   }catch(error){finish(error);}
  };
  video.src=url;video.load();
 });
}
