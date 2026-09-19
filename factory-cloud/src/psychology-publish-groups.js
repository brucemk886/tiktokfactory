import { json, readJson } from './http.js';
import { signalDesk } from './signal-desk.js';
import { assertAutoJobAccess, loadAutoUser } from './psychology-auto-publish.js';
import { assertOfficialPublishAccess } from './official.js';
import { mergeAndStorePublishRecords } from './publish-records-store.js';

export const PSYCHOLOGY_GROUP_SIZE = 20;
const LEASE_MS = 180000;
const parse = value => JSON.parse(value || '{}');
const fail = (message, statusCode=400) => { throw Object.assign(new Error(message),{statusCode}); };

// Group membership is fixed at creation. Ready assets may come from different workers.
export async function stagePublishItem(env, item, ready) {
  await env.DB.prepare("UPDATE psychology_publish_items SET ready_json=? WHERE id=? AND ready_json='{}'")
    .bind(JSON.stringify(ready),item.id).run();
  await dispatchPublishGroup(env,item.publish_group_id);
  const current=await env.DB.prepare('SELECT receipt_json FROM psychology_publish_items WHERE id=?').bind(item.id).first();
  const receipt=parse(current?.receipt_json);
  return receipt.batchId ? receipt : {waiting:true,groupId:item.publish_group_id};
}

export async function dispatchPublishGroup(env,groupId) {
  const db=env.DB;
  let group=await db.prepare('SELECT g.*,b.created_by,b.config_json FROM psychology_publish_groups g JOIN psychology_publish_batches b ON b.id=g.batch_id WHERE g.id=?').bind(groupId).first();
  if(!group)fail('发布分组不存在。',404);
  if(group.status==='submitted')return parse(group.response_json);
  const {results:rows}=await db.prepare('SELECT i.*,j.status AS job_status FROM psychology_publish_items i LEFT JOIN factory_jobs j ON j.id=i.job_id WHERE i.publish_group_id=? ORDER BY i.id').bind(groupId).all();
  if(rows.length!==group.expected_count || rows.some(r=>r.ready_json==='{}'))return {waiting:true};
  if(rows.some(r=>r.job_status==='cancelled'))fail('组内有已取消内容，请先处理后再提交。',409);
  const stamp=Date.now();
  // A short lease prevents concurrent last-item callbacks from sending the same group.
  const changed=await db.prepare("UPDATE psychology_publish_groups SET status='submitting',error='',updated_at=? WHERE id=? AND status<>'submitted' AND (status<>'submitting' OR updated_at<?)")
    .bind(stamp,groupId,stamp-LEASE_MS).run();
  if(!changed.meta?.changes)return {waiting:true};
  try {
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
    return response;
  } catch(error) {
    await db.prepare("UPDATE psychology_publish_groups SET status='failed',error=?,updated_at=? WHERE id=? AND status<>'submitted'")
      .bind(error.message||'整批提交失败',Date.now(),groupId).run();
    throw error;
  }
}

// Worker token is checked by handleWorkerApi before entering this route.
export async function handleAutoVideoStage(request,env,url) {
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
