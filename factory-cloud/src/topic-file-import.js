import {z} from 'zod';
import {sha256Hex} from './http.js';
import {toPublicUser} from './auth.js';
import {assertTopicBankUser} from './psychology-topic-bank.js';
import {normalizeTopic} from '../../scripts/psychology-topic-bank.js';
import {topicImageInput,topicImageStatus,inspectPng,importReadyImage} from './topic-image-operation.js';

const MAX_BYTES=8*1024*1024;
// Exact storage account reported by the user's ChatGPT image handoff. Do not
// broaden this to all Azure Blob tenants or infer other regions from its name.
const CHAT_IMAGE_BLOB_HOST='oaisdmntprwestus.blob.core.windows.net';
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
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!(host==='oaiusercontent.com'||host.endsWith('.oaiusercontent.com')||host===CHAT_IMAGE_BLOB_HOST))
  fail('图片下载域名 '+host+' 不受支持。请通过选图入库界面选择图片；不要传入聊天页面或 sandbox 地址。',400,'FILE_HOST_NOT_ALLOWED');
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
  // Native ChatGPT generated images are normally PNG. Do not trust MIME or filename.
  let dimensions;try{dimensions=inspectPng(bytes);}catch{fail('请附加完整 PNG 图片，单边不超过 4096 像素。',400,'INVALID_IMAGE');}
  const view=new DataView(bytes.buffer);let pos=8,idat=false,ended=false;
  while(pos+12<=bytes.length){const size=view.getUint32(pos),type=String.fromCharCode(...bytes.slice(pos+4,pos+8));if(size>bytes.length-pos-12)break;if(pos===8&&(type!=='IHDR'||size!==13))break;if(type==='IDAT')idat=true;pos+=size+12;if(type==='IEND'){ended=size===0&&pos===bytes.length;break;}}
  if(!idat||!ended)fail('PNG 图片不完整，请重新附加图片。',400,'INVALID_IMAGE');
  return {bytes,...dimensions};
 }
 fail('图片下载重定向过多。',502,'FILE_REDIRECT_FAILED');
}
async function registerFile(env,row,stored){
 const m=stored.customMetadata||{};
 if(m.operation!==row.workflow_id||m.inputHash!==row.input_hash||!m.sha256)fail('图片存储记录不匹配。',409,'ASSET_CONFLICT');
 await env.DB.prepare("INSERT OR IGNORE INTO factory_assets(id,owner_id,purpose,object_key,mime_type,bytes,width,height,sha256,source,generation_model,generation_prompt,status,created_at) VALUES(?,?,'psychology-topic-cover',?,'image/png',?,?,?,?,'chatgpt-file','','','ready',?)")
 .bind(row.asset_id,row.owner_id,keyFor(row),stored.size,Number(m.width),Number(m.height),m.sha256,Date.now()).run();
}
export async function importTopicFile(env,user,raw,origin=''){
 assertTopicBankUser(user);await activeUser(env.DB,user.id);
 const {image,...topic}=topicFileInput.parse(raw);
 validateTopicDraft(topic);
 // Signed URLs are ephemeral secrets, never persist or include them in error messages.
 const input={...topic,mode:'chatgpt-file',fileId:image.file_id};
 const inputHash=await sha256Hex(JSON.stringify(input));
 let row=await get(env.DB,user.id,topic.requestId);
 if(row&&row.input_hash!==inputHash)fail('requestId 已用于不同图片或题目；恢复原任务时请保留原 file_id 和题目内容。',409,'REQUEST_ID_CONFLICT');
 if(row?.status==='completed')return topicImageStatus(env,user,topic.requestId,origin);
 chatFileUrl(image.download_url);
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
   const imageData=await downloadPng(env,image.download_url);
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
