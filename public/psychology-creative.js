import {renderTextCard} from './psychology-card-renderer.js';
const $=s=>document.querySelector(s);
const cover={kind:'cover',title:'When closeness feels like too much',pageNumber:1},inside={kind:'content',title:'',bullets:['Needing space can be a way to feel safe.','Try naming your need without disappearing.'],pageNumber:2};
const styles=new Map();
function cards(container,s,full=false){for(const slide of [cover,inside]){const original=renderTextCard(slide,'3:4',s.id,s);if(full){container.append(original);continue;}const thumb=document.createElement('canvas');thumb.width=216;thumb.height=288;thumb.getContext('2d').drawImage(original,0,0,216,288);original.width=0;container.append(thumb);}}
async function load(){
 const gallery=$('#styleGallery');gallery.textContent='正在读取图文样式…';
 try{
  const response=await fetch('/api/psychology-management/styles',{cache:'no-store'}),data=await response.json();
  if(!response.ok)throw new Error(data.error||'样式读取失败');
  gallery.replaceChildren();
  $('#styleCount').textContent=data.items.length+'套情感心理学样式 · 启用 '+data.active+' 套';
  for(const s of data.items){
   styles.set(s.id,s);const article=document.createElement('article');article.className='style-card';
   const title=document.createElement('h3');title.textContent=s.label+(s.enabled?'':'（已停用）');
   const pair=document.createElement('div');pair.className='style-pair';cards(pair,s);
   const id=document.createElement('small');id.textContent='ID: '+s.id;id.style.overflowWrap='anywhere';
   const button=document.createElement('button');button.type='button';button.dataset.preview=s.id;button.textContent='放大查看';
   article.append(title,pair,id,button);gallery.append(article);
  }
 }catch(error){gallery.textContent=error.message;const retry=document.createElement('button');retry.textContent='重试';retry.onclick=load;gallery.append(retry);}
}
$('#styleGallery').onclick=e=>{const b=e.target.closest('[data-preview]');if(!b)return;const s=styles.get(b.dataset.preview);$('#previewTitle').textContent=s.label;$('#previewCards').replaceChildren();cards($('#previewCards'),s,true);$('#styleDialog').showModal();};
$('#closeStyle').onclick=()=>$('#styleDialog').close();
load();
