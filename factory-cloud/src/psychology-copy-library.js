import {psychologyPeerHitFromRow} from './psychology-peer-hits-store.js';
import {json,errorJson} from './http.js';
import {peerProductionPayload} from '../../scripts/psychology-peer-production.js';
import {photoCopyKey,validatePhotoCopy} from './peer-photo-copy-cache.js';
import {filterPhotoPageTexts,NO_USABLE_PAGES} from './photo-page-filter.js';

const BASE='/api/psychology-copy-library';
export const COPY_EXTRACTION_CONCURRENCY=3;
const safeParse=value=>{try{return JSON.parse(value||'{}');}catch{return {};}};
// Photo copy with unusable pages removed; `skipped` carries the reason when none remain.
export function photoContent(title,caption,texts){
 const kept=filterPhotoPageTexts(texts);
 if(!kept.length)return {mediaType:'photo',skipped:NO_USABLE_PAGES};
 return {mediaType:'photo',title,caption,pages:kept.map((text,i)=>({index:i+1,text})),transcript:'',onScreenText:[]};
}
export function originalPhotoContent(copy){
 return photoContent(copy.sourceTitle,copy.sourceCopy,copy.plan.scenes.map(s=>s.originalText));
}
export function importedCopy(source){
 const d=source.videoData||{},caption=String(d.copy||d.caption||d.description||source.title||'');
 if(source.mediaType==='photo'&&Array.isArray(d.pageTexts)&&d.pageTexts.length>0&&d.pageTexts.length<=6&&d.pageTexts.every(t=>typeof t==='string'&&t.length<=10000))
  return photoContent(source.title||'',caption,d.pageTexts);
 if(source.mediaType==='video'&&typeof d.transcript==='string'&&d.transcript.trim()&&d.transcript.length<=12000)
  return {mediaType:'video',title:source.title||'',caption,pages:[],transcript:d.transcript,
   onScreenText:Array.isArray(d.onScreenText)?d.onScreenText.filter(t=>typeof t==='string').slice(0,100):[]};
 return null;
}
export async function handlePsychologyCopyLibrary(request,env,url,session){
 if(!url.pathname.startsWith(BASE))return null;
 const user=session?.user;
 if(user?.role!=='admin'||!['psychology-copy-library','psychology-peer-hits'].some(id=>user.sidebarModules?.includes(id)))return errorJson('没有文案库权限。',403);
 if(request.method!=='GET'&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return errorJson('不允许跨站修改。',403);
 if(url.pathname===BASE&&request.method==='GET'){
  const media=url.searchParams.get('mediaType')||'all';
  if(!['all','video','photo'].includes(media))return errorJson('筛选条件无效。',400);
  const status=url.searchParams.get('status')||'done',sort=url.searchParams.get('sort')||'recent';
  if(!['all','done','queued','running','failed','historical'].includes(status)||!['recent','plays','published'].includes(sort))return errorJson('筛选条件无效。',400);
  const query='%'+String(url.searchParams.get('q')||'').slice(0,200)+'%';
  const statusWhere=status==='all'?'1=1':status==='historical'?"c.auto_extract=0 AND c.status<>'done'":status==='done'?"c.status='done'":"c.status=? AND c.auto_extract=1";
  const where=statusWhere+" AND (?='all' OR c.media_type=?) AND (c.title LIKE ? OR c.source_url LIKE ? OR c.content_json LIKE ? OR p.account_name LIKE ? OR p.account_username LIKE ?)";
  const args=[...(['queued','running','failed'].includes(status)?[status]:[]),media,media,query,query,query,query,query];
  const from=' FROM psychology_copy_library c LEFT JOIN psychology_peer_hits p ON p.id=c.id WHERE ';
  const total=Number((await env.DB.prepare('SELECT COUNT(*) n'+from+where).bind(...args).first()).n);
  const pages=Math.max(1,Math.ceil(total/20)),page=Math.min(pages,Math.max(1,Math.floor(Number(url.searchParams.get('page'))||1)));
  const order={recent:'c.created_at DESC,c.id',plays:'p.play_count DESC,c.created_at DESC,c.id',published:'p.published_at DESC,c.created_at DESC,c.id'}[sort];
  const items=(await env.DB.prepare('SELECT c.id,c.media_type,c.title,c.source_url,c.status,c.content_json,c.error,c.provider,c.created_at,c.completed_at,c.auto_extract'+from+where+' ORDER BY '+order+' LIMIT 20 OFFSET ?').bind(...args,(page-1)*20).all()).results;
  const counts=(await env.DB.prepare("SELECT media_type,COUNT(*) n FROM psychology_copy_library WHERE status='done' GROUP BY media_type").all()).results;
  const ids=items.map(r=>r.id);
  const peers=ids.length?(await env.DB.prepare('SELECT * FROM psychology_peer_hits WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all()).results.map(psychologyPeerHitFromRow):[];
  const byId=new Map(peers.map(r=>[r.id,r]));
  const originals=items.map(({content_json,...r})=>({...r,sourceKey:(()=>{try{return photoCopyKey(r.source_url);}catch{return r.id;}})(),content:safeParse(content_json)}));
  const keys=[...new Set(originals.map(r=>r.sourceKey))];
  const variants=keys.length?(await env.DB.prepare('SELECT source_key,COUNT(*) total,SUM(enabled) enabled FROM psychology_copy_variants WHERE owner=? AND deleted_at=0 AND source_key IN ('+keys.map(()=>'?').join(',')+') GROUP BY source_key').bind(user.username,...keys).all()).results:[];
  const bySource=new Map(variants.map(r=>[r.source_key,r]));
  return json({canManageSources:user.sidebarModules?.includes('psychology-peer-hits')===true,items:originals.map(r=>({...r,peer:byId.get(r.id)||null,variantCount:Number(bySource.get(r.sourceKey)?.total||0),enabledVariantCount:Number(bySource.get(r.sourceKey)?.enabled||0)})),total,page,pages,counts});
 }
 const match=url.pathname.match(/^\/api\/psychology-copy-library\/(psy-[a-f0-9]{32})\/retry$/);
 if(match&&request.method==='POST'){
  const changed=await env.DB.prepare("UPDATE psychology_copy_library SET status='queued',attempt=attempt+1,error='',workflow_id='',payload_json='{}',started_at=0,dispatch_at=0,updated_at=? WHERE id=? AND status='failed' AND auto_extract=1").bind(Date.now(),match[1]).run();
  return changed.meta?.changes?json({ok:true}):errorJson('仅可重试提取失败的文案。',409);
 }
 return errorJson('不支持此请求。',405);
}

export async function dispatchCopyExtractions(env,now=Date.now()){
 if(!env.PSYCHOLOGY_COPY_WORKFLOW)return {configured:false};
 const db=env.DB;
 // Do not blindly repeat a timed-out paid analysis. Operators can review/retry it.
 await db.prepare("UPDATE psychology_copy_library SET status='failed',error='文案提取超过2小时，请查看后重试。',updated_at=? WHERE status='running' AND auto_extract=1 AND started_at<?").bind(now,now-2*3600000).run();
 const pending=(await db.prepare("SELECT * FROM psychology_copy_library WHERE status='queued' AND auto_extract=1 ORDER BY created_at,id LIMIT 30").all()).results;
 for(const row of pending){
  try{
  const source=safeParse(row.source_json);let content=importedCopy(source),provider='imported-text';
  if(!content&&row.media_type==='photo'){
   try{const cached=await db.prepare("SELECT copy_json FROM psychology_photo_copy_cache WHERE owner=? AND source_key=? AND copy_json<>''").bind(row.owner,photoCopyKey(row.source_url)).first();
    if(cached){content=originalPhotoContent(validatePhotoCopy(JSON.parse(cached.copy_json)));provider='source-copy-cache';}
   }catch{/* Invalid cache is repaired by the normal extraction path. */}
  }
  if(content?.skipped){await db.prepare("UPDATE psychology_copy_library SET status='failed',error=?,updated_at=? WHERE id=? AND status='queued' AND attempt=?").bind(content.skipped,now,row.id,row.attempt).run();continue;}
  if(content){await db.prepare("UPDATE psychology_copy_library SET status='done',content_json=?,provider=?,error='',completed_at=?,updated_at=? WHERE id=? AND status='queued' AND attempt=?").bind(JSON.stringify(content),provider,now,now,row.id,row.attempt).run();continue;}
  const actor=await db.prepare("SELECT active,role FROM factory_users WHERE username=?").bind(row.owner).first();
  if(!actor?.active||actor.role!=='admin'){await db.prepare("UPDATE psychology_copy_library SET status='failed',error='原导入账号已停用或无管理员权限。',updated_at=? WHERE id=? AND status='queued' AND attempt=?").bind(now,row.id,row.attempt).run();continue;}
  const workflowId='copy-'+row.id+'-'+row.attempt;
  const payload=row.media_type==='photo'?peerProductionPayload(source,'psychology-photo-story',{rewriteCopy:false}):source;
  await db.prepare("UPDATE psychology_copy_library SET status='running',workflow_id=?,payload_json=?,started_at=?,dispatch_at=0,updated_at=? WHERE id=? AND status='queued' AND auto_extract=1 AND attempt=? AND (SELECT COUNT(*) FROM psychology_copy_library WHERE status='running' AND auto_extract=1)<?")
   .bind(workflowId,JSON.stringify(payload),now,now,row.id,row.attempt,COPY_EXTRACTION_CONCURRENCY).run();
  }catch(error){await db.prepare("UPDATE psychology_copy_library SET status='failed',error=?,updated_at=? WHERE id=? AND attempt=? AND status='queued'").bind(String(error.message||error).slice(0,1000),now,row.id,row.attempt).run();}
 }
 const active=(await db.prepare("SELECT id,attempt,workflow_id,dispatch_at FROM psychology_copy_library WHERE status='running' AND auto_extract=1 ORDER BY started_at LIMIT ?").bind(COPY_EXTRACTION_CONCURRENCY).all()).results;
 for(const row of active){
  if(row.dispatch_at&&now-row.dispatch_at<120000)continue;
  try{
   let instance,state;try{instance=await env.PSYCHOLOGY_COPY_WORKFLOW.get(row.workflow_id);state=await instance.status();}catch{instance=null;}
   if(!instance)await env.PSYCHOLOGY_COPY_WORKFLOW.create({id:row.workflow_id,params:{jobId:row.workflow_id,copyId:row.id,attempt:row.attempt,copyExtraction:true}});
   else {if(['errored','terminated','complete'].includes(state.status)){
    await db.prepare("UPDATE psychology_copy_library SET status='failed',error='提取工作流已结束但未返回完整文案，请查看后重试。',updated_at=? WHERE id=? AND attempt=? AND status='running'").bind(now,row.id,row.attempt).run();continue;
   }}
   await db.prepare("UPDATE psychology_copy_library SET dispatch_at=?,error='' WHERE id=? AND attempt=? AND status='running'").bind(now,row.id,row.attempt).run();
  }catch(error){await db.prepare("UPDATE psychology_copy_library SET error=?,updated_at=? WHERE id=? AND attempt=? AND status='running'").bind('等待工作流派发：'+String(error.message||error).slice(0,800),now,row.id,row.attempt).run();}
 }
 return {active:active.length};
}
