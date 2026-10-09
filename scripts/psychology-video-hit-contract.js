// Shared import/render validation; no provider calls.
export const VIDEO_HIT_MAX_FRAMES=300;
export const VIDEO_HIT_MAX_VERSIONS=20;
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
export function object(value){return value&&typeof value==='object'&&!Array.isArray(value);}
export function only(input,keys){if(!object(input)||Object.keys(input).some(key=>!keys.includes(key)))fail('对象格式错误或包含未知字段。');}
export function text(value,name,max,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail(name+'无效，最多'+max+'字。');return value.trim();}
export function versionNumber(value,original=false){if(!Number.isInteger(value)||value<(original?0:1)||value>20)fail('版本编号须为'+(original?'0（原图）或':'')+'1–20。');return value;}
export function imageUrl(value){
 const valueText=text(value,'图片链接',2000,true);let url;try{url=new URL(valueText);}catch{fail('图片链接无效。');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.includes('.')||/^\[|^[\d.]+$/.test(url.hostname)||/(^|\.)(localhost|local|internal|test|invalid|example)$/.test(url.hostname))fail('图片须使用公开 HTTPS 域名链接。');
 return url.href;
}
export function importSource(value){
 if(typeof value!=='string')fail('importSource 须为智能体标识。');
 const name=value.trim().toLowerCase();
 if(!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name))fail('importSource 须为1–64位字母、数字、点、下划线或连字符，以字母或数字开头。');
 return name;
}
export function sourceInput(input){
 only(input,['requestId','revision','externalId','videoUrl','title','caption','script','videoData','importSource']);
 const result={};
 if(input.importSource!==undefined)result.importSource=importSource(input.importSource);
 if(input.externalId!==undefined)result.externalId=text(input.externalId,'来源编号',100,true);
 if(input.videoUrl!==undefined){let url;try{url=new URL(input.videoUrl);}catch{fail('视频链接无效。');}if(url.protocol!=='https:'||url.username||url.password||!/(^|\.)tiktok\.com$/i.test(url.hostname))fail('请输入 TikTok HTTPS 视频链接。');result.videoUrl=url.href;}
 for(const [key,max] of [['title',200],['caption',2200],['script',20000]])if(input[key]!==undefined)result[key]=text(input[key],key,max,key==='title');
 if(input.videoData!==undefined){if(!object(input.videoData)||JSON.stringify(input.videoData).length>16000)fail('视频数据须为最多16KB的 JSON 对象。');result.videoData=input.videoData;}
 return result;
}
export function versionInput(input){
 only(input,['requestId','revision','name','title','caption','script','enabled','inputMode','videoAssetId']);
 const result={};
 if(input.inputMode!==undefined){if(!['frames','video'].includes(input.inputMode))fail('inputMode须为frames或video。');result.inputMode=input.inputMode;}
 if(input.videoAssetId!==undefined){if(input.videoAssetId!==''&&!UUID.test(input.videoAssetId))fail('成片素材编号须为UUID。');result.videoAssetId=input.videoAssetId;}
 for(const [key,max] of [['name',100],['title',200],['caption',2200],['script',20000]])if(input[key]!==undefined)result[key]=text(input[key],key,max,['name','title'].includes(key));
 if(input.enabled!==undefined){if(typeof input.enabled!=='boolean')fail('enabled 须为布尔值。');result.enabled=input.enabled;}return result;
}
export function framesInput(input){
 only(input,['requestId','revision','frames']);
 if(!Array.isArray(input.frames)||!input.frames.length||input.frames.length>100)fail('每次写入1–100帧，可分批补充至300帧。');
 const result=input.frames.map(frame=>{
  only(frame,['index','assetId','imageUrl','text','durationSeconds']);
  if(!Number.isInteger(frame.index)||frame.index<1||frame.index>VIDEO_HIT_MAX_FRAMES)fail('帧编号须为1–300。');
  const assetId=frame.assetId===undefined?'':text(frame.assetId,'素材编号',36);
  const url=frame.imageUrl===undefined?'':imageUrl(frame.imageUrl);
  if((!assetId&&!url)||(assetId&&url)||(assetId&&!UUID.test(assetId)))fail('每帧只能填写 assetId 或 imageUrl 之一。');
  const durationSeconds=frame.durationSeconds??3;
  if(typeof durationSeconds!=='number'||!Number.isFinite(durationSeconds)||durationSeconds<0.04||durationSeconds>60)fail('每帧时长须为0.04–60秒。');
  return {index:frame.index,assetId,imageUrl:url,text:frame.text===undefined?'':text(frame.text,'帧文字',1500),durationSeconds};
 });
 if(new Set(result.map(f=>f.index)).size!==result.length)fail('同一请求不能重复帧编号。');return result;
}
export function completeVersion(sourceFrames,frames,version){
 if(!version.script?.trim()||!version.title?.trim())fail('启用前请填写二创标题和完整配音文案。',409);
 if(!sourceFrames.length||sourceFrames.length!==frames.length||frames.some((f,i)=>f.index!==i+1||sourceFrames[i].index!==f.index||(!f.assetId&&!f.imageUrl)))fail('请补齐原图及每帧对应的二创图片，帧序从1连续编号。',409);
 const duration=frames.reduce((sum,f)=>sum+f.durationSeconds,0);if(duration>1800)fail('分镜总时长最多30分钟。',409);
 return frames;
}
