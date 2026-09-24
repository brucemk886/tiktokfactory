import {normalizeCopyReview} from './psychology-copy-review.js';
import {handleCopyComparison} from './psychology-copy-comparison.js';
import { json,readJson,sha256Hex,errorJson } from './http.js';
import { photoCopyKey } from './peer-photo-copy-cache.js';
import { loadGroupStore } from './official.js';
import { publishAccountDirectory } from './psychology-account-access.js';
import { scopeOfficialAccess } from '../../scripts/official-account-group-store.js';
import { VISUAL_STYLES,styleById,currentStyleId,currentStyleBindings } from '../../public/psychology-visual-styles.js';
const BASE='/api/psychology-creative';
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
export function contentText(plan){return {title:String(plan.title||'').trim(),caption:String(plan.caption||'').trim(),pages:(plan.scenes||[]).map(p=>[p.title,p.subtitle,p.body].filter(Boolean).join('\n').trim()||String(p.text||'').trim())};}
export async function copyIdentity(plan){const copy=contentText(plan);const canonical=JSON.stringify(copy).normalize('NFKC').replace(/\s+/g,' ');return {hash:await sha256Hex(canonical),copy};}
export function normalizeVariant(input){
 const externalId=String(input.externalId||'').trim(),sourceKey=String(input.sourceKey||'').trim(),title=String(input.title||'').trim(),caption=String(input.caption||'').trim();
 if(!externalId||externalId.length>120||!sourceKey||sourceKey.length>200||!title||title.length>200||caption.length>2200)fail('每条须填写 externalId、sourceKey、title；标题最多200字符，发布文案最多2200字符。');
 if(!Array.isArray(input.pages)||input.pages.length<1||input.pages.length>6)fail('每篇文案须有1–6页，pages 第一项为首图文案。');
 const pages=input.pages.map(v=>typeof v==='string'?v.trim():'');if(pages.some(v=>!v||v.length>1500))fail('每页须为1–1500字符的文字。');
 return {externalId,sourceKey,title,caption,pages,...normalizeCopyReview({...input,title,caption,pages})};
}
export function variantPlan(v){return {title:v.title,caption:v.caption,hooks:[],scenes:JSON.parse(v.pages_json).map((text,index)=>({sourceIndex:index+1,template:'text',textKind:index?'content':'cover',originalText:text,title:text,subtitle:'',body:'',text,stockQuery:''}))};}
export async function handlePsychologyCreative(request,env,url,session){
 if(!url.pathname.startsWith(BASE))return null;
 const user=session?.user;const copyRoute=url.pathname===BASE+'/copies'||url.pathname.startsWith(BASE+'/copies/');
 if(!user||user.role!=='admin'||!(user.sidebarModules?.includes('psychology-publish')||(copyRoute&&['psychology-copy-library','psychology-peer-hits'].some(id=>user.sidebarModules?.includes(id)))))return errorJson('没有心理学自动发布权限。',403);
 if(request.method!=='GET'&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return errorJson('不允许跨站修改。',403);
 const db=env.DB,owner=user.username;
 const comparison=url.pathname.match(/^\/api\/psychology-creative\/copies\/([a-f0-9]{64})\/comparison$/);
 if(comparison)return handleCopyComparison(request,env,url,owner,comparison[1]);
 const sourceId=url.searchParams.get('sourceId');
 let sourceKey='';
 if(sourceId&&url.pathname===BASE+'/copies'){
  const source=await db.prepare("SELECT id,source_url FROM psychology_copy_library WHERE id=? AND status='done'").bind(sourceId).first();
  if(!source)fail('爆款文案不存在或尚未提取完成。',404);
  try{sourceKey=photoCopyKey(source.source_url);}catch{sourceKey=source.id;}
 }
 if(url.pathname===BASE+'/bindings'){
  const scoped=scopeOfficialAccess(await publishAccountDirectory(env),await loadGroupStore(db),user,'psychology');
  const accounts=scoped.accounts.map(a=>({id:String(a.connectionId||a.id),username:a.username||a.displayName||'',groupId:a.groupId||'',groupName:a.groupName||''}));
  const groups=(scoped.groups||[]).map(g=>({id:g.id,name:g.name}));
  for(const a of accounts)if(a.groupId&&!groups.some(g=>g.id===a.groupId))groups.push({id:a.groupId,name:a.groupName});
  const allowed=(kind,id)=>kind==='group'?groups.some(g=>g.id===id):kind==='account'&&accounts.some(a=>a.id===id);
  if(request.method==='GET'){const rows=(await db.prepare('SELECT * FROM psychology_style_bindings WHERE owner=?').bind(owner).all()).results;return json({styles:VISUAL_STYLES,accounts,groups,bindings:currentStyleBindings(rows.filter(b=>allowed(b.kind,b.target_id)))});}
  if(request.method==='PUT'){
   const b=await readJson(request);if(!allowed(b.kind,b.targetId))fail('只能设置当前有权限的心理学账号或分组。',403);
   const styles=[...new Set(Array.isArray(b.styles)?b.styles.map(currentStyleId):[])];if(styles.length>20||styles.some(id=>!styleById(id))||(b.kind==='account'&&styles.length>1))fail('选择有效样式；单账号最多指定一种。');
   if(!styles.length)await db.prepare('DELETE FROM psychology_style_bindings WHERE owner=? AND kind=? AND target_id=?').bind(owner,b.kind,b.targetId).run();
   else await db.prepare('INSERT INTO psychology_style_bindings(owner,kind,target_id,styles_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner,kind,target_id) DO UPDATE SET styles_json=excluded.styles_json,updated_at=excluded.updated_at').bind(owner,b.kind,b.targetId,JSON.stringify(styles),Date.now()).run();
   return json({ok:true});
  }
 }
 if(url.pathname===BASE+'/copies'&&request.method==='GET'){
  const page=Math.max(1,Math.min(100000,Math.floor(Number(url.searchParams.get('page'))||1))),q='%'+String(url.searchParams.get('q')||'').slice(0,100)+'%';
  const args=[owner,q,q];let where='owner=? AND deleted_at=0 AND (title LIKE ? OR source_key LIKE ?)';
  if(sourceId){where+=' AND source_key=?';args.push(sourceKey);}
  const [rows,total]=await Promise.all([db.prepare('SELECT id,owner,external_id,source_key,title,caption,pages_json,fingerprint,created_at,enabled,deleted_at,quality_score,score_reason FROM psychology_copy_variants WHERE '+where+' ORDER BY quality_score DESC,created_at DESC,id LIMIT 20 OFFSET ?').bind(...args,(page-1)*20).all(),db.prepare('SELECT COUNT(*) n FROM psychology_copy_variants WHERE '+where).bind(...args).first()]);
  return json({items:rows.results.map(r=>({...r,pages:JSON.parse(r.pages_json)})),page,total:total.n});
 }
 if(url.pathname===BASE+'/copies'&&request.method==='POST'){
  const raw=await request.text();if(raw.length>1500000)fail('导入内容过大。');let body;try{body=JSON.parse(raw);}catch{fail('请输入有效 JSON。');}
  const rows=Array.isArray(body)?body:body.items;if(!Array.isArray(rows)||!rows.length||rows.length>100)fail('每次导入1–100条文案。');
  if(sourceId&&rows.some(r=>r.sourceKey&&r.sourceKey!==sourceKey))fail('导入版本的来源与当前爆款文案不一致，请核对 sourceKey。');
  const normalized=rows.map(r=>normalizeVariant(sourceId?{...r,sourceKey}:r));if(new Set(normalized.map(r=>r.externalId)).size!==rows.length)fail('同次导入的 externalId 不可重复。');
  const statements=[];let created=0;
  for(const r of normalized){const id=await sha256Hex(owner+':'+r.externalId),fingerprint=await sha256Hex(JSON.stringify([r.sourceKey,r.title,r.caption,r.pages]));
   const old=await db.prepare('SELECT fingerprint FROM psychology_copy_variants WHERE id=?').bind(id).first();if(old&&old.fingerprint!==fingerprint)fail('文案编号 '+r.externalId+' 已存在且内容不同，请使用新的编号保留版本。',409);
   statements.push(db.prepare('INSERT INTO psychology_copy_variants(id,owner,external_id,source_key,title,caption,pages_json,fingerprint,created_at,quality_score,score_reason,comparison_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET fingerprint=CASE WHEN fingerprint=excluded.fingerprint THEN fingerprint ELSE NULL END,quality_score=COALESCE(excluded.quality_score,quality_score),score_reason=CASE WHEN excluded.score_reason<>\'\' THEN excluded.score_reason ELSE score_reason END,comparison_json=CASE WHEN excluded.comparison_json<>\'\' THEN excluded.comparison_json ELSE comparison_json END WHERE deleted_at=0').bind(id,owner,r.externalId,r.sourceKey,r.title,r.caption,JSON.stringify(r.pages),fingerprint,Date.now(),r.score,r.scoreReason,r.comparison?JSON.stringify(r.comparison):''));if(!old)created++;
  }
  await db.batch(statements);return json({ok:true,created,duplicates:rows.length-created});
 }
 const match=url.pathname.match(/^\/api\/psychology-creative\/copies\/([a-f0-9]{64})$/);
 if(match&&request.method==='PATCH'){const b=await readJson(request);if(typeof b.enabled!=='boolean')fail('启用状态无效。');const result=await db.prepare('UPDATE psychology_copy_variants SET enabled=? WHERE id=? AND owner=? AND deleted_at=0').bind(b.enabled?1:0,match[1],owner).run();if(!result.meta.changes)fail('文案不存在。',404);return json({ok:true});}
 // Deleted rows stay as tombstones so Grokbot re-imports of the same version are skipped as duplicates.
 if(match&&request.method==='DELETE'){const result=await db.prepare('UPDATE psychology_copy_variants SET enabled=0,deleted_at=? WHERE id=? AND owner=? AND deleted_at=0').bind(Date.now(),match[1],owner).run();if(!result.meta.changes)fail('文案不存在。',404);return json({ok:true});}
 if(url.pathname===BASE+'/export'&&request.method==='GET'){
  const offset=Math.max(0,Math.floor(Number(url.searchParams.get('offset'))||0));
  const rows=(await db.prepare("SELECT source_key,copy_json FROM psychology_photo_copy_cache WHERE owner=? AND copy_json<>'' ORDER BY source_key LIMIT 51 OFFSET ?").bind(owner,offset).all()).results;
  return json({items:rows.slice(0,50).map(r=>{const c=JSON.parse(r.copy_json);return {sourceKey:r.source_key,...contentText(c.plan)};}),offset,hasMore:rows.length>50});
 }
 return errorJson('不支持此请求。',405);
}
