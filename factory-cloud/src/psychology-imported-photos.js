import {normalizePhotoMusicIds} from '../../scripts/psychology-photo-music-policy.js';
import {json,errorJson,readJson,sha256Hex} from './http.js';
import {toPublicUser} from './auth.js';
import {hasPsychologyModule} from './psychology-permissions.js';
import {accountScope,balanceConversionRoutes} from './psychology-conversion.js';
import {publishAccountDirectory} from './psychology-account-access.js';
import {assertOfficialPublishAccess} from './official.js';
import {allFrames,assertAssets,guard} from './psychology-video-hits.js';
import {hitAdmin} from './psychology-video-hit-access.js';
import {createHitPhotoBatch,validateFrames} from './psychology-video-hit-photos.js';
import {dispatchCloudPhotos} from './psychology-cloud-queue.js';
import {IMPORTED_PHOTO_TIMES,IMPORTED_PHOTO_ZONE,IMPORTED_PHOTO_LEAD,IMPORTED_PHOTO_PREPARE,importedPhotoSlots,importedPhotoCaption,DEFAULT_IMPORTED_PHOTO_CTA,normalizeImportedPhotoCTA} from '../../scripts/psychology-imported-photo-policy.js';
const BASE='/api/psychology-autopilot/imported-photos',LEASE=5*60000;
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
const parse=s=>JSON.parse(s||'{}');
const defaults=()=>({connectionIds:[],receivers:[],routes:{},isAiGenerated:true,musicIds:[],cta:{...DEFAULT_IMPORTED_PHOTO_CTA}});
async function actor(db,username,website=false){
 const row=await db.prepare('SELECT * FROM factory_users WHERE username=? AND active=1').bind(username||'').first(),user=row&&toPublicUser(row);
 if(!user||(website?!(hasPsychologyModule(user,'psychology-website')||user.role==='admin'&&hasPsychologyModule(user,'psychology-autopilot')):!['psychology-autopilot','psychology-publish','psychology-video-hits'].every(m=>hasPsychologyModule(user,m))))fail(website?'没有独立站承接设置权限。':'需要自动运营、自动发布和视频爆款权限。',403);
 return user;
}
const inventoryWhere=`(s.owner_id=? OR ?=1) AND s.archived_at=0 AND v.input_mode='frames' AND v.enabled=1 AND v.cleaned_at=0 AND v.publish_item_id=''
 AND trim(v.title)<>'' AND trim(v.caption)<>''
 AND (SELECT count(*) FROM psychology_video_hit_frames f WHERE f.source_id=v.source_id AND f.version=v.version) BETWEEN 1 AND 15
 AND NOT EXISTS(SELECT 1 FROM psychology_video_hit_frames f WHERE f.source_id=v.source_id AND f.version=v.version AND f.asset_id='' AND f.image_url='')`;
