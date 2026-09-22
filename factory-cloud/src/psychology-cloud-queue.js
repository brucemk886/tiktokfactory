import { Buffer } from 'node:buffer';
import { handleAutoPhotoWorker } from './psychology-auto-photo.js';
import { assertAutoJobAccess } from './psychology-auto-publish.js';
import { finishPsychologyPublishAttempt } from './psychology-publish-retries.js';
import { dispatchPublishGroup } from './psychology-publish-groups.js';
import { loadCardModules, openCloudCardRenderer } from './psychology-cloud-renderer.js';

const parse = value => JSON.parse(value || '{}');
const CLOUD = "json_extract(payload_json,'$.cloudPhotoRender')=1";
const LEASE_MS = 20 * 60000; // Longer than Queues' maximum consumer wall time.
// Uploading the pages, not drawing them, dominates this stage.
const UPLOAD_CONCURRENCY = 3;

export async function dispatchCloudPhotos(env) {
  if (!env.PHOTO_QUEUE) return {sent:0};
  const stamp = Date.now();
  // A dead consumer releases no slot: expired jobs resume their persisted checkpoints.
  const abandoned = await env.DB.prepare(`SELECT * FROM factory_jobs WHERE ${CLOUD} AND
    ((status='running' AND cloud_lease_until>0 AND cloud_lease_until<?) OR (status='failed' AND cloud_lease_until>0)) LIMIT 20`).bind(stamp).all();
  for (const job of abandoned.results) {
    const changed = await env.DB.prepare("UPDATE factory_jobs SET status='failed',error=?,message='云端执行中断',updated_at=? WHERE id=? AND worker_id=? AND status IN ('running','failed') AND cloud_lease_until>0")
      .bind(job.error || '云端执行超时，恢复已保存的图片后重试。',stamp,job.id,job.worker_id).run();
    if (changed.meta?.changes) {
      await finishPsychologyPublishAttempt(env.DB,{...job,status:'failed'},job.error || '云端执行超时');
      await env.DB.prepare('UPDATE factory_jobs SET cloud_lease_until=0 WHERE id=? AND worker_id=?').bind(job.id,job.worker_id).run();
    }
  }
  const rows = await env.DB.prepare(`SELECT id FROM factory_jobs WHERE ${CLOUD} AND status='queued'
    AND available_at<=? AND cloud_dispatch_at<? ORDER BY created_at LIMIT 100`).bind(stamp,stamp-300000).all();
  let sent=0;
  for (const row of rows.results) {
    const changed=await env.DB.prepare("UPDATE factory_jobs SET cloud_dispatch_at=? WHERE id=? AND status='queued' AND cloud_dispatch_at<?")
      .bind(stamp,row.id,stamp-300000).run();
    if(!changed.meta?.changes)continue;
    try { await env.PHOTO_QUEUE.send({jobId:row.id}); sent++; }
    catch(error) {
      await env.DB.prepare('UPDATE factory_jobs SET cloud_dispatch_at=0 WHERE id=? AND cloud_dispatch_at=?').bind(row.id,stamp).run();
      throw error;
    }
  }
  return {sent};
}

