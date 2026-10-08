import {decodeTopicPng} from './topic-png.js';
import {json} from './http.js';
import {authenticate} from './factory-api.js';
import {videoHitUser,VIDEO_HITS_BASE} from './psychology-video-hits.js';
import {UUID,fail} from '../../scripts/psychology-video-hit-contract.js';
const EXTERNAL='/api/integrations/psychology/video-hits/assets/';
export const VIDEO_HIT_IMAGE_MAX=8*1024*1024;
async function bytes(request){
 if(!request.body)fail('缺少图片内容。');const reader=request.body.getReader(),chunks=[];let total=0;
 try{while(true){const r=await reader.read();if(r.done)break;total+=r.value.byteLength;if(total>VIDEO_HIT_IMAGE_MAX)fail('每张图片最多8MB。',413);chunks.push(r.value);}}
 catch(error){await reader.cancel().catch(()=>{});throw error;}
 const output=new Uint8Array(total);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}return output;
}
export function imageType(b,type){
 const signature=String.fromCharCode(...b.slice(0,12));
 if(type==='image/png'&&b.length>=33&&b[0]===137&&signature.slice(1,4)==='PNG'&&String.fromCharCode(...b.slice(12,16))==='IHDR'){
  const view=new DataView(b.buffer,b.byteOffset,b.byteLength),w=view.getUint32(16),h=view.getUint32(20);if(w&&h&&w<=8192&&h<=8192&&w*h<=40000000)return type;
 }
 if(type==='image/jpeg'&&b.length>=20&&b[0]===255&&b[1]===216&&b[b.length-2]===255&&b[b.length-1]===217)return type;
 if(type==='image/webp'&&b.length>=30&&signature.slice(0,4)==='RIFF'&&signature.slice(8,12)==='WEBP'&&new DataView(b.buffer,b.byteOffset,b.byteLength).getUint32(4,true)+8===b.length)return type;
 fail('图片内容与类型不符，仅支持PNG、JPEG、WebP静态图片。');
}
export async function handleVideoHitAssets(request,env,url,session){
 const external=url.pathname.startsWith(EXTERNAL);
 const match=url.pathname.match(/^\/api\/(?:integrations\/psychology\/video-hits|psychology-video-hits)\/assets\/([a-f0-9-]+)(\/file)?$/i);
 if(!match)return null;if(!UUID.test(match[1]))fail('图片上传编号须为UUID。');
 const actor=external?await authenticate(request,env.DB):session?.user,user=await videoHitUser(env.DB,actor);
 if(!env.ARCHIVE)fail('图片存储尚未配置。',503);
 if(!external&&!['GET','HEAD'].includes(request.method)&&((request.headers.get('origin')&&request.headers.get('origin')!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site'))fail('不允许跨站上传。',403);
 if(match[2]&&['GET','HEAD'].includes(request.method)){
  const row=await env.DB.prepare('SELECT * FROM psychology_video_hit_assets WHERE id=? AND owner_id=?').bind(match[1],user.id).first();
  if(!row)fail('图片不存在或无权访问。',404);
  const object=await env.ARCHIVE.get(row.r2_key);if(!object)fail('图片文件不存在。',404);
  return new Response(request.method==='HEAD'?null:object.body,{headers:{'Content-Type':row.content_type,'Content-Length':String(row.size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }
 if(match[2]||request.method!=='PUT')fail('上传使用PUT二进制图片内容。',405);
 const b=await bytes(request),type=imageType(b,request.headers.get('content-type')?.split(';')[0]);if(type==='image/png')await decodeTopicPng(b);const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
 const prior=await env.DB.prepare('SELECT * FROM psychology_video_hit_assets WHERE id=?').bind(match[1]).first();
 if(prior){if(prior.owner_id!==user.id||prior.digest!==digest||prior.content_type!==type)fail('该上传编号已用于其他图片。',409);return json({assetId:prior.id,duplicate:true,previewUrl:VIDEO_HITS_BASE+'/assets/'+prior.id+'/file'});}
 const key='psychology-video-hits/'+user.id+'/'+match[1]+'/'+digest;
 await env.ARCHIVE.put(key,b,{httpMetadata:{contentType:type}});
 try{await env.DB.prepare('INSERT INTO psychology_video_hit_assets(id,owner_id,r2_key,content_type,size,digest,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(match[1],user.id,key,type,b.length,digest,Date.now()).run();}
 catch(error){await env.ARCHIVE.delete(key);throw error;}
 const saved=await env.DB.prepare('SELECT * FROM psychology_video_hit_assets WHERE id=?').bind(match[1]).first();
 if(saved.owner_id!==user.id||saved.digest!==digest||saved.content_type!==type){if(saved.r2_key!==key)await env.ARCHIVE.delete(key);fail('该上传编号已用于其他图片。',409);}
 return json({assetId:saved.id,size:b.length,previewUrl:VIDEO_HITS_BASE+'/assets/'+saved.id+'/file'},201);
}
// Called after the common worker bearer check. Access is limited to frozen assets of this running job.
export async function handleVideoHitWorkerAsset(request,env,url){
 const match=url.pathname.match(/^\/api\/worker\/psychology-video-hits\/([a-zA-Z0-9_-]+)\/assets\/([a-f0-9-]+)$/);
 if(!match)return null;if(request.method!=='GET')fail('请求方法无效。',405);
 const job=await env.DB.prepare("SELECT * FROM factory_jobs WHERE id=? AND type='psychology-video-remix' AND status='running' AND worker_id=?").bind(match[1],request.headers.get('x-factory-worker')||'').first();
 if(!job)fail('任务不属于当前工人。',403);
 const owner=await env.DB.prepare('SELECT * FROM factory_users WHERE username=? AND active=1').bind(job.created_by).first(),user=await videoHitUser(env.DB,owner);
 const payload=JSON.parse(job.payload_json);
 if(!payload.videoRemix.frames.some(f=>f.assetId===match[2]))fail('图片不属于当前任务。',403);
 const row=await env.DB.prepare('SELECT * FROM psychology_video_hit_assets WHERE id=? AND owner_id=?').bind(match[2],user.id).first(),object=row&&await env.ARCHIVE.get(row.r2_key);
 if(!object)fail('任务图片不可用。',404);
 return new Response(object.body,{headers:{'Content-Type':row.content_type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
