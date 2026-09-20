import { mergeAndStorePublishRecords } from './publish-records-store.js';

export const PSYCHOLOGY_RETRY_DELAYS=[30000,60000];
const parse=value=>JSON.parse(value||'{}');
export function isPsychologyPublishAttempt(job){
  const p=parse(job?.payload_json);
  return Boolean(p.psychologySubmission || (p.psychologyAutomation&&(p.photoAutomation||job.type==='official-publish')));
}
export function publishDiagnostic(error,phase='publish'){
  const message=String(error?.message||error||'发布失败').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,4000);
  return {at:Date.now(),phase,message,httpStatus:Number(error?.statusCode||error?.status)||0,code:String(error?.cause?.code||error?.code||'').slice(0,80)};
}
export async function failureItems(db,job){
  const p=parse(job.payload_json);
  if(p.psychologySubmission)return (await db.prepare("SELECT i.*,b.config_json,j.title,j.payload_json FROM psychology_publish_items i JOIN psychology_publish_batches b ON b.id=i.batch_id LEFT JOIN factory_jobs j ON j.id=i.job_id WHERE i.publish_group_id=? AND i.deleted_at=0 AND i.receipt_json='{}'").bind(p.psychologySubmission.groupId).all()).results;
  if(!p.psychologyAutomation)return [];
  const item=await db.prepare("SELECT i.*,b.config_json,j.title,j.payload_json FROM psychology_publish_items i JOIN psychology_publish_batches b ON b.id=i.batch_id LEFT JOIN factory_jobs j ON j.id=i.job_id WHERE i.id=? AND i.deleted_at=0 AND i.receipt_json='{}'").bind(p.psychologyAutomation.id).first();
  return item?[item]:[];
}
export async function storePsychologyFailures(db,items,diagnostic,retryCount,nextRetryAt){
  const records=items.map(i=>{
    const cfg=parse(i.config_json),p=parse(i.payload_json),account=p.psychologyAutomation?.account || (p.publish?.officialAccounts||[]).find(a=>a.connectionId===i.connection_id)||{};
    return {id:'psychology:'+i.id,autoTaskId:i.id,autoBatchId:i.batch_id,connectionId:i.connection_id,
      accountName:account.name||'',accountUsername:account.username||'',title:i.title||cfg.name,fileName:i.title||cfg.name,
      createdAt:diagnostic.at,updatedAt:diagnostic.at,scheduleAt:i.schedule_at*1000,status:'failed',
      provider:'official',source:'official-tiktok',mediaType:cfg.mediaType,photoCount:Object.keys(parse(i.photo_assets_json)).length,
      error:diagnostic.message,errorMessage:diagnostic.message,publishError:diagnostic.message,lastFailure:diagnostic,
      autoRetryCount:retryCount,nextRetryAt,note:nextRetryAt?`提交失败，等待自动重试 ${retryCount}/2`:'提交失败，自动重试已停止，请人工处理'};
  });
  if(records.length)await mergeAndStorePublishRecords(db,records);
}
export async function enqueueGroupRetry(db,group,error){
  const stamp=Date.now(),id=group.id+'-submit',diagnostic=publishDiagnostic(error,'batch-submit');
  const payload={module:'psychology',psychologySubmission:{groupId:group.id}};
  // Initial submission happened in the last upload callback; this job is retry 1 of 2.
  await db.prepare(`INSERT INTO factory_jobs (id,type,status,title,percent,message,payload_json,result_json,error,created_by,worker_id,claimed_at,completed_at,created_at,updated_at,available_at,auto_retry_count,retry_history_json)
    VALUES (?,'psychology-publish-submit','queued',?,0,'等待自动重试 1/2',?,'{}',?,?,'',0,0,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status='queued',auto_retry_count=1,available_at=excluded.available_at,error=excluded.error,message=excluded.message,retry_history_json=excluded.retry_history_json WHERE factory_jobs.status='cancelled'`)
    .bind(id,parse(group.config_json).name+' · 整批提交',JSON.stringify(payload),diagnostic.message,group.created_by,stamp,stamp,stamp+PSYCHOLOGY_RETRY_DELAYS[0],1,JSON.stringify([diagnostic])).run();
  const job=await db.prepare('SELECT * FROM factory_jobs WHERE id=?').bind(id).first();
  await storePsychologyFailures(db,await failureItems(db,job),diagnostic,job.auto_retry_count,job.status==='queued'?job.available_at:0);
}
export async function finishPsychologyPublishAttempt(db,job,error){
  if(!isPsychologyPublishAttempt(job)||job.status==='cancelled')return;
  const p=parse(job.payload_json),items=await failureItems(db,job);
  if(!items.length)return;
  // A ready grouped item delegates submission retries to the group's own job.
  if(!p.psychologySubmission&&items[0].publish_group_id&&items[0].ready_json!=='{}')return;
  if(!error)return;
  const diagnostic=publishDiagnostic(error,p.psychologySubmission?'batch-submit':p.photoAutomation?'photo-upload-or-submit':'video-upload');
  const count=Number(job.auto_retry_count)||0,nextCount=Math.min(2,count+1),nextAt=count<2?Date.now()+PSYCHOLOGY_RETRY_DELAYS[count]:0;
  const history=[...JSON.parse(job.retry_history_json||'[]'),diagnostic].slice(-10);
  await db.prepare(`UPDATE factory_jobs SET status=?,auto_retry_count=?,available_at=?,retry_history_json=?,message=?,updated_at=? WHERE id=? AND status IN ('failed','done')`)
    .bind(nextAt?'queued':'failed',nextCount,nextAt,JSON.stringify(history),nextAt?`发布失败，等待自动重试 ${nextCount}/2`:'发布失败，已自动重试 2 次，请人工处理',Date.now(),job.id).run();
  await storePsychologyFailures(db,items,diagnostic,nextCount,nextAt);
}
