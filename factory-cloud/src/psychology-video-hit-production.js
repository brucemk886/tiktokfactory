import {json,sha256Hex} from './http.js';
import {readManagementBody} from './psychology-management-api.js';
import {sourceRow,versionRow,publicVersion,allFrames,assertAssets,mutation,guard,videoHitUser} from './psychology-video-hits.js';
import {readyVideo} from './psychology-video-hit-videos.js';
import {loadAutoUser,insertAutoJob} from './psychology-auto-publish.js';
import {assertOfficialPublishAccess} from './official.js';
import {assertPublishFollowers} from './psychology-publish-followers.js';
import {ensurePsychologyOneMembers} from './psychology-tiktok-one.js';
import {officialPublishFollowupPayload} from './jobs.js';
import {publishOutcome} from '../../scripts/psychology-operations.js';
import {normalizeOneProject} from '../../scripts/psychology-auto-publish.js';
import {fail,only,completeVersion,versionNumber} from '../../scripts/psychology-video-hit-contract.js';
async function renderedPreview(db,user,source,v){
 if(v.input_mode==='video'||!v.render_job_id)return null;
 if(v.cleaned_at)return {state:'cleaned'};
 if(v.render_revision!==v.revision||v.render_source_revision!==source.revision)return {state:'stale'};
 const job=await db.prepare("SELECT id,status,percent,error,worker_id,result_json FROM factory_jobs WHERE id=? AND type='psychology-video-remix'").bind(v.render_job_id).first();
 const state=job?.status||v.render_state;
 if(state!=='done')return {state,percent:job?.percent||0,error:job?.error||''};
 const asset=await db.prepare("SELECT a.*,j.status preparation_status,j.error preparation_error FROM psychology_video_assets a LEFT JOIN factory_jobs j ON j.id='video-archive-'||a.id WHERE a.source_job_id=? AND a.result_index=0 ORDER BY (a.status='ready') DESC,(a.owner=?) DESC,a.created_at DESC,a.id LIMIT 1").bind(v.render_job_id,user.username).first();
 const active=!asset||asset.cleanup_state==='active',ready=active&&asset?.status==='ready';
 return {state:'done',jobId:v.render_job_id,assetId:asset?.id||'',previewUrl:ready?'/api/psychology-video-library/'+asset.id+'/file':'',fileName:asset?.file_name||'',canPrepare:Boolean(active&&job?.worker_id&&JSON.parse(job.result_json||'{}').results?.[0]?.fileName),preparationStatus:asset?.preparation_status||'',error:active?(asset?.preparation_error||''):'成片素材已进入清理流程，无法再次准备。'};
}
export async function handleVideoHitProduction(request,env,url,session){
 if(url.pathname==='/api/psychology-video-hits/photo-library'&&request.method==='GET')return (await import('./psychology-video-hit-photos.js')).hitPhotoInventory(env,session?.user,url);
 const match=url.pathname.match(/^\/api\/psychology-video-hits\/(vh-[a-f0-9]{32})\/versions\/(\d+)\/(render|publish|jobs)$/);
 if(!match)return null;
 const user=await videoHitUser(env.DB,session?.user),n=versionNumber(Number(match[2])),source=await sourceRow(env.DB,match[1],user),db=env.DB;
 if(request.method==='GET'&&match[3]==='jobs'){
  const v=await versionRow(db,source.id,n,user);
  const rows=await db.prepare("SELECT id,type,status,percent,message,error,result_json,created_at FROM factory_jobs WHERE ((json_extract(payload_json,'$.videoRemix.sourceId')=? AND json_extract(payload_json,'$.videoRemix.version')=?) OR (json_extract(payload_json,'$.videoHitOrigin.sourceId')=? AND json_extract(payload_json,'$.videoHitOrigin.version')=?)) ORDER BY created_at DESC,id LIMIT 20").bind(source.id,n,source.id,n).all();
  let publication=null;
  if(v.publish_item_id){
   const item=await db.prepare('SELECT i.*,j.status,j.error,j.type FROM psychology_publish_items i LEFT JOIN factory_jobs j ON j.id=i.job_id WHERE i.id=?').bind(v.publish_item_id).first();
   const record=await db.prepare("SELECT value_json FROM factory_publish_records WHERE json_extract(value_json,'$.autoTaskId')=? ORDER BY created_at DESC LIMIT 1").bind(v.publish_item_id).first();
   const facts=record?JSON.parse(record.value_json):{},outcome=publishOutcome(facts);
   publication={itemId:v.publish_item_id,batchId:item?.batch_id||'',connectionId:item?.connection_id||'',scheduleAt:item?.schedule_at||0,status:v.publish_state==='published'||outcome==='published'?'published':outcome==='failed'||item?.status==='failed'?'failed':item?.deleted_at?'cancelled':item?.receipt_json&&item.receipt_json!=='{}'?'submitted':item?.status||'reserved',postUrl:v.published_url||facts.shareLink||facts.videoUrl||'',error:item?.error||''};
  }
  return json({jobs:rows.results.map(r=>({...r,result_json:undefined,result:JSON.parse(r.result_json)})),publication,version:publicVersion(v),sourceRevision:source.revision,renderedVideo:await renderedPreview(db,user,source,v)});
 }
 if(request.method!=='POST'||match[3]==='jobs')fail('请求方法无效。',405);
 if((request.headers.get('origin')&&request.headers.get('origin')!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site')fail('不允许跨站修改。',403);
 const body=await readManagementBody(request),publishing=match[3]==='publish';
 only(body,publishing?['requestId','revision','connectionIds','scheduleAt','intervalMinutes','isAiGenerated','tiktokOne','minFollowers','voiceGender']:['requestId','revision','voiceGender']);
 return mutation(db,user,body,match[3]+':'+source.id+':'+n,async()=>{
  const v=await versionRow(db,source.id,n,user),direct=v.input_mode==='video';
  if(v.publish_item_id)fail('该版本已提交发布，请查看或重试原任务；不能创建第二次发布。',409);
  if(body.revision!==v.revision||!v.enabled)fail('请先启用完整版本，并读取最新revision。',409);
  if(direct&&!publishing)fail('此版本已传入成片，可直接发布，无需合成。',409);
  const voiceGender=body.voiceGender??'female';if(!['male','female'].includes(voiceGender))fail('voiceGender须为male或female。');
  const asset=direct?await readyVideo(db,user,v.video_asset_id):null;
  if(asset&&await db.prepare('SELECT item_id FROM psychology_video_hit_video_usage WHERE owner_id=? AND digest=?').bind(asset.owner_id,asset.digest).first())fail('此成片已提交发布，不能重复使用同一视频文件。',409);
  if(asset&&!await env.ARCHIVE.head(asset.r2_key))fail('成片文件已失效，请重新上传。',409);
  const frames=direct?[]:completeVersion(await allFrames(db,source.id,0),await allFrames(db,source.id,n),publicVersion(v));if(!direct)await assertAssets(db,user,frames);
  const snapshot={sourceId:source.id,sourceRevision:source.revision,videoUrl:source.video_url,version:n,revision:v.revision,title:v.title,caption:v.caption,script:v.script,voiceGender,frames:frames.map(({previewUrl,...f})=>f)};
  const prior=v.render_job_id?await db.prepare('SELECT * FROM factory_jobs WHERE id=?').bind(v.render_job_id).first():null;
  const sameRender=prior&&v.render_revision===v.revision&&v.render_source_revision===source.revision&&JSON.parse(prior.payload_json).videoRemix?.voiceGender===voiceGender;
  if(publishing&&!direct&&prior&&['queued','running'].includes(prior.status))fail('已有合成任务正在等待或执行，请完成后再提交发布。',409);
  if(!publishing&&prior&&['queued','running'].includes(prior.status)&&!sameRender)fail('该版本已有合成任务，请先等待完成。',409);
  const stamp=Date.now(),statements=[],jobs=[];
  if(!publishing){
   if(!prior&&v.render_revision===v.revision&&v.render_source_revision===source.revision&&v.render_state==='done')fail('该版本已合成，但任务记录已归档。请传入成片或修改版本后合成。',409);
   const id=sameRender?prior.id:'vh-render-'+(await sha256Hex(user.id+':'+source.id+':'+n+':'+v.revision+':'+source.revision+':'+voiceGender)).slice(0,32);
   statements.push(db.prepare("UPDATE psychology_video_hit_versions SET render_state=?,render_job_id=?,render_revision=?,render_source_revision=? WHERE source_id=? AND version=? AND revision=? AND enabled=1 AND publish_item_id='' AND render_job_id=?").bind(sameRender&&prior.status!=='failed'?prior.status:'queued',id,v.revision,source.revision,source.id,n,v.revision,v.render_job_id),guard(db),db.prepare('UPDATE psychology_video_hits SET revision=revision WHERE id=? AND revision=?').bind(source.id,source.revision),guard(db));
   statements.push(insertAutoJob(db,{id,type:'psychology-video-remix',title:v.title,createdBy:user.username,payload:{module:'psychology',videoRemix:snapshot}},stamp));
   if(sameRender&&prior.status==='failed')statements.push(db.prepare("UPDATE factory_jobs SET status='queued',percent=0,error='',message='等待重试合成',worker_id='',claimed_at=0,completed_at=0,updated_at=? WHERE id=? AND status='failed'").bind(stamp,id));
   return {statements,result:{accepted:true,jobIds:[id],sourceId:source.id,version:n,mode:'render',duplicate:Boolean(sameRender&&prior.status!=='failed')}};
  }
  await loadAutoUser(db,user.username);
  if(!Array.isArray(body.connectionIds)||body.connectionIds.length!==1||typeof body.connectionIds[0]!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(body.connectionIds[0]))fail('每个二创版本仅发布一次，请选择一个发布账号。');
  const connectionId=body.connectionIds[0],scheduleAt=body.scheduleAt,minimum=direct||sameRender&&prior.status==='done'?300:1800,now=Date.now();
  if(!Number.isSafeInteger(scheduleAt)||scheduleAt<Math.floor(now/1000)+minimum||scheduleAt*1000>now+14*86400000)fail(minimum===300?'成片排期须在5分钟后、14天内。':'需留出至少30分钟合成，排期在14天内。');
  if(typeof body.isAiGenerated!=='boolean')fail('请明确isAiGenerated标识。');
  const minFollowers=body.minFollowers??0;if(![0,1000].includes(minFollowers))fail('粉丝门槛仅支持0或1000。');
  const config={name:'视频二创 · '+v.name,mediaType:'video',template:direct?'selected-video':'psychology-video-remix',sourceType:'video-hits',count:1,connectionIds:[connectionId],scheduleAt,intervalMinutes:60,requestId:body.requestId,minFollowers,...(body.tiktokOne?{tiktokOne:normalizeOneProject(body.tiktokOne)}:{})};
  const accounts=(await assertOfficialPublishAccess(env,user,{module:'psychology',connectionIds:[connectionId]})).accounts;
  await assertPublishFollowers(db,config,accounts);await ensurePsychologyOneMembers(env,user,config,accounts);
  const batchId='psy-vh-'+(await sha256Hex(user.id+':'+body.requestId)).slice(0,32),id=batchId+'-000',groupId=batchId+'-group-0';
  statements.push(db.prepare("UPDATE psychology_video_hit_versions SET publish_state='reserved',publish_item_id=? WHERE source_id=? AND version=? AND revision=? AND enabled=1 AND publish_item_id=''").bind(id,source.id,n,v.revision),guard(db),db.prepare('UPDATE psychology_video_hits SET revision=revision WHERE id=? AND revision=?').bind(source.id,source.revision),guard(db));
  statements.push(db.prepare('INSERT INTO psychology_publish_batches(id,created_by,config_json,created_at) VALUES(?,?,?,?)').bind(batchId,user.username,JSON.stringify(config),stamp),db.prepare('INSERT INTO psychology_publish_groups(id,batch_id,ordinal,expected_count) VALUES(?,?,0,1)').bind(groupId,batchId));
  if(asset)statements.push(db.prepare('INSERT INTO psychology_video_hit_video_usage(owner_id,digest,asset_id,item_id) VALUES(?,?,?,?)').bind(asset.owner_id,asset.digest,asset.id,id));
  const automation={id,batchId,groupId,submissionMode:'grouped',connectionId,scheduleAt,mediaType:'video',template:config.template};
  const publish={provider:'official',autoPublish:true,connectionIds:[connectionId],officialAccounts:accounts,scheduleAt,intervalMinutes:60,videoDesc:v.caption||v.title,isAiGenerated:body.isAiGenerated,envIds:[],accounts:[]};
  const origin={sourceId:source.id,version:n,revision:v.revision},payload={module:'psychology',videoHitOrigin:origin,psychologyAutomation:automation,publish};
  let type='psychology-video-remix',finalPayload={...payload,videoRemix:snapshot};
  if(direct){type='psychology-selected-video';finalPayload={...payload,assetId:asset.id,publishOnly:true};}
  else if(sameRender&&prior.status==='done'){
   const result=JSON.parse(prior.result_json);if(!prior.worker_id||!result.results?.[0]?.fileName)fail('合成任务未返回可发布成片。',409);
   type='official-publish';finalPayload={...officialPublishFollowupPayload({...prior,payload_json:JSON.stringify({...JSON.parse(prior.payload_json),...payload})},result),...payload};
  }
  statements.push(insertAutoJob(db,{id,type,title:v.title,createdBy:user.username,payload:finalPayload},stamp));jobs.push(id);
  statements.push(db.prepare('INSERT INTO psychology_publish_items(id,batch_id,source_id,job_id,connection_id,schedule_at,publish_group_id) VALUES(?,?,?,?,?,?,?)').bind(id,batchId,source.id+':v'+n,id,connectionId,scheduleAt,groupId),db.prepare('INSERT INTO psychology_peer_account_usage(source_id,connection_id,item_id) VALUES(?,?,?)').bind(source.id+':v'+n,connectionId,id));
  return {statements,result:{accepted:true,batchId,jobIds:jobs,sourceId:source.id,version:n,mode:'publish',inputMode:v.input_mode}};
 });
}
