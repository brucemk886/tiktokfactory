import {json} from './http.js';
import {videoHitUser,sourceRow,mutation,guard,VIDEO_HITS_BASE} from './psychology-video-hits.js';
import {readManagementBody} from './psychology-management-api.js';
import {only,fail} from '../../scripts/psychology-video-hit-contract.js';
import {insertAutoJob} from './psychology-auto-publish.js';
export const VIDEO_HIT_GRACE_MS=86400000;
const RETRY_MS=7*86400000;
const LOCAL_STALE_MS=15*60000;
const jobHold=(kind,ref)=>`EXISTS(SELECT 1 FROM psychology_video_hit_job_assets r JOIN factory_jobs j ON j.id=r.job_id WHERE r.kind='${kind}' AND r.asset_id=${ref} AND (j.status IN ('queued','running') OR (j.status='failed' AND j.updated_at>?)))`;
const localJobHold="EXISTS(SELECT 1 FROM factory_jobs j WHERE (j.status IN ('queued','running') OR (j.status='failed' AND j.updated_at>?)) AND (json_extract(j.payload_json,'$.sourceJobId')=l.job_id OR json_extract(j.payload_json,'$.renderJobId')=l.job_id OR json_extract(j.payload_json,'$.generation.renderJobId')=l.job_id))";
const versionJobHold=`EXISTS(SELECT 1 FROM factory_jobs j WHERE j.status IN ('queued','running') AND ((json_extract(j.payload_json,'$.videoRemix.sourceId')=v.source_id AND json_extract(j.payload_json,'$.videoRemix.version')=v.version) OR (json_extract(j.payload_json,'$.videoHitOrigin.sourceId')=v.source_id AND json_extract(j.payload_json,'$.videoHitOrigin.version')=v.version) OR (json_extract(j.payload_json,'$.generation.videoRemix.sourceId')=v.source_id AND json_extract(j.payload_json,'$.generation.videoRemix.version')=v.version) OR (v.publish_item_id<>'' AND json_extract(j.payload_json,'$.psychologyAutomation.id')=v.publish_item_id)))`;
export function assetPin(db,user,id,kind,now=Date.now()){
 const table=kind==='image'?'psychology_video_hit_assets':'psychology_video_hit_videos';
 return [db.prepare('UPDATE '+table+" SET last_touched_at=? WHERE id=? AND owner_id=? AND cleanup_state='active'").bind(now,id,user.id),guard(db)];
}
async function purgeVersion(db,v,now){
 await db.batch([
  db.prepare(`UPDATE psychology_video_hit_versions AS v SET cleaned_at=?,enabled=0,script='',caption='',cleaned_frame_count=(SELECT COUNT(*) FROM psychology_video_hit_frames f WHERE f.source_id=v.source_id AND f.version=v.version) WHERE source_id=? AND version=? AND publish_state='published' AND published_at>0 AND published_at<=? AND cleaned_at=0 AND NOT ${versionJobHold}`).bind(now,v.source_id,v.version,now-VIDEO_HIT_GRACE_MS),guard(db),
  db.prepare('DELETE FROM psychology_video_hit_frames WHERE source_id=? AND version=?').bind(v.source_id,v.version),
  db.prepare(`UPDATE factory_jobs SET payload_json=json_remove(payload_json,'$.videoRemix.script','$.videoRemix.caption','$.videoRemix.frames','$.generation.videoRemix.script','$.generation.videoRemix.caption','$.generation.videoRemix.frames','$.publish.videoDesc','$.generation.publish.videoDesc','$.videos[0].narration','$.generatedVideos[0].narration'),result_json=json_remove(result_json,'$.results[0].narration') WHERE status IN ('done','cancelled') AND ((json_extract(payload_json,'$.videoRemix.sourceId')=? AND json_extract(payload_json,'$.videoRemix.version')=?) OR (json_extract(payload_json,'$.videoHitOrigin.sourceId')=? AND json_extract(payload_json,'$.videoHitOrigin.version')=?) OR (json_extract(payload_json,'$.generation.videoRemix.sourceId')=? AND json_extract(payload_json,'$.generation.videoRemix.version')=?))`).bind(v.source_id,v.version,v.source_id,v.version,v.source_id,v.version)
 ]);
}
async function deleteFile(env,{table,id,key,prefix,mirror=false,generation},now){
 try{if(!key.startsWith(prefix)||key===prefix)throw Error('清理对象不在该模块的存储目录内。');await env.ARCHIVE.delete(key);
  const result=await env.DB.batch([
   env.DB.prepare('UPDATE '+table+" SET cleanup_state='deleted',cleaned_at=?,cleanup_error='' WHERE id=? AND cleanup_state='deleting' AND r2_key=? AND cleanup_generation=?").bind(now,id,key,generation),
   ...(mirror?[env.DB.prepare("UPDATE psychology_video_assets SET cleanup_state='deleted',cleaned_at=?,cleanup_error='' WHERE id=? AND cleanup_state='deleting' AND r2_key=? AND EXISTS(SELECT 1 FROM psychology_video_hit_videos v WHERE v.id=? AND v.cleanup_generation=? AND v.cleanup_state='deleted')").bind(now,id,key,id,generation)]:[])
  ]);return Boolean(result[0]?.meta?.changes);
 }catch(error){await env.DB.prepare('UPDATE '+table+" SET cleanup_error=?,"+(table==='psychology_video_assets'?'updated_at':'last_touched_at')+"=? WHERE id=? AND cleanup_state='deleting' AND cleanup_generation=?").bind(String(error.message).slice(0,300),now,id,generation).run();return false;}
}
// A late upload may finish after GC deleted the previous object. Reopen a durable
// deletion receipt before compensation; a newer generation fences older collectors.
export async function discardExpiredVideoHitUpload(env,{kind,id,key,ownerId},now=Date.now()){
 const video=kind==='video',table=video?'psychology_video_hit_videos':'psychology_video_hit_assets';
 const claim=await env.DB.prepare('UPDATE '+table+" SET cleanup_state='deleting',cleanup_generation=cleanup_generation+1,cleaned_at=0,last_touched_at=? WHERE id=? AND owner_id=? AND r2_key=? AND cleanup_state IN ('deleting','deleted')").bind(now,id,ownerId,key).run();
 if(!claim.meta?.changes)return;
 const row=await env.DB.prepare('SELECT cleanup_generation FROM '+table+' WHERE id=?').bind(id).first();
 if(video)await env.DB.prepare("UPDATE psychology_video_assets SET cleanup_state='deleting',cleaned_at=0 WHERE id=? AND r2_key=?").bind(id,key).run();
 await deleteFile(env,{table,id,key,prefix:(video?'psychology-video-hit-videos/':'psychology-video-hits/')+ownerId+'/',mirror:video,generation:row.cleanup_generation},now);
}
export async function collectVideoHitAssets(env,{now=Date.now(),limit=50}={}){
 if(!env.ARCHIVE)return {skipped:'storage-unavailable'};
 limit=Math.max(1,Math.min(100,limit));const db=env.DB,cutoff=now-VIDEO_HIT_GRACE_MS,retryCutoff=now-RETRY_MS;
 const stats={versions:0,sources:0,files:0,retryPending:0,localQueued:0};
 const versions=(await db.prepare(`SELECT v.* FROM psychology_video_hit_versions v WHERE publish_state='published' AND published_at>0 AND published_at<=? AND cleaned_at=0 AND NOT ${versionJobHold} ORDER BY published_at LIMIT 10`).bind(cutoff).all()).results;
 for(const v of versions){try{await purgeVersion(db,v,now);stats.versions++;}catch(error){if(!/CHECK constraint/i.test(error.message))throw error;}}
 const sources=(await db.prepare("SELECT id FROM psychology_video_hits h WHERE archived_at>0 AND archived_at<=? AND originals_cleaned_at=0 AND NOT EXISTS(SELECT 1 FROM psychology_video_hit_versions v WHERE v.source_id=h.id AND (v.publish_state<>'published' OR v.cleaned_at=0)) LIMIT 10").bind(cutoff).all()).results;
 for(const h of sources){try{await db.batch([
  db.prepare("UPDATE psychology_video_hits SET originals_cleaned_at=?,script='',caption='' WHERE id=? AND originals_cleaned_at=0 AND archived_at>0").bind(now,h.id),guard(db),
  db.prepare('DELETE FROM psychology_video_hit_frames WHERE source_id=? AND version=0').bind(h.id)
 ]);stats.sources++;}catch(error){if(!/CHECK constraint/i.test(error.message))throw error;}}
 // Recover only this idempotent cleanup type, never rendering or publishing jobs.
 await db.prepare("UPDATE factory_jobs SET status='done',percent=100,error='',message='已确认本机成片清理',completed_at=?,updated_at=? WHERE id IN (SELECT j.id FROM factory_jobs j JOIN psychology_video_hit_local_files l ON l.cleanup_job_id=j.id WHERE j.type='psychology-video-cleanup' AND j.status IN ('queued','running','failed') AND j.updated_at<=? AND l.cleaned_at>0 LIMIT 10)").bind(now,now,now-LOCAL_STALE_MS).run();
 const local=(await db.prepare(`SELECT l.*,u.username,j.status cleanup_status FROM psychology_video_hit_local_files l JOIN psychology_video_hit_versions v ON v.source_id=l.source_id AND v.version=l.version JOIN factory_users u ON u.id=l.owner_id LEFT JOIN factory_jobs j ON j.id=l.cleanup_job_id WHERE v.cleaned_at>0 AND v.publish_state='published' AND l.cleaned_at=0 AND (l.cleanup_job_id='' OR j.id IS NULL OR (j.status='failed' AND j.updated_at<=?) OR (j.type='psychology-video-cleanup' AND j.status='running' AND j.updated_at<=?)) AND NOT ${localJobHold} ORDER BY COALESCE(j.updated_at,l.created_at),l.job_id LIMIT 10`).bind(now-300000,now-LOCAL_STALE_MS,retryCutoff).all()).results;
 for(const file of local){const id='vh-cleanup-'+file.job_id;try{await db.batch([
  db.prepare(`UPDATE psychology_video_hit_local_files AS l SET cleanup_job_id=? WHERE job_id=? AND cleaned_at=0 AND NOT ${localJobHold}`).bind(id,file.job_id,retryCutoff),guard(db),
  ['failed','running'].includes(file.cleanup_status)?db.prepare("UPDATE factory_jobs SET status='queued',available_at=?,worker_id='',claimed_at=0,error='',message='重试已发布素材清理',updated_at=? WHERE id=? AND type='psychology-video-cleanup' AND ((status='failed' AND updated_at<=?) OR (status='running' AND updated_at<=?))").bind(now,now,id,now-300000,now-LOCAL_STALE_MS):insertAutoJob(db,{id,type:'psychology-video-cleanup',title:'清理已发布二创成片',createdBy:file.username,payload:{module:'psychology',targetWorkerId:file.worker_id,publishOnly:true,videoHitCleanup:{renderJobId:file.job_id,fileName:file.file_name}}},now),guard(db)
 ]);stats.localQueued++;}catch(error){if(!/CHECK constraint|UNIQUE constraint/i.test(error.message))throw error;}}
 const imageWhere=`NOT EXISTS(SELECT 1 FROM psychology_video_hit_frames f WHERE f.asset_id=a.id) AND NOT ${jobHold('image','a.id')}`;
 const images=(await db.prepare(`SELECT a.* FROM psychology_video_hit_assets a WHERE cleanup_state='deleting' OR (cleanup_state IN ('active','uploading') AND last_touched_at<=? AND ${imageWhere}) ORDER BY last_touched_at,a.id LIMIT ?`).bind(cutoff,retryCutoff,limit).all()).results;
 for(const a of images){if(a.cleanup_state!=='deleting'){const claim=await db.prepare(`UPDATE psychology_video_hit_assets AS a SET cleanup_state='deleting',cleanup_generation=cleanup_generation+1 WHERE id=? AND cleanup_state IN ('active','uploading') AND last_touched_at<=? AND ${imageWhere}`).bind(a.id,cutoff,retryCutoff).run();if(!claim.meta?.changes)continue;a.cleanup_generation++;}
  if(await deleteFile(env,{table:'psychology_video_hit_assets',id:a.id,key:a.r2_key,generation:a.cleanup_generation,prefix:'psychology-video-hits/'+a.owner_id+'/'},now))stats.files++;else stats.retryPending++;}
 const videoWhere=`NOT EXISTS(SELECT 1 FROM psychology_video_hit_versions v WHERE v.video_asset_id=a.id AND v.cleaned_at=0) AND NOT ${jobHold('video','a.id')}`;
 const videos=(await db.prepare(`SELECT a.* FROM psychology_video_hit_videos a WHERE cleanup_state='deleting' OR (cleanup_state IN ('active','uploading') AND last_touched_at<=? AND ${videoWhere}) ORDER BY last_touched_at,a.id LIMIT ?`).bind(cutoff,retryCutoff,limit).all()).results;
 for(const a of videos){if(a.cleanup_state!=='deleting'){const claim=await db.prepare(`UPDATE psychology_video_hit_videos AS a SET cleanup_state='deleting',cleanup_generation=cleanup_generation+1 WHERE id=? AND cleanup_state IN ('active','uploading') AND last_touched_at<=? AND ${videoWhere}`).bind(a.id,cutoff,retryCutoff).run();if(!claim.meta?.changes)continue;a.cleanup_generation++;}await db.prepare("UPDATE psychology_video_assets SET cleanup_state='deleting' WHERE id=? AND r2_key=? AND cleanup_state<>'deleted'").bind(a.id,a.r2_key).run();
  if(await deleteFile(env,{table:'psychology_video_hit_videos',id:a.id,key:a.r2_key,generation:a.cleanup_generation,prefix:'psychology-video-hit-videos/'+a.owner_id+'/',mirror:true},now))stats.files++;else stats.retryPending++;}
 const renderWhere=`EXISTS(SELECT 1 FROM psychology_video_hit_render_assets r JOIN psychology_video_hit_versions v ON v.source_id=r.source_id AND v.version=r.version WHERE r.asset_id=a.id AND r.owner_id=(SELECT id FROM factory_users WHERE username=a.owner) AND v.cleaned_at>0) AND NOT ${jobHold('video','a.id')}`;
 const previews=(await db.prepare(`SELECT a.*,u.id owner_id FROM psychology_video_assets a JOIN factory_users u ON u.username=a.owner WHERE a.cleanup_state='deleting' AND EXISTS(SELECT 1 FROM psychology_video_hit_render_assets r WHERE r.asset_id=a.id AND r.owner_id=u.id) OR (a.cleanup_state='active' AND ${renderWhere}) ORDER BY a.updated_at,a.id LIMIT ?`).bind(retryCutoff,limit).all()).results;
 for(const a of previews){if(a.cleanup_state!=='deleting'){const claim=await db.prepare(`UPDATE psychology_video_assets AS a SET cleanup_state='deleting',cleanup_generation=cleanup_generation+1 WHERE id=? AND cleanup_state='active' AND ${renderWhere}`).bind(a.id,retryCutoff).run();if(!claim.meta?.changes)continue;a.cleanup_generation++;}
  if(await deleteFile(env,{table:'psychology_video_assets',id:a.id,key:a.r2_key,generation:a.cleanup_generation,prefix:'psychology-videos/'+a.owner_id+'/'},now))stats.files++;else stats.retryPending++;}
 return stats;
}
export async function handleVideoHitCleanup(request,env,url,session){
 const archive=url.pathname.match(/^\/api\/psychology-video-hits\/(vh-[a-f0-9]{32})\/archive$/),status=url.pathname===VIDEO_HITS_BASE+'/cleanup';
 if(!archive&&!status)return null;const user=await videoHitUser(env.DB,session?.user),db=env.DB;
 if(status&&request.method==='GET'){
  const images=await db.prepare("SELECT cleanup_state state,COUNT(*) count,COALESCE(SUM(size),0) bytes FROM psychology_video_hit_assets WHERE owner_id=? GROUP BY cleanup_state").bind(user.id).all(),videos=await db.prepare("SELECT cleanup_state state,COUNT(*) count,COALESCE(SUM(size),0) bytes FROM psychology_video_hit_videos WHERE owner_id=? GROUP BY cleanup_state").bind(user.id).all();
  const versions=await db.prepare("SELECT COALESCE(SUM(publish_state='published'),0) published,COALESCE(SUM(cleaned_at>0),0) cleaned,COALESCE(SUM(publish_state='published' AND cleaned_at=0),0) awaitingCleanup FROM psychology_video_hit_versions v JOIN psychology_video_hits h ON h.id=v.source_id WHERE h.owner_id=?").bind(user.id).first();
  const previews=await db.prepare("SELECT a.cleanup_state state,COUNT(*) count,COALESCE(SUM(a.file_size),0) bytes FROM psychology_video_assets a JOIN psychology_video_hit_render_assets r ON r.asset_id=a.id WHERE r.owner_id=? GROUP BY a.cleanup_state").bind(user.id).all();
  const local=await db.prepare("SELECT COUNT(*) total,COALESCE(SUM(l.cleaned_at>0),0) cleaned,COALESCE(SUM(l.cleaned_at=0 AND l.cleanup_job_id<>''),0) queued FROM psychology_video_hit_local_files l WHERE l.owner_id=?").bind(user.id).first();
  const errors=await db.prepare("SELECT 'image' kind,id,cleanup_error error FROM psychology_video_hit_assets WHERE owner_id=? AND cleanup_state='deleting' AND cleanup_error<>'' UNION ALL SELECT 'video',id,cleanup_error FROM psychology_video_hit_videos WHERE owner_id=? AND cleanup_state='deleting' AND cleanup_error<>'' UNION ALL SELECT 'preview',a.id,a.cleanup_error FROM psychology_video_assets a JOIN psychology_video_hit_render_assets r ON r.asset_id=a.id WHERE r.owner_id=? AND a.cleanup_state='deleting' AND a.cleanup_error<>'' UNION ALL SELECT 'local',l.job_id,j.error FROM psychology_video_hit_local_files l JOIN factory_jobs j ON j.id=l.cleanup_job_id WHERE l.owner_id=? AND l.cleaned_at=0 AND j.status='failed' AND j.error<>'' LIMIT 10").bind(user.id,user.id,user.id,user.id).all();
  return json({previews:previews.results,local,errors:errors.results,policy:{graceHours:24,orphanHours:24,failedRetryDays:7,intervalMinutes:5,localStaleMinutes:15},images:images.results,videos:videos.results,versions});
 }
 if(!archive||request.method!=='POST')fail('请求方法无效。',405);
 if((request.headers.get('origin')&&request.headers.get('origin')!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site')fail('不允许跨站修改。',403);
 const body=await readManagementBody(request);only(body,['requestId','revision']);
 return mutation(db,user,body,'archive:'+archive[1],async()=>{
  const h=await sourceRow(db,archive[1],user);if(h.archived_at)fail('来源已结束，原图按保留期清理。',409);if(body.revision!==h.revision)fail('revision已变化。',409);
  const counts=await db.prepare("SELECT COUNT(*) n,SUM(publish_state<>'published') pending FROM psychology_video_hit_versions WHERE source_id=?").bind(h.id).first();
  if(!counts.n||counts.pending)fail('需等全部已创建版本确认发布成功，才能结束来源并清理原图。',409);
  const now=Date.now();return {statements:[db.prepare("UPDATE psychology_video_hits SET archived_at=?,revision=revision+1 WHERE id=? AND owner_id=? AND revision=? AND archived_at=0 AND NOT EXISTS(SELECT 1 FROM psychology_video_hit_versions v WHERE v.source_id=psychology_video_hits.id AND v.publish_state<>'published')").bind(now,h.id,user.id,h.revision),guard(db)],result:{ok:true,id:h.id,archivedAt:now,revision:h.revision+1}};
 });
}

// Called only after the common worker bearer-token check in jobs.js.
export async function handleVideoHitWorkerCleanup(request,env,url){
 const match=url.pathname.match(/^\/api\/worker\/psychology-video-hits\/cleanup\/([a-zA-Z0-9_-]+)(\/done)?$/);if(!match)return null;
 if(request.method!=='POST')fail('请求方法无效。',405);
 const job=await env.DB.prepare('SELECT * FROM factory_jobs WHERE id=?').bind(match[1]).first(),worker=request.headers.get('x-factory-worker');
 if(!job||job.type!=='psychology-video-cleanup'||job.status!=='running'||!worker||job.worker_id!==worker)fail('此清理任务不属于当前接单工人。',403);
 const p=JSON.parse(job.payload_json||'{}'),file=await env.DB.prepare(`SELECT l.*,v.cleaned_at version_cleaned_at,v.publish_state,u.username FROM psychology_video_hit_local_files l JOIN psychology_video_hit_versions v ON v.source_id=l.source_id AND v.version=l.version JOIN factory_users u ON u.id=l.owner_id WHERE l.cleanup_job_id=? AND NOT ${localJobHold}`).bind(job.id,Date.now()-RETRY_MS).first();
 if(!file||file.worker_id!==worker||file.username!==job.created_by||file.publish_state!=='published'||!file.version_cleaned_at||p.targetWorkerId!==worker||p.videoHitCleanup?.renderJobId!==file.job_id||p.videoHitCleanup?.fileName!==file.file_name||file.file_name!==file.job_id+'.mp4')fail('成片清理条件未满足。',409);
 if(!match[2]){
  const body=await readManagementBody(request);only(body,['outputPath']);
  if(body.outputPath!==undefined){
   const location=body.outputPath,parts=typeof location==='string'?location.split(/[\\/]/):[];
   if(typeof location!=='string'||location.length>4096||/[\x00-\x1f]/.test(location)||!(/^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/.test(location))||parts.at(-1)!==file.file_name||parts.some(part=>part==='..'||part==='.'))fail('记录的成片路径或文件名无效。');
   if(file.output_path&&file.output_path!==location)fail('原成片路径已记录，不能改写。',409);
   await env.DB.batch([env.DB.prepare("UPDATE psychology_video_hit_local_files SET output_path=? WHERE job_id=? AND cleanup_job_id=? AND cleaned_at=0 AND (output_path='' OR output_path=?) AND EXISTS(SELECT 1 FROM factory_jobs j WHERE j.id=? AND j.status='running' AND j.worker_id=?)").bind(location,file.job_id,job.id,location,job.id,worker),guard(env.DB)]);
   file.output_path=location;
  }
 }
 if(match[2])await env.DB.prepare('UPDATE psychology_video_hit_local_files SET cleaned_at=? WHERE job_id=? AND cleanup_job_id=? AND cleaned_at=0').bind(Date.now(),file.job_id,job.id).run();
 return json({ok:true,renderJobId:file.job_id,fileName:file.file_name,outputPath:file.output_path||'',cleanedAt:file.cleaned_at||0});
}
