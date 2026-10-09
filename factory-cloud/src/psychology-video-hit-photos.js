import {videoHitUser,sourceRow,versionRow,allFrames,assertAssets} from './psychology-video-hits.js';
import {normalizeHitRef,hitPublishStatements} from './psychology-video-hit-publishing.js';
import {assetPin} from './psychology-video-hit-cleanup.js';
import {insertAutoJob} from './psychology-auto-publish.js';
import {dispatchCloudPhotos} from './psychology-cloud-queue.js';
import {imageType,VIDEO_HIT_IMAGE_MAX} from './psychology-video-hit-assets.js';
import {imageUrl} from '../../scripts/psychology-video-hit-contract.js';
import {json} from './http.js';
const fail=(message,statusCode=409)=>{throw Object.assign(new Error(message),{statusCode});};
// Admission policy; frozen jobs created before this limit keep their transport compatibility.
export const MAX_HIT_PHOTOS=15;
function validateFrames(frames){if(frames.length<1||frames.length>MAX_HIT_PHOTOS)fail('每条图文需要 1–15 张二创图片，请调整版本后再发布。');if(frames.some((f,i)=>f.index!==i+1||(!f.assetId&&!f.imageUrl)))fail('二创图片帧号须从 1 连续排列，请补齐图片。');}
export async function hitPhotoInventory(env,actor,url){
 const user=await videoHitUser(env.DB,actor),page=Number(url.searchParams.get('page')||1),query=String(url.searchParams.get('q')||'').slice(0,100),size=12;
 if(!Number.isInteger(page)||page<1||page>10000)fail('页码无效。',400);
 const where="s.owner_id=? AND s.archived_at=0 AND v.input_mode='frames' AND v.enabled=1 AND v.cleaned_at=0 AND v.publish_item_id='' AND (s.title LIKE ? OR v.title LIKE ? OR v.caption LIKE ?)",args=[user.id,'%'+query+'%','%'+query+'%','%'+query+'%'];
 const count=await env.DB.prepare('SELECT COUNT(*) n FROM psychology_video_hit_versions v JOIN psychology_video_hits s ON s.id=v.source_id WHERE '+where).bind(...args).first();
 const rows=await env.DB.prepare('SELECT v.*,s.title source_title FROM psychology_video_hit_versions v JOIN psychology_video_hits s ON s.id=v.source_id WHERE '+where+' ORDER BY v.created_at DESC,v.source_id,v.version LIMIT ? OFFSET ?').bind(...args,size,(page-1)*size).all();
 const items=[];for(const v of rows.results){const frames=await allFrames(env.DB,v.source_id,v.version);let reason='';try{validateFrames(frames);await assertAssets(env.DB,user,frames);}catch(e){reason=e.message;}items.push({ref:{sourceId:v.source_id,version:v.version,revision:v.revision},title:v.title.slice(0,90),caption:v.caption||v.title,sourceTitle:v.source_title,name:v.name,frameCount:frames.length,frames:frames.slice(0,MAX_HIT_PHOTOS).map(f=>({index:f.index,previewUrl:f.previewUrl})),eligible:!reason,reason});}
 return json({page,pageSize:size,total:count.n,hasMore:page*size<count.n,items});
}
export async function createHitPhotoBatch(env,actor,config,batchId,accounts){
 const user=await videoHitUser(env.DB,actor);if(!env.ARCHIVE||!env.PHOTO_QUEUE||!env.PHOTO_BROWSER)fail('图文发布服务尚未配置。',503);
 const entries=[];for(const ref of config.photoVersions){const origin=normalizeHitRef(ref),source=await sourceRow(env.DB,origin.sourceId,user),v=await versionRow(env.DB,source.id,origin.version,user);
  if(source.archived_at||v.input_mode!=='frames'||!v.enabled||v.cleaned_at||v.publish_item_id||v.revision!==origin.revision)fail('二创版本已修改、停用或提交发布，请刷新后重新选择。');
  const frames=await allFrames(env.DB,source.id,v.version);validateFrames(frames);await assertAssets(env.DB,user,frames);
  entries.push({user,origin,source,v,frames});
 }
 const db=env.DB,stamp=Date.now(),statements=[db.prepare('INSERT INTO psychology_publish_batches(id,created_by,config_json,created_at) VALUES(?,?,?,?)').bind(batchId,user.username,JSON.stringify(config),stamp)];
 for(let i=0;i<entries.length;i+=20)statements.push(db.prepare('INSERT INTO psychology_publish_groups(id,batch_id,ordinal,expected_count) VALUES(?,?,?,?)').bind(batchId+'-group-'+Math.floor(i/20),batchId,Math.floor(i/20),Math.min(20,entries.length-i)));
 entries.forEach((hit,i)=>{const id=batchId+'-'+String(i).padStart(3,'0'),connectionId=config.connectionIds[i%config.connectionIds.length],scheduleAt=config.scheduleAt+Math.floor(i/config.connectionIds.length)*config.intervalMinutes*60+(i%config.connectionIds.length)*(config.staggerSeconds||0),groupId=batchId+'-group-'+Math.floor(i/20),account=accounts.find(a=>String(a.connectionId||a.id)===connectionId)||{};
  const payload={module:'psychology',cloudPhotoRender:true,photoAutomation:true,hitPhoto:true,videoHitOrigin:hit.origin,plan:{title:hit.v.title.slice(0,90),caption:hit.v.caption||hit.v.title},pages:hit.frames.map(({index,assetId,imageUrl})=>({index,assetId,imageUrl})),psychologyAutomation:{id,batchId,groupId,submissionMode:'grouped',connectionId,scheduleAt,mediaType:'photo',template:'selected-photo',isAiGenerated:config.isAiGenerated,musicSoundId:config.musicIds[i%config.musicIds.length]||'',account:{connectionId,username:account.username||'',name:account.displayName||account.username||''}}};
  statements.push(...hitPublishStatements(db,hit,id,stamp));for(const assetId of new Set(hit.frames.map(f=>f.assetId).filter(Boolean)))statements.push(...assetPin(db,user,assetId,'image',stamp));
  statements.push(insertAutoJob(db,{id,type:'psychology',title:hit.v.title,payload,createdBy:user.username},stamp),db.prepare('INSERT INTO psychology_publish_items(id,batch_id,source_id,job_id,connection_id,schedule_at,publish_group_id) VALUES(?,?,?,?,?,?,?)').bind(id,batchId,hit.source.id+':v'+hit.v.version,id,connectionId,scheduleAt,groupId),db.prepare('INSERT INTO psychology_peer_account_usage(source_id,connection_id,item_id) VALUES(?,?,?)').bind(hit.source.id+':v'+hit.v.version,connectionId,id));
 });
 try{await db.batch(statements);}catch(e){const prior=await db.prepare('SELECT config_json FROM psychology_publish_batches WHERE id=? AND created_by=?').bind(batchId,user.username).first();if(prior?.config_json===JSON.stringify(config))return json({accepted:true,duplicate:true,batchId});if(/CHECK constraint|UNIQUE constraint/.test(e.message))fail('二创已被其他任务占用或发生修改，请刷新后重新选择。');throw e;}
 try{await dispatchCloudPhotos(env);}catch{ /* The existing minute dispatcher recovers committed jobs. */ }
 return json({accepted:true,batchId,count:entries.length},202);
}
export async function loadHitPhotoImage(env,job,index){
 const p=JSON.parse(job.payload_json),frame=p.pages[index];if(!frame)fail('图片序号无效。',404);
 let response;
 if(frame.assetId){const asset=await env.DB.prepare("SELECT a.* FROM psychology_video_hit_assets a JOIN factory_users u ON u.id=a.owner_id WHERE a.id=? AND u.username=? AND a.cleanup_state='active'").bind(frame.assetId,job.created_by).first();if(!asset)fail('图片不存在、已清理或无权访问。',404);const object=await env.ARCHIVE.get(asset.r2_key);if(!object)fail('图片文件已失效。',410);response=new Response(object.body,{headers:{'Content-Type':asset.content_type}});}
 else{let address=imageUrl(frame.imageUrl);for(let hop=0;hop<4;hop++){response=await (env.fetch||fetch)(address,{redirect:'manual',signal:AbortSignal.timeout(30000)});if(![301,302,303,307,308].includes(response.status))break;const location=response.headers.get('location');await response.body?.cancel();if(!location)fail('图片重定向无效。');address=imageUrl(new URL(location,address).href);}}
 if(!response?.ok)fail('图片读取失败，请检查二创图片链接。',502);
 const type=(response.headers.get('content-type')||'').split(';')[0].toLowerCase(),reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>VIDEO_HIT_IMAGE_MAX)fail('每张二创图片最多 8MB。',413);chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}imageType(bytes,type);return new Response(bytes,{headers:{'Content-Type':type}});
}
