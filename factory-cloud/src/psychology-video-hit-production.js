import {json,sha256Hex} from './http.js';
import {readManagementBody} from './psychology-management-api.js';
import {sourceRow,versionRow,publicVersion,allFrames,assertAssets,mutation,guard,videoHitUser} from './psychology-video-hits.js';
import {loadAutoUser,insertAutoJob} from './psychology-auto-publish.js';
import {assertOfficialPublishAccess} from './official.js';
import {assertPublishFollowers} from './psychology-publish-followers.js';
import {ensurePsychologyOneMembers} from './psychology-tiktok-one.js';
import {normalizeOneProject} from '../../scripts/psychology-auto-publish.js';
import {fail,only,completeVersion,versionNumber} from '../../scripts/psychology-video-hit-contract.js';
export async function handleVideoHitProduction(request,env,url,session){
 const match=url.pathname.match(/^\/api\/psychology-video-hits\/(vh-[a-f0-9]{32})\/versions\/(\d+)\/(render|publish|jobs)$/);
 if(!match)return null;
 const user=await videoHitUser(env.DB,session?.user),n=versionNumber(Number(match[2])),source=await sourceRow(env.DB,match[1],user);
 if(request.method==='GET'&&match[3]==='jobs'){
  const rows=await env.DB.prepare("SELECT id,status,percent,message,error,result_json,created_at FROM factory_jobs WHERE created_by=? AND type='psychology-video-remix' AND json_extract(payload_json,'$.videoRemix.sourceId')=? AND json_extract(payload_json,'$.videoRemix.version')=? ORDER BY created_at DESC LIMIT 20").bind(user.username,source.id,n).all();
  return json({jobs:rows.results.map(r=>({...r,result_json:undefined,result:JSON.parse(r.result_json)}))});
 }
 if(request.method!=='POST'||match[3]==='jobs')fail('请求方法无效。',405);
 if((request.headers.get('origin')&&request.headers.get('origin')!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site')fail('不允许跨站修改。',403);
 const body=await readManagementBody(request),publishing=match[3]==='publish';
 only(body,publishing?['requestId','revision','connectionIds','scheduleAt','intervalMinutes','isAiGenerated','tiktokOne','minFollowers','voiceGender']:['requestId','revision','voiceGender']);
 return mutation(env.DB,user,body,match[3]+':'+source.id+':'+n,async()=>{
  const v=await versionRow(env.DB,source.id,n,user);
  if(body.revision!==v.revision||!v.enabled)fail('请先启用完整版本，并读取最新revision。',409);
  const frames=completeVersion(await allFrames(env.DB,source.id,0),await allFrames(env.DB,source.id,n),publicVersion(v));await assertAssets(env.DB,user,frames);
  const voiceGender=body.voiceGender??'female';if(!['male','female'].includes(voiceGender))fail('voiceGender须为male或female。');
  const snapshot={sourceId:source.id,sourceRevision:source.revision,videoUrl:source.video_url,version:n,revision:v.revision,title:v.title,caption:v.caption,script:v.script,voiceGender,frames:frames.map(({previewUrl,...f})=>f)};
  let accounts=[],config={},connections=[''],batchId='',scheduleAt=0,intervalMinutes=60;
  if(publishing){
   await loadAutoUser(env.DB,user.username);
   if(!Array.isArray(body.connectionIds)||!body.connectionIds.length||body.connectionIds.length>20||body.connectionIds.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))||new Set(body.connectionIds).size!==body.connectionIds.length)fail('请选择1–20个不同的发布账号。');
   connections=body.connectionIds;scheduleAt=body.scheduleAt;intervalMinutes=body.intervalMinutes??60;
   const now=Date.now(),last=scheduleAt+(connections.length-1)*intervalMinutes*60;
   if(!Number.isSafeInteger(scheduleAt)||scheduleAt<Math.floor(now/1000)+1800||last*1000>now+14*86400000||!Number.isInteger(intervalMinutes)||intervalMinutes<1||intervalMinutes>10080)fail('需留出至少30分钟合成，整批排期在14天内，间隔1–10080分钟。');
   if(typeof body.isAiGenerated!=='boolean')fail('请明确isAiGenerated标识。');
   const minFollowers=body.minFollowers??0;if(![0,1000].includes(minFollowers))fail('粉丝门槛仅支持0或1000。');
   config={name:'视频二创 · '+v.name,mediaType:'video',template:'psychology-video-remix',sourceType:'video-hits',count:connections.length,connectionIds:connections,scheduleAt,intervalMinutes,requestId:body.requestId,minFollowers,...(body.tiktokOne?{tiktokOne:normalizeOneProject(body.tiktokOne)}:{})};
   accounts=(await assertOfficialPublishAccess(env,user,{module:'psychology',connectionIds:connections})).accounts;
   await assertPublishFollowers(env.DB,config,accounts);
   // Use existing explicit TikTok One join/prepare semantics before committing a publishing batch.
   await ensurePsychologyOneMembers(env,user,config,accounts);
   batchId='psy-vh-'+(await sha256Hex(user.id+':'+body.requestId)).slice(0,32);
  }
  const id='vh-render-'+(await sha256Hex(user.id+':'+body.requestId)).slice(0,32),stamp=Date.now(),db=env.DB;
  const statements=[
   db.prepare('UPDATE psychology_video_hit_versions SET revision=revision WHERE source_id=? AND version=? AND revision=? AND enabled=1').bind(source.id,n,v.revision),guard(db),
   db.prepare('UPDATE psychology_video_hits SET revision=revision WHERE id=? AND revision=?').bind(source.id,source.revision),guard(db)];
  if(publishing)statements.push(
   db.prepare('INSERT INTO psychology_publish_batches(id,created_by,config_json,created_at) VALUES(?,?,?,?)').bind(batchId,user.username,JSON.stringify(config),stamp),
   db.prepare('INSERT INTO psychology_publish_groups(id,batch_id,ordinal,expected_count) VALUES(?,?,0,?)').bind(batchId+'-group-0',batchId,connections.length));
  const jobs=[];
  connections.forEach((connectionId,i)=>{
   const jobId=publishing?batchId+'-'+String(i).padStart(3,'0'):id;
   const automation={id:jobId,batchId,groupId:batchId+'-group-0',submissionMode:'grouped',connectionId,scheduleAt:scheduleAt+i*intervalMinutes*60,mediaType:'video',template:'psychology-video-remix'};
   const publish={provider:'official',autoPublish:true,connectionIds:[connectionId],officialAccounts:accounts.filter(a=>String(a.connectionId||a.id)===connectionId),scheduleAt:automation.scheduleAt,intervalMinutes,videoDesc:v.caption||v.title,isAiGenerated:body.isAiGenerated,envIds:[],accounts:[]};
   const payload={module:'psychology',videoRemix:snapshot,...(publishing?{psychologyAutomation:automation,publish}:{})};
   statements.push(insertAutoJob(db,{id:jobId,type:'psychology-video-remix',title:v.title,createdBy:user.username,payload},stamp));jobs.push(jobId);
   if(publishing){statements.push(db.prepare('INSERT INTO psychology_publish_items(id,batch_id,source_id,job_id,connection_id,schedule_at,publish_group_id) VALUES(?,?,?,?,?,?,?)').bind(jobId,batchId,source.id+':v'+n,jobId,connectionId,automation.scheduleAt,automation.groupId));
    statements.push(db.prepare('INSERT INTO psychology_peer_account_usage(source_id,connection_id,item_id) VALUES(?,?,?)').bind(source.id+':v'+n,connectionId,jobId));}
  });
  return {statements,result:{accepted:true,...(batchId?{batchId}:{}),jobIds:jobs,sourceId:source.id,version:n,mode:match[3]}};
 });
}
