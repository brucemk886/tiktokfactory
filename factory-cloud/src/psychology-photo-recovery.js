import { decodeRenderedPhoto } from './photo-publishing.js';
import { signalDeskBinary } from './signal-desk.js';
const parse=s=>JSON.parse(s||'{}');
export async function backupPhoto(env,item,index,input){
 if(!env.ARCHIVE?.put)throw Object.assign(new Error('图文恢复存储不可用。'),{statusCode:503});
 const {bytes,contentType}=decodeRenderedPhoto(input);
 const key='psychology-publish-backup/'+item.id+'/'+index+(contentType==='image/webp'?'.webp':'.jpg');
 await env.ARCHIVE.put(key,bytes,{httpMetadata:{contentType}});
 await env.DB.prepare("UPDATE psychology_publish_items SET photo_backups_json=json_set(photo_backups_json,?,json(?)) WHERE id=?")
  .bind('$.'+index,JSON.stringify({key,contentType}),item.id).run();
}
export async function restorePhotoCheckpoints(env,item,assets){
 const backups=parse(item.photo_backups_json);
 for(const [index,backup] of Object.entries(backups)){
  if(assets[index])continue;
  const object=await env.ARCHIVE.get(backup.key);
  if(!object)continue; // Historical or cleaned backup: the worker regenerates this page.
  const bytes=await object.arrayBuffer();
  const asset=await signalDeskBinary(env,env.DB,'/api/v1/publish/assets',{body:bytes,contentType:backup.contentType,fileName:item.id+'-'+index+(backup.contentType==='image/webp'?'.webp':'.jpg'),fileSize:bytes.byteLength});
  await env.DB.prepare("UPDATE psychology_publish_items SET photo_assets_json=json_set(photo_assets_json,?,json(?)) WHERE id=?")
   .bind('$.'+index,JSON.stringify(asset),item.id).run();assets[index]=asset;
 }
 return assets;
}
export async function removePhotoBackups(env,items){
 for(const item of items){
  const keys=Object.values(parse(item.photo_backups_json)).map(b=>b.key);
  if(keys.length){await env.ARCHIVE.delete(keys);await env.DB.prepare("UPDATE psychology_publish_items SET photo_backups_json='{}' WHERE id=?").bind(item.id).run();}
 }
}
// Only a definitive pre-creation rejection permits changing the frozen request.
// A timeout or any ambiguous error keeps the exact original request/externalId.
export async function recoverMissingPhotos(env,group,rows,error){
 if(Number(error.statusCode)!==400||!/^One or more photo assets are missing or expired\.$/.test(error.message)||parse(group.response_json).batch?.id)return false;
 if(Number(group.asset_recovery_count)>=2||rows.some(r=>parse(r.ready_json).mediaType!=='photo'))return false;
 const statements=[env.DB.prepare("UPDATE psychology_publish_groups SET status='waiting',request_json='{}',error='图片已失效，正在恢复上传',asset_recovery_count=asset_recovery_count+1,ready_at=0,updated_at=? WHERE id=? AND response_json='{}'").bind(Date.now(),group.id)];
 for(const row of rows){
  statements.push(env.DB.prepare("UPDATE psychology_publish_items SET ready_json='{}',photo_assets_json='{}' WHERE id=? AND receipt_json='{}'").bind(row.id));
  statements.push(env.DB.prepare("UPDATE factory_jobs SET status='queued',available_at=0,auto_retry_count=0,error='',worker_id='',message='恢复失效图片后重新提交',updated_at=? WHERE id=? AND status<>'cancelled'").bind(Date.now(),row.job_id));
 }
 statements.push(env.DB.prepare("UPDATE factory_jobs SET status='cancelled',message='图片恢复由上传任务接管' WHERE id=?").bind(group.id+'-submit'));
 await env.DB.batch(statements);return true;
}