async function photoCall(env, job, action, body) {
  const url=new URL('https://internal.invalid/api/worker/psychology-auto/'+encodeURIComponent(job.id)+'/'+action);
  const request=new Request(url,{method:body?'POST':'GET',headers:{'x-factory-worker':job.worker_id,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const response=await handleAutoPhotoWorker(request,env,url);
  if(!response?.ok)throw new Error('云端图文处理失败：'+await response?.text());
  return action.startsWith('image/')?response:response.json();
}

export async function runCloudPhoto(env, job, deps={}) {
  const payload=parse(job.payload_json),started=Date.now();
  if(!Array.isArray(payload.pages)||payload.pages.length<1||payload.pages.length>6)throw new Error('图文必须包含 1–6 张图片。');
  const call=deps.call || ((action,body)=>photoCall(env,job,action,body));
  const state=await call('state');
  if(state.receipt?.batchId)return {publishSummary:state.receipt};
  const pending=payload.pages.map((source,index)=>({source,index})).filter(({index})=>!state.assets[index]);
  const backgrounds=new Map();let backgroundBytes=0;
  // Downloads happen before opening Chrome. The existing proxy checks allowed hosts and size.
  for(const {source,index} of pending) {
    if(source.template==='stock'&&payload.psychologyAutomation.template!=='photo-text') {
      const response=await call('image/'+index);
      const bytes=await response.arrayBuffer();
      backgroundBytes+=bytes.byteLength;
      if(bytes.byteLength>4*1024*1024||backgroundBytes>12*1024*1024)throw new Error('素材底图过大，请使用压缩后的素材。');
      backgrounds.set(index,'data:'+response.headers.get('content-type')+';base64,'+Buffer.from(bytes).toString('base64'));
    }
  }
  let browserMs=0,rendered=0;
  if(pending.length) {
    const sources=await (deps.loadModules || loadCardModules)(env);
    const renderer=await (deps.openRenderer || openCloudCardRenderer)(env,sources);
    let images;
    try {
      images=await renderer.renderBatch(pending.map(({source,index})=>({source,index,template:payload.psychologyAutomation.template,imageData:backgrounds.get(index)||''})));
    } finally { browserMs=await renderer.close();backgrounds.clear(); }
    if(images.length!==pending.length)throw new Error('云端图片生成不完整。');
    // Pages go up a few at a time. Chrome is already closed, so the hub round
    // trips never extend billable browser time.
    for(let start=0;start<pending.length;start+=UPLOAD_CONCURRENCY) {
      const wave=pending.slice(start,start+UPLOAD_CONCURRENCY);
      const current=await env.DB.prepare('SELECT status,worker_id FROM factory_jobs WHERE id=?').bind(job.id).first();
      if(current?.status!=='running'||current.worker_id!==job.worker_id)throw new Error('任务已取消或执行权已变更。');
      if(!await env.DB.prepare('SELECT id FROM psychology_publish_items WHERE job_id=? AND deleted_at=0').bind(job.id).first())throw new Error('自动发布任务已删除。');
      await Promise.all(wave.map(async ({index},offset)=>{
        const position=start+offset;
        await call('upload',{index,dataUrl:images[position]});
        images[position]='';
      }));
      rendered+=wave.length;
      await env.DB.prepare("UPDATE factory_jobs SET percent=?,message=?,updated_at=? WHERE id=? AND status='running' AND worker_id=?")
        .bind(Math.round(20+60*rendered/payload.pages.length),`云端已生成并上传 ${rendered}/${payload.pages.length} 张图片`,Date.now(),job.id,job.worker_id).run();
    }
  }
  // A resumed job can still hold backups with no asset yet; state uploads those.
  await call('state');
  const receipt=await call('publish',{});
  return {execution:'cloud-browser',browserMs,renderedImages:rendered,elapsedMs:Date.now()-started,
    groupReady:!receipt.batchId,publishSummary:receipt,results:[]};
}

export async function processCloudMessage(env, message, deps={}) {
  const id=String(message.body?.jobId || '');
  let job=await env.DB.prepare('SELECT * FROM factory_jobs WHERE id=?').bind(id).first();
  if(!job||!parse(job.payload_json).cloudPhotoRender||!['queued','running'].includes(job.status)){message.ack();return;}
  if(job.status==='running'){message.ack();return;} // Lease owner or watchdog is responsible.
  if(job.available_at>Date.now()){message.retry({delaySeconds:Math.max(1,Math.ceil((job.available_at-Date.now())/1000))});return;}
  const owner='cloud-photo-'+crypto.randomUUID(),stamp=Date.now();
  const claimed=await env.DB.prepare(`UPDATE factory_jobs SET status='running',worker_id=?,claimed_at=?,cloud_lease_until=?,updated_at=?,message='云端正在处理图文任务' WHERE id=? AND status='queued' AND available_at<=? AND ${CLOUD}`)
    .bind(owner,stamp,stamp+LEASE_MS,stamp,id,stamp).run();
  if(!claimed.meta?.changes){message.ack();return;}
  job={...job,status:'running',worker_id:owner};
  try {
    const payload=parse(job.payload_json);
    let result;
    if(payload.psychologySubmission){
      result=await (deps.dispatchGroup || dispatchPublishGroup)(env,payload.psychologySubmission.groupId);
      if(result?.waiting&&!result.recovering){
        await env.DB.prepare("UPDATE factory_jobs SET status='queued',available_at=?,cloud_lease_until=0 WHERE id=? AND status='running' AND worker_id=?").bind(Date.now()+30000,id,owner).run();
      }
    }
    else {
      await (deps.assertAccess || assertAutoJobAccess)(env,job);
      result=await (deps.runPhoto || runCloudPhoto)(env,job);
    }
    await env.DB.prepare("UPDATE factory_jobs SET status='done',percent=100,message=?,result_json=?,error='',completed_at=?,updated_at=?,cloud_lease_until=0 WHERE id=? AND status='running' AND worker_id=?")
      .bind(result?.groupReady?'云端图片已上传，等待同组内容就绪':'云端图文处理完成',JSON.stringify(result||{}),Date.now(),Date.now(),id,owner).run();
    console.info(JSON.stringify({event:'psychology-cloud-photo-complete',jobId:id,browserMs:result?.browserMs,renderedImages:result?.renderedImages,elapsedMs:result?.elapsedMs}));
  } catch(error) {
    const diagnostic=String(error.message||error).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,4000);
    const changed=await env.DB.prepare("UPDATE factory_jobs SET status='failed',error=?,message='云端图文执行失败',updated_at=? WHERE id=? AND status='running' AND worker_id=?")
      .bind(diagnostic,Date.now(),id,owner).run();
    if(changed.meta?.changes) {
      await (deps.finishAttempt || finishPsychologyPublishAttempt)(env.DB,{...job,status:'failed'},error);
      await env.DB.prepare('UPDATE factory_jobs SET cloud_lease_until=0 WHERE id=? AND worker_id=?').bind(id,owner).run();
    }
    console.error(JSON.stringify({event:'psychology-cloud-photo-failed',jobId:id,error:diagnostic}));
  }
  const current=await env.DB.prepare('SELECT status,available_at FROM factory_jobs WHERE id=?').bind(id).first();
  if(current?.status==='queued')message.retry({delaySeconds:Math.max(1,Math.ceil((current.available_at-Date.now())/1000))});
  else message.ack();
}

export async function consumeCloudPhotos(batch,env) {
  for(const message of batch.messages)await processCloudMessage(env,message);
  // Also wakes group submission retries created by the final upload.
  await dispatchCloudPhotos(env);
}
