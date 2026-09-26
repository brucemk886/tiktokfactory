import {photoUser,getDirection,photoDirectory,assertNoLegacyConflict} from './photo-factory.js';
import {parse,fail,DAY,HOUR,upcomingSlots,batchRequest,renderEntries,copyContent} from './photo-factory-domain.js';
import {loadCardModules,openCloudCardRenderer} from './psychology-cloud-renderer.js';
import {importRenderedPhoto,decodeRenderedPhoto} from './photo-publishing.js';
import {signalDesk} from './signal-desk.js';
import {mergeAndStorePublishRecords} from './publish-records-store.js';

const READ={retries:{limit:2,delay:'5 seconds',backoff:'exponential'},timeout:'2 minutes'};
const MEDIA={retries:{limit:1,delay:'15 seconds'},timeout:'5 minutes'};
const SUBMIT={retries:{limit:2,delay:'15 seconds',backoff:'exponential'},timeout:'2 minutes'};
const rows=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;

// Original content and reviewed rewrites share a source/account reservation.
// Unjudged versions have at most three live samples; balanced mode rotates
// original/rewrite exploration and uses mature local outcomes for exploitation.
export async function selectCopy(db,pilot,account,index,now,excluded=[]){
 const kind=pilot.strategy==='original'?'original':pilot.strategy==='rewrite'?'rewrite':'';
 const preferKind=index%2?'rewrite':'original',explore=pilot.strategy==='balanced'&&index%10<3;
 return db.prepare(`WITH candidates AS (
 SELECT c.*, (SELECT count(*) FROM photo_jobs j WHERE j.copy_id=c.id) draws,
 (SELECT count(*) FROM photo_jobs j LEFT JOIN ops_video_facts v ON v.account_key='tiktok:'||j.connection_id AND v.video_id=j.video_id
  WHERE j.copy_id=c.id AND j.state NOT IN ('failed','stopped') AND (v.views IS NULL OR v.published_at>?)) unjudged,
 (SELECT avg(v.views) FROM photo_jobs j JOIN ops_video_facts v ON v.account_key='tiktok:'||j.connection_id AND v.video_id=j.video_id
  WHERE j.copy_id=c.id AND v.published_at<=?) score
 FROM photo_copies c WHERE c.owner=? AND c.direction_id=? AND c.enabled=1 AND (?='' OR c.kind=?)
 AND c.id NOT IN (SELECT value FROM json_each(?))
 AND EXISTS(SELECT 1 FROM photo_copies original WHERE original.id=c.source_id AND original.enabled=1)
 AND NOT EXISTS(SELECT 1 FROM photo_source_uses u WHERE u.owner=c.owner AND u.direction_id=c.direction_id AND u.connection_id=? AND u.source_id=c.source_id)
 ) SELECT * FROM candidates WHERE unjudged<3 ORDER BY
 CASE WHEN ? THEN score IS NULL ELSE score IS NOT NULL END DESC,
 CASE WHEN ?=0 THEN score END DESC,CASE WHEN kind=? THEN 0 ELSE 1 END,draws,created_at,id LIMIT 1`)
 .bind(now-DAY,now-DAY,pilot.owner,pilot.direction_id,kind,kind,JSON.stringify(excluded),account.id,Number(explore),Number(explore),preferKind).first();
}
export async function planPhotoSlot(env,pilot,direction,slot,now=Date.now()){
 const db=env.DB;
 if(await db.prepare('SELECT 1 FROM photo_slots WHERE pilot_id=? AND slot_at=?').bind(pilot.id,slot).first())return {duplicate:true};
 const accounts=parse(pilot.accounts_json,[]),config=parse(pilot.config_json),statements=[];
 // Selection and its provisional reservations run under the dispatcher lease.
 // Build the entire slot first; a shortage never creates a partial group.
 const selected=[],reserved=new Set(),perVersion=new Map();
 for(let i=0;i<accounts.length;i++){
  const account=accounts[i],copy=await selectCopy(db,pilot,account,i+Math.floor(slot/60000),now,selected.filter(s=>Number(s.copy.unjudged)+(perVersion.get(s.copy.id)||0)>=3).map(s=>s.copy.id));
  if(!copy)fail('可用文案不足：请补充当前方向的原文或启用改写，已有任务不受影响。',409);
  const used=perVersion.get(copy.id)||0;
  if(Number(copy.unjudged)+used>=3)fail('未验证版本已达到 3 个样本上限，请补充文案或等待效果数据。',409);
  // One account appears once in a slot; future slots reserve in the DB.
  const usage=account.id+':'+copy.source_id;if(reserved.has(usage))fail('分组包含重复账号。');reserved.add(usage);perVersion.set(copy.id,used+1);
  selected.push({account,copy,index:i});
 }
 statements.push(db.prepare("INSERT INTO photo_slots(pilot_id,slot_at,status,created_at) VALUES(?,?,'created',?)").bind(pilot.id,slot,now));
 for(const {account,copy,index} of selected){
  const id=crypto.randomUUID(),schedule=slot+index*config.staggerSeconds*1000;
  if(schedule>=pilot.ends_at)fail('账号错峰超出测试结束日期，请提前末次发布时间。',409);
  const content=copyContent({title:copy.title,caption:copy.caption,pages:parse(copy.pages_json,[]),tags:parse(copy.tags_json,[])},direction.config);
  const snapshot={directionId:direction.id,directionName:direction.name,revision:direction.revision,config:direction.config,
   styleId:direction.config.styleIds[index%direction.config.styleIds.length],copy:{...content,id:copy.id,sourceId:copy.source_id,kind:copy.kind,model:copy.model},
   groupId:pilot.group_id,groupName:pilot.group_name,strategy:pilot.strategy,accountName:account.username};
  statements.push(db.prepare('INSERT INTO photo_jobs(id,owner,direction_id,pilot_id,slot_at,connection_id,source_id,copy_id,snapshot_json,schedule_at,generate_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(id,pilot.owner,direction.id,pilot.id,slot,account.id,copy.source_id,copy.id,JSON.stringify(snapshot),schedule,Math.max(now,schedule-2*HOUR),now,now));
  statements.push(db.prepare('INSERT INTO photo_source_uses(owner,direction_id,connection_id,source_id,job_id,created_at) VALUES(?,?,?,?,?,?)').bind(pilot.owner,direction.id,account.id,copy.source_id,id,now));
 }
 await db.batch(statements);return {count:selected.length};
}
export async function assertPhotoJobAccess(env,job,{fresh=true}={}){
 const user=await photoUser(env.DB,job.owner),pilot=await env.DB.prepare('SELECT * FROM photo_pilots WHERE id=?').bind(job.pilot_id).first();
 if(!pilot||pilot.status!=='active')fail('运营任务已暂停或结束。',409);
 await getDirection(env.DB,job.owner,job.direction_id,true);
 await assertNoLegacyConflict(env.DB,pilot.group_id,[job.connection_id]);
 const directory=await photoDirectory(env,user,fresh);
 if(!directory.accounts.some(a=>a.connectionId===job.connection_id&&a.groupId===pilot.group_id))fail('账号授权或所属分组已变化。',403);
 return pilot;
}
export async function saveReceipt(env,job,result){
 const batch=result.batch||result,task=(batch.tasks||[]).find(t=>t.externalRef===job.id);
 if(!batch.id||!task?.id)fail('中台尚未返回该任务的准确回执，保留原提交编号等待核对。',502);
 const now=Date.now();
 await env.DB.prepare("UPDATE photo_jobs SET remote_batch=?,remote_task=?,state=CASE WHEN state='published' THEN state ELSE 'submitted' END,error='',updated_at=? WHERE id=?")
 .bind(batch.id,task.id,now,job.id).run();
 const snap=parse(job.snapshot_json);
 await mergeAndStorePublishRecords(env.DB,[{id:'photo-factory:'+job.id,autoTaskId:'photo-factory:'+job.id,createdAt:job.created_at,updatedAt:now,scheduleAt:job.schedule_at,
  status:'submitted',module:'photo-factory',provider:'official',source:'official-tiktok',mediaType:'photo',title:snap.copy.title,fileName:snap.copy.title,
  connectionId:job.connection_id,batchId:batch.id,officialBatchIds:[batch.id],remoteTaskId:task.id,taskIds:[task.id],externalRef:job.id,accountUsername:snap.accountName}]);
 return {batchId:batch.id,taskId:task.id};
}
export async function runPhotoFactoryWorkflow(env,event,step,deps={}){
 const id=event.payload.jobId,db=env.DB,load=()=>db.prepare('SELECT * FROM photo_jobs WHERE id=?').bind(id).first();
 try{
  const job=await step.do('load',READ,load);if(!job||['stopped','failed','submitted','published'].includes(job.state))return {skipped:true};
  const snapshot=parse(job.snapshot_json);
  await step.do('render',MEDIA,async()=>{
   const current=await load();if(['stopped','failed'].includes(current.state))return {skipped:true};
   await assertPhotoJobAccess(env,current,{fresh:false});
   await db.prepare("UPDATE photo_jobs SET state='rendering',updated_at=? WHERE id=? AND state IN ('dispatching','rendering')").bind(Date.now(),id).run();
   const keys=snapshot.copy.pages.map((_,i)=>'photo-factory/'+id+'/'+i+'.jpg');
   const missing=[];for(let i=0;i<keys.length;i++)if(!await env.ARCHIVE.head(keys[i]))missing.push(i);
   if(missing.length){
    const renderer=await (deps.openRenderer||openCloudCardRenderer)(env,await loadCardModules(env));
    let images;try{images=await renderer.renderBatch(renderEntries(snapshot).filter((_,i)=>missing.includes(i)));}finally{await renderer.close();}
    for(let n=0;n<missing.length;n++){const {bytes}=decodeRenderedPhoto({dataUrl:images[n]});await env.ARCHIVE.put(keys[missing[n]],bytes,{httpMetadata:{contentType:'image/jpeg'}});}
   }return {keys};
  });
  for(let i=0;i<snapshot.copy.pages.length;i++)await step.do('upload-'+i,MEDIA,async()=>{
   const current=await load();if(['stopped','failed'].includes(current.state))return {skipped:true};
   const assets=parse(current.assets_json,[]);if(assets[i])return assets[i];
   const object=await env.ARCHIVE.get('photo-factory/'+id+'/'+i+'.jpg');if(!object)throw new Error('生成图片未保存。');
   const bytes=new Uint8Array(await object.arrayBuffer());let binary='';for(const b of bytes)binary+=String.fromCharCode(b);
   const asset=await (deps.upload||importRenderedPhoto)(env,db,{dataUrl:'data:image/jpeg;base64,'+btoa(binary),fileName:id+'-'+i+'.jpg'});
   assets[i]=asset;await db.prepare('UPDATE photo_jobs SET assets_json=?,updated_at=? WHERE id=?').bind(JSON.stringify(assets),Date.now(),id).run();return asset;
  });
  return await step.do('submit',SUBMIT,async()=>{
   let current=await load();if(['stopped','failed'].includes(current.state))return {skipped:true};if(current.remote_batch)return {batchId:current.remote_batch};
   if(!current.request_json){
    await assertPhotoJobAccess(env,current,{fresh:true});
    if(Date.now()>current.schedule_at+5*60000)fail('已错过排期，未向中台补发；请新建测试。',409);
    const body=batchRequest(current,parse(current.assets_json,[]));
    const changed=await db.prepare("UPDATE photo_jobs SET state='submitting',request_json=?,updated_at=? WHERE id=? AND state IN ('rendering','ready','dispatching') AND request_json=''").bind(JSON.stringify(body),Date.now(),id).run();
    if(!changed.meta.changes){current=await load();if(!current.request_json)return {skipped:true};}else current={...current,request_json:JSON.stringify(body)};
   }
   // Retries always replay the frozen request with the same externalId.
   const result=await (deps.submit||signalDesk)(env,db,'/api/v1/publish/batches',{method:'POST',body:parse(current.request_json)});
   return saveReceipt(env,current,result);
  });
 }catch(error){
  await step.do('record-error',READ,async()=>{const current=await load();if(!current||['submitted','published','stopped'].includes(current.state))return;
   await db.prepare("UPDATE photo_jobs SET state=CASE WHEN request_json<>'' THEN 'submitting' ELSE 'failed' END,error=?,updated_at=? WHERE id=?")
    .bind(String(error.message||error).slice(0,800),Date.now(),id).run();});throw error;
 }
}
export function remoteOutcome(task){
 const videoId=String(task.itemId||task.videoId||'');
 return {state:task.status==='published'?'published':['failed','canceled'].includes(task.status)?'failed':'submitted',videoId,
 publishedAt:Number(task.publishedAt||0),error:String(task.error||task.failReason||'').slice(0,800)};
}
export async function syncPhotoReceipts(env,now=Date.now()){
 const db=env.DB,jobs=await rows(db,`SELECT * FROM photo_jobs WHERE
 (state IN ('submitted','submitting') OR (state='published' AND video_id='' AND schedule_at>?)) AND last_checked<? ORDER BY last_checked LIMIT 10`,now-7*DAY,now-300000);
 for(const job of jobs){
  await db.prepare('UPDATE photo_jobs SET last_checked=? WHERE id=?').bind(now,job.id).run();
  try{
   if(!job.remote_batch){
    if(!job.request_json||now>job.schedule_at+DAY)continue;
    await saveReceipt(env,job,await signalDesk(env,db,'/api/v1/publish/batches',{method:'POST',body:parse(job.request_json)}));continue;
   }
   const result=await signalDesk(env,db,'/api/v1/publish/batches/'+encodeURIComponent(job.remote_batch)),batch=result.batch||result;
   const task=(batch.tasks||[]).find(t=>t.id===job.remote_task&&t.externalRef===job.id);if(!task)throw new Error('中台没有返回匹配的任务。');
   const state=remoteOutcome(task);
   await db.prepare('UPDATE photo_jobs SET state=?,video_id=?,published_at=max(published_at,?),error=?,updated_at=? WHERE id=?').bind(state.state,state.videoId||job.video_id,state.publishedAt,state.error,now,job.id).run();
  }catch(error){await db.prepare('UPDATE photo_jobs SET error=? WHERE id=?').bind(String(error.message||error).slice(0,800),job.id).run();}
 }
 return jobs.length;
}
export async function tickPhotoFactory(env,now=Date.now()){
 if(!env.PHOTO_FACTORY_WORKFLOW)return {disabled:true};
 const db=env.DB,token=crypto.randomUUID(),claim=await db.prepare('UPDATE photo_dispatch_lock SET lease_until=?,token=? WHERE id=1 AND lease_until<?').bind(now+300000,token,now).run();
 if(!claim.meta.changes)return {busy:true};
 let planned=0,dispatched=0;
 try{
  const pilots=await rows(db,"SELECT * FROM photo_pilots WHERE status='active' AND next_check<=? ORDER BY next_check,created_at LIMIT 10",now);
  for(const p of pilots){
   await db.prepare('UPDATE photo_pilots SET next_check=? WHERE id=?').bind(now+60000,p.id).run();
   if(p.ends_at<=now){await db.prepare("UPDATE photo_pilots SET status='ended',updated_at=? WHERE id=?").bind(now,p.id).run();continue;}
   try{
    const user=await photoUser(db,p.owner),direction=await getDirection(db,p.owner,p.direction_id,true),accounts=parse(p.accounts_json,[]);
    await assertNoLegacyConflict(db,p.group_id,accounts.map(a=>a.id),now);
    const directory=await photoDirectory(env,user,false);if(accounts.some(a=>!directory.accounts.some(b=>b.connectionId===a.id&&b.groupId===p.group_id)))fail('分组账号已变化，请暂停并新建测试。',409);
    for(const slot of upcomingSlots(p,now)){
     // Do not let a single pilot reserve days of stock or dominate the dispatcher.
     if(slot>now+2*HOUR||planned+accounts.length>100)continue;
     try{const result=await planPhotoSlot(env,p,direction,slot,now);planned+=result.count||0;}catch(error){await db.prepare('UPDATE photo_pilots SET error=?,updated_at=? WHERE id=?').bind(error.message,now,p.id).run();break;}
    }
   }catch(error){await db.prepare('UPDATE photo_pilots SET error=?,updated_at=? WHERE id=?').bind(error.message,now,p.id).run();}
  }
  const stale=await rows(db,"SELECT * FROM photo_jobs WHERE state IN ('dispatching','rendering','ready') AND updated_at<? ORDER BY updated_at LIMIT 5",now-10*60000);
  for(const job of stale){try{
   const instance=await env.PHOTO_FACTORY_WORKFLOW.get(job.workflow_id),s=await instance.status();
   if(['errored','terminated','complete'].includes(s.status))await db.prepare("UPDATE photo_jobs SET state='failed',error='制作工作流已结束但未完成提交，请检查后新建测试',updated_at=? WHERE id=? AND state IN ('dispatching','rendering','ready')").bind(now,job.id).run();
  }catch{/* Uncertain workflow state retains its slot; never duplicate execution. */}}
  const pendingDispatch=await rows(db,"SELECT * FROM photo_jobs WHERE state='dispatching' AND updated_at<? ORDER BY updated_at LIMIT 2",now-60000);
  const active=await db.prepare("SELECT count(*) n FROM photo_jobs WHERE state IN ('dispatching','rendering','ready')").first();
  const jobs=await rows(db,"SELECT * FROM photo_jobs WHERE state='queued' AND generate_at<=? ORDER BY schedule_at,id LIMIT ?",now,Math.max(0,2-active.n));
  for(const job of [...pendingDispatch,...jobs]){
   const workflowId=job.workflow_id||'photo-'+job.id;
   const changed=await db.prepare("UPDATE photo_jobs SET state='dispatching',workflow_id=?,updated_at=? WHERE id=? AND state IN ('queued','dispatching')").bind(workflowId,now,job.id).run();
   if(!changed.meta.changes)continue;
   try{await env.PHOTO_FACTORY_WORKFLOW.create({id:workflowId,params:{jobId:job.id}});dispatched++;}
   catch(error){try{const instance=await env.PHOTO_FACTORY_WORKFLOW.get(workflowId);await instance.status();}catch{await db.prepare("UPDATE photo_jobs SET error=? WHERE id=? AND state='dispatching'").bind(String(error.message||error).slice(0,500),job.id).run();}}
  }
  const synced=await syncPhotoReceipts(env,now);
  const expired=await rows(db,"SELECT id,snapshot_json FROM photo_jobs WHERE state IN ('published','failed','stopped') AND assets_cleaned=0 AND updated_at<? LIMIT 10",now-7*DAY);
  for(const job of expired){await env.ARCHIVE.delete(parse(job.snapshot_json).copy.pages.map((_,i)=>'photo-factory/'+job.id+'/'+i+'.jpg'));await db.prepare('UPDATE photo_jobs SET assets_cleaned=1 WHERE id=?').bind(job.id).run();}
  return {planned,dispatched,synced};
 }finally{await db.prepare('UPDATE photo_dispatch_lock SET lease_until=0 WHERE id=1 AND token=?').bind(token).run();}
}
