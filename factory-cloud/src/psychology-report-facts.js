import {retentionAt} from '../../scripts/psychology-content-performance.js';
import {publishOutcome,parseObject} from '../../scripts/psychology-operations.js';
const ms=v=>{const n=Number(v);return n>0?(n<1e12?n*1000:n):Date.parse(v||'')||0;};
const key=v=>'tiktok:'+String(v||'').replace(/^tiktok:/,'');
const metric=(v,...keys)=>{const a=parseObject(v.analytics);for(const k of keys){const x=v[k]??a[k];if(x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x)))return Math.max(0,Number(x));}return null;};
export function normalizedVideo(v){return {video_id:String(v.id||v.videoId||''),published_at:ms(v.createTime||v.createdAt||v.create_time),views:metric(v,'views','viewCount','view_count','playCount'),likes:metric(v,'likes','like_count','diggCount'),comments:metric(v,'comments','comment_count','commentCount'),shares:metric(v,'shares','share_count','shareCount'),saves:metric(v,'favorites','saves','favorites_count','collectCount'),completion:metric(v,'fullWatchRate','full_video_watched_rate','fullVideoWatchedRate'),average_watch:metric(v,'averageTimeWatched','average_time_watched'),retention3:retentionAt(v.retention||v.videoViewRetention||v.video_view_retention),title:String(v.title||v.caption||'').slice(0,500),share:String(v.shareUrl||v.shareLink||'').slice(0,1000)};}
const videoColumns=['video_id','published_at','views','likes','comments','shares','saves','completion','average_watch','retention3','title','share'];
// One bounded SQL statement per ingestion account. Old videos stay after they
// leave the upstream latest-100 response; stale syncs cannot overwrite new data.
export function reportVideoFactWrite(db,account,stamp,videos){
 const rows=videos.map(normalizedVideo).filter(v=>v.video_id);
 return db.prepare(`INSERT INTO ops_video_facts(account_key,synced_at,${videoColumns}) SELECT ?,?,${videoColumns.map(k=>`json_extract(value,'$.${k}')`).join(',')} FROM json_each(?) WHERE 1
 ON CONFLICT(account_key,video_id) DO UPDATE SET ${['synced_at',...videoColumns.filter(k=>k!=='video_id')].map(k=>`${k}=excluded.${k}`).join(',')} WHERE excluded.synced_at>=ops_video_facts.synced_at`).bind(key(account),stamp,JSON.stringify(rows));
}
const fields=['id','batch_id','account_key','media','schedule_at','published_at','pilot_id','group_id','group_name','strategy','source','variant','style','rewrite_model','copy_hash','title','video_id','state','error','updated_at'];
const metrics=['views','likes','comments','shares','saves','completion','average_watch','retention3','synced_at'];
function factWrite(db,rows){
 // Metrics are read again inside the commit, so an intervening sync is never
 // overwritten by the earlier dirty-item snapshot.
 return db.prepare(`INSERT INTO ops_task_facts(${fields},${metrics}) SELECT ${fields.map(k=>k==='state'?"CASE WHEN v.video_id IS NOT NULL THEN 'published' ELSE json_extract(j.value,'$.state') END":k==='published_at'?"COALESCE(NULLIF(v.published_at,0),json_extract(j.value,'$.published_at'))":`json_extract(j.value,'$.${k}')`).join(',')},${metrics.map(k=>k==='synced_at'?'COALESCE(v.synced_at,0)':'v.'+k).join(',')}
 FROM json_each(?) j LEFT JOIN ops_video_facts v ON v.account_key=json_extract(j.value,'$.account_key') AND v.video_id=json_extract(j.value,'$.video_id') AND EXISTS(SELECT 1 FROM ops_video_owners o WHERE o.account_key=v.account_key AND o.video_id=v.video_id AND o.item_id=json_extract(j.value,'$.id'))
 WHERE EXISTS(SELECT 1 FROM ops_task_dirty WHERE item_id=json_extract(j.value,'$.id') AND revision=json_extract(j.value,'$.revision'))
 ON CONFLICT(id) DO UPDATE SET ${[...fields.filter(k=>k!=='id'),...metrics].map(k=>`${k}=excluded.${k}`).join(',')}`).bind(JSON.stringify(rows));
}
export async function refreshReportFacts(db,{limit=500}={}){
 const {results}=await db.prepare(`SELECT d.item_id,d.revision,i.id,i.batch_id,i.source_id,i.job_id,i.connection_id,i.schedule_at,i.receipt_json,i.execution_status,i.deleted_at,b.created_at,json_object('mediaType',json_extract(b.config_json,'$.mediaType'),'libraryStrategy',json_extract(b.config_json,'$.libraryStrategy')) config_json,
 c.source_key,c.variant_id,c.style_id,c.rewrite_model,c.copy_hash,json_extract(c.copy_json,'$.title') copy_title,
 j.status job_status,j.title job_title,j.error job_error,g.status group_status,p.pilot_id,p.group_id,p.group_name,p.strategy,
 r.value_json record_json,old.video_id old_video,old.published_at old_published,old.state old_state,old.source old_source,
 old.title old_title,old.variant old_variant,old.style old_style,old.rewrite_model old_model,old.copy_hash old_hash
 FROM (SELECT * FROM ops_task_dirty ORDER BY rowid LIMIT ?) d LEFT JOIN psychology_publish_items i ON i.id=d.item_id
 LEFT JOIN psychology_publish_batches b ON b.id=i.batch_id LEFT JOIN psychology_creative_snapshots c ON c.item_id=i.id
 LEFT JOIN factory_jobs j ON j.id=i.job_id LEFT JOIN psychology_publish_groups g ON g.id=i.publish_group_id
 LEFT JOIN ops_pilot_batches p ON p.batch_id=i.batch_id LEFT JOIN factory_publish_records r ON r.id='psychology:'||i.id
 LEFT JOIN ops_task_facts old ON old.id=i.id`).bind(limit).all();
 const facts=[];
 for(const i of results){
  if(i.id){
   const config=parseObject(i.config_json),receipt=parseObject(i.receipt_json);let r=parseObject(i.record_json);
   if(r.autoTaskId!==i.id||(r.autoBatchId&&r.autoBatchId!==i.batch_id)||(r.connectionId&&key(r.connectionId)!==key(i.connection_id)))r={};
   const outcome=publishOutcome(r),hasRecord=Object.keys(r).length>0;
   const state=outcome==='published'?'published':outcome==='failed'?'failed':i.deleted_at?'stopped':!r.batchId&&!receipt.batchId&&[i.job_status,i.execution_status,i.group_status].includes('failed')?'failed':!hasRecord&&['published','failed'].includes(i.old_state)?i.old_state:'pending';
   const row={id:i.id,batch_id:i.batch_id,account_key:key(i.connection_id),media:config.mediaType||'video',schedule_at:ms(i.schedule_at),published_at:ms(r.officialPublishedAt||r.completedAt||r.publishedAt)||i.old_published||0,
    pilot_id:i.pilot_id||'',group_id:i.group_id||'',group_name:i.group_name||'',strategy:config.libraryStrategy||i.strategy||'',source:i.source_key||i.old_source||i.source_id||'',variant:i.variant_id??i.old_variant??'',style:i.style_id||i.old_style||'',rewrite_model:i.rewrite_model||i.old_model||'',copy_hash:i.copy_hash||i.old_hash||'',title:i.copy_title||i.job_title||i.old_title||'未命名',video_id:String(r.videoId||r.tiktokVideoId||r.itemId||i.old_video||''),state,error:String(r.publishError||r.error||i.job_error||'').slice(0,500),updated_at:Date.now()};
   facts.push({...row,revision:i.revision});
  }
 }
 if(results.length){
  const encoded=JSON.stringify(facts);
  await db.batch([
   db.prepare(`INSERT OR IGNORE INTO ops_video_owners(account_key,video_id,item_id) SELECT json_extract(j.value,'$.account_key'),json_extract(j.value,'$.video_id'),json_extract(j.value,'$.id') FROM json_each(?) j WHERE json_extract(j.value,'$.video_id')<>'' AND EXISTS(SELECT 1 FROM ops_task_dirty d WHERE d.item_id=json_extract(j.value,'$.id') AND d.revision=json_extract(j.value,'$.revision'))`).bind(encoded),
   factWrite(db,facts),
   db.prepare(`DELETE FROM ops_task_dirty WHERE EXISTS(SELECT 1 FROM json_each(?) j WHERE json_extract(j.value,'$.item_id')=ops_task_dirty.item_id AND json_extract(j.value,'$.revision')=ops_task_dirty.revision)`).bind(JSON.stringify(results.map(r=>({item_id:r.item_id,revision:r.revision}))))
  ]);
 }
 return results.length;
}
// Resumable keyset migration. Read requests never touch R2 or perform backfill.
export async function backfillReportFacts(env){
 const db=env.DB,progress=(await db.prepare('SELECT * FROM ops_report_progress').all()).results;
 const p=Object.fromEntries(progress.map(r=>[r.name,r]));
 let migrationError='';try{
 if(!p.pilots.done){
  const rows=(await db.prepare(`SELECT s.batch_id,p.id pilot_id,p.group_id,p.group_name,p.strategy FROM psychology_autopilot_slots s JOIN psychology_autopilots p ON p.id=s.autopilot_id WHERE s.batch_id>? ORDER BY s.batch_id LIMIT 100`).bind(p.pilots.cursor).all()).results;
  const batches=rows.flatMap(r=>r.batch_id.split(',').filter(Boolean).map(batch_id=>({...r,batch_id})));
  if(batches.length)await db.batch([
   db.prepare(`INSERT OR IGNORE INTO ops_pilot_batches(batch_id,pilot_id,group_id,group_name,strategy) SELECT json_extract(value,'$.batch_id'),json_extract(value,'$.pilot_id'),json_extract(value,'$.group_id'),json_extract(value,'$.group_name'),json_extract(value,'$.strategy') FROM json_each(?)`).bind(JSON.stringify(batches)),
   db.prepare(`INSERT INTO ops_task_dirty(item_id) SELECT id FROM psychology_publish_items WHERE batch_id IN (SELECT json_extract(value,'$.batch_id') FROM json_each(?)) ON CONFLICT(item_id) DO UPDATE SET revision=lower(hex(randomblob(16)))`).bind(JSON.stringify(batches))]);
  await db.prepare("UPDATE ops_report_progress SET cursor=max(cursor,?),done=max(done,?) WHERE name='pilots'").bind(rows.at(-1)?.batch_id||p.pilots.cursor,Number(rows.length<100)).run();
 }
 if(!p.videos.done){
  const rows=(await db.prepare('SELECT account_key,synced_at,videos_json FROM official_report_video_cache WHERE account_key>? ORDER BY account_key LIMIT 100').bind(p.videos.cursor).all()).results;
  for(let n=0;n<rows.length;n+=10)await db.batch(rows.slice(n,n+10).map(r=>reportVideoFactWrite(db,r.account_key,r.synced_at,JSON.parse(r.videos_json))));
  await db.prepare("UPDATE ops_report_progress SET cursor=max(cursor,?),done=max(done,?) WHERE name='videos'").bind(rows.at(-1)?.account_key||p.videos.cursor,Number(rows.length<100)).run();
 }
 if(!p.tasks.done){
  const rows=(await db.prepare('SELECT id FROM psychology_publish_items WHERE id>? ORDER BY id LIMIT 500').bind(p.tasks.cursor).all()).results;
  if(rows.length)await db.batch([db.prepare('INSERT INTO ops_task_dirty(item_id) SELECT value FROM json_each(?) WHERE 1 ON CONFLICT(item_id) DO UPDATE SET revision=lower(hex(randomblob(16)))').bind(JSON.stringify(rows.map(r=>r.id))),db.prepare("UPDATE ops_report_progress SET cursor=max(cursor,?) WHERE name='tasks'").bind(rows.at(-1).id)]);
  if(rows.length<500)await db.prepare("UPDATE ops_report_progress SET done=1 WHERE name='tasks'").run();
 }
 if(!p.legacy.done){
  const rows=(await db.prepare(`SELECT a.account_key,a.synced_at FROM official_accounts_latest a WHERE a.account_key>? AND a.synced_at>0 AND a.video_count>0 AND EXISTS(SELECT 1 FROM official_account_assignments x WHERE replace(x.account_key,'tiktok:','')=replace(a.account_key,'tiktok:','') AND x.group_id<>'') AND NOT EXISTS(SELECT 1 FROM official_report_video_cache c WHERE c.account_key=a.account_key AND c.synced_at=a.synced_at AND c.version=1) ORDER BY a.account_key LIMIT 10`).bind(p.legacy.cursor).all()).results;
  if(rows.length){
   const {loadReportVideosForAccounts}=await import('./official-archive-store.js');
   await loadReportVideosForAccounts(env,db,rows.map(r=>({schema:r.account_key,latestSyncAt:r.synced_at})),[]);
   const fresh=(await db.prepare('SELECT c.* FROM official_report_video_cache c JOIN official_accounts_latest a ON a.account_key=c.account_key AND a.synced_at=c.synced_at WHERE c.account_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(rows.map(r=>r.account_key))).all()).results;
   if(fresh.length!==rows.length)throw new Error('历史归档版本尚未就绪，后台将重试，未写入旧指标');
   await db.batch(fresh.map(r=>reportVideoFactWrite(db,r.account_key,r.synced_at,JSON.parse(r.videos_json))));
  }
  await db.prepare("UPDATE ops_report_progress SET cursor=max(cursor,?),done=max(done,?) WHERE name='legacy'").bind(rows.at(-1)?.account_key||p.legacy.cursor,Number(rows.length<10)).run();
 }
 await db.prepare("UPDATE ops_report_progress SET error='' WHERE error<>''").run();
 }catch(error){migrationError=String(error.message||error).slice(0,300);await db.prepare('UPDATE ops_report_progress SET error=? WHERE done=0').bind(migrationError).run();}
 const started=Date.now();let processed=0;for(let n=0;n<6;n++){const count=await refreshReportFacts(db);processed+=count;if(count<500||Date.now()-started>10000)break;}return {processed,migrationError};
}
