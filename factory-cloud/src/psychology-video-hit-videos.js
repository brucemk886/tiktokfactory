import {hitAssetScope} from './psychology-video-hit-access.js';
import {discardExpiredVideoHitUpload} from './psychology-video-hit-cleanup.js';
import {json} from './http.js';
import {authenticate} from './factory-api.js';
import {videoHitUser,VIDEO_HITS_BASE,guard} from './psychology-video-hits.js';
import {UUID,fail} from '../../scripts/psychology-video-hit-contract.js';
export const VIDEO_HIT_VIDEO_MAX=95*1024*1024;
const TYPES={mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm'};
export async function readyVideo(db,user,id){
 const access=hitAssetScope(user,'video','v');
 const row=await db.prepare("SELECT v.*,a.status FROM psychology_video_hit_videos v JOIN factory_users uploader ON uploader.id=v.owner_id JOIN psychology_video_assets a ON a.id=v.id AND a.owner=uploader.username WHERE v.id=? AND "+access.sql).bind(id,...access.args).first();
 if(row&&row.cleanup_state!=='active')fail('成片已清理或正在清理。',410);
 if(!row||row.status!=='ready')fail('成片不存在、尚未上传完成或无权访问。',409);return row;
}
const publicVideo=row=>({videoAssetId:row.id,fileName:row.file_name,size:row.size,previewUrl:VIDEO_HITS_BASE+'/videos/'+row.id+'/file'});
export async function handleVideoHitVideos(request,env,url,session){
 const match=url.pathname.match(/^\/api\/(integrations\/psychology\/video-hits|psychology-video-hits)\/videos\/([a-f0-9-]+)(\/file)?$/i);
 if(!match)return null;if(!UUID.test(match[2]))fail('成片上传编号须为UUID。');
 const external=match[1].startsWith('integrations'),actor=external?await authenticate(request,env.DB):session?.user,user=await videoHitUser(env.DB,actor);
 if(!env.ARCHIVE)fail('成片存储尚未配置。',503);
 if(!external&&!['GET','HEAD'].includes(request.method)&&((request.headers.get('origin')&&request.headers.get('origin')!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site'))fail('不允许跨站上传。',403);
 if(match[3]&&['GET','HEAD'].includes(request.method)){
  const row=await readyVideo(env.DB,user,match[2]),object=await env.ARCHIVE.get(row.r2_key,{range:request.headers});if(!object)fail('成片文件不存在。',404);
  const headers=new Headers({'Content-Type':row.content_type,'Cache-Control':'private, no-store','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'}),range=object.range;
  if(range?.length){headers.set('Content-Range','bytes '+range.offset+'-'+(range.offset+range.length-1)+'/'+object.size);headers.set('Content-Length',String(range.length));}else headers.set('Content-Length',String(object.size));
  return new Response(request.method==='HEAD'?null:object.body,{status:range?.length?206:200,headers});
 }
 if(match[3]||request.method!=='PUT')fail('上传使用PUT二进制成片。',405);
 let name;try{name=decodeURIComponent(request.headers.get('X-File-Name')||'');}catch{fail('文件名编码无效。');}
 const size=Number(request.headers.get('X-File-Size')),digest=request.headers.get('X-Content-SHA256')||'',type=TYPES[name.split('.').pop().toLowerCase()];
 if(!type||!name||name.length>180||/[\\/\x00-\x1f]/.test(name)||request.headers.get('content-type')?.split(';')[0]!==type)fail('支持MP4、MOV、WebM，文件名和Content-Type须匹配。');
 if(!Number.isSafeInteger(size)||size<12||size>VIDEO_HIT_VIDEO_MAX||!request.body)fail('成片须为95MB以内的有效视频。',413);
 if(!/^[a-f0-9]{64}$/.test(digest))fail('请提供小写SHA256文件摘要X-Content-SHA256。');
 const db=env.DB,id=match[2],same=row=>row.owner_id===user.id&&row.digest===digest&&row.size===size&&row.file_name===name&&row.content_type===type;
 const prior=await db.prepare('SELECT * FROM psychology_video_hit_videos WHERE id=?').bind(id).first();
 if(prior){if(!same(prior))fail('该上传编号已用于其他成片。',409);if(['deleting','deleted'].includes(prior.cleanup_state))fail('成片已清理或正在清理，请使用新上传编号。',410);if(prior.cleanup_state==='active')return json({...publicVideo(prior),duplicate:true});}
 if(!prior&&await db.prepare('SELECT id FROM psychology_video_assets WHERE id=?').bind(id).first())fail('该编号已用于其他视频资产。',409);
 const key='psychology-video-hit-videos/'+user.id+'/'+id+'/'+digest;
 await db.prepare("INSERT INTO psychology_video_hit_videos(id,owner_id,digest,file_name,content_type,size,r2_key,created_at,last_touched_at,cleanup_state) VALUES(?,?,?,?,?,?,?,?,?,'uploading') ON CONFLICT(id) DO NOTHING").bind(id,user.id,digest,name,type,size,key,Date.now(),Date.now()).run();
 const claim=await db.prepare("UPDATE psychology_video_hit_videos SET last_touched_at=? WHERE id=? AND owner_id=? AND digest=? AND file_name=? AND size=? AND cleanup_state IN ('uploading','active')").bind(Date.now(),id,user.id,digest,name,size).run();if(!claim.meta?.changes)fail('该上传编号已失效或用于其他成片。',409);
 const reader=request.body.getReader();let actual=0,prefix=new Uint8Array(0),validated=false;
 const stream=new ReadableStream({async pull(controller){try{
  const part=await reader.read();if(part.done){if(actual!==size||!validated)fail('上传未完成或视频内容无效。');controller.close();return;}
  actual+=part.value.byteLength;if(actual>size)fail('上传超过声明大小。',413);
  if(!validated){const next=new Uint8Array(Math.min(64,prefix.length+part.value.length));next.set(prefix);next.set(part.value.slice(0,next.length-prefix.length),prefix.length);prefix=next;
   if(prefix.length>=12){const magic=String.fromCharCode(...prefix.slice(4,8));if(type==='video/webm'?!(prefix[0]===26&&prefix[1]===69&&prefix[2]===223&&prefix[3]===163):magic!=='ftyp')fail('视频内容与文件类型不符。');validated=true;}}
  controller.enqueue(part.value);
 }catch(error){await reader.cancel().catch(()=>{});controller.error(error);}},cancel(reason){return reader.cancel(reason);}});
 // R2 verifies the streamed bytes against the supplied SHA256, without buffering a 95MB video in Worker memory.
 const fixed=typeof FixedLengthStream==='function'?new FixedLengthStream(size):new TransformStream();
 try{await Promise.all([env.ARCHIVE.put(key,fixed.readable,{sha256:digest,httpMetadata:{contentType:type}}),stream.pipeTo(fixed.writable)]);}catch(error){if(/checksum|sha256/i.test(error.message))fail('成片内容与SHA256摘要不符，请核对原文件。');throw error;}
 const stamp=Date.now(),row={id,owner_id:user.id,digest,file_name:name,content_type:type,size,r2_key:key};
 try{await db.batch([
  db.prepare("UPDATE psychology_video_hit_videos SET cleanup_state='active',last_touched_at=? WHERE id=? AND owner_id=? AND digest=? AND cleanup_state IN ('uploading','active')").bind(stamp,id,user.id,digest),guard(db),
  db.prepare("INSERT INTO psychology_video_assets(id,owner,file_name,content_type,file_size,r2_key,status,created_at,updated_at) SELECT ?,?,?,?,?,?,'ready',?,? WHERE EXISTS(SELECT 1 FROM psychology_video_hit_videos WHERE id=? AND owner_id=? AND digest=? AND file_name=?) ON CONFLICT(id) DO UPDATE SET id=excluded.id WHERE psychology_video_assets.owner=excluded.owner AND psychology_video_assets.r2_key=excluded.r2_key AND psychology_video_assets.file_name=excluded.file_name AND psychology_video_assets.content_type=excluded.content_type AND psychology_video_assets.file_size=excluded.file_size").bind(id,user.username,name,type,size,key,stamp,stamp,id,user.id,digest,name),guard(db)
 ]);}catch(error){const winner=await db.prepare('SELECT * FROM psychology_video_hit_videos WHERE id=?').bind(id).first();if(winner?.r2_key!==key)await env.ARCHIVE.delete(key);else if(['deleting','deleted'].includes(winner?.cleanup_state))await discardExpiredVideoHitUpload(env,{kind:'video',id,key,ownerId:user.id});if(/CHECK constraint/i.test(error.message))fail('该上传编号已用于其他视频资产。',409);throw error;}
 const saved=await db.prepare('SELECT * FROM psychology_video_hit_videos WHERE id=?').bind(id).first();
 if(!same(saved)){if(saved.r2_key!==key)await env.ARCHIVE.delete(key);fail('该上传编号已用于其他成片。',409);}
 return json(publicVideo(row),201);
}
