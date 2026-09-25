// Deterministic migration generator. Never regenerate a deployed migration.
import {writeFileSync} from 'node:fs';
const out=[],sql=s=>out.push(s.trim());
sql(`-- Reporting only: no publishing mutations.
CREATE TABLE ops_video_facts (
 account_key TEXT NOT NULL,video_id TEXT NOT NULL,published_at INTEGER NOT NULL DEFAULT 0,synced_at INTEGER NOT NULL,
 views REAL,likes REAL,comments REAL,shares REAL,saves REAL,completion REAL,average_watch REAL,retention3 REAL,
 title TEXT NOT NULL DEFAULT '',share TEXT NOT NULL DEFAULT '',PRIMARY KEY(account_key,video_id));
CREATE INDEX ops_video_account_time ON ops_video_facts(account_key,published_at);
CREATE TABLE ops_pilot_batches(batch_id TEXT PRIMARY KEY,pilot_id TEXT NOT NULL,group_id TEXT NOT NULL,group_name TEXT NOT NULL,strategy TEXT NOT NULL);
CREATE TABLE ops_video_owners(account_key TEXT NOT NULL,video_id TEXT NOT NULL,item_id TEXT NOT NULL,PRIMARY KEY(account_key,video_id));
CREATE TABLE ops_task_dirty(item_id TEXT PRIMARY KEY,revision TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))));
CREATE TABLE ops_report_progress(name TEXT PRIMARY KEY,cursor TEXT NOT NULL DEFAULT '',done INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '');
INSERT INTO ops_report_progress(name) VALUES ('videos'),('tasks'),('pilots'),('legacy');
CREATE INDEX ops_items_job ON psychology_publish_items(job_id);
CREATE INDEX ops_items_schedule ON psychology_publish_items(schedule_at,id);
CREATE TABLE ops_task_facts (
 id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,account_key TEXT NOT NULL,media TEXT NOT NULL,schedule_at INTEGER NOT NULL,published_at INTEGER NOT NULL DEFAULT 0,
 pilot_id TEXT NOT NULL DEFAULT '',group_id TEXT NOT NULL DEFAULT '',group_name TEXT NOT NULL DEFAULT '',strategy TEXT NOT NULL DEFAULT '',
 source TEXT NOT NULL DEFAULT '',variant TEXT NOT NULL DEFAULT '',style TEXT NOT NULL DEFAULT '',rewrite_model TEXT NOT NULL DEFAULT '',copy_hash TEXT NOT NULL DEFAULT '',
 title TEXT NOT NULL DEFAULT '',video_id TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'pending',error TEXT NOT NULL DEFAULT '',
 views REAL,likes REAL,comments REAL,shares REAL,saves REAL,completion REAL,average_watch REAL,retention3 REAL,
 synced_at INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL DEFAULT 0);
CREATE INDEX ops_task_account_schedule ON ops_task_facts(account_key,media,schedule_at);
CREATE INDEX ops_task_account_published ON ops_task_facts(account_key,media,published_at);
CREATE INDEX ops_task_video ON ops_task_facts(account_key,video_id);
CREATE INDEX ops_task_batch ON ops_task_facts(batch_id);
CREATE INDEX ops_task_source ON ops_task_facts(source,schedule_at,id);
CREATE INDEX ops_task_period ON ops_task_facts(media,published_at,views);
CREATE TABLE ops_daily (
 account_key TEXT NOT NULL,media TEXT NOT NULL,day TEXT NOT NULL,basis TEXT NOT NULL,pilot_id TEXT NOT NULL,group_id TEXT NOT NULL,strategy TEXT NOT NULL,variant_kind TEXT NOT NULL,
 planned INTEGER NOT NULL DEFAULT 0,published INTEGER NOT NULL DEFAULT 0,failed INTEGER NOT NULL DEFAULT 0,pending INTEGER NOT NULL DEFAULT 0,stopped INTEGER NOT NULL DEFAULT 0,
 synced INTEGER NOT NULL DEFAULT 0,views REAL NOT NULL DEFAULT 0,potential INTEGER NOT NULL DEFAULT 0,hit INTEGER NOT NULL DEFAULT 0,
 likes REAL NOT NULL DEFAULT 0,likes_n INTEGER NOT NULL DEFAULT 0,comments REAL NOT NULL DEFAULT 0,comments_n INTEGER NOT NULL DEFAULT 0,shares REAL NOT NULL DEFAULT 0,shares_n INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(account_key,media,day,basis,pilot_id,group_id,strategy,variant_kind));
CREATE INDEX ops_daily_period ON ops_daily(media,basis,day,account_key);
`);
const dirty=where=>"INSERT INTO ops_task_dirty(item_id) SELECT id FROM psychology_publish_items WHERE "+where+" ON CONFLICT(item_id) DO UPDATE SET revision=lower(hex(randomblob(16)));";
for(const [table,condition,cols] of [
 ['psychology_publish_items','id=NEW.id','job_id,receipt_json,execution_status,deleted_at,schedule_at'],
 ['psychology_creative_snapshots','id=NEW.item_id','source_key,variant_id,style_id,copy_hash,copy_json'],
 ['factory_jobs','job_id=NEW.id','status,error,result_json'],
 ['psychology_publish_groups','publish_group_id=NEW.id','status'],
 ['factory_publish_records',"id=substr(NEW.id,12)",'value_json'],
])for(const event of ['INSERT','UPDATE OF '+cols])sql("CREATE TRIGGER ops_dirty_"+table+"_"+(event==='INSERT'?'insert':'update')+" AFTER "+event+" ON "+table+" BEGIN "+dirty(condition)+" END;");
for(const event of ['INSERT','UPDATE OF batch_id'])sql("CREATE TRIGGER ops_pilot_slot_"+(event==='INSERT'?'insert':'update')+" AFTER "+event+" ON psychology_autopilot_slots WHEN NEW.batch_id<>'' BEGIN "+
"INSERT OR IGNORE INTO ops_pilot_batches(batch_id,pilot_id,group_id,group_name,strategy) SELECT trim(j.value),p.id,p.group_id,p.group_name,p.strategy FROM psychology_autopilots p,json_each('['||replace(json_quote(NEW.batch_id),',','\",\"')||']') j WHERE p.id=NEW.autopilot_id AND trim(j.value)<>''; "+
dirty("batch_id IN (SELECT trim(value) FROM json_each('['||replace(json_quote(NEW.batch_id),',','\",\"')||']'))")+" END;");
for(const event of ['INSERT','UPDATE'])sql("CREATE TRIGGER ops_video_"+event.toLowerCase()+" AFTER "+event+" ON ops_video_facts BEGIN UPDATE ops_task_facts SET published_at=CASE WHEN NEW.published_at>0 THEN NEW.published_at ELSE published_at END,state='published',views=NEW.views,likes=NEW.likes,comments=NEW.comments,shares=NEW.shares,saves=NEW.saves,completion=NEW.completion,average_watch=NEW.average_watch,retention3=NEW.retention3,synced_at=NEW.synced_at WHERE account_key=NEW.account_key AND video_id=NEW.video_id AND id=(SELECT item_id FROM ops_video_owners WHERE account_key=NEW.account_key AND video_id=NEW.video_id); END;");
sql("CREATE TRIGGER ops_video_delete AFTER DELETE ON ops_video_facts BEGIN UPDATE ops_task_facts SET views=NULL,likes=NULL,comments=NULL,shares=NULL,saves=NULL,completion=NULL,average_watch=NULL,retention3=NULL,synced_at=0 WHERE account_key=OLD.account_key AND video_id=OLD.video_id; END; CREATE TRIGGER ops_archive_delete AFTER DELETE ON official_report_video_cache BEGIN DELETE FROM ops_video_facts WHERE account_key=OLD.account_key; END;");
const dims=['account_key','media','day','basis','pilot_id','group_id','strategy','variant_kind'];
const counters={planned:'1',published:"state='published'",failed:"state='failed'",pending:"state='pending'",stopped:"state='stopped'",synced:"state='published' AND views IS NOT NULL",views:"CASE WHEN state='published' THEN COALESCE(views,0) ELSE 0 END",potential:"state='published' AND views>=1000",hit:"state='published' AND views>=10000"};
for(const m of ['likes','comments','shares']){counters[m]="CASE WHEN state='published' AND views IS NOT NULL THEN COALESCE("+m+",0) ELSE 0 END";counters[m+'_n']="state='published' AND views IS NOT NULL AND "+m+" IS NOT NULL";}
const expr=(e,row)=>e.replace(/\b(state|views|likes|comments|shares)\b/g,row+'.$1');
function contribute(row,sign){return ['schedule','publish'].map(basis=>{
 const stamp=row+'.'+(basis==='schedule'?'schedule_at':'published_at');
 const values=[row+'.account_key',row+'.media',"date("+stamp+"/1000,'unixepoch','+8 hours')","'"+basis+"'",row+'.pilot_id',row+'.group_id',row+'.strategy',"CASE WHEN "+row+".variant='' THEN 'original' ELSE 'rewrite' END"];
 return "INSERT INTO ops_daily("+[...dims,...Object.keys(counters)].join(',')+") SELECT "+[...values,...Object.values(counters).map(e=>sign+"*COALESCE(("+expr(e,row)+"),0)")].join(',')+" WHERE "+stamp+">0 ON CONFLICT("+dims.join(',')+") DO UPDATE SET "+Object.keys(counters).map(k=>k+'='+k+'+excluded.'+k).join(',')+";";
}).join('\n');}
sql("CREATE TRIGGER ops_fact_insert AFTER INSERT ON ops_task_facts BEGIN "+contribute('NEW',1)+" END; CREATE TRIGGER ops_fact_update AFTER UPDATE ON ops_task_facts WHEN NEW.account_key IS NOT OLD.account_key OR NEW.media IS NOT OLD.media OR NEW.schedule_at IS NOT OLD.schedule_at OR NEW.published_at IS NOT OLD.published_at OR NEW.pilot_id IS NOT OLD.pilot_id OR NEW.group_id IS NOT OLD.group_id OR NEW.strategy IS NOT OLD.strategy OR NEW.variant IS NOT OLD.variant OR NEW.state IS NOT OLD.state OR NEW.views IS NOT OLD.views OR NEW.likes IS NOT OLD.likes OR NEW.comments IS NOT OLD.comments OR NEW.shares IS NOT OLD.shares BEGIN "+contribute('OLD',-1)+contribute('NEW',1)+" END; CREATE TRIGGER ops_fact_delete AFTER DELETE ON ops_task_facts BEGIN "+contribute('OLD',-1)+" END;");
writeFileSync(new URL('../migrations/0061_ops_reporting_facts.sql',import.meta.url),out.join('\n\n')+'\n');

