import {z} from 'zod';
import {sha256Hex} from './http.js';
import {toPublicUser} from './auth.js';
import {assertTopicBankUser,writeIntegrationTopics} from './psychology-topic-bank.js';
import {publicAsset} from './topic-assets.js';
import {normalizeTopic} from '../../scripts/psychology-topic-bank.js';

const UUID=z.string().uuid();
export const topicImageInput=z.object({requestId:UUID,template:z.enum(['psychology-collage','psychology-target-2']).default('psychology-collage'),title:z.string().trim().min(1).max(200),content:z.string().trim().min(1).max(5000),imagePrompt:z.string().trim().min(1).max(8000),imageModel:z.literal('gpt-image-2').default('gpt-image-2'),imageSize:z.enum(['1024x1024','1024x1536','1536x1024','1152x2048']).default('1024x1536'),enabled:z.boolean().default(false),choices:z.array(z.object({copy:z.string().trim().min(1).max(80)}).strict()).length(4).optional(),revealComment:z.string().max(2000).default('')}).strict();
const fail=(message,statusCode=400,code='INVALID_INPUT')=>{throw Object.assign(new Error(message),{statusCode,code});};
const get=(db,owner,id)=>db.prepare('SELECT * FROM factory_ai_operations WHERE owner_id=? AND request_id=?').bind(owner,id).first();
const keyFor=assetId=>'psychology-topics/'+assetId.slice(6)+'.png';
async function currentUser(db,id){const row=await db.prepare('SELECT * FROM factory_users WHERE id=? AND active=1').bind(id).first();const user=row&&toPublicUser(row);assertTopicBankUser(user);return user;}
export async function topicImageStatus(env,user,requestId,origin=''){
 assertTopicBankUser(user);UUID.parse(requestId);const row=await get(env.DB,user.id,requestId);if(!row)fail('生图入库任务不存在。',404,'NOT_FOUND');
 const status=row.status==='generating'&&Date.now()-row.updated_at>6*60*1000?'unknown':row.status;
 const result=row.result_json?JSON.parse(row.result_json):null;
 return {ok:status==='completed',requestId,status,errorCode:row.error_code||null,...(result||{}),...(result?.asset?{asset:{...result.asset,url:origin+result.asset.url}}:{}),next:status==='completed'?'已入库':status==='unknown'?'结果未确认，请沿用同一 requestId 恢复；不要换编号重新生图。':status==='failed'?'任务已停止，请检查 errorCode。':row.error_code==='IMPORT_PENDING'?'图片已保存，入库暂未完成；请沿用同一 requestId 恢复，不会重新生图。':'后台处理中，请使用 psychology_topic_image_operation_get 查询同一 requestId。'};
}
export async function startTopicImage(env,user,raw,origin=''){
 assertTopicBankUser(user);const input=topicImageInput.parse(raw);
 if(input.template==='psychology-target-2'&&!input.choices)fail('单图互动测试必须提供 A/B/C/D 四个 choices 文案。');
 if(input.template==='psychology-collage'&&input.choices)fail('纸张拼贴模板不接受测试选项。');
 // Validate all topic fields before any paid request, using a placeholder owned object key.
 normalizeTopic({...input,...(input.choices?{imageKey:'psychology-topics/00000000-0000-4000-8000-000000000000.png'}:{})},input.template);
 const hash=await sha256Hex(JSON.stringify(input)),prior=await get(env.DB,user.id,input.requestId);
 if(prior&&prior.input_hash!==hash)fail('requestId 已用于不同内容。',409,'REQUEST_ID_CONFLICT');
 if(prior?.status==='completed'||prior?.status==='failed')return topicImageStatus(env,user,input.requestId,origin);
 if(!env.OPENAI_API_KEY&&(!prior||prior.status==='pending'))fail('请在 Cloudflare Worker 的 Secrets 中配置 OPENAI_API_KEY。',503,'OPENAI_NOT_CONFIGURED');
 if(!env.ARCHIVE||!env.TOPIC_IMAGE_WORKFLOW)fail('生图存储或后台工作流未配置。',503,'WORKFLOW_NOT_CONFIGURED');
 const stamp=Date.now(),workflowId='topic-image-'+(await sha256Hex(user.id+':'+input.requestId)).slice(0,40);
 await env.DB.prepare("INSERT INTO factory_ai_operations(owner_id,request_id,input_hash,input_json,status,asset_id,workflow_id,import_request_id,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?,?,?,?) ON CONFLICT(owner_id,request_id) DO NOTHING")
 .bind(user.id,input.requestId,hash,JSON.stringify(input),'asset-'+crypto.randomUUID(),workflowId,crypto.randomUUID(),stamp,stamp).run();
 const row=await get(env.DB,user.id,input.requestId);if(row.input_hash!==hash)fail('requestId 已用于不同内容。',409,'REQUEST_ID_CONFLICT');
 if(['image_ready','importing','unknown'].includes(row.status)||row.status==='generating'&&stamp-row.updated_at>6*60*1000){
  // Recovery only inspects durable storage and imports an existing image. It never calls the generator.
  await recoverStoredImage(env,row);const recovered=await get(env.DB,user.id,input.requestId);
  if(['image_ready','importing'].includes(recovered.status))await importReadyImage(env,recovered);
 }else if(row.status==='pending'){
  try{await env.TOPIC_IMAGE_WORKFLOW.create({id:workflowId,params:{ownerId:user.id,requestId:input.requestId}});}catch{
   // Fixed workflow identity and the SQL generation claim make re-submission safe.
   try{const instance=await env.TOPIC_IMAGE_WORKFLOW.get(workflowId);const status=await instance.status();if(status.status==='errored')await instance.restart();}catch{fail('后台提交结果未确认，请沿用同一 requestId 重试。',503,'DISPATCH_UNKNOWN');}
  }
 }
 return topicImageStatus(env,user,input.requestId,origin);
}
async function state(db,row,status,errorCode=null){await db.prepare("UPDATE factory_ai_operations SET status=?,error_code=?,updated_at=? WHERE owner_id=? AND request_id=? AND status<>'completed'").bind(status,errorCode,Date.now(),row.owner_id,row.request_id).run();}
export function inspectPng(bytes){
 if(bytes.length<33||bytes.length>8*1024*1024||![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')fail('服务商返回了无效的 PNG 图片。',502,'INVALID_IMAGE');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=v.getUint32(16),height=v.getUint32(20);
 if(!width||!height||width>4096||height>4096)fail('图片尺寸不支持。',502,'INVALID_IMAGE');return {width,height};
}
async function boundedJson(response){
 const reader=response.body.getReader(),chunks=[];let length=0;
 for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>12*1024*1024){await reader.cancel();fail('图片返回过大。',502,'IMAGE_TOO_LARGE');}chunks.push(value);}
 const out=new Uint8Array(length);let offset=0;for(const part of chunks){out.set(part,offset);offset+=part.length;}return JSON.parse(new TextDecoder().decode(out));
}
async function registerStoredAsset(env,row,metadata){
 const input=JSON.parse(row.input_json);
 await env.DB.prepare("INSERT OR IGNORE INTO factory_assets(id,owner_id,purpose,object_key,mime_type,bytes,width,height,sha256,source,generation_model,generation_prompt,status,created_at) VALUES(?,?,'psychology-topic-cover',?,'image/png',?,?,?,?,'ai-generated',?,?,'ready',?)")
 .bind(row.asset_id,row.owner_id,keyFor(row.asset_id),metadata.bytes,metadata.width,metadata.height,metadata.sha256,input.imageModel,input.imagePrompt,Date.now()).run();
 await state(env.DB,row,'image_ready');
}
async function recoverStoredImage(env,row){
 const stored=await env.ARCHIVE.head(keyFor(row.asset_id));
 if(stored){const m=stored.customMetadata||{};if(m.operation===row.workflow_id&&m.sha256){await registerStoredAsset(env,row,{bytes:stored.size,width:Number(m.width),height:Number(m.height),sha256:m.sha256});return true;}}
 // A JSON evidence object is not persisted: the image itself is the durable checkpoint.
 if(['generating','unknown'].includes(row.status))await state(env.DB,row,'unknown','PROVIDER_RESULT_UNKNOWN');return false;
}
async function generateAndStore(env,row){
 try{await currentUser(env.DB,row.owner_id);}catch(error){if(error.statusCode===403){await state(env.DB,row,'failed','PERMISSION_REVOKED');return;}throw error;}
 if(!env.OPENAI_API_KEY){await state(env.DB,row,'failed','OPENAI_NOT_CONFIGURED');return;}
 const claimed=await env.DB.prepare("UPDATE factory_ai_operations SET status='generating',updated_at=? WHERE owner_id=? AND request_id=? AND status='pending'").bind(Date.now(),row.owner_id,row.request_id).run();
 if(!claimed.meta.changes)return;
 const input=JSON.parse(row.input_json);let stage='provider';
 try{
  const response=await (env.fetch||fetch)('https://api.openai.com/v1/images/generations',{method:'POST',headers:{authorization:'Bearer '+env.OPENAI_API_KEY,'content-type':'application/json','X-Client-Request-Id':row.request_id},body:JSON.stringify({model:input.imageModel,prompt:input.imagePrompt,size:input.imageSize,n:1,quality:'medium',output_format:'png'}),signal:AbortSignal.timeout(240000)});
  const providerId=response.headers.get('x-request-id');if(providerId)await env.DB.prepare('UPDATE factory_ai_operations SET provider_request_id=? WHERE owner_id=? AND request_id=?').bind(providerId,row.owner_id,row.request_id).run();
  if(!response.ok){await state(env.DB,row,response.status>=500||response.status===408?'unknown':'failed','OPENAI_HTTP_'+response.status);return;}
  const result=await boundedJson(response),b64=result.data?.[0]?.b64_json;
  if(typeof b64!=='string'||result.data.length!==1)fail('服务商未返回单张图片。',502,'INVALID_IMAGE_RESPONSE');
  const binary=atob(b64),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  const dimensions=inspectPng(bytes),sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  stage='storage';
  await env.ARCHIVE.put(keyFor(row.asset_id),bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{operation:row.workflow_id,sha256,width:String(dimensions.width),height:String(dimensions.height)}});
  stage='registry';await registerStoredAsset(env,row,{...dimensions,sha256,bytes:bytes.length});
 }catch(error){await state(env.DB,row,'unknown',stage==='storage'?'STORAGE_RESULT_UNKNOWN':stage==='registry'?'ASSET_RECORD_PENDING':error.code==='INVALID_IMAGE'?'INVALID_IMAGE':'PROVIDER_RESULT_UNKNOWN');}
}
async function importReadyImage(env,row){
 const user=await currentUser(env.DB,row.owner_id),input=JSON.parse(row.input_json);
 const asset=await env.DB.prepare("SELECT * FROM factory_assets WHERE id=? AND owner_id=? AND status='ready'").bind(row.asset_id,row.owner_id).first();
 if(!asset)return;
 await state(env.DB,row,'importing');
 // Topic fingerprinting is the downstream idempotency guard, preserved by the existing importer.
 const result=await writeIntegrationTopics(env.DB,{template:input.template,items:[{title:input.title,content:input.content,enabled:input.enabled,revealComment:input.revealComment,...(input.choices?{choices:input.choices}:{}),coverAssetId:asset.id,imageAssetIds:[asset.id]}]},user.id);
 const item=result.items?.[0];if(result.accepted!==1||!item||!['created','skipped'].includes(item.status))fail('题目导入结果未确认。',503,'IMPORT_RESULT_UNKNOWN');
 const topic=await env.DB.prepare('SELECT id,title,revision,enabled,cover_asset_id FROM psychology_template_topics WHERE id=? AND deleted_at=0').bind(item.id).first();
 if(!topic||topic.cover_asset_id!==asset.id)fail('题目入库状态未确认。',503,'IMPORT_RESULT_UNKNOWN');
 const output={topic:{id:topic.id,title:topic.title,revision:topic.revision,enabled:!!topic.enabled},asset:publicAsset(asset),imageGeneration:{model:input.imageModel},importRequestId:row.import_request_id};
 await env.DB.prepare("UPDATE factory_ai_operations SET status='completed',result_json=?,error_code=NULL,updated_at=? WHERE owner_id=? AND request_id=?").bind(JSON.stringify(output),Date.now(),row.owner_id,row.request_id).run();
 return output;
}
export async function runTopicImageWorkflow(env,event,step){
 const {ownerId,requestId}=event.payload;
 await step.do('generate-and-store',{retries:{limit:0,delay:'1 second'},timeout:'5 minutes'},async()=>{const row=await get(env.DB,ownerId,requestId);if(row?.status==='pending')await generateAndStore(env,row);});
 try{return await step.do('register-and-import',{retries:{limit:3,delay:'10 seconds',backoff:'exponential'},timeout:'1 minute'},async()=>{
  let row=await get(env.DB,ownerId,requestId);if(!row||['completed','failed'].includes(row.status))return {status:row?.status};
  if(['generating','unknown'].includes(row.status)){await recoverStoredImage(env,row);row=await get(env.DB,ownerId,requestId);}
  if(['image_ready','importing'].includes(row.status))await importReadyImage(env,row);
  return {status:(await get(env.DB,ownerId,requestId)).status};
 });}catch(error){const row=await get(env.DB,ownerId,requestId);if(row&&['image_ready','importing'].includes(row.status)){await state(env.DB,row,'image_ready','IMPORT_PENDING');return {status:'image_ready',errorCode:'IMPORT_PENDING'};}throw error;}
}
