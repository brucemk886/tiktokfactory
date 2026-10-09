// Session-authenticated material import only. No enabling, rendering or publishing operations.
const required=(value,label,max)=>{const s=String(value??'').trim();if(!s||s.length>max)throw new Error(label+'必填，最多 '+max+' 字。');return s;};
const optional=(value,label,max)=>{const s=String(value??'').trim();if(s.length>max)throw new Error(label+'最多 '+max+' 字。');return s;};
export function normalizeImportImage(image){
 const result={...image,text:optional(image.text,'图片文字',1500)};
 if(image.file){
  const type=image.file.type||({'png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','webp':'image/webp'}[image.file.name.split('.').pop().toLowerCase()]);
  if(!['image/png','image/jpeg','image/webp'].includes(type)||!image.file.size||image.file.size>8*1024*1024)throw new Error('请选择不超过 8 MB 的 PNG、JPEG 或 WebP 图片。');
  result.contentType=type;result.imageUrl='';
 }else{
  let url;try{url=new URL(image.imageUrl);}catch{throw new Error('图片链接格式无效。');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.includes('.')||/^\[|^[\d.]+$/.test(url.hostname)||/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(url.hostname))throw new Error('图片链接须为公开 HTTPS 地址。');
  result.imageUrl=url.href;
 }
 return result;
}
export function normalizePhotoImport(input,uuid=()=>crypto.randomUUID()){
 const images=(input.images||[]).map(normalizeImportImage),originals=(input.originals||[]).map(normalizeImportImage);
 if(images.length<1||images.length>15||originals.length>15)throw new Error('每套图文请选择 1–15 张二创图片；原图最多 15 张。');
 const version={title:required(input.title,'二创标题',200),name:optional(input.name,'版本名称',100),caption:optional(input.caption,'发布文案',2200),script:optional(input.script,'配音文案',20000),inputMode:'frames',enabled:false};
 if(input.sourceMode==='existing'){
  if(!/^vh-[a-f0-9]{32}$/.test(input.sourceId||''))throw new Error('请先选择已有选题。');
  if(originals.length)throw new Error('已有选题的原图请在详情中维护。');
  return {sourceId:input.sourceId,version,images,originals:[]};
 }
 if(input.sourceMode!=='new')throw new Error('请选择选题来源。');
 let url;try{url=new URL(input.videoUrl);}catch{throw new Error('请填写原 TikTok 链接。');}
 if(url.protocol!=='https:'||url.username||url.password||!/(^|\.)tiktok\.com$/i.test(url.hostname))throw new Error('请填写 TikTok HTTPS 链接。');
 const importSource=required(input.importSource,'导入来源',64).toLowerCase();if(!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(importSource))throw new Error('导入来源仅支持字母、数字、点、下划线和连字符。');
 const source={externalId:optional(input.externalId,'来源编号',100)||'page-'+uuid(),importSource,videoUrl:url.href,title:required(input.originalTitle,'原选题标题',200),caption:optional(input.originalCaption,'原发布文案',2200),script:optional(input.originalScript,'完整原文',20000)};
 return {source,version,images,originals};
}
export function createPhotoImportSession(input,{request,upload,uuid=()=>crypto.randomUUID(),progress=()=>{}}){
 const saved=new Map(),pending=new Map(),assets=new Map();let id=input.sourceId||'',version=0,inflight=null;
 async function step(key,path,method,body){
  if(saved.has(key))return saved.get(key);
  if(!pending.has(key))pending.set(key,{...body,requestId:uuid()});
  const result=await request(path,method,pending.get(key));saved.set(key,result);return result;
 }
 async function uploadFrames(images,prefix){
  const frames=[];
  for(const [i,image] of images.entries()){
   progress('正在上传'+(prefix==='original'?'原图':'二创图片')+' '+(i+1)+' / '+images.length+'…');
   const key=prefix+':'+i;let ref;
   if(image.file){
    if(!pending.has(key))pending.set(key,uuid());
    if(!assets.has(key)){const uploaded=await upload(pending.get(key),image.file,image.contentType);if(!uploaded?.assetId)throw new Error('图片上传未返回素材编号，请重试。');assets.set(key,uploaded);}
    const assetId=assets.get(key)?.assetId;if(!assetId)throw new Error('图片上传未返回素材编号，请重试。');ref={assetId};
   }else ref={imageUrl:image.imageUrl};
   frames.push({index:i+1,...ref,text:image.text,durationSeconds:3});
  }
  return frames;
 }
 async function execute(){
  let parent;
  if(input.sourceId){
   if(!saved.has('parent')){
    parent=await request('/'+id,'GET');
    if(parent.source.archivedAt)throw new Error('该选题已归档，请先在素材库恢复。');
    if(parent.activeVersionCount>=20)throw new Error('该选题已有 20 个未清理版本，请选择其他选题或等待清理。');
    if(!Number.isInteger(parent.nextVersion)||parent.nextVersion<1||parent.nextVersion>2147483647)throw new Error('无法读取可用的二创版本编号。');
    saved.set('parent',parent);
   }else parent=saved.get('parent');
   version=parent.nextVersion;
  }else version=1;
  const frames=await uploadFrames(input.images,'remix'),originals=await uploadFrames(input.originals,'original');
  if(!id){progress('正在保存原选题…');const result=await step('source','','POST',input.source);if(!result.id)throw new Error('保存原选题未返回编号。');id=result.id;}
  if(originals.length){progress('正在保存原图…');await step('originals','/'+id+'/frames/0','PUT',{revision:saved.get('source').revision,frames:originals});}
  progress('正在保存二创文案…');const created=await step('version','/'+id+'/versions/'+version,'PUT',{...input.version,name:input.version.name||'二创图文 '+version,revision:0});
  progress('正在保存二创图片顺序…');await step('frames','/'+id+'/frames/'+version,'PUT',{revision:created.revision,frames});
  progress('正在核对已保存内容…');
  const [readVersion,readFrames]=await Promise.all([request('/'+id+'/versions/'+version,'GET'),request('/'+id+'/frames/'+version+'?page=1','GET')]);
  const v=readVersion.version;
  if(!v||v.inputMode!=='frames'||v.enabled||v.title!==input.version.title||v.caption!==input.version.caption||v.script!==input.version.script||readFrames.total!==frames.length||readFrames.frames.length!==frames.length||readFrames.frames.some((f,i)=>f.index!==frames[i].index||f.text!==frames[i].text||(frames[i].assetId?f.assetId!==frames[i].assetId:f.imageUrl!==frames[i].imageUrl)))throw new Error('内容已提交，但回读结果尚未一致。请保留页面并重试核对。');
  return {id,version,frameCount:frames.length,title:v.title,enabled:false};
 }
 return {get sourceId(){return id;},run(){if(!inflight)inflight=execute().finally(()=>{inflight=null;});return inflight;}};
}