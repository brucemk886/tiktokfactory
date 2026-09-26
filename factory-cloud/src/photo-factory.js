import {json,readJson,sha256Hex,randomToken} from './http.js';
import {toPublicUser} from './auth.js';
import {loadGroupStore} from './official.js';
import {scopeOfficialAccess} from '../../scripts/official-account-group-store.js';
import {publishAccountDirectory} from './psychology-account-access.js';
import {kvGet,kvSet} from './kv.js';
import {VISUAL_STYLES} from '../../public/psychology-visual-styles.js';
import {COPY_MODELS,copyModel,parseCopyModelJson} from './psychology-copy-generation.js';
import {replicateText} from './replicate.js';
import {createDeepSeekClient} from './deepseek.js';
import {PHOTO_API,PHOTO_IMPORT,PRESETS,fail,parse,text,directionConfig,copyContent,pilotConfig,periodRange,rewritePrompt} from './photo-factory-domain.js';

export function assertPhotoUser(user){if(!user||user.role!=='admin'||user.active===false||!user.sidebarModules?.includes('photo-factory'))fail('没有图文工厂访问权限。',403);}
export async function photoUser(db,owner){const row=await db.prepare('SELECT * FROM factory_users WHERE username=? AND active=1').bind(owner).first();if(!row)fail('创建人已停用。',403);const user=toPublicUser(row);assertPhotoUser(user);return user;}
export async function getDirection(db,owner,id,enabled=false){
 const row=await db.prepare('SELECT * FROM photo_directions WHERE id=? AND owner=?').bind(id,owner).first();
 if(!row)fail('内容方向不存在。',404);if(enabled&&!row.enabled)fail('内容方向已停用。',409);return {...row,config:parse(row.config_json)};
}
export async function photoDirectory(env,user,fresh=false){
 let directory=await kvGet(env.DB,'photo-factory-directory',null);
 if(fresh||!directory){const data=await publishAccountDirectory(env,{fresh:true});directory={updatedAt:Date.now(),accounts:(data.accounts||[]).map(a=>({id:String(a.connectionId||a.id),connectionId:String(a.connectionId||a.id),username:a.username||'',displayName:a.displayName||'',scopes:a.scopes}))};await kvSet(env.DB,'photo-factory-directory',directory);}
 const scoped=scopeOfficialAccess(directory,await loadGroupStore(env.DB),user,'');
 const accounts=scoped.accounts.filter(a=>a.groupId&&(!Array.isArray(a.scopes)||a.scopes.includes('video.publish')));
 const legacy=(await env.DB.prepare("SELECT group_id FROM psychology_autopilots WHERE status IN ('active','paused') AND ends_at>?").bind(Date.now()).all()).results;
 const busy=new Set(legacy.map(r=>r.group_id));
 const pilots=(await env.DB.prepare("SELECT group_id FROM photo_pilots WHERE status IN ('active','paused') AND ends_at>?").bind(Date.now()).all()).results;
 return {updatedAt:directory.updatedAt,accounts,groups:scoped.groups.map(g=>({...g,accounts:accounts.filter(a=>a.groupId===g.id).length,legacyBusy:busy.has(g.id),photoBusy:pilots.some(p=>p.group_id===g.id)}))};
}
export async function assertNoLegacyConflict(db,groupId,ids,now=Date.now()){
 const legacy=await db.prepare(`SELECT p.id FROM psychology_autopilots p WHERE p.status IN ('active','paused') AND p.ends_at>? AND
 (p.group_id=? OR EXISTS(SELECT 1 FROM psychology_autopilot_accounts a WHERE a.autopilot_id=p.id AND a.connection_id IN(SELECT value FROM json_each(?)))) LIMIT 1`).bind(now,groupId,JSON.stringify(ids)).first();
 if(legacy)fail('该分组或账号仍在现有心理学自动运营中，请使用新的测试分组和账号。',409);
 const pending=await db.prepare(`SELECT i.id FROM psychology_publish_items i JOIN psychology_publish_batches b ON b.id=i.batch_id LEFT JOIN factory_jobs j ON j.id=i.job_id
 WHERE i.connection_id IN(SELECT value FROM json_each(?)) AND i.deleted_at=0 AND i.schedule_at>? AND (COALESCE(j.status,'') NOT IN ('failed','canceled') OR i.receipt_json<>'{}') LIMIT 1`).bind(JSON.stringify(ids),Math.floor(now/1000)-3600).first();
 if(pending)fail('所选账号仍有现有心理学排期，请使用空闲测试账号。',409);
}
export async function importCopy(db,owner,direction,input){
 const c=copyContent(input,direction.config),externalId=text(input.externalId||crypto.randomUUID(),'外部编号',120),kind=input.kind||'original';
 if(!['original','rewrite'].includes(kind))fail('版本类型无效。');
 let sourceId='';if(kind==='rewrite'){
  const source=await db.prepare("SELECT id FROM photo_copies WHERE id=? AND owner=? AND direction_id=? AND kind='original'").bind(String(input.sourceId||''),owner,direction.id).first();
  if(!source)fail('改写必须绑定当前方向中的原文。',400);sourceId=source.id;
 }
 const metadata=input.metadata&&typeof input.metadata==='object'?input.metadata:{};if(JSON.stringify(metadata).length>12000)fail('来源信息过长。');
 const id=crypto.randomUUID(),stamp=Date.now();sourceId||=id;
 const existing=await db.prepare('SELECT * FROM photo_copies WHERE owner=? AND direction_id=? AND external_id=?').bind(owner,direction.id,externalId).first();
 if(existing){if(existing.title!==c.title||existing.caption!==c.caption||existing.pages_json!==JSON.stringify(c.pages)||existing.kind!==kind||(kind==='rewrite'&&existing.source_id!==sourceId))fail('外部编号已有不同内容，请使用新的版本编号。',409);return {id:existing.id,duplicate:true};}
 await db.prepare(`INSERT INTO photo_copies(id,owner,direction_id,source_id,external_id,kind,title,caption,pages_json,tags_json,metadata_json,model,enabled,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
 .bind(id,owner,direction.id,sourceId,externalId,kind,c.title,c.caption,JSON.stringify(c.pages),JSON.stringify(c.tags),JSON.stringify(metadata),String(input.model||'').slice(0,80),input.enabled===false?0:1,stamp).run();
 return {id,duplicate:false};
}
const pageOf=params=>Math.max(1,Math.floor(Number(params.get('page'))||1));
export async function listCopies(db,owner,direction,params){
 const page=pageOf(params),query='%'+(params.get('q')||'').slice(0,100)+'%',kind=params.get('kind')||'',range=periodRange(params.get('period')||'all');
 const scope=`c.owner=? AND c.direction_id=? AND c.title LIKE ? AND (?='' OR c.kind=?)`;
 const bindings=[owner,direction.id,query,kind,kind];
 const [rows,count,inventory,comparison]=await db.batch([
  db.prepare(`SELECT c.*, (SELECT count(*) FROM photo_jobs j WHERE j.copy_id=c.id) draws,
   (SELECT max(v.views) FROM photo_jobs j JOIN ops_video_facts v ON v.account_key='tiktok:'||j.connection_id AND v.video_id=j.video_id WHERE j.copy_id=c.id AND v.published_at>=? AND v.published_at<?) highest_views,
   (SELECT count(*) FROM photo_jobs j JOIN ops_video_facts v ON v.account_key='tiktok:'||j.connection_id AND v.video_id=j.video_id WHERE j.copy_id=c.id AND v.views IS NOT NULL AND v.published_at>=? AND v.published_at<?) samples
   FROM photo_copies c WHERE ${scope} ORDER BY ${params.get('sort')==='views'?'highest_views DESC,':''} c.created_at DESC,c.id LIMIT 20 OFFSET ?`).bind(range.start,range.end,range.start,range.end,...bindings,(page-1)*20),
  db.prepare(`SELECT count(*) total FROM photo_copies c WHERE ${scope}`).bind(...bindings),
  db.prepare(`SELECT count(*) total,sum(kind='original') originals,sum(kind='rewrite') rewrites,sum(enabled=0) disabled,
   sum(EXISTS(SELECT 1 FROM photo_jobs j WHERE j.copy_id=c.id)) used FROM photo_copies c WHERE c.owner=? AND c.direction_id=?`).bind(owner,direction.id),
  db.prepare(`WITH samples AS (
   SELECT c.kind,v.views,j.id,row_number() OVER(PARTITION BY c.kind ORDER BY v.views,j.id) rn,count(*) OVER(PARTITION BY c.kind) n
   FROM photo_jobs j JOIN photo_copies c ON c.id=j.copy_id JOIN ops_video_facts v ON v.account_key='tiktok:'||j.connection_id AND v.video_id=j.video_id
   WHERE j.owner=? AND j.direction_id=? AND v.views IS NOT NULL AND v.published_at>=? AND v.published_at<?)
   SELECT kind,count(*) samples,max(views) highest,avg(CASE WHEN rn IN((n+1)/2,(n+2)/2) THEN views END) median,
   avg(views>=1000) thousand FROM samples GROUP BY kind`).bind(owner,direction.id,range.start,range.end)
 ]);
 return {page,total:count.results[0].total,inventory:inventory.results[0],comparison:comparison.results,items:rows.results.map(r=>({...r,pages:parse(r.pages_json,[]),tags:parse(r.tags_json,[]),metadata:parse(r.metadata_json)}))};
}
export async function report(db,owner,direction,params){
 const range=periodRange(params.get('period')||'today'),page=pageOf(params);
 const from=`FROM photo_jobs j JOIN photo_pilots p ON p.id=j.pilot_id LEFT JOIN ops_video_facts v ON v.account_key='tiktok:'||j.connection_id AND v.video_id=j.video_id WHERE j.owner=? AND j.direction_id=?`;
 const [execution,effects,groups,rows,count]=await db.batch([
  db.prepare(`SELECT count(*) total,sum(j.state='published') published,sum(j.state='failed') failed,sum(j.state='stopped') stopped,sum(j.state NOT IN ('published','failed','stopped')) pending ${from} AND j.schedule_at>=? AND j.schedule_at<?`).bind(owner,direction.id,range.start,range.end),
  db.prepare(`SELECT count(v.views) samples,sum(v.views) views,max(v.views) highest,avg(CASE WHEN v.views IS NOT NULL THEN v.views>=1000 END) thousand,sum(v.likes) likes,sum(v.saves) saves,sum(v.shares) shares,max(v.synced_at) syncedAt ${from} AND v.published_at>=? AND v.published_at<?`).bind(owner,direction.id,range.start,range.end),
  db.prepare(`WITH scoped AS (SELECT p.id,p.group_name,p.strategy,j.schedule_at,j.state,v.published_at,v.views ${from})
   SELECT id,group_name,strategy,sum(schedule_at>=? AND schedule_at<?) total,
   sum(schedule_at>=? AND schedule_at<? AND state='published') published,
   sum(schedule_at>=? AND schedule_at<? AND state='failed') failed,
   count(CASE WHEN published_at>=? AND published_at<? THEN views END) samples,
   max(CASE WHEN published_at>=? AND published_at<? THEN views END) highest
   FROM scoped WHERE (schedule_at>=? AND schedule_at<?) OR (published_at>=? AND published_at<?) GROUP BY id ORDER BY group_name`)
   .bind(owner,direction.id,...Array.from({length:7},()=>[range.start,range.end]).flat()),
  db.prepare(`SELECT j.id,j.state,j.schedule_at,j.created_at,j.error,j.video_id,j.remote_batch,j.connection_id,json_extract(j.snapshot_json,'$.accountName') account_name,json_extract(j.snapshot_json,'$.copy.title') title,p.group_name,p.strategy,v.views,v.likes,v.saves,v.shares,v.synced_at ${from} AND j.schedule_at>=? AND j.schedule_at<? ORDER BY j.schedule_at DESC,j.id LIMIT 20 OFFSET ?`).bind(owner,direction.id,range.start,range.end,(page-1)*20),
  db.prepare(`SELECT count(*) total ${from} AND j.schedule_at>=? AND j.schedule_at<?`).bind(owner,direction.id,range.start,range.end)
 ]);
 return {execution:execution.results[0],effects:effects.results[0],groups:groups.results,items:rows.results,page,total:count.results[0].total};
}
export async function handlePhotoFactory(request,env,url,session){
 const external=url.pathname===PHOTO_IMPORT;if(!external&&!url.pathname.startsWith(PHOTO_API))return null;if(Number(request.headers.get('content-length')||0)>1024*1024)fail('请求超过 1 MB。',413);
 if(!external&&request.method!=='GET'&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)fail('不允许跨站修改。',403);
 const db=env.DB,method=request.method;let user=session?.user,key;
 if(external){const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||'';if(!token)fail('请提供方向写入密钥。',401);key=await db.prepare('SELECT * FROM photo_import_keys WHERE token_hash=?').bind(await sha256Hex(token)).first();if(!key)fail('写入密钥无效。',401);user=await photoUser(db,key.owner);}
 assertPhotoUser(user);const owner=user.username,path=url.pathname.slice(PHOTO_API.length);
 if(!external&&path==='/directions'){
  if(method==='GET')return json({directions:(await db.prepare('SELECT * FROM photo_directions WHERE owner=? ORDER BY created_at,id').bind(owner).all()).results.map(r=>({...r,config:parse(r.config_json)})),presets:PRESETS,styles:VISUAL_STYLES.map(s=>({id:s.id,label:s.label})),models:Object.entries(COPY_MODELS).map(([id,m])=>({id,label:m.label}))});
  if(method==='POST'){const input=await readJson(request),config=directionConfig(input.config),slug=text(input.slug,'方向标识',40);if(!/^[a-z][a-z0-9-]{1,39}$/.test(slug))fail('标识使用 2–40 位英文、数字或短横线。');
   const id=crypto.randomUUID(),stamp=Date.now();if(await db.prepare('SELECT id FROM photo_directions WHERE owner=? AND slug=?').bind(owner,slug).first())fail('方向标识已存在。',409);
   await db.prepare('INSERT INTO photo_directions(id,owner,slug,name,config_json,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,owner,slug,text(input.name,'方向名称',40),JSON.stringify(config),input.enabled===false?0:1,stamp,stamp).run();return json({id},201);
  }
 }
 const id=external?key.direction_id:url.searchParams.get('directionId');
 const direction=await getDirection(db,owner,id,method!=='GET'&&path!=='/direction'&&path!=='/key');
 if(external&&method==='GET')return json({directionId:direction.id,name:direction.name,config:direction.config,revision:direction.revision});
 if((external||path==='/copies')&&method==='POST'){
  const input=await readJson(request),items=input.items||[input];if(!Array.isArray(items)||!items.length||items.length>50)fail('每次支持 1–50 条文案。');
  const results=[];for(const item of items){try{results.push({ok:true,...await importCopy(db,owner,direction,item)});}catch(e){results.push({ok:false,externalId:item?.externalId||'',error:e.message});}}
  return json({results},200);
 }
 if(external)fail('仅支持 GET 和 POST。',405);
 if(path==='/direction'&&method==='PATCH'){
  const input=await readJson(request),config=directionConfig(input.config||direction.config);
  const result=await db.prepare('UPDATE photo_directions SET name=?,config_json=?,enabled=?,revision=revision+1,updated_at=? WHERE id=? AND owner=? AND revision=?')
   .bind(text(input.name||direction.name,'方向名称',40),JSON.stringify(config),input.enabled===false?0:1,Date.now(),id,owner,Number(input.revision)).run();
  if(!result.meta.changes)fail('方向配置已变化，请刷新后再保存。',409);return json({ok:true});
 }
 if(path==='/key'&&method==='POST'){
  const token='pf_'+randomToken(32);await db.prepare('INSERT INTO photo_import_keys(direction_id,owner,token_hash,prefix,created_at) VALUES(?,?,?,?,?) ON CONFLICT(direction_id) DO UPDATE SET token_hash=excluded.token_hash,prefix=excluded.prefix,created_at=excluded.created_at')
   .bind(id,owner,await sha256Hex(token),token.slice(0,10),Date.now()).run();return json({key:token,endpoint:PHOTO_IMPORT,directionId:id});
 }
 if(path==='/key'&&method==='DELETE'){await db.prepare('DELETE FROM photo_import_keys WHERE direction_id=? AND owner=?').bind(id,owner).run();return json({ok:true});}
 if(path==='/copies'&&method==='GET')return json(await listCopies(db,owner,direction,url.searchParams));
 if(path==='/copy'&&method==='PATCH'){
  const input=await readJson(request);const result=await db.prepare('UPDATE photo_copies SET enabled=? WHERE id=? AND owner=? AND direction_id=?').bind(input.enabled?1:0,input.id,owner,id).run();if(!result.meta.changes)fail('文案不存在。',404);return json({ok:true});
 }
 if(path==='/rewrite'&&method==='POST'){
  const input=await readJson(request),source=await db.prepare("SELECT * FROM photo_copies WHERE id=? AND owner=? AND direction_id=? AND kind='original'").bind(input.sourceId,owner,id).first();if(!source)fail('原文不存在。',404);
  const model=copyModel(direction.config.model),prompt=rewritePrompt(direction.config,{title:source.title,caption:source.caption,pages:parse(source.pages_json,[])});
  const raw=model.provider==='replicate'?await replicateText(env,{model:model.model,prompt,maxTokens:4096,effort:model.effort}):await createDeepSeekClient({apiKey:env.DEEPSEEK_API_KEY,fetchImpl:env.fetch||fetch}).createChat(prompt);
  let draft;try{draft=parseCopyModelJson(raw).value;}catch{fail('改写结果不是有效 JSON，请重试。',502);}
  return json(await importCopy(db,owner,direction,{...draft,tags:parse(source.tags_json,[]),externalId:'ai-'+crypto.randomUUID(),kind:'rewrite',sourceId:source.id,model:model.id,enabled:false}),201);
 }
 if(path==='/directory'&&method==='GET')return json(await photoDirectory(env,user,url.searchParams.get('refresh')==='1'));
 if(path==='/pilots'&&method==='GET')return json({items:(await db.prepare('SELECT * FROM photo_pilots WHERE owner=? AND direction_id=? ORDER BY created_at DESC').bind(owner,id).all()).results.map(p=>({...p,config:parse(p.config_json),accounts:parse(p.accounts_json,[])}))});
 if(path==='/pilots'&&method==='POST'){
  const input=await readJson(request),config=pilotConfig(input),strategy=input.strategy||'balanced';if(!['balanced','original','rewrite'].includes(strategy))fail('运营策略无效。');
  const directory=await photoDirectory(env,user,true),group=directory.groups.find(g=>g.id===input.groupId),accounts=directory.accounts.filter(a=>a.groupId===input.groupId);
  if(!group||!accounts.length)fail('分组不存在或没有可发布的授权账号。');
  if(accounts.length>100)fail('试运行版本单组最多 100 个账号，请分组测试。');
  await assertNoLegacyConflict(db,group.id,accounts.map(a=>a.connectionId));
  const pilotId=input.requestId||crypto.randomUUID();if(!/^[0-9a-f-]{36}$/i.test(pilotId))fail('请求编号无效。');
  const duplicate=await db.prepare('SELECT * FROM photo_pilots WHERE id=?').bind(pilotId).first();
  if(duplicate){if(duplicate.owner!==owner||duplicate.direction_id!==id||duplicate.group_id!==group.id||duplicate.config_json!==JSON.stringify(config)||duplicate.strategy!==strategy)fail('请求编号已用于其他测试。',409);return json({id:pilotId,status:duplicate.status,duplicate:true});}
  const stamp=Date.now();await db.prepare('INSERT INTO photo_pilots(id,owner,direction_id,group_id,group_name,strategy,config_json,accounts_json,starts_at,ends_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(pilotId,owner,id,group.id,group.name,strategy,JSON.stringify(config),JSON.stringify(accounts.map(a=>({id:a.connectionId,username:a.username||a.displayName||a.connectionId}))),config.startsAt,config.endsAt,stamp,stamp).run();return json({id:pilotId,status:'draft'},201);
 }
 if(path==='/pilot'&&method==='PATCH'){
  const input=await readJson(request),p=await db.prepare('SELECT * FROM photo_pilots WHERE id=? AND owner=? AND direction_id=?').bind(input.id,owner,id).first();if(!p)fail('运营记录不存在。',404);
  if(!['active','paused','ended'].includes(input.status))fail('状态无效。');if(p.status==='ended')fail('已结束任务不能重新启动，请新建测试。',409);
  if(input.status==='active'){
   if(p.ends_at<=Date.now())fail('测试日期已结束，请新建测试。',409);
   await assertNoLegacyConflict(db,p.group_id,parse(p.accounts_json,[]).map(a=>a.id));
   const other=await db.prepare("SELECT id FROM photo_pilots WHERE id<>? AND status IN ('active','paused') AND (group_id=? OR EXISTS(SELECT 1 FROM json_each(accounts_json) a WHERE json_extract(a.value,'$.id') IN(SELECT json_extract(value,'$.id') FROM json_each(?)))) LIMIT 1").bind(p.id,p.group_id,p.accounts_json).first();
   if(other)fail('分组或账号已在新图文工厂的其他运营任务中。',409);
   const directory=await photoDirectory(env,user,true),ids=new Set(directory.accounts.filter(a=>a.groupId===p.group_id).map(a=>a.connectionId));
   if(parse(p.accounts_json,[]).some(a=>!ids.has(a.id)))fail('分组账号或授权已变化，请新建测试以确认账号。',409);
  }
  const statements=[db.prepare('UPDATE photo_pilots SET status=?,error=\'\',next_check=0,updated_at=? WHERE id=?').bind(input.status,Date.now(),p.id)];
  if(input.status!=='active')statements.push(db.prepare("UPDATE photo_jobs SET state='stopped',error='运营任务已暂停或结束',updated_at=? WHERE pilot_id=? AND state IN ('queued','dispatching','rendering','ready')").bind(Date.now(),p.id));
  await db.batch(statements);return json({ok:true});
 }
 if(path==='/report'&&method==='GET')return json(await report(db,owner,direction,url.searchParams));
 fail('接口不存在。',404);
}
