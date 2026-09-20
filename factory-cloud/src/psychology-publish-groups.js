import { recoverMissingPhotos, removePhotoBackups } from './psychology-photo-recovery.js';
import { enqueueGroupRetry } from './psychology-publish-retries.js';
import { json, readJson } from './http.js';
import { signalDesk } from './signal-desk.js';
import { assertAutoJobAccess, loadAutoUser } from './psychology-auto-publish.js';
import { assertOfficialPublishAccess } from './official.js';
import { mergeAndStorePublishRecords } from './publish-records-store.js';

export const PSYCHOLOGY_GROUP_SIZE = 20;
const LEASE_MS = 180000;
const parse = value => JSON.parse(value || '{}');
const fail = (message, statusCode=400) => { throw Object.assign(new Error(message),{statusCode}); };

// Groups start at 20 items; unfinished members may be isolated before the remote request is frozen.
export async function stagePublishItem(env, item, ready) {
  await env.DB.prepare("UPDATE psychology_publish_items SET ready_json=? WHERE id=? AND ready_json='{}'")
    .bind(JSON.stringify(ready),item.id).run();
  item=await env.DB.prepare('SELECT * FROM psychology_publish_items WHERE id=?').bind(item.id).first();
  await env.DB.prepare('UPDATE psychology_publish_groups SET ready_at=? WHERE id=? AND ready_at=0').bind(Date.now(),item.publish_group_id).run();
  const retry=await env.DB.prepare("SELECT id FROM factory_jobs WHERE id=? AND status IN ('queued','running')").bind(item.publish_group_id+'-submit').first();
  if(!retry)await dispatchPublishGroup(env,item.publish_group_id);
  const current=await env.DB.prepare('SELECT receipt_json FROM psychology_publish_items WHERE id=?').bind(item.id).first();
  const receipt=parse(current?.receipt_json);
  return receipt.batchId ? receipt : {waiting:true,groupId:item.publish_group_id};
}

