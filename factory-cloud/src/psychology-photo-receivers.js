import {accountScope} from './psychology-conversion.js';
import {publishAccountDirectory} from './psychology-account-access.js';
import {toPublicUser} from './auth.js';
import {hasPsychologyModule} from './psychology-permissions.js';
import {normalizeImportedPhotoCTA} from '../../scripts/psychology-imported-photo-policy.js';
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
// Consume the current operator's saved receivers; this never enables automatic operations.
export async function photoReceiverPool(env,actor,directory){
 const row=await env.DB.prepare('SELECT * FROM factory_users WHERE username=? AND active=1').bind(actor?.username||'').first(),user=row&&toPublicUser(row);
 if(!hasPsychologyModule(user,'psychology-publish'))fail('没有心理学发布权限。',403);
 const saved=await env.DB.prepare('SELECT revision,config_json FROM psychology_imported_photo_settings WHERE owner=?').bind(user.username).first(),config=JSON.parse(saved?.config_json||'{}');
 const cta=normalizeImportedPhotoCTA(config.cta),scope=await accountScope(env.DB,user,directory||await publishAccountDirectory(env)),accounts=new Map(scope.accounts.map(a=>[a.connectionId,a]));
 const receivers=(config.receivers||[]).filter(r=>{const a=accounts.get(r.connectionId);return r.linkReady===true&&a?.candidate&&a.canPublish&&a.username===r.username;}).map(r=>({connectionId:r.connectionId,username:r.username}));
 return {revision:saved?.revision||0,receivers,mention:cta.mention};
}
export function requirePhotoReceivers(pool,connectionIds){
 for(const id of connectionIds)if(!pool.receivers.some(r=>r.connectionId!==id))fail('所选发布账号没有其他可用承接账号，请在独立站引流配置中保存承接账号并确认主页链接。');
}
export function drawPhotoReceiver(pool,connectionId,random=Math.random){
 const candidates=pool.receivers.filter(r=>r.connectionId!==connectionId);requirePhotoReceivers(pool,[connectionId]);
 const r=candidates[Math.floor(random()*candidates.length)];
 return {mode:'random-mention',receiverConnectionId:r.connectionId,username:r.username,settingsRevision:pool.revision,cta:pool.mention.replace('{account}','@'+r.username)};
}
export function applyPhotoReceiverCaption(plan,receiver){
 if(!receiver)return plan;
 const base=String(plan?.caption||plan?.title||'').trim(),cta=receiver.cta;
 if(!base||typeof cta!=='string'||!cta.includes('@'+receiver.username))fail('图文引导文案不完整。');
 const caption=base.endsWith(cta)?base:base+'\n\n'+cta;
 if(caption.length>2200)fail('追加承接引导后文案超过 2200 字，请缩短图文发布文案。');
 return {...plan,caption};
}
export function photoReceiverGuard(db,user,pool){
 return db.prepare('UPDATE psychology_video_hit_guards SET ok=CASE WHEN EXISTS(SELECT 1 FROM psychology_imported_photo_settings WHERE owner=? AND revision=?) THEN 1 ELSE 0 END WHERE id=1').bind(user.username,pool.revision);
}
export async function assertPhotoReceiverAccess(env,user,receiver,directory){
 const scope=await accountScope(env.DB,user,directory),a=scope.accounts.find(a=>a.connectionId===receiver.receiverConnectionId);
 if(!a?.candidate||!a.canPublish||a.username!==receiver.username)fail('任务的承接账号已失效、改名或超出权限范围，请检查承接账号。',403);
}
