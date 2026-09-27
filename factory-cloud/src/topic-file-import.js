import {z} from 'zod';
import {decodeTopicPng} from './topic-png.js';
import {sha256Hex} from './http.js';
import {toPublicUser} from './auth.js';
import {assertTopicBankUser} from './psychology-topic-bank.js';
import {normalizeTopic} from '../../scripts/psychology-topic-bank.js';
import {topicImageInput,topicImageStatus,importReadyImage} from './topic-image-operation.js';

const MAX_BYTES=8*1024*1024;
// Compatibility pattern requested by the user, not proof of OpenAI ownership.
// Azure storage names are 3-24 lowercase letters/digits; no hyphens/subdomains.
const CHAT_IMAGE_BLOB_HOST=/^oaisdmntpr[a-z0-9]{1,14}\.blob\.core\.windows\.net$/;
const fail=(message,statusCode=400,code='INVALID_INPUT')=>{throw Object.assign(new Error(message),{statusCode,code});};
// All four file properties are declared; only the two host-provided fields are required.
export const topicFileInput=topicImageInput.omit({imagePrompt:true,imageModel:true,imageSize:true}).extend({
 image:z.object({download_url:z.string().min(1).max(16000),file_id:z.string().min(1).max(300),mime_type:z.string().max(100).optional(),file_name:z.string().max(500).optional()}).strict()
}).strict();
export const topicDraftInput=topicFileInput.omit({image:true});
export function validateTopicDraft(raw){
 const topic=topicDraftInput.parse(raw);
 if(topic.template==='psychology-target-2'&&!topic.choices)fail('单图互动测试必须提供 A/B/C/D 四个 choices 文案。');
 if(topic.template==='psychology-collage'&&topic.choices)fail('纸张拼贴模板不接受测试选项。');
 normalizeTopic({...topic,...(topic.choices?{imageKey:'psychology-topics/00000000-0000-4000-8000-000000000000.png'}:{})},topic.template);
 return topic;
}
const get=(db,user,id)=>db.prepare('SELECT * FROM factory_ai_operations WHERE owner_id=? AND request_id=?').bind(user,id).first();
const keyFor=row=>'psychology-topics/'+row.asset_id.slice(6)+'.png';
async function activeUser(db,id){const row=await db.prepare('SELECT * FROM factory_users WHERE id=? AND active=1').bind(id).first();assertTopicBankUser(row&&toPublicUser(row));}