export async function dispatchPublishGroup(env,groupId) {
  const db=env.DB;
  let group=await db.prepare('SELECT g.*,b.created_by,b.config_json FROM psychology_publish_groups g JOIN psychology_publish_batches b ON b.id=g.batch_id WHERE g.id=?').bind(groupId).first();
  if(!group)fail('发布分组不存在。',404);
  if(group.status==='submitted')return parse(group.response_json);
  let {results:rows}=await db.prepare('SELECT i.*,j.status AS job_status FROM psychology_publish_items i LEFT JOIN factory_jobs j ON j.id=i.job_id WHERE i.publish_group_id=? ORDER BY i.id').bind(groupId).all();
  if(rows.length!==group.expected_count)return {waiting:true};
  rows=rows.filter(r=>!r.deleted_at);
  if(!rows.length)return {cancelled:true};
  const pending=rows.filter(r=>r.ready_json==='{}');
  const expired=group.ready_at>0&&Date.now()-group.ready_at>=20*60000;
  if(pending.length && (!rows.some(r=>r.ready_json!=='{}') || (!expired&&pending.some(r=>!['failed','cancelled'].includes(r.job_status)))))return {waiting:true};
  if(pending.length&&group.request_json!=='{}')return {waiting:true};
  if(rows.some(r=>r.job_status==='cancelled'&&r.ready_json!=='{}'))fail('组内有已取消内容，请先处理后再提交。',409);
  const stamp=Date.now();
  // A short lease prevents concurrent last-item callbacks from sending the same group.
  const changed=await db.prepare("UPDATE psychology_publish_groups SET status='submitting',error='',updated_at=? WHERE id=? AND status<>'submitted' AND (status<>'submitting' OR updated_at<?)")
    .bind(stamp,groupId,stamp-LEASE_MS).run();
  if(!changed.meta?.changes)return {waiting:true};
  try {
    // Refresh membership after the lease; deletion may have won before it.
    rows=(await db.prepare('SELECT i.*,j.status AS job_status FROM psychology_publish_items i LEFT JOIN factory_jobs j ON j.id=i.job_id WHERE i.publish_group_id=? AND i.deleted_at=0 ORDER BY i.id').bind(groupId).all()).results;
    if(!rows.length){await db.prepare("UPDATE psychology_publish_groups SET status='cancelled',error='' WHERE id=?").bind(groupId).run();return {cancelled:true};}
    if(group.request_json==='{}'&&rows.some(r=>r.ready_json==='{}')){
      // Under the submission lease, move unfinished members to their own groups.
      // Completed members retain their original externalId. No submitted request is changed.
      const statements=[];
      for(const row of rows.filter(r=>r.ready_json==='{}')){
        const id=row.id+'-isolated';
        statements.push(db.prepare("INSERT INTO psychology_publish_groups(id,batch_id,ordinal,expected_count) SELECT ?,?,COALESCE(MAX(ordinal),-1)+1,1 FROM psychology_publish_groups WHERE batch_id=? ON CONFLICT(id) DO NOTHING").bind(id,group.batch_id,group.batch_id));
        statements.push(db.prepare('UPDATE psychology_publish_items SET publish_group_id=? WHERE id=? AND publish_group_id=?').bind(id,row.id,group.id));
      }
      statements.push(db.prepare('UPDATE psychology_publish_groups SET expected_count=(SELECT COUNT(*) FROM psychology_publish_items WHERE publish_group_id=?) WHERE id=?').bind(group.id,group.id));
      await db.batch(statements);
      rows=rows.filter(r=>r.ready_json!=='{}');
    }
    const user=await loadAutoUser(db,group.created_by);
    await assertOfficialPublishAccess(env,user,{module:'psychology',connectionIds:[...new Set(rows.map(r=>r.connection_id))]});
    let request=parse(group.request_json);
    if(!request.items) {
      const config=parse(group.config_json);
      request={externalId:'local-factory-'+groupId,name:(config.name+' · 第 '+(group.ordinal+1)+' 批').slice(0,160),
        items:rows.map(r=>({...parse(r.ready_json).item,externalRef:r.id,connectionId:r.connection_id,scheduleAt:r.schedule_at*1000}))};
      // Freeze the exact remote request before network I/O; retries reuse its stable externalId.
      await db.prepare("UPDATE psychology_publish_groups SET request_json=? WHERE id=? AND request_json='{}'").bind(JSON.stringify(request),groupId).run();
      request=parse((await db.prepare('SELECT request_json FROM psychology_publish_groups WHERE id=?').bind(groupId).first()).request_json);
    }
    let response=parse(group.response_json);
    if(!response.batch?.id) {
      response=await signalDesk(env,db,'/api/v1/publish/batches',{method:'POST',body:request,signal:AbortSignal.timeout(120000)});
      if(!response.batch?.id)fail('发布中台未返回批次编号，请重试确认。',502);
      await db.prepare('UPDATE psychology_publish_groups SET response_json=? WHERE id=?').bind(JSON.stringify(response),groupId).run();
    }
    if(!rows.every(row=>(response.batch.tasks||[]).some(t=>t.externalRef===row.id && t.id))){
      response=await signalDesk(env,db,'/api/v1/publish/batches/'+encodeURIComponent(response.batch.id));
      if(!response.batch?.id)fail('中台回执暂不可用，请重试同步。',502);
      await db.prepare('UPDATE psychology_publish_groups SET response_json=? WHERE id=?').bind(JSON.stringify(response),groupId).run();
    }
    const tasks=response.batch.tasks||[];
    const records=rows.map(row=>{
      const ready=parse(row.ready_json),remote=tasks.find(t=>t.externalRef===row.id);
      if(!remote?.id)fail('中台回执缺少内容关联，请重试同步回执。',502);
      return {id:'psychology:'+row.id,createdAt:stamp,updatedAt:stamp,publishedAt:stamp,scheduleAt:row.schedule_at*1000,
        status:remote.status||'submitted',fileName:ready.item.fileName,title:ready.title||ready.item.fileName,
        connectionId:row.connection_id,accountName:remote.accountDisplayName||'',accountUsername:remote.username||'',
        officialBatchIds:[response.batch.id],batchId:response.batch.id,taskIds:[remote.id],remoteTaskId:remote.id,
        externalRef:row.id,autoTaskId:row.id,autoBatchId:group.batch_id,provider:'official',source:'official-tiktok',
        mediaType:ready.mediaType,photoCount:ready.item.photoAssetKeys?.length||0,note:'心理学自动发布 · 每组最多20条'};
    });
    await mergeAndStorePublishRecords(db,records);
    await db.batch([
      ...records.map(r=>db.prepare('UPDATE psychology_publish_items SET receipt_json=? WHERE id=?')
        .bind(JSON.stringify({batchId:r.batchId,recordId:r.id,remoteTaskId:r.remoteTaskId,submittedAt:stamp}),r.externalRef)),
      db.prepare("UPDATE psychology_publish_groups SET status='submitted',error='',updated_at=? WHERE id=?").bind(stamp,groupId),
    ]);
    await removePhotoBackups(env,rows).catch(error=>console.error('photo-backup-cleanup',error.message));
    return response;
  } catch(error) {
    if(await recoverMissingPhotos(env,group,rows,error))return {waiting:true,recovering:true,groupId};
    await db.prepare("UPDATE psychology_publish_groups SET status='failed',error=?,updated_at=? WHERE id=? AND status<>'submitted'")
      .bind(error.message||'整批提交失败',Date.now(),groupId).run();
    await enqueueGroupRetry(db,group,error);
    throw error;
  }
}

