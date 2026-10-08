import {readyVideo} from './psychology-video-hit-videos.js';
import {json,sha256Hex} from './http.js';
import {toPublicUser} from './auth.js';
import {readManagementBody} from './psychology-management-api.js';
import {UUID,fail,sourceInput,versionInput,framesInput,completeVersion,versionNumber} from '../../scripts/psychology-video-hit-contract.js';
export const VIDEO_HITS_BASE='/api/psychology-video-hits';
const parse=value=>JSON.parse(value||'{}');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export async function videoHitUser(db,actor){
 const row=actor?.id&&await db.prepare('SELECT * FROM factory_users WHERE id=? AND active=1').bind(actor.id).first();
 const user=row&&toPublicUser(row);
 if(user?.role!=='admin'||!user.sidebarModules?.includes('psychology-video-hits'))fail('没有心理学视频爆款权限。',403);
 return user;
}
export async function sourceRow(db,id,user){
 const row=await db.prepare('SELECT * FROM psychology_video_hits WHERE id=? AND owner_id=?').bind(id,user.id).first();
 if(!row)fail('视频爆款不存在或无权访问。',404);return row;
}
export async function versionRow(db,id,version,user){
 await sourceRow(db,id,user);
 const row=await db.prepare('SELECT * FROM psychology_video_hit_versions WHERE source_id=? AND version=?').bind(id,version).first();
 if(!row)fail('二创版本不存在。',404);return row;
}
export function publicSource(row){return {id:row.id,externalId:row.external_id,videoUrl:row.video_url,title:row.title,caption:row.caption,script:row.script,videoData:parse(row.video_data_json),revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at};}
export function publicVersion(row){return {version:row.version,name:row.name,title:row.title,caption:row.caption,script:row.script,enabled:Boolean(row.enabled),inputMode:row.input_mode||'frames',videoAssetId:row.video_asset_id||'',videoPreviewUrl:row.video_asset_id?VIDEO_HITS_BASE+'/videos/'+row.video_asset_id+'/file':'',renderState:row.render_state||'',publishState:row.publish_state||'',publishedUrl:row.published_url||'',renderJobId:row.render_job_id||'',renderRevision:row.render_revision||0,renderSourceRevision:row.render_source_revision||0,publishItemId:row.publish_item_id||'',revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at};}
export function publicFrame(row){return {index:row.frame_index,assetId:row.asset_id,imageUrl:row.image_url,text:row.text,durationSeconds:row.duration_seconds,previewUrl:row.asset_id?VIDEO_HITS_BASE+'/assets/'+row.asset_id+'/file':row.image_url};}
export async function allFrames(db,id,version){return (await db.prepare('SELECT * FROM psychology_video_hit_frames WHERE source_id=? AND version=? ORDER BY frame_index').bind(id,version).all()).results.map(publicFrame);}
export async function assertAssets(db,user,frames){
 const ids=[...new Set(frames.map(f=>f.assetId).filter(Boolean))];if(!ids.length)return;
 const rows=await db.prepare('SELECT id FROM psychology_video_hit_assets WHERE owner_id=? AND id IN (SELECT value FROM json_each(?))').bind(user.id,JSON.stringify(ids)).all();
 if(rows.results.length!==ids.length)fail('图片素材不存在或不属于当前账号。',403);
}
export function guard(db){return db.prepare('UPDATE psychology_video_hit_guards SET ok=CASE WHEN changes()=1 THEN 1 ELSE 0 END WHERE id=1');}
export async function mutation(db,user,body,action,build){
 if(!UUID.test(body.requestId||''))fail('写入必须提供 UUID requestId。');
 const digest=await sha256Hex(JSON.stringify(canonical({action,body})));
 const replay=async()=>{const r=await db.prepare('SELECT * FROM psychology_video_hit_requests WHERE owner_id=? AND request_id=?').bind(user.id,body.requestId).first();if(r&&r.digest!==digest)fail('requestId 已用于其他输入。',409);return r&&json(parse(r.response_json),200,{'X-Idempotent-Replay':'true'});};
 const saved=await replay();if(saved)return saved;
 const {statements,result}=await build();
 statements.push(db.prepare('INSERT INTO psychology_video_hit_requests(owner_id,request_id,digest,response_json,created_at) VALUES(?,?,?,?,?)').bind(user.id,body.requestId,digest,JSON.stringify(result),Date.now()));
 try{await db.batch(statements);}catch(error){const saved=await replay();if(saved)return saved;if(/CHECK constraint|UNIQUE constraint/i.test(error.message))fail('数据已变化，请重新读取 revision 后使用新 requestId。',409);throw error;}
 return json(result);
}
const revision=(input,row)=>{if(!Number.isInteger(input.revision)||input.revision!==row.revision)fail('revision 已变化，请重新读取。',409);};
export async function handleVideoHits(request,env,url,session){
 if(!url.pathname.startsWith(VIDEO_HITS_BASE))return null;
 const user=await videoHitUser(env.DB,session?.user);
 if(!['GET','HEAD'].includes(request.method)&&((request.headers.get('origin')&&request.headers.get('origin')!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site'))fail('不允许跨站修改。',403);
 const db=env.DB,path=url.pathname.slice(VIDEO_HITS_BASE.length);
 if(path==='/api'&&request.method==='GET')return json({endpoint:url.origin+'/api/v1/factory',assetUpload:url.origin+'/api/integrations/psychology/video-hits/assets/UPLOAD_UUID',videoUpload:url.origin+'/api/integrations/psychology/video-hits/videos/UPLOAD_UUID',maxVideoBytes:95*1024*1024,maxVersions:20,maxFrames:300,maxFrameBatch:100,authentication:'Authorization: Bearer <PROJECT_API_KEY>',instructions:['先创建来源，再创建1–20号版本。原图为version=0；二创图为version=1–20。','每帧须含assetId或持久公开imageUrl，可分批写入；帧序从1连续编号。','每次写入须带新的UUID requestId；重试沿用原编号；更新先读取revision。','成片版传inputMode:video与videoAssetId，可直接启用发布，无需分镜与script；图片版inputMode:frames。成片PUT最多95MB，须带文件名、大小、SHA256摘要。','每个二创版本仅允许一个发布账号和一个发布任务，失败重试原任务。','启用图片版本须补齐所有对应二创图和完整script。写入图片会停用版本；补完后再次启用。','图片建议先PUT二进制到assetUpload，PNG/JPEG/WebP每张最多8MB；同一UUID只允许相同内容。','videoHits.render只合成，videoHits.publish才创建真实合成/发布任务；不会恢复旧自动规划。']});
 if(path===''&&request.method==='GET'){
  const page=Number(url.searchParams.get('page')||1),q=(url.searchParams.get('q')||'').slice(0,100),sort=url.searchParams.get('sort')||'recent';
  if(!Number.isInteger(page)||page<1||page>10000||!['recent','plays'].includes(sort))fail('页码或排序无效。');
  const where='WHERE h.owner_id=? AND (?=\'\' OR h.title LIKE ? OR h.external_id LIKE ? OR h.video_url LIKE ?)',args=[user.id,q,'%'+q+'%','%'+q+'%','%'+q+'%'];
  const [count,rows]=await Promise.all([
   db.prepare('SELECT COUNT(*) n FROM psychology_video_hits h '+where).bind(...args).first(),
   db.prepare('SELECT h.*, (SELECT COUNT(*) FROM psychology_video_hit_versions v WHERE v.source_id=h.id) version_count, (SELECT COUNT(*) FROM psychology_video_hit_frames f WHERE f.source_id=h.id AND f.version=0) frame_count FROM psychology_video_hits h '+where+' ORDER BY '+(sort==='plays'?"CAST(COALESCE(json_extract(h.video_data_json,'$.playCount'),0) AS REAL) DESC, ":'')+'h.updated_at DESC,h.id LIMIT 20 OFFSET ?').bind(...args,(page-1)*20).all()
  ]);
  return json({page,pageSize:20,total:count.n,hasMore:page*20<count.n,items:rows.results.map(r=>({...publicSource(r),script:undefined,videoData:{...parse(r.video_data_json)},versionCount:r.version_count,frameCount:r.frame_count}))});
 }
 if(path===''&&request.method==='POST'){
  const body=await readManagementBody(request);
  return mutation(db,user,body,'create',async()=>{
   const input=sourceInput(body);if(!input.externalId||!input.videoUrl||!input.title)fail('请输入externalId、videoUrl和title。');
   const id='vh-'+(await sha256Hex(user.id+':'+input.externalId)).slice(0,32),stamp=Date.now();
   return {statements:[db.prepare('INSERT INTO psychology_video_hits(id,owner_id,external_id,video_url,title,caption,script,video_data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,user.id,input.externalId,input.videoUrl,input.title,input.caption||'',input.script||'',JSON.stringify(input.videoData||{}),stamp,stamp)],result:{ok:true,id,revision:1}};
  });
 }
 const detail=path.match(/^\/(vh-[a-f0-9]{32})$/);
 if(detail&&request.method==='GET'){
  const row=await sourceRow(db,detail[1],user),versions=(await db.prepare('SELECT v.*,(SELECT COUNT(*) FROM psychology_video_hit_frames f WHERE f.source_id=v.source_id AND f.version=v.version) frame_count FROM psychology_video_hit_versions v WHERE source_id=? ORDER BY version').bind(row.id).all()).results;
  return json({source:publicSource(row),frameCount:(await db.prepare('SELECT COUNT(*) n FROM psychology_video_hit_frames WHERE source_id=? AND version=0').bind(row.id).first()).n,versions:versions.map(r=>({...publicVersion(r),frameCount:r.frame_count}))});
 }
 if(detail&&request.method==='PATCH'){
  const body=await readManagementBody(request);
  return mutation(db,user,body,'source.update:'+detail[1],async()=>{
   const row=await sourceRow(db,detail[1],user);revision(body,row);const x={...publicSource(row),...sourceInput(body)};
   if(x.externalId!==row.external_id)fail('externalId不可修改。');
   return {statements:[db.prepare('UPDATE psychology_video_hits SET video_url=?,title=?,caption=?,script=?,video_data_json=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?').bind(x.videoUrl,x.title,x.caption,x.script,JSON.stringify(x.videoData),Date.now(),row.id,user.id,row.revision),guard(db)],result:{ok:true,id:row.id,revision:row.revision+1}};
  });
 }
 const vm=path.match(/^\/(vh-[a-f0-9]{32})\/versions\/(\d+)$/);
 if(vm){
  const n=versionNumber(Number(vm[2]));
  if(request.method==='GET')return json({version:publicVersion(await versionRow(db,vm[1],n,user))});
  if(['PUT','PATCH'].includes(request.method)){
   const body=await readManagementBody(request);
   return mutation(db,user,body,'version.write:'+vm[1]+':'+n,async()=>{
    await sourceRow(db,vm[1],user);
    const old=await db.prepare('SELECT * FROM psychology_video_hit_versions WHERE source_id=? AND version=?').bind(vm[1],n).first();
    if(old)revision(body,old);else if(body.revision!==0)fail('新版本revision须为0。',409);
    if(old?.publish_item_id)fail('该版本已进入发布流程，不能修改或再次发布。',409);
    const x={name:'版本 '+n,title:'',caption:'',script:'',enabled:false,inputMode:'frames',videoAssetId:'',...(old?publicVersion(old):{}),...versionInput(body)};
    if(!x.title)fail('请填写二创标题。');if(x.inputMode==='video'){if(x.videoAssetId)await readyVideo(db,user,x.videoAssetId);if(x.enabled&&!x.videoAssetId)fail('请先传入成片。',409);}else{if(x.videoAssetId)fail('图片方式不能绑定成片，请选择直接传入成片。');if(x.enabled)completeVersion(await allFrames(db,vm[1],0),await allFrames(db,vm[1],n),x);}
    const stamp=Date.now(),statements=old?[db.prepare("UPDATE psychology_video_hit_versions SET name=?,title=?,caption=?,script=?,enabled=?,input_mode=?,video_asset_id=?,revision=revision+1,updated_at=? WHERE source_id=? AND version=? AND revision=? AND publish_item_id=''").bind(x.name,x.title,x.caption,x.script,Number(x.enabled),x.inputMode,x.videoAssetId,stamp,vm[1],n,old.revision),guard(db)]:[db.prepare('INSERT INTO psychology_video_hit_versions(source_id,version,name,title,caption,script,enabled,input_mode,video_asset_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(vm[1],n,x.name,x.title,x.caption,x.script,Number(x.enabled),x.inputMode,x.videoAssetId,stamp,stamp)];
    return {statements,result:{ok:true,id:vm[1],version:n,revision:(old?.revision||0)+1,enabled:x.enabled}};
   });
  }
 }
 const fm=path.match(/^\/(vh-[a-f0-9]{32})\/frames\/(\d+)$/);
 if(fm){
  const n=versionNumber(Number(fm[2]),true);await sourceRow(db,fm[1],user);if(n)await versionRow(db,fm[1],n,user);
  if(request.method==='GET'){
   const page=Number(url.searchParams.get('page')||1);if(!Number.isInteger(page)||page<1||page>15)fail('帧页码须为1–15。');
   const frames=await allFrames(db,fm[1],n);return json({version:n,page,total:frames.length,hasMore:frames.some(f=>f.index>page*20),frames:frames.filter(f=>f.index>(page-1)*20&&f.index<=page*20)});
  }
  if(request.method==='PUT'){
   const body=await readManagementBody(request);
   return mutation(db,user,body,'frames.write:'+fm[1]+':'+n,async()=>{
    const row=n?await versionRow(db,fm[1],n,user):await sourceRow(db,fm[1],user);revision(body,row);
    if(n&&(row.input_mode==='video'||row.publish_item_id))fail('成片方式或已提交发布的版本不能修改分镜。',409);
    const frames=framesInput(body);await assertAssets(db,user,frames);
    const statement=n?db.prepare("UPDATE psychology_video_hit_versions SET enabled=0,revision=revision+1,updated_at=? WHERE source_id=? AND version=? AND revision=? AND publish_item_id=''").bind(Date.now(),fm[1],n,row.revision):db.prepare('UPDATE psychology_video_hits SET revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?').bind(Date.now(),fm[1],user.id,row.revision);
    const statements=[statement,guard(db)];
    if(!n)statements.push(db.prepare("UPDATE psychology_video_hit_versions SET enabled=0,revision=revision+1 WHERE source_id=? AND input_mode='frames' AND publish_item_id=''").bind(fm[1]));
    for(const f of frames)statements.push(db.prepare('INSERT INTO psychology_video_hit_frames(source_id,version,frame_index,asset_id,image_url,text,duration_seconds) VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_id,version,frame_index) DO UPDATE SET asset_id=excluded.asset_id,image_url=excluded.image_url,text=excluded.text,duration_seconds=excluded.duration_seconds').bind(fm[1],n,f.index,f.assetId,f.imageUrl,f.text,f.durationSeconds));
    return {statements,result:{ok:true,id:fm[1],version:n,written:frames.length,revision:row.revision+1,...(n?{enabled:false}:{})}};
   });
  }
 }
 fail('接口或请求方法不存在。',404);
}