export function chatFileUrl(value){
 let url;try{url=new URL(value);}catch{fail('需要 ChatGPT 提供的图片附件，不能使用 sandbox 路径或手写地址。',400,'FILE_REFERENCE_REQUIRED');}
 const host=url.hostname;
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!(host==='oaiusercontent.com'||host.endsWith('.oaiusercontent.com')||CHAT_IMAGE_BLOB_HOST.test(host)))
  throw Object.assign(new Error('图片下载地址不受支持，请使用文件上传或有效的图片下载地址。'),{statusCode:400,code:'FILE_HOST_NOT_ALLOWED',host});
 return url.href;
}
async function downloadPng(env,url){
 const signal=AbortSignal.timeout(30000);
 for(let n=0;n<4;n++){
  let response;try{response=await (env.fetch||fetch)(chatFileUrl(url),{method:'GET',redirect:'manual',credentials:'omit',signal});}catch(e){if(e.code)throw e;fail('图片下载暂时失败，请保留 requestId 并重新传入附件。',502,'FILE_DOWNLOAD_FAILED');}
  if([301,302,303,307,308].includes(response.status)){
   const next=response.headers.get('location');await response.body?.cancel();
   if(!next)break;url=chatFileUrl(new URL(next,url).href);continue;
  }
  if(!response.ok){await response.body?.cancel();fail(response.status===401||response.status===403||response.status===404?'图片链接已失效，请重新附加同一图片并沿用 requestId。':'图片下载失败，请沿用 requestId 重试。',502,'FILE_HTTP_'+response.status);}
  if(Number(response.headers.get('content-length'))>MAX_BYTES){await response.body?.cancel();fail('图片不能超过 8 MB。',413,'IMAGE_TOO_LARGE');}
  if(!response.body)fail('图片内容为空。',400,'INVALID_IMAGE');
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_BYTES)fail('图片不能超过 8 MB。',413,'IMAGE_TOO_LARGE');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return decodeTopicPng(bytes);
 }
 fail('图片下载重定向过多。',502,'FILE_REDIRECT_FAILED');
}
async function registerFile(env,row,stored){
 const m=stored.customMetadata||{};
 if(m.operation!==row.workflow_id||m.inputHash!==row.input_hash||!m.sha256)fail('图片存储记录不匹配。',409,'ASSET_CONFLICT');
 await env.DB.prepare("INSERT OR IGNORE INTO factory_assets(id,owner_id,purpose,object_key,mime_type,bytes,width,height,sha256,source,generation_model,generation_prompt,status,created_at) VALUES(?,?,'psychology-topic-cover',?,'image/png',?,?,?,?,?,'','','ready',?)")
 .bind(row.asset_id,row.owner_id,keyFor(row),stored.size,Number(m.width),Number(m.height),m.sha256,JSON.parse(row.input_json).transport==='client-png'?'client-png':'chatgpt-file',Date.now()).run();
}
export const topicBytesInput=topicDraftInput.extend({imageBase64:z.string().min(1).max(4*Math.ceil(MAX_BYTES/3))}).strict();
export async function importTopicBytes(env,user,raw,origin=''){
 assertTopicBankUser(user);await activeUser(env.DB,user.id);
 const {imageBase64,...topic}=topicBytesInput.parse(raw);validateTopicDraft(topic);
 if(imageBase64.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64))fail('图片编码无效。',400,'INVALID_IMAGE');
 const bytes=Uint8Array.from(atob(imageBase64),c=>c.charCodeAt(0));
 if(bytes.length>MAX_BYTES)fail('图片不能超过 8 MB。',413,'IMAGE_TOO_LARGE');
 const data=await decodeTopicPng(bytes),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
 return importFileSource(env,user,topic,'bytes-sha256:'+digest,()=>data,()=>{},origin,'client-png');
}
export async function importTopicFile(env,user,raw,origin=''){
 assertTopicBankUser(user);await activeUser(env.DB,user.id);
 const {image,...topic}=topicFileInput.parse(raw);validateTopicDraft(topic);
 return importFileSource(env,user,topic,image.file_id,()=>downloadPng(env,image.download_url),()=>chatFileUrl(image.download_url),origin);
}
async function importFileSource(env,user,topic,fileId,loadImage,validateSource,origin,transport){
 // Signed URLs are ephemeral secrets, never persist or include them in error messages.
 const input={...topic,mode:'chatgpt-file',fileId,...(transport?{transport}:{})};
 const inputHash=await sha256Hex(JSON.stringify(input));
 let row=await get(env.DB,user.id,topic.requestId);
 if(row&&row.input_hash!==inputHash)fail('requestId 已用于不同图片或题目；请保持原上传方式、图片和题目内容。',409,'REQUEST_ID_CONFLICT');
 if(row?.status==='completed')return topicImageStatus(env,user,topic.requestId,origin);
 validateSource();
 if(!env.ARCHIVE)fail('图片存储未配置。',503,'STORAGE_NOT_CONFIGURED');
 const now=Date.now(),operation='topic-file-'+(await sha256Hex(user.id+':'+topic.requestId)).slice(0,40);
 await env.DB.prepare("INSERT INTO factory_ai_operations(owner_id,request_id,input_hash,input_json,status,asset_id,workflow_id,import_request_id,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?,?,?,?) ON CONFLICT(owner_id,request_id) DO NOTHING")
 .bind(user.id,topic.requestId,inputHash,JSON.stringify(input),'asset-'+crypto.randomUUID(),operation,crypto.randomUUID(),now,now).run();
 row=await get(env.DB,user.id,topic.requestId);
 if(row.input_hash!==inputHash)fail('requestId 已用于不同内容。',409,'REQUEST_ID_CONFLICT');
 const lease=crypto.randomUUID();
 const claim=await env.DB.prepare("UPDATE factory_ai_operations SET status='receiving',provider_request_id=?,error_code=NULL,updated_at=? WHERE owner_id=? AND request_id=? AND (status IN ('pending','image_ready','unknown') OR (status IN ('receiving','importing') AND updated_at<?))")
 .bind(lease,now,user.id,topic.requestId,now-180000).run();
 if(!claim.meta.changes)return topicImageStatus(env,user,topic.requestId,origin);
 const owns=async()=>{const latest=await get(env.DB,user.id,topic.requestId);return latest.provider_request_id===lease&&latest.status!=='completed';};
 try{
  let stored=await env.ARCHIVE.head(keyFor(row));
  if(!stored){
   const imageData=await loadImage();
   await activeUser(env.DB,user.id);
   if(!await owns())return topicImageStatus(env,user,topic.requestId,origin);
   const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',imageData.bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
   // Immutable checkpoint also protects against a stale request resuming after lease expiry.
   await env.ARCHIVE.put(keyFor(row),imageData.bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'image/png'},customMetadata:{operation:row.workflow_id,inputHash,sha256,width:String(imageData.width),height:String(imageData.height)}});
   stored=await env.ARCHIVE.head(keyFor(row));
  }
  if(!stored)fail('图片保存结果尚未确认，请沿用 requestId 重试。',503,'STORAGE_RESULT_UNKNOWN');
  if(!await owns())return topicImageStatus(env,user,topic.requestId,origin);
  await registerFile(env,row,stored);
  await importReadyImage(env,row);
  return topicImageStatus(env,user,topic.requestId,origin);
 }catch(e){
  await env.DB.prepare("UPDATE factory_ai_operations SET status='pending',error_code=?,updated_at=? WHERE owner_id=? AND request_id=? AND provider_request_id=? AND status<>'completed'")
   .bind(e.code||'FILE_IMPORT_RETRY',Date.now(),user.id,topic.requestId,lease).run();
  if(e.statusCode)throw e;
  fail('图片入库暂未完成，请沿用同一 requestId 和附件重试；已保存的图片会直接复用。',503,'FILE_IMPORT_RETRY');
 }
}