// Worker token is checked by handleWorkerApi before entering this route.
export async function handleAutoVideoStage(request,env,url) {
  const submit=url.pathname.match(/^\/api\/worker\/psychology-publish-groups\/([^/]+)\/submit$/);
  if(submit && request.method==='POST'){
    const job=await env.DB.prepare('SELECT * FROM factory_jobs WHERE id=?').bind(submit[1]).first();
    if(!job||job.type!=='psychology-publish-submit'||job.status!=='running'||job.worker_id!==request.headers.get('x-factory-worker'))fail('只能由接单工人提交当前分组。',409);
    return json(await dispatchPublishGroup(env,parse(job.payload_json).psychologySubmission.groupId));
  }
  const match=url.pathname.match(/^\/api\/worker\/psychology-video\/([^/]+)\/(state|ready)$/);
  if(!match)return null;
  const job=await env.DB.prepare('SELECT * FROM factory_jobs WHERE id=?').bind(match[1]).first();
  const payload=parse(job?.payload_json);
  if(!job || job.type!=='official-publish' || payload.psychologyAutomation?.submissionMode!=='grouped')fail('整批视频上传任务不存在。',404);
  if(job.status!=='running'||job.worker_id!==request.headers.get('x-factory-worker'))fail('只能由接单工人处理当前任务。',409);
  await assertAutoJobAccess(env,job);
  const item=await env.DB.prepare('SELECT * FROM psychology_publish_items WHERE id=? AND job_id=?').bind(payload.psychologyAutomation.id,job.id).first();
  if(!item?.publish_group_id)fail('发布分组不存在。',404);
  if(match[2]==='state'&&request.method==='GET')return json({ready:item.ready_json!=='{}',receipt:parse(item.receipt_json)});
  if(match[2]!=='ready'||request.method!=='POST')fail('不支持此请求。',405);
  if(parse(item.receipt_json).batchId)return json(parse(item.receipt_json));
  if(item.ready_json!=='{}')return json(await stagePublishItem(env,item,parse(item.ready_json)));
  const input=await readJson(request),asset=input.asset||{};
  if(!/^(temporary--)?[0-9a-f-]{36}\.(mp4|mov|webm)$/i.test(String(asset.assetKey||'')) ||
      !['video/mp4','video/quicktime','video/webm'].includes(asset.contentType) ||
      !Number.isSafeInteger(asset.fileSize)||asset.fileSize<=0)fail('视频素材无效，请重新上传。');
  const video=(payload.videos||payload.generatedVideos||[])[0];
  if(!video?.fileName)fail('没有已生成的视频。');
  return json(await stagePublishItem(env,item,{mediaType:'video',title:job.title,item:{
    assetKey:asset.assetKey,fileName:String(video.fileName).slice(0,180),contentType:asset.contentType,fileSize:asset.fileSize,
    postInfo:{caption:String(payload.publish?.videoDesc||job.title).slice(0,2200),privacy_level:'PUBLIC_TO_EVERYONE',
      disable_comment:false,disable_duet:false,disable_stitch:false,video_cover_timestamp_ms:1000},
  }}),202);
}

export async function reconcilePsychologyGroups(env){
 const completed=await env.DB.prepare("SELECT * FROM psychology_publish_items WHERE photo_backups_json<>'{}' AND (receipt_json<>'{}' OR deleted_at>0) LIMIT 20").all();
 await removePhotoBackups(env,completed.results).catch(e=>console.error('photo-backup-cleanup',e.message));
 const groups=await env.DB.prepare("SELECT g.id FROM psychology_publish_groups g WHERE g.status='waiting' AND g.request_json='{}' AND g.ready_at>0 AND (g.ready_at<? OR EXISTS(SELECT 1 FROM psychology_publish_items i JOIN factory_jobs j ON j.id=i.job_id WHERE i.publish_group_id=g.id AND i.ready_json='{}' AND j.status IN ('failed','cancelled'))) ORDER BY g.ready_at LIMIT 10").bind(Date.now()-20*60000).all();
 for(const group of groups.results){try{await dispatchPublishGroup(env,group.id);}catch(error){console.error('psychology-group-reconcile',group.id,error.message);}}
 return {checked:groups.results.length};
}
