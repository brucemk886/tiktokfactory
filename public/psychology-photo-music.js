import {PHOTO_MUSIC_LIBRARY} from './psychology-photo-music-library.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountPhotoMusic(root,{selected=[],changed=()=>{},isBusy=()=>false}={}){
 if(!root)return {ids:()=>[]};
 const known=new Set(PHOTO_MUSIC_LIBRARY.map(t=>t.id));
 // Retain previously explicit API selections in automation settings, even outside the presets.
 const extras=[...new Set(selected)].filter(id=>!known.has(id)&&/^\d{1,30}$/.test(id)).map(id=>({id,name:'已保存音乐 ID '+id,artist:'自定义音乐',group:'已保存'}));
 const tracks=[...PHOTO_MUSIC_LIBRARY,...extras],chosen=new Set(selected);
 root.classList.add('photo-music');
 root.innerHTML='<div class="photo-music-heading"><label class="photo-music-toggle"><input type="checkbox" data-music-pool>使用图文音乐池 <span>已确认 '+PHOTO_MUSIC_LIBRARY.length+' 首</span></label><span data-music-count role="status" aria-live="polite"></span></div><p class="photo-music-help">默认不启用。勾选后每条图文从所选音乐中随机抽一首，允许重复；任务创建后固定，重试不重抽。不选则由 TikTok 推荐配乐。</p><details><summary>试听 / 调整曲目</summary><div class="photo-music-list">'+tracks.map(t=>'<article class="photo-music-track"><label><input type="checkbox" data-music-id="'+esc(t.id)+'" '+(chosen.has(t.id)?'checked':'')+'><span><b>'+esc(t.name)+'</b><small>'+esc(t.artist)+' · '+esc(t.group)+'</small></span></label>'+(t.previewUrl?'<audio controls preload="none" src="'+esc(t.previewUrl)+'" aria-label="试听 '+esc(t.name)+'"></audio>':'')+'</article>').join('')+'</div></details>';
 const boxes=()=>[...root.querySelectorAll('[data-music-id]')],master=root.querySelector('[data-music-pool]');
 const ids=()=>boxes().filter(n=>n.checked).map(n=>n.dataset.musicId);
 function sync(){const count=ids().length;master.checked=count===tracks.length;master.indeterminate=count>0&&count<tracks.length;root.querySelector('[data-music-count]').textContent=count?'已选 '+count+' 首 · 每条随机 1 首':'未启用 · TikTok 推荐配乐';}
 root.addEventListener('change',e=>{if(isBusy())return;if(e.target===master)boxes().forEach(n=>n.checked=master.checked);if(e.target===master||e.target.matches('[data-music-id]')){sync();changed();}});
 root.addEventListener('play',e=>{if(e.target.tagName==='AUDIO')root.querySelectorAll('audio').forEach(a=>{if(a!==e.target)a.pause();});},true);
 sync();return {ids};
}