async function readData(env,user,scope,now){
 const row=await env.DB.prepare('SELECT * FROM psychology_imported_photo_settings WHERE owner=?').bind(user.username).first();
 const count=await env.DB.prepare('SELECT count(*) n FROM psychology_video_hit_versions v JOIN psychology_video_hits s ON s.id=v.source_id WHERE '+inventoryWhere).bind(user.id,hitAdmin(user)).first();
 const recent=(await env.DB.prepare(`SELECT s.connection_id connectionId,s.slot_at slotAt,s.item_id itemId,s.receiver_id receiverId,s.source_id sourceId,s.version,
 v.title,COALESCE(v.publish_state,'') publishState,COALESCE(j.status,'') jobStatus,COALESCE(j.error,'') error
 FROM psychology_imported_photo_slots s LEFT JOIN psychology_video_hit_versions v ON v.source_id=s.source_id AND v.version=s.version
 LEFT JOIN factory_jobs j ON j.id=s.item_id WHERE s.owner=? ORDER BY s.slot_at DESC,s.connection_id LIMIT 30`).bind(user.username).all()).results;
 return {revision:row?.revision||0,enabled:Boolean(row?.enabled),config:{...defaults(),...parse(row?.config_json),cta:normalizeImportedPhotoCTA(parse(row?.config_json).cta)},ctaDefaults:DEFAULT_IMPORTED_PHOTO_CTA,accounts:scope.accounts,
  times:IMPORTED_PHOTO_TIMES,timeZone:IMPORTED_PHOTO_ZONE,nextSlots:importedPhotoSlots(now,now+26*3600000,row?.enabled_at||0).slice(0,3),
  inventory:count.n,checkedAt:row?.checked_at||0,detail:row?.detail||'配置发布账号和承接账号后，可保存并启用。',recent};
}
export async function handleImportedPhotos(request,env,url,session,{directory,now=Date.now(),website=false}={}){
 if(url.pathname!==(website?'/api/psychology-website/receiving':BASE))return null;
 try{
  const user=await actor(env.DB,session?.user?.username,website),db=env.DB;
  if(request.method!=='GET'&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)fail('不允许跨站修改。',403);
  const head=await db.prepare('SELECT * FROM psychology_imported_photo_settings WHERE owner=?').bind(user.username).first();
  if(!['GET','PATCH'].includes(request.method))fail('不支持此操作。',405);
  const body=request.method==='PATCH'?await readJson(request):null;
  if(website&&body&&(!['receivers','cta'].includes(body.section)||body.pauseOnly!==undefined))fail('承接设置只能修改承接账号或引导文案。',403);
  if(body&&body.revision!==(head?.revision||0))fail('配置已变化，请刷新后重试。',409);
  // Pausing remains possible during a directory outage. Committed jobs keep their frozen settings.
  if(body?.pauseOnly===true){
   if(body.enabled!==false||!head)fail('暂停参数无效。');
   const result=await db.prepare("UPDATE psychology_imported_photo_settings SET enabled=0,revision=revision+1,lease_token='',lease_until=0,detail='已暂停新增排期；已创建任务继续。',updated_at=? WHERE owner=? AND revision=?").bind(now,user.username,body.revision).run();
   if(!result.meta?.changes)fail('配置已变化，请刷新。',409);return json({ok:true,revision:body.revision+1,enabled:false});
  }
  const scope=await accountScope(db,user,directory||await publishAccountDirectory(env));
  const responseData=async()=>{
   if(!website)return readData(env,user,scope,now);
   const saved=await db.prepare('SELECT revision,config_json FROM psychology_imported_photo_settings WHERE owner=?').bind(user.username).first();
   const config={...defaults(),...parse(saved?.config_json)},allowed=new Set(scope.accounts.map(a=>a.connectionId));
   return {revision:saved?.revision||0,config:{receivers:config.receivers,cta:normalizeImportedPhotoCTA(config.cta)},accounts:scope.accounts,ctaDefaults:DEFAULT_IMPORTED_PHOTO_CTA,publisherIds:config.connectionIds.filter(id=>allowed.has(id)),routes:config.routes};
  };
  if(!body)return json(await responseData());
  const section=body.section||'all';
  if(!['all','publishing','receivers','cta'].includes(section))fail('未知的设置区域。');
  const keys={publishing:['section','revision','enabled','connectionIds','isAiGenerated','musicIds'],receivers:['section','revision','receivers'],cta:['section','revision','cta']};
  if(keys[section]&&Object.keys(body).some(k=>!keys[section].includes(k)))fail('请只提交当前区域的设置。');
  const prior={...defaults(),...parse(head?.config_json)},publishing=['all','publishing'].includes(section),receiving=['all','receivers'].includes(section);
  const enabled=publishing?body.enabled:Boolean(head?.enabled);
  if(typeof enabled!=='boolean')fail('请设置是否启用自动发布。');
  const ids=publishing?body.connectionIds:prior.connectionIds,selectedReceivers=receiving?body.receivers:prior.receivers;
  if(!Array.isArray(ids)||ids.length>200||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))fail('请选择最多 200 个发布账号。');
  if(!Array.isArray(selectedReceivers)||selectedReceivers.length>60||new Set(selectedReceivers.map(a=>a?.connectionId)).size!==selectedReceivers.length)fail('承接账号重复或数量无效。');
  const accounts=new Map(scope.accounts.map(a=>[a.connectionId,a]));
  if(publishing&&ids.some(id=>!accounts.get(id)?.canPublish))fail('所选发布账号已失效或不在当前权限范围内。',403);
  const receivers=receiving||publishing&&enabled?selectedReceivers.map(r=>{
   const a=accounts.get(r?.connectionId);if(!a?.canPublish||!a.candidate||r.linkReady!==true)fail('承接账号需要至少 1000 粉丝、有效用户名，并确认已挂主页测试链接。');
   if(!receiving&&a.username!==r.username)fail('承接账号用户名已改变，请先单独保存承接账号以重新确认。');
   return {connectionId:a.connectionId,username:a.username,linkReady:true};
  }):prior.receivers;
  if(enabled&&(!ids.length||!receivers.length))fail('启用前请先分别保存发布账号和至少一个已挂链接的承接账号。');
  const isAiGenerated=publishing?body.isAiGenerated:prior.isAiGenerated;if(typeof isAiGenerated!=='boolean')fail('请设置 AI 内容标记。');
  if(section==='cta'&&body.cta===undefined)fail('请填写引导文案。');
  const cta=normalizeImportedPhotoCTA(section==='cta'?body.cta:section==='all'&&body.cta!==undefined?body.cta:prior.cta);
  const musicIds=publishing&&body.musicIds!==undefined?normalizePhotoMusicIds(body.musicIds):prior.musicIds;
  const config={...prior,musicIds,receiversConfigured:receiving||prior.receiversConfigured===true||prior.receivers.length>0,connectionIds:[...ids].sort(),receivers,routes:balanceConversionRoutes(ids,receivers,prior.routes),isAiGenerated,cta};
  // No old strategy is resumed, and changing settings cannot reset occupied account/time slots.
  const statements=[db.prepare('INSERT INTO psychology_imported_photo_settings(owner) VALUES(?) ON CONFLICT(owner) DO NOTHING').bind(user.username),
   db.prepare("UPDATE psychology_imported_photo_settings SET revision=revision+1,enabled=?,config_json=?,enabled_at=?,dispatched_at=0,scan_cursor='',lease_token='',lease_until=0,detail=?,updated_at=? WHERE owner=? AND revision=?")
    .bind(Number(enabled),JSON.stringify(config),head?.enabled?head.enabled_at:now,enabled?'已启用；提前 60 分钟准备未来时段，已错过的时段不补发。':'已保存，尚未启用；已创建任务继续。',now,user.username,body.revision),guard(db)];
  try{await db.batch(statements);}catch(e){if(/CHECK|UNIQUE/.test(e.message))fail('配置已变化，请刷新后重试。',409);throw e;}
  return json(await responseData());
 }catch(e){return errorJson(e.message,e.statusCode||500);}
}
export async function dispatchImportedPhotos(env,now=Date.now()){
 if(!env.SCHEDULE_QUEUE)return {sent:0};
 const rows=(await env.DB.prepare('SELECT owner,enabled_at FROM psychology_imported_photo_settings WHERE enabled=1 AND dispatched_at<=? AND lease_until<=? ORDER BY dispatched_at LIMIT 20').bind(now-60000,now).all()).results;let sent=0;
 for(const row of rows){if(!importedPhotoSlots(now,now+IMPORTED_PHOTO_PREPARE,row.enabled_at).length)continue;
  const claim=await env.DB.prepare('UPDATE psychology_imported_photo_settings SET dispatched_at=? WHERE owner=? AND enabled=1 AND dispatched_at<=? AND lease_until<=?').bind(now,row.owner,now-60000,now).run();if(!claim.meta?.changes)continue;
  try{await env.SCHEDULE_QUEUE.send({kind:'imported-photos',owner:row.owner});sent++;}catch(e){await env.DB.prepare('UPDATE psychology_imported_photo_settings SET dispatched_at=0 WHERE owner=? AND dispatched_at=?').bind(row.owner,now).run();throw e;}
 }
 return {sent};
}
export async function runImportedPhotos(env,owner,{now=Date.now(),directory}={}){
 const db=env.DB,token=crypto.randomUUID();
 const claim=await db.prepare('UPDATE psychology_imported_photo_settings SET lease_token=?,lease_until=? WHERE owner=? AND enabled=1 AND lease_until<=?').bind(token,now+LEASE,owner,now).run();
 if(!claim.meta?.changes)return {created:0};
 let created=0,detail='',lastScanned='';
 try{
  const setting=await db.prepare('SELECT * FROM psychology_imported_photo_settings WHERE owner=? AND lease_token=?').bind(owner,token).first();if(!setting)return {created:0};
  const user=await actor(db,owner),config=parse(setting.config_json),scope=await accountScope(db,user,directory||await publishAccountDirectory(env)),accounts=new Map(scope.accounts.map(a=>[a.connectionId,a]));
  const slots=importedPhotoSlots(now,now+IMPORTED_PHOTO_PREPARE,setting.enabled_at);
  await db.prepare('DELETE FROM psychology_imported_photo_skips WHERE owner=? AND retry_at<?').bind(owner,now-86400000).run();
  const receivers=new Map(config.receivers.map(r=>[r.connectionId,r]));
  const counts=(await db.prepare('SELECT connection_id,count(*) n,max(slot_at) last FROM psychology_imported_photo_slots WHERE slot_at>=? GROUP BY connection_id').bind(now-7*86400000).all()).results;
  const rank=new Map(counts.map(r=>[r.connection_id,r]));
  let ids=[...config.connectionIds].sort((a,b)=>(rank.get(a)?.n||0)-(rank.get(b)?.n||0)||(rank.get(a)?.last||0)-(rank.get(b)?.last||0)||a.localeCompare(b));
  const resume=ids.indexOf(setting.scan_cursor);if(resume>=0)ids=[...ids.slice(resume+1),...ids.slice(0,resume+1)];
  let inspected=0;
  outer:for(const slot of slots)for(const id of ids){
   if(created>=5||inspected>=20)break outer;
   if(await db.prepare('SELECT 1 FROM psychology_imported_photo_slots WHERE connection_id=? AND slot_at=?').bind(id,slot).first())continue;
   const receiver=receivers.get(config.routes[id]),target=receiver&&accounts.get(receiver.connectionId);
   if(!accounts.get(id)?.canPublish||!target?.canPublish||!target.candidate||!receiver.linkReady||target.username!==receiver.username){detail='部分发布账号或承接账号失效，请重新配置并确认主页链接。';continue;}
   // Respect other queued work at this exact account/time; never shift the requested clock silently.
   if(await db.prepare('SELECT 1 FROM psychology_publish_items WHERE connection_id=? AND schedule_at BETWEEN ? AND ? AND deleted_at=0 LIMIT 1').bind(id,slot/1000-60,slot/1000+60).first()){detail='有账号在该时段已有发布任务，已跳过冲突。';continue;}
   inspected++;lastScanned=id;
   const candidates=(await db.prepare('SELECT v.* FROM psychology_video_hit_versions v JOIN psychology_video_hits s ON s.id=v.source_id WHERE '+inventoryWhere+
    ' AND NOT EXISTS(SELECT 1 FROM psychology_imported_photo_slots old WHERE old.connection_id=? AND old.source_id=v.source_id AND old.slot_at>=?) AND NOT EXISTS(SELECT 1 FROM psychology_imported_photo_skips skip WHERE skip.owner=? AND skip.source_id=v.source_id AND skip.version=v.version AND skip.revision=v.revision AND skip.retry_at>?) AND NOT EXISTS(SELECT 1 FROM psychology_publish_items old WHERE old.connection_id=? AND old.source_id LIKE v.source_id||\':v%\' AND old.schedule_at>=? AND old.deleted_at=0) ORDER BY v.created_at,v.source_id,v.version LIMIT 20').bind(user.id,hitAdmin(user),id,slot-14*86400000,owner,now,id,slot/1000-14*86400).all()).results;
   let picked=null,copy=null;
   for(const v of candidates){try{const frames=await allFrames(db,v.source_id,v.version);validateFrames(frames);await assertAssets(db,user,frames);copy=importedPhotoCaption(v.caption,id,receiver,config.cta);picked=v;break;}catch(e){if(e.statusCode>=500)throw e;detail=e.message;await db.prepare('INSERT INTO psychology_imported_photo_skips(owner,source_id,version,revision,retry_at,reason) VALUES(?,?,?,?,?,?) ON CONFLICT(owner,source_id,version) DO UPDATE SET revision=excluded.revision,retry_at=excluded.retry_at,reason=excluded.reason').bind(owner,v.source_id,v.version,v.revision,now+3600000,e.message.slice(0,300)).run();}}
   if(!picked){detail='可发布图文不足；请启用完整的 1–15 张图文版本。同账号 14 天内不重复原选题。';continue;}
   await assertOfficialPublishAccess(env,user,{module:'psychology',connectionIds:[id]},{fresh:false});
   const batchId='psy-imported-'+(await sha256Hex(id+':'+slot)).slice(0,32),itemId=batchId+'-000';
   // A role/grant change during selection invalidates the whole transaction.
   const freshRow=await db.prepare('SELECT * FROM factory_users WHERE username=? AND active=1').bind(owner).first();await actor(db,owner);
   const beforeStatements=[db.prepare('UPDATE factory_users SET updated_at=updated_at WHERE id=? AND active=1 AND role=? AND sidebar_modules_json=?').bind(user.id,user.role,freshRow.sidebar_modules_json),guard(db),db.prepare('UPDATE psychology_imported_photo_settings SET checked_at=? WHERE owner=? AND revision=? AND enabled=1 AND lease_token=? AND lease_until>? AND ?>?').bind(now,owner,setting.revision,token,Date.now(),slot,Date.now()+IMPORTED_PHOTO_LEAD),guard(db),
    db.prepare('INSERT INTO psychology_imported_photo_slots(connection_id,slot_at,owner,revision,source_id,version,item_id,receiver_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,slot,owner,setting.revision,picked.source_id,picked.version,itemId,receiver.connectionId,now)];
   const batchConfig={name:'导入图文 · 独立站引流',mediaType:'photo',template:'selected-photo',sourceType:'video-hits',count:1,connectionIds:[id],scheduleAt:slot/1000,intervalMinutes:60,staggerSeconds:0,isAiGenerated:config.isAiGenerated,musicIds:normalizePhotoMusicIds(config.musicIds||[]),photoVersions:[{sourceId:picked.source_id,version:picked.version,revision:picked.revision}],rewriteCopy:false};
   await createHitPhotoBatch(env,user,batchConfig,batchId,scope.accounts,{beforeStatements,caption:copy.caption,conversion:{...receiver,connectionId:id,receiverConnectionId:receiver.connectionId,cta:copy.cta,revision:setting.revision},deferDispatch:true});created++;
  }
  detail=created?'本轮已安排 '+created+' 条图文；不足的时段会在截止前继续检查。'+(detail?' '+detail:''):detail||'当前时段已安排，等待下一个北京时间发布时段。';
 }catch(e){detail=String(e.message||e).slice(0,500);}
 finally{
  await db.prepare("UPDATE psychology_imported_photo_settings SET lease_token='',lease_until=0,checked_at=?,detail=?,scan_cursor=? WHERE owner=? AND lease_token=?").bind(now,detail.slice(0,600),lastScanned,owner,token).run();
 }
 if(created)try{await dispatchCloudPhotos(env);}catch{/* minute queue recovery owns committed jobs */}
 return {created,detail};
}
export async function consumeImportedPhotoMessage(env,message){
 if(typeof message.body?.owner!=='string'){message.ack();return;}
 try{await runImportedPhotos(env,message.body.owner);message.ack();}catch{message.retry({delaySeconds:60});}
}
