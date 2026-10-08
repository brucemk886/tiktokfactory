import {json,readJson,sha256Hex} from './http.js';
import {loadAutoUser,assertAutoJobAccess,insertAutoJob} from './psychology-auto-publish.js';
import {assertOfficialPublishAccess} from './official.js';
import {assertPublishFollowers} from './psychology-publish-followers.js';
import {ensurePsychologyOneMembers} from './psychology-tiktok-one.js';
import {normalizeOneProject} from '../../scripts/psychology-auto-publish.js';
import {signalDeskBinary} from './signal-desk.js';
import {stagePublishItem} from './psychology-publish-groups.js';
const BASE='/api/psychology-video-library',MAX=95*1024*1024;
const TYPES={mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm'};
const JOBS="'psychology-video-remix','psychology','psychology-collage','psychology-target-2','psychology-narrative'";
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
const parse=value=>{try{return JSON.parse(value||'{}');}catch{return {};}};
const fileName=value=>{const name=String(value||'');if(!name||name.length>180||/[\\/\x00-\x1f]/.test(name)||!TYPES[name.split('.').pop().toLowerCase()])fail('只支持文件名有效的 MP4、MOV、WebM 视频。');return name;};
const publicAsset=row=>({id:row.id,fileName:row.file_name,title:row.file_name,sourceJobId:row.source_job_id,resultIndex:row.result_index,fileSize:row.file_size,status:row.status,createdAt:row.created_at,previewUrl:row.status==='ready'?BASE+'/'+row.id+'/file':''});
async function owned(db,id,user){const row=await db.prepare('SELECT * FROM psychology_video_assets WHERE id=? AND owner=?').bind(id,user.username).first();if(!row)fail('视频不存在或无权访问。',404);return row;}
export function normalizeSelectedPublish(input,now=Date.now(),replay=false){
 if(!/^[0-9a-f-]{36}$/i.test(String(input.requestId||'')))fail('提交编号无效。');
 if(!Array.isArray(input.items)||input.items.length<1||input.items.length>20)fail('每批请选择1–20条成片。');
 const items=input.items.map(item=>{
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(String(item.assetId||''))||!String(item.connectionId||'').trim())fail('请为每条视频选择账号。');
  if(typeof item.caption!=='string'||item.caption.length>2200)fail('发布文案最多2200字。');
  if(typeof item.isAiGenerated!=='boolean')fail('请确认视频的 AI 内容标识。');
  if(!Number.isSafeInteger(item.scheduleAt)||item.scheduleAt<=0||(!replay&&(item.scheduleAt<Math.floor(now/1000)+300||item.scheduleAt*1000>now+14*86400000)))fail('发布时间需要在5分钟后、14天内。');
  return {assetId:item.assetId,connectionId:String(item.connectionId).trim(),caption:item.caption,scheduleAt:item.scheduleAt,isAiGenerated:item.isAiGenerated};
 });
 if(new Set(items.map(i=>i.assetId+':'+i.connectionId)).size!==items.length)fail('同一视频不能在同一批重复分配给同一账号。');
 return {requestId:input.requestId,name:String(input.name||'TikTok One · 选片发布').trim().slice(0,100),mediaType:'video',template:'selected-video',sourceType:'selected-videos',count:items.length,minFollowers:1000,connectionIds:[...new Set(items.map(i=>i.connectionId))],tiktokOne:normalizeOneProject(input.tiktokOne),items};
}
async function selectedPublish(request,env,user){
 const body=await readJson(request);
 const batchId='psy-select-'+(await sha256Hex(user.username+':'+String(body.requestId||''))).slice(0,32);
 const existing=await env.DB.prepare('SELECT config_json FROM psychology_publish_batches WHERE id=? AND created_by=?').bind(batchId,user.username).first();
 const config=normalizeSelectedPublish(body,Date.now(),Boolean(existing));
 if(existing){if(existing.config_json!==JSON.stringify(config))fail('该提交编号已用于其他配置。',409);return json({accepted:true,duplicate:true,batchId});}
 const scoped=await assertOfficialPublishAccess(env,user,{module:'psychology',connectionIds:config.connectionIds});
 const assets=[];for(const item of config.items){const asset=await owned(env.DB,item.assetId,user);if(await env.DB.prepare('SELECT id FROM psychology_video_hit_videos WHERE id=? UNION ALL SELECT asset_id id FROM psychology_video_hit_render_assets WHERE asset_id=?').bind(asset.id,asset.id).first())fail('视频爆款成片请从其二创版本提交发布，以保留一次发布保护。',409);if(asset.status!=='ready'||!await env.ARCHIVE.head(asset.r2_key))fail('视频未准备好或文件已失效，请重新上传。',409);assets.push(asset);}
 await assertPublishFollowers(env.DB,config,scoped.accounts);
 await ensurePsychologyOneMembers(env,user,config,scoped.accounts);
 const stamp=Date.now(),groupId=batchId+'-group-0',statements=[
  env.DB.prepare('INSERT INTO psychology_publish_batches(id,created_by,config_json,created_at) VALUES(?,?,?,?)').bind(batchId,user.username,JSON.stringify(config),stamp),
  env.DB.prepare('INSERT INTO psychology_publish_groups(id,batch_id,ordinal,expected_count) VALUES(?,?,0,?)').bind(groupId,batchId,config.count)];
 config.items.forEach((entry,index)=>{
  const id=batchId+'-'+String(index).padStart(3,'0'),asset=assets[index];
  const automation={id,batchId,groupId,submissionMode:'grouped',connectionId:entry.connectionId,scheduleAt:entry.scheduleAt,mediaType:'video',template:'selected-video'};
  statements.push(insertAutoJob(env.DB,{id,type:'psychology-selected-video',title:asset.file_name,createdBy:user.username,payload:{module:'psychology',assetId:asset.id,publishOnly:true,psychologyAutomation:automation,publish:{videoDesc:entry.caption,isAiGenerated:entry.isAiGenerated}}},stamp));
  statements.push(env.DB.prepare('INSERT INTO psychology_publish_items(id,batch_id,source_id,job_id,connection_id,schedule_at,publish_group_id) VALUES(?,?,?,?,?,?,?)').bind(id,batchId,'video:'+asset.id,id,entry.connectionId,entry.scheduleAt,groupId));
 });
 try{await env.DB.batch(statements);}catch(error){const winner=await env.DB.prepare('SELECT config_json FROM psychology_publish_batches WHERE id=?').bind(batchId).first();if(winner?.config_json!==JSON.stringify(config))throw error;}
 return json({accepted:true,batchId},202);
}
export async function handleVideoLibrary(request,env,url,session){
 if(!url.pathname.startsWith(BASE)&&url.pathname!=='/api/psychology-video-publish')return null;
 const user=await loadAutoUser(env.DB,session?.user?.username);
 if(!env.ARCHIVE)fail('视频存储尚未配置。',503);
 if(!['GET','HEAD'].includes(request.method)&&request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)fail('请求来源无效。',403);
 if(url.pathname==='/api/psychology-video-publish'){if(request.method!=='POST')fail('不支持此请求。',405);return selectedPublish(request,env,user);}
 const file=url.pathname.match(/^\/api\/psychology-video-library\/([a-zA-Z0-9_-]+)\/file$/);
 if(file&&['GET','HEAD'].includes(request.method)){
  const row=await owned(env.DB,file[1],user);if(row.status!=='ready')fail('视频尚未准备好。',409);
  const object=await env.ARCHIVE.get(row.r2_key,{range:request.headers});if(!object)fail('视频文件已失效。',404);
  const headers=new Headers({'Content-Type':row.content_type,'Cache-Control':'private, no-store','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'});
  const range=object.range;if(range?.length){headers.set('Content-Range',`bytes ${range.offset}-${range.offset+range.length-1}/${object.size}`);headers.set('Content-Length',String(range.length));}else headers.set('Content-Length',String(object.size));
  return new Response(request.method==='HEAD'?null:object.body,{status:range?.length?206:200,headers});
 }
 if(url.pathname===BASE&&request.method==='GET'){
  const page=Number(url.searchParams.get('page')||1);if(!Number.isInteger(page)||page<1||page>10000)fail('页码无效。');
  const offset=(page-1)*12;
  if(url.searchParams.get('source')==='generated'){
   const sql=`FROM factory_jobs j,json_each(COALESCE(json_extract(j.result_json,'$.results'),json_extract(j.result_json,'$.generatedVideos'),'[]')) v
    LEFT JOIN psychology_video_assets a ON a.source_job_id=j.id AND a.result_index=CAST(v.key AS INTEGER) AND a.owner=?
    LEFT JOIN factory_jobs prep ON prep.id='video-archive-'||a.id
    WHERE j.type IN (${JOBS}) AND j.status='done' AND (j.type<>'psychology-video-remix' OR j.created_by=?) AND json_extract(v.value,'$.fileName') IS NOT NULL`;
   const data=await env.DB.prepare(`SELECT j.id job_id,j.title,j.created_at,j.worker_id,v.key result_index,v.value video,a.id asset_id,a.status,a.file_size,prep.status preparation_status,prep.error preparation_error ${sql} ORDER BY j.created_at DESC,j.id DESC,v.key LIMIT 13 OFFSET ?`).bind(user.username,user.username,offset).all();
   return json({page,hasMore:data.results.length>12,videos:data.results.slice(0,12).map(r=>{const video=parse(r.video);return {id:r.asset_id||'',sourceJobId:r.job_id,resultIndex:Number(r.result_index),title:video.title||r.title,fileName:video.fileName,createdAt:r.created_at,fileSize:r.file_size||0,status:r.status||'local',preparationStatus:r.preparation_status,error:r.preparation_error||'',canPrepare:Boolean(r.worker_id),previewUrl:r.status==='ready'?BASE+'/'+r.asset_id+'/file':''};})});
  }
  const data=await env.DB.prepare("SELECT * FROM psychology_video_assets WHERE owner=? AND source_job_id='' AND status='ready' AND NOT EXISTS(SELECT 1 FROM psychology_video_hit_videos v WHERE v.id=psychology_video_assets.id) ORDER BY created_at DESC,id DESC LIMIT 13 OFFSET ?").bind(user.username,offset).all();
  return json({page,hasMore:data.results.length>12,videos:data.results.slice(0,12).map(publicAsset)});
 }
 if(url.pathname===BASE+'/upload'&&request.method==='POST'){
  const name=fileName(decodeURIComponent(request.headers.get('X-File-Name')||'')),size=Number(request.headers.get('X-File-Size')||0),type=TYPES[name.split('.').pop().toLowerCase()];
  const id=crypto.randomUUID(),stamp=Date.now(),row={id,owner:user.username,file_name:name,content_type:type,file_size:size,r2_key:'psychology-videos/'+user.id+'/'+id,source_job_id:'',result_index:0,status:'ready',created_at:stamp,updated_at:stamp};
  await putVideo(env,row,request,size);
  try{await env.DB.prepare('INSERT INTO psychology_video_assets(id,owner,file_name,content_type,file_size,r2_key,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,row.owner,name,type,size,row.r2_key,'ready',stamp,stamp).run();}catch(error){await env.ARCHIVE.delete(row.r2_key);throw error;}
  return json({video:publicAsset(row)},201);
 }
 if(url.pathname===BASE+'/import'&&request.method==='POST'){
  const body=await readJson(request),index=body.resultIndex;if(!Number.isInteger(index)||index<0||index>100)fail('视频索引无效。');
  const source=await env.DB.prepare(`SELECT * FROM factory_jobs WHERE id=? AND type IN (${JOBS}) AND status='done' AND (type<>'psychology-video-remix' OR created_by=?)`).bind(String(body.jobId||''),user.username).first();
  if(!source||!source.worker_id)fail('找不到可取回的工厂成片，请使用本地上传。',404);
  const result=parse(source.result_json),video=(result.results||result.generatedVideos||[])[index],name=fileName(video?.fileName);
  const id=(await sha256Hex(user.username+':'+source.id+':'+index)).slice(0,32),stamp=Date.now();
  if(source.type==='psychology-video-remix'){const origin=JSON.parse(source.payload_json).videoRemix;await env.DB.prepare('INSERT INTO psychology_video_hit_render_assets(asset_id,source_id,version,owner_id) VALUES(?,?,?,?) ON CONFLICT(asset_id) DO NOTHING').bind(id,origin.sourceId,origin.version,user.id).run();}
  const row=await env.DB.prepare('SELECT * FROM psychology_video_assets WHERE id=? AND owner=?').bind(id,user.username).first();
  if(row?.status==='ready')return json({video:publicAsset(row)});
  await env.DB.batch([
   env.DB.prepare("INSERT INTO psychology_video_assets(id,owner,file_name,content_type,r2_key,source_job_id,result_index,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'pending',?,?) ON CONFLICT(id) DO NOTHING").bind(id,user.username,name,TYPES[name.split('.').pop().toLowerCase()],'psychology-videos/'+user.id+'/'+id,source.id,index,stamp,stamp),
   insertAutoJob(env.DB,{id:'video-archive-'+id,type:'psychology-video-archive',title:'准备视频预览 · '+name,createdBy:user.username,payload:{assetId:id,fileName:name,sourceJobId:source.id,targetWorkerId:source.worker_id,publishOnly:true}},stamp),
   env.DB.prepare("UPDATE factory_jobs SET status='queued',error='',updated_at=? WHERE id=? AND status='failed'").bind(stamp,'video-archive-'+id)
  ]);
  return json({pending:true,assetId:id},202);
 }
 fail('不支持此请求。',405);
}
async function putVideo(env,row,request,size){
 if(!Number.isSafeInteger(size)||size<=0||size>MAX||!request.body)fail('视频大小须在1字节至95MB之间。',413);
 let actual=0;const limiter=new TransformStream({transform(chunk,controller){actual+=chunk.byteLength;if(actual>size||actual>MAX)throw new Error('上传超过声明大小。');controller.enqueue(chunk);},flush(){if(actual!==size)throw new Error('上传未完成。');}});
 const fixed=typeof FixedLengthStream==='function'?new FixedLengthStream(size):new TransformStream();
 try{await Promise.all([env.ARCHIVE.put(row.r2_key,fixed.readable,{httpMetadata:{contentType:row.content_type}}),request.body.pipeThrough(limiter).pipeTo(fixed.writable)]);}catch(error){await env.ARCHIVE.delete(row.r2_key).catch(()=>{});throw error;}
}
// Called only after the shared worker bearer token has been checked.
export async function handleVideoTransfer(request,env,url){
 const match=url.pathname.match(/^\/api\/worker\/psychology-video-transfer\/([a-zA-Z0-9_-]+)$/);if(!match)return null;
 const job=await env.DB.prepare('SELECT * FROM factory_jobs WHERE id=?').bind(match[1]).first();
 if(!job||!['psychology-selected-video','psychology-video-archive'].includes(job.type)||job.status!=='running'||job.worker_id!==request.headers.get('x-factory-worker'))fail('此任务不属于当前工人。',403);
 const user=await loadAutoUser(env.DB,job.created_by),payload=parse(job.payload_json),asset=await owned(env.DB,payload.assetId,user);
 if(job.type==='psychology-video-archive'){
  if(request.method!=='PUT')fail('不支持此请求。',405);
  if(asset.status==='ready')return json({ready:true});
  const size=Number(request.headers.get('X-File-Size'));await putVideo(env,asset,request,size);
  await env.DB.prepare("UPDATE psychology_video_assets SET status='ready',file_size=?,updated_at=? WHERE id=? AND owner=?").bind(size,Date.now(),asset.id,user.username).run();return json({ready:true});
 }
 if(request.method!=='POST')fail('不支持此请求。',405);
 await assertAutoJobAccess(env,job);
 const item=await env.DB.prepare('SELECT * FROM psychology_publish_items WHERE id=? AND job_id=? AND deleted_at=0').bind(payload.psychologyAutomation.id,job.id).first();if(!item)fail('发布任务已取消。',409);
 if(parse(item.receipt_json).batchId)return json(parse(item.receipt_json));
 if(item.ready_json!=='{}')return json(await stagePublishItem(env,item,parse(item.ready_json)));
 const object=await env.ARCHIVE.get(asset.r2_key);if(!object)fail('视频文件已失效，请重新上传。',404);
 const uploaded=await signalDeskBinary(env,env.DB,'/api/v1/publish/assets',{body:object.body,contentType:asset.content_type,fileName:asset.file_name,fileSize:object.size});
 if(!/^(temporary--)?[0-9a-f-]{36}\.(mp4|mov|webm)$/i.test(uploaded.assetKey||''))fail('中台未返回有效视频资产。',502);
 return json(await stagePublishItem(env,item,{mediaType:'video',title:asset.file_name,item:{assetKey:uploaded.assetKey,fileName:asset.file_name,contentType:asset.content_type,fileSize:object.size,postInfo:{caption:payload.publish.videoDesc,isAiGenerated:payload.publish.isAiGenerated,privacyLevel:'PUBLIC_TO_EVERYONE',disableComment:false}}}));
}
