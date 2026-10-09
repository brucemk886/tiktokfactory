import {z} from 'zod';
import {CATALOG,allowed} from './factory-api-catalog.js';
import {executeFactoryInput} from './factory-api.js';
import {handleVideoHitAssets,VIDEO_HIT_IMAGE_MAX} from './psychology-video-hit-assets.js';
import {videoHitUser} from './psychology-video-hits.js';
import {downloadChatImage,topicFileInput} from './topic-file-import.js';
import {VIDEO_HIT_IMPORT_UI,videoHitImportWidget} from './video-hit-import-widget.js';

export const VIDEO_HITS_SCOPE='factory.video_hits.write';
export const VIDEO_HITS_GUIDE='/docs/psychology-video-hits-api.md';
const uuid=z.string().uuid(),id=z.string().regex(/^vh-[a-f0-9]{32}$/),revision=z.number().int().nonnegative();
const version=z.string().regex(/^(?:[1-9]|1[0-9]|20)$/),frameVersion=z.string().regex(/^(?:0|[1-9]|1[0-9]|20)$/);
const textFields={title:z.string().min(1).max(200),caption:z.string().max(2200).optional(),script:z.string().max(20000).optional()};
const sourceBody=z.object({...textFields,importSource:z.string().min(1).max(64).describe('导入智能体标识：grokbot、gpt-dot或自定义小写字母/数字/点/下划线/连字符；新智能体务必声明，省略兼容为grokbot').optional(),externalId:z.string().min(1).max(100),videoUrl:z.string().url(),videoData:z.record(z.string(),z.unknown()).optional()}).strict();
const frame=z.object({index:z.number().int().min(1).max(300),assetId:uuid.optional(),imageUrl:z.string().url().max(2000).optional(),text:z.string().max(1500).optional(),durationSeconds:z.number().min(0.04).max(60).optional()}).strict();
const params=fields=>z.object(fields).strict();
const definitions={
 'videoHits.list':params({query:params({page:z.number().int().min(1).max(10000).optional(),q:z.string().max(100).optional(),importSource:z.string().max(64).optional(),sort:z.enum(['recent','plays']).optional(),scope:z.enum(['active','archived','all']).optional(),inputMode:z.enum(['all','video','frames']).optional()}).optional()}),
 'videoHits.get':params({id}),
 'videoHits.versions.get':params({id,version}),
 'videoHits.frames.list':params({id,version:frameVersion,query:params({page:z.number().int().min(1).max(10000).optional()}).optional()}),
 'videoHits.jobs':params({id,version}),
 'videoHits.cleanup':params({}),
 'videoHits.create':params({body:sourceBody}),
 'videoHits.update':params({id,body:sourceBody.partial().extend({revision}).strict()}),
 'videoHits.versions.write':params({id,version,body:z.object({...textFields,name:z.string().min(1).max(100).optional(),enabled:z.boolean().optional(),inputMode:z.enum(['frames','video']).optional(),videoAssetId:z.union([uuid,z.literal('')]).optional()}).partial().extend({revision}).strict()}),
 'videoHits.frames.write':params({id,version:frameVersion,body:params({revision,frames:z.array(frame).min(1).max(100)})})
};
export const VIDEO_HIT_MCP_ACTIONS=Object.keys(definitions);
export const VIDEO_HIT_MCP_TOOLS=Object.entries(definitions).map(([action,schema])=>{
 const entry=CATALOG.psychology[action],write=entry.method!=='GET';
 return {name:'psychology_'+action.replaceAll('.','_'),action,entry,write,schema:z.object({params:schema,...(write?{requestId:uuid}:{})}).strict()};
});
const readMeta={securitySchemes:[{type:'oauth2',scopes:['factory.read']}]};
const writeMeta={securitySchemes:[{type:'oauth2',scopes:['factory.read',VIDEO_HITS_SCOPE]}]};
const annotations=(write=false,open=false)=>({readOnlyHint:!write,destructiveHint:false,idempotentHint:true,openWorldHint:open});
const fileInput=z.object({uploadId:uuid,image:topicFileInput.shape.image}).strict();
const bytesInput=z.object({uploadId:uuid,contentType:z.enum(['image/png','image/jpeg','image/webp']),imageBase64:z.string().min(1).max(4*Math.ceil(VIDEO_HIT_IMAGE_MAX/3))}).strict();
export function registerVideoHitTools(server,env,user,origin,scopes,redact){
 if(!allowed(user,CATALOG.psychology['videoHits.get']))return;
 const result=(data,isError=false)=>({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data,isError});
 const response=async r=>result({...redact(await r.json()),httpStatus:r.status},!r.ok);
 const failure=e=>result({ok:false,httpStatus:e.statusCode||500,code:e.code||'OPERATION_UNAVAILABLE',error:e.statusCode?e.message:'结果暂未确认。写入请查询原 requestId；上传请查询原 uploadId，勿换编号重试。'},true);
 const run=(write,fn)=>async args=>{
  if(write&&!scopes.includes(VIDEO_HITS_SCOPE))return {...result({ok:false,httpStatus:403,code:'INSUFFICIENT_SCOPE',error:'请补充授权 factory.video_hits.write，允许视频爆款素材写入；无需发布权限。'},true),_meta:{'mcp/www_authenticate':[`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="insufficient_scope", scope="factory.read ${VIDEO_HITS_SCOPE}"`]}};
  try{return await fn(args);}catch(e){return failure(e);}
 };
 for(const tool of VIDEO_HIT_MCP_TOOLS)server.registerTool(tool.name,{title:tool.entry.description,description:tool.entry.description+'。与统一 REST API 使用相同 params 和 requestId；先 psychology_videoHits_guide 阅读流程。'+(tool.write?'每次新操作使用 UUID requestId；重试沿用原编号和参数。更新先读取最新 revision。仅保存内容，不渲染、不发布。':'列表须按 total/hasMore 翻页。'),inputSchema:tool.schema,annotations:annotations(tool.write),_meta:tool.write?writeMeta:readMeta},run(tool.write,async args=>response(await executeFactoryInput(env,user,{module:'psychology',action:tool.action,...args},origin,VIDEO_HIT_MCP_ACTIONS))));
 server.registerTool('psychology_videoHits_requests_get',{title:'查询视频爆款写入回执',description:'用原 UUID requestId 查询 shared REST/MCP 写入结果。processing 或 RESULT_UNKNOWN 先核对业务记录，勿换新编号重发；只查询此连接允许的 videoHits 操作。',inputSchema:z.object({requestId:uuid}).strict(),annotations:annotations(),_meta:readMeta},run(false,async args=>response(await executeFactoryInput(env,user,{module:'psychology',action:'requests.get',params:{id:args.requestId}},origin,VIDEO_HIT_MCP_ACTIONS))));
 server.registerTool('psychology_videoHits_guide',{title:'读取视频爆款完整接入文档',description:'首次写入前调用。返回可直接执行的 MCP/REST 统一流程、字段、上传步骤、revision 和失败恢复规则。',inputSchema:z.object({}).strict(),annotations:annotations(),_meta:readMeta},run(false,async()=>{
  const r=await env.ASSETS.fetch(new Request(origin+VIDEO_HITS_GUIDE));if(!r.ok)throw new Error('Guide unavailable');
  return {content:[{type:'text',text:await r.text()}],structuredContent:{url:origin+VIDEO_HITS_GUIDE,writeAuthorized:scopes.includes(VIDEO_HITS_SCOPE),actions:VIDEO_HIT_MCP_ACTIONS},isError:false};
 }));
 const assetRequest=(uploadId,init={})=>{const url=new URL('/api/psychology-video-hits/assets/'+uploadId,origin);return handleVideoHitAssets(new Request(url,init),env,url,{user});};
 const upload=async(uploadId,bytes,type)=>response(await assetRequest(uploadId,{method:'PUT',headers:{'content-type':type},body:bytes}));
 server.registerTool('psychology_videoHits_assets_get',{title:'查询图片上传结果',description:'按原 uploadId 查询保存状态。status=active 才可引用 assetId；uploading 沿用同编号和同一文件重传；404 表示当前账号下没有该上传记录。previewUrl 需要工厂登录，不是公开图片链接。',inputSchema:z.object({uploadId:uuid}).strict(),annotations:annotations(),_meta:{...readMeta,ui:{visibility:['model','app']},'openai/widgetAccessible':true}},run(false,async args=>response(await assetRequest(args.uploadId))));
 server.registerTool('psychology_videoHits_assets_upload_file',{title:'上传图片附件到视频爆款库',description:'接收客户端实际文件引用，支持 PNG/JPEG/WebP，最多8MB。uploadId 固定 UUID，同编号不能更换内容。image 必须由宿主提供 file_id/download_url，不能填写 sandbox 路径或编造地址。文件参数转换失败时用 prepare_image_upload 选图；有代码执行能力也可通过 upload_bytes 上传实际文件编码。此工具只保存图片，不创建来源/分镜/发布。',inputSchema:fileInput,annotations:annotations(true,true),_meta:{...writeMeta,'openai/fileParams':['image']}},run(true,async args=>{
  await videoHitUser(env.DB,user);
  const {bytes,contentType}=await downloadChatImage(env,args.image.download_url);
  const type=bytes[0]===137?'image/png':bytes[0]===255?'image/jpeg':String.fromCharCode(...bytes.slice(8,12))==='WEBP'?'image/webp':contentType;
  return upload(args.uploadId,bytes,type);
 }));
 server.registerTool('psychology_videoHits_assets_upload_bytes',{title:'上传实际图片字节到视频爆款库',description:'供能读取真实文件的代码客户端或选图界面使用：将实际 PNG/JPEG/WebP 文件编码为纯 base64（非data URL），最多8MB。模型不得编造图片编码；没有文件读取能力请用文件附件或 prepare_image_upload。同一 uploadId 重试只允许同一内容。',inputSchema:bytesInput,annotations:annotations(true),_meta:{...writeMeta,ui:{visibility:['model','app']},'openai/widgetAccessible':true}},run(true,async args=>{
  if(args.imageBase64.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(args.imageBase64))throw Object.assign(new Error('图片编码无效。'),{statusCode:400});
  const bytes=Uint8Array.from(atob(args.imageBase64),c=>c.charCodeAt(0));
  return upload(args.uploadId,bytes,args.contentType);
 }));
 server.registerResource('video-hit-image-picker',VIDEO_HIT_IMPORT_UI,{},async()=>({contents:[{uri:VIDEO_HIT_IMPORT_UI,mimeType:'text/html;profile=mcp-app',text:videoHitImportWidget,_meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:[]}},'openai/widgetCSP':{connect_domains:[],resource_domains:[]}}}]}));
 server.registerTool('psychology_videoHits_prepare_image_upload',{title:'打开视频爆款图片上传界面',description:'当客户端无法传递附件或读取文件时打开选图界面。用户选择本地PNG/JPEG/WebP后确认上传。只准备界面，不写入素材；后续用 assets_get 确认 active，再用 frames_write 保存分镜。',inputSchema:z.object({uploadId:uuid}).strict(),annotations:annotations(),_meta:{...readMeta,ui:{resourceUri:VIDEO_HIT_IMPORT_UI},'openai/outputTemplate':VIDEO_HIT_IMPORT_UI}},run(false,async args=>result({status:'awaiting_image',uploadId:args.uploadId})));
}
