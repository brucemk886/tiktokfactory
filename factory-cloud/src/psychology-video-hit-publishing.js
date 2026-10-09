import {videoHitUser,sourceRow,versionRow,guard} from './psychology-video-hits.js';
import {assetPin} from './psychology-video-hit-cleanup.js';
import {readyVideo} from './psychology-video-hit-videos.js';
import {insertAutoJob} from './psychology-auto-publish.js';
import {officialPublishFollowupPayload} from './jobs.js';
import {ensurePsychologyOneMembers} from './psychology-tiktok-one.js';
import {json} from './http.js';
const fail=(message,statusCode=409)=>{throw Object.assign(new Error(message),{statusCode});};
export function normalizeHitRef(ref){
 if(!ref||!/^vh-[a-f0-9]{32}$/.test(ref.sourceId||'')||!Number.isInteger(ref.version)||ref.version<1||ref.version>2147483647||!Number.isSafeInteger(ref.revision)||ref.revision<1)fail('二创版本标识无效，请刷新视频列表。',400);
 return {sourceId:ref.sourceId,version:ref.version,revision:ref.revision};
}
// Inventory is private and excludes reserved, cleaned, disabled and stale renders.
export async function hitVideoInventory(env,actor,{page=1,limit=20,selection='recent',query=''}={}){
 const user=await videoHitUser(env.DB,actor),order={random:'RANDOM()',popular:"CAST(COALESCE(json_extract(s.video_data_json,'$.playCount'),0) AS INTEGER) DESC,v.created_at DESC",recent:'v.created_at DESC,s.id,v.version'}[selection]||'v.created_at DESC,s.id,v.version';
 const data=await env.DB.prepare(`SELECT v.*,s.revision source_revision,s.title source_title,j.worker_id,j.result_json,a.id asset_id,a.file_name,a.file_size,a.status asset_status,prep.status preparation_status,prep.error preparation_error
 FROM psychology_video_hit_versions v JOIN psychology_video_hits s ON s.id=v.source_id
 LEFT JOIN factory_jobs j ON j.id=v.render_job_id AND j.status='done' AND j.created_by=?
 LEFT JOIN psychology_video_assets a ON a.owner=? AND a.cleanup_state='active' AND ((v.input_mode='video' AND a.id=v.video_asset_id) OR (v.input_mode='frames' AND a.source_job_id=v.render_job_id AND a.result_index=0))
 LEFT JOIN psychology_video_hit_videos d ON d.id=v.video_asset_id AND d.owner_id=s.owner_id AND d.cleanup_state='active'
 LEFT JOIN factory_jobs prep ON prep.id='video-archive-'||a.id
 WHERE s.owner_id=? AND s.archived_at=0 AND v.enabled=1 AND v.cleaned_at=0 AND v.publish_item_id=''
 AND (v.title LIKE ? OR s.title LIKE ? OR v.caption LIKE ?)
 AND ((v.input_mode='video' AND d.id IS NOT NULL AND a.status='ready' AND NOT EXISTS(SELECT 1 FROM psychology_video_hit_video_usage u WHERE u.owner_id=s.owner_id AND u.digest=d.digest))
 OR (v.input_mode='frames' AND v.render_revision=v.revision AND v.render_source_revision=s.revision AND j.id IS NOT NULL AND j.worker_id<>'' AND json_extract(j.result_json,'$.results[0].fileName') IS NOT NULL))
 ORDER BY `+order+' LIMIT ? OFFSET ?').bind(user.username,user.username,user.id,'%'+query+'%','%'+query+'%','%'+query+'%',limit+1,(page-1)*limit).all();
 return {page,pageSize:limit,hasMore:data.results.length>limit,videos:data.results.slice(0,limit).map(v=>({id:v.source_id+'-v'+v.version,assetId:v.asset_id||'',videoHit:{sourceId:v.source_id,version:v.version,revision:v.revision},title:v.title,caption:v.caption||v.title,sourceTitle:v.source_title,versionName:v.name,inputMode:v.input_mode,fileName:v.file_name||JSON.parse(v.result_json||'{}').results?.[0]?.fileName||'',fileSize:v.file_size||0,createdAt:v.created_at,status:v.asset_status||'local',sourceJobId:v.render_job_id,resultIndex:0,canPrepare:Boolean(v.worker_id),preparationStatus:v.preparation_status,error:v.preparation_error||'',previewUrl:v.asset_status==='ready'?'/api/psychology-video-library/'+v.asset_id+'/file':''}))};
}
export async function resolveHitVideo(env,actor,ref,assetId){
 const user=await videoHitUser(env.DB,actor),origin=normalizeHitRef(ref),source=await sourceRow(env.DB,origin.sourceId,user),v=await versionRow(env.DB,origin.sourceId,origin.version,user);
 if(source.archived_at||!v.enabled||v.cleaned_at||v.publish_item_id||v.revision!==origin.revision)fail('二创已被提交、停用或修改，请刷新后重新选择。');
 let asset=null,render=null,digest='';
 if(v.input_mode==='video'){
  const video=await readyVideo(env.DB,user,v.video_asset_id);digest=video.digest;
  if(await env.DB.prepare('SELECT item_id FROM psychology_video_hit_video_usage WHERE owner_id=? AND digest=?').bind(user.id,digest).first())fail('此成片已提交发布，不能重复使用同一视频文件。');
  asset=await env.DB.prepare("SELECT * FROM psychology_video_assets WHERE id=? AND owner=? AND cleanup_state='active' AND status='ready'").bind(video.id,user.username).first();
 }else{
  if(v.render_revision!==v.revision||v.render_source_revision!==source.revision)fail('二创文案或图片已变化，请先重新合成成片。');
  render=await env.DB.prepare("SELECT * FROM factory_jobs WHERE id=? AND created_by=? AND status='done'").bind(v.render_job_id,user.username).first();
  if(!render?.worker_id||!JSON.parse(render.result_json).results?.[0]?.fileName)fail('二创尚未合成完成。');
  asset=await env.DB.prepare("SELECT * FROM psychology_video_assets WHERE source_job_id=? AND result_index=0 AND owner=? AND cleanup_state='active' AND status='ready'").bind(render.id,user.username).first();
 }
 if(assetId!==undefined&&(!asset||asset.id!==assetId))fail('所选成片已变化，请刷新列表。');
 if(asset&&!await env.ARCHIVE.head(asset.r2_key))fail('成片文件已失效，请重新准备视频。');
 if(!asset&&!render)fail('成片素材不可用。');
 return {user,origin,source,v,asset,render,digest,title:v.title,caption:v.caption||v.title};
}
export function hitPublishStatements(db,hit,id,stamp){
 const {user,source,v,asset,digest}=hit;
 const statements=[db.prepare("UPDATE psychology_video_hit_versions SET publish_state='reserved',publish_item_id=? WHERE source_id=? AND version=? AND revision=? AND enabled=1 AND cleaned_at=0 AND publish_item_id='' AND input_mode=? AND video_asset_id=? AND render_job_id=? AND render_revision=? AND render_source_revision=?").bind(id,source.id,v.version,v.revision,v.input_mode,v.video_asset_id,v.render_job_id,v.render_revision,v.render_source_revision),guard(db),db.prepare('UPDATE psychology_video_hits SET revision=revision WHERE id=? AND owner_id=? AND revision=? AND archived_at=0').bind(source.id,user.id,source.revision),guard(db)];
 if(asset)statements.push(db.prepare("UPDATE psychology_video_assets SET updated_at=? WHERE id=? AND owner=? AND status='ready' AND cleanup_state='active'").bind(stamp,asset.id,user.username),guard(db));
 if(digest)statements.push(...assetPin(db,user,asset.id,'video',stamp),db.prepare('INSERT INTO psychology_video_hit_video_usage(owner_id,digest,asset_id,item_id) VALUES(?,?,?,?)').bind(user.id,digest,asset.id,id));
 return statements;
}
export async function commitVideoBatch(env,user,config,batchId,entries,accounts){
 await ensurePsychologyOneMembers(env,user,config,accounts);
 const db=env.DB,stamp=Date.now(),statements=[db.prepare('INSERT INTO psychology_publish_batches(id,created_by,config_json,created_at) VALUES(?,?,?,?)').bind(batchId,user.username,JSON.stringify(config),stamp)];
 for(let i=0;i<entries.length;i+=20)statements.push(db.prepare('INSERT INTO psychology_publish_groups(id,batch_id,ordinal,expected_count) VALUES(?,?,?,?)').bind(batchId+'-group-'+Math.floor(i/20),batchId,Math.floor(i/20),Math.min(20,entries.length-i)));
 entries.forEach((entry,index)=>{
  const id=batchId+'-'+String(index).padStart(3,'0'),groupId=batchId+'-group-'+Math.floor(index/20),hit=entry.hit,asset=hit?hit.asset:entry.asset,account=accounts.find(a=>String(a.connectionId||a.id)===entry.connectionId)||{};
  const automation={id,batchId,groupId,submissionMode:'grouped',connectionId:entry.connectionId,scheduleAt:entry.scheduleAt,mediaType:'video',template:'selected-video',account:{connectionId:entry.connectionId,username:account.username||'',name:account.displayName||account.username||''}};
  const publish={provider:'official',autoPublish:true,connectionIds:[entry.connectionId],officialAccounts:accounts,scheduleAt:entry.scheduleAt,intervalMinutes:config.intervalMinutes||60,videoDesc:entry.caption,isAiGenerated:entry.isAiGenerated,envIds:[],accounts:[]};
  let type='psychology-selected-video',payload={module:'psychology',...(hit?{videoHitOrigin:hit.origin}:{}),psychologyAutomation:automation,publish};
  if(asset)payload={...payload,assetId:asset.id,publishOnly:true};
  else{type='official-publish';const prior=hit.render;payload={...officialPublishFollowupPayload({...prior,payload_json:JSON.stringify({...JSON.parse(prior.payload_json),...payload})},JSON.parse(prior.result_json)),...payload};}
  if(hit)statements.push(...hitPublishStatements(db,hit,id,stamp));
  statements.push(insertAutoJob(db,{id,type,title:hit?.title||asset.file_name,createdBy:user.username,payload},stamp),db.prepare('INSERT INTO psychology_publish_items(id,batch_id,source_id,job_id,connection_id,schedule_at,publish_group_id) VALUES(?,?,?,?,?,?,?)').bind(id,batchId,hit?hit.source.id+':v'+hit.v.version:'video:'+asset.id,id,entry.connectionId,entry.scheduleAt,groupId));
  if(hit)statements.push(db.prepare('INSERT INTO psychology_peer_account_usage(source_id,connection_id,item_id) VALUES(?,?,?)').bind(hit.source.id+':v'+hit.v.version,entry.connectionId,id));
 });
 try{await db.batch(statements);}catch(error){const existing=await db.prepare('SELECT config_json FROM psychology_publish_batches WHERE id=? AND created_by=?').bind(batchId,user.username).first();if(existing?.config_json===JSON.stringify(config))return json({accepted:true,duplicate:true,batchId});if(/CHECK constraint|UNIQUE constraint/i.test(error.message))fail('所选二创已被其他任务占用，请刷新视频列表重新选择。');throw error;}
 return json({accepted:true,batchId,count:entries.length},202);
}
export async function drawHitVideoBatch(env,user,config,batchId,accounts){
 if(!env.ARCHIVE)fail('成片存储尚未配置。',503);
 const inventory=await hitVideoInventory(env,user,{limit:1000,selection:config.selection,query:config.query}),entries=[],digests=new Set();
 for(const v of inventory.videos){
  const hit=await resolveHitVideo(env,user,v.videoHit);
  if(hit.digest&&digests.has(hit.digest))continue;
  digests.add(hit.digest);
  const i=entries.length;entries.push({hit,connectionId:config.connectionIds[i%config.connectionIds.length],scheduleAt:config.scheduleAt+Math.floor(i/config.connectionIds.length)*config.intervalMinutes*60+(i%config.connectionIds.length)*(config.staggerSeconds||0),caption:hit.caption,isAiGenerated:config.isAiGenerated});
  if(entries.length===config.count)break;
 }
 if(entries.length<config.count)fail('符合条件且未发布的二创成片只有 '+entries.length+' 条，请减少数量或补充成片。',400);
 if(entries.some(e=>e.caption.length>2200))fail('二创发布文案超过2200字，请先在二创详情修改。',400);
 return commitVideoBatch(env,user,config,batchId,entries,accounts);
}
