import {Buffer} from 'node:buffer';
import {openPhotoImageConverter} from './psychology-cloud-renderer.js';
export async function runHitPhoto(env,job,call,deps={}){
 const payload=JSON.parse(job.payload_json),started=Date.now();
 if(!Array.isArray(payload.pages)||payload.pages.length<1||payload.pages.length>35)throw Error('每条二创图文需要 1–35 张图片。');
 const state=await call('state');if(state.receipt?.batchId)return {publishSummary:state.receipt};
 let converter,browserMs=0,uploaded=0;
 try{for(let index=0;index<payload.pages.length;index++){
  if(state.assets[index])continue;
  const current=await env.DB.prepare('SELECT status,worker_id FROM factory_jobs WHERE id=?').bind(job.id).first();if(current?.status!=='running'||current.worker_id!==job.worker_id)throw Error('任务已取消或执行权已变更。');
  if(!await env.DB.prepare('SELECT id FROM psychology_publish_items WHERE job_id=? AND deleted_at=0').bind(job.id).first())throw Error('发布任务已删除。');
  const response=await call('image/'+index),bytes=await response.arrayBuffer(),type=response.headers.get('content-type');
  if(!['image/png','image/jpeg','image/webp'].includes(type)||!bytes.byteLength||bytes.byteLength>8*1024*1024)throw Error('二创图片类型或大小无效。');
  let dataUrl='data:'+type+';base64,'+Buffer.from(bytes).toString('base64');
  if(type==='image/png'){converter||=await (deps.openConverter||openPhotoImageConverter)(env);dataUrl=await converter.convert(dataUrl);}
  await call('upload',{index,dataUrl});uploaded++;
  await env.DB.prepare("UPDATE factory_jobs SET percent=?,message=?,updated_at=? WHERE id=? AND status='running' AND worker_id=?").bind(Math.round(20+60*(index+1)/payload.pages.length),'已上传二创图片 '+(index+1)+' / '+payload.pages.length,Date.now(),job.id,job.worker_id).run();
 }}finally{if(converter)browserMs=await converter.close();}
 await call('state');const receipt=await call('publish',{});
 return {execution:'saved-hit-photos',browserMs,uploadedImages:uploaded,elapsedMs:Date.now()-started,groupReady:!receipt.batchId,publishSummary:receipt,results:[]};
}
