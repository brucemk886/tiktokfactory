import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './psychology-cloud-test-fixture.js';
import {handleVideoHits} from './psychology-video-hits.js';
import {handleImportedPhotos,runImportedPhotos,dispatchImportedPhotos} from './psychology-imported-photos.js';
import {importedPhotoSlots,importedPhotoCaption} from '../../scripts/psychology-imported-photo-policy.js';
const BASE='https://factory.test/api/psychology-autopilot/imported-photos',now=Date.parse('2026-10-09T14:00:00Z');
const user={id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-publish','psychology-video-hits','psychology-autopilot']};
async function setup(t){
 const f=await fixture(t);t.mock.method(Date,'now',()=>now);f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(user.sidebarModules));
 for(const id of ['a','b']){f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id) VALUES(?,?)').run(id,'g');f.sqlite.prepare('INSERT INTO official_accounts_latest(account_key,profile_json,synced_at) VALUES(?,?,?)').run('tiktok:'+id,JSON.stringify({username:id==='a'?'alpha':'target_b',followers:1200}),now);}
 const directory={accounts:[{id:'a',username:'alpha',scopes:['video.publish']},{id:'b',username:'target_b',scopes:['video.publish']}]};
 f.env.PHOTO_BROWSER={};f.photoSent=[];f.scheduleSent=[];f.env.PHOTO_QUEUE={async send(x){f.photoSent.push(x);}};f.env.SCHEDULE_QUEUE={async send(x){f.scheduleSent.push(x);}};
 f.call=async(method='GET',body,override={})=>{const r=new Request(BASE,{method,...(body?{body:JSON.stringify(body)}:{})});const res=await handleImportedPhotos(r,f.env,new URL(r.url),{user},{directory,now,...override});return {status:res.status,data:await res.json()};};
 f.config={revision:0,enabled:true,connectionIds:['a','b'],receivers:[{connectionId:'b',linkReady:true}],isAiGenerated:true};
 f.run=(time=now)=>runImportedPhotos(f.env,user.username,{now:time,directory});
 f.write=async(path,body,method='PUT')=>{const r=new Request('https://factory.test/api/psychology-video-hits'+path,{method,headers:{'Content-Type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify({requestId:crypto.randomUUID(),...body})})});return handleVideoHits(r,f.env,new URL(r.url),{user});};
 f.ready=async(count=12,sourceId=null,version=1)=>{if(!sourceId)sourceId=(await(await f.write('',{externalId:crypto.randomUUID(),videoUrl:'https://www.tiktok.com/@qa/photo/1',title:'Original'},'POST')).json()).id;
  let r=await f.write('/'+sourceId+'/versions/'+version,{revision:0,title:'Saved title',caption:'Saved caption'});assert.equal(r.status,200);
  await f.write('/'+sourceId+'/frames/'+version,{revision:1,frames:Array.from({length:count},(_,i)=>({index:i+1,imageUrl:'https://example.com/'+i+'.jpg'}))});
  if(count<=15){r=await f.write('/'+sourceId+'/versions/'+version,{revision:2,enabled:true});assert.equal(r.status,200);}
  return {sourceId,version,revision:3};
 };
 return {...f,directory};
}
test('Beijing schedule crosses midnight without converting to device time or backfilling',()=>{
 assert.deepEqual(importedPhotoSlots(now).slice(0,3).map(x=>new Date(x).toISOString()),['2026-10-09T14:30:00.000Z','2026-10-09T17:30:00.000Z','2026-10-09T19:30:00.000Z']);
 const late=Date.parse('2026-10-09T14:21:00Z');assert.equal(importedPhotoSlots(late)[0],Date.parse('2026-10-09T17:30:00Z'));
 assert.equal(importedPhotoSlots(now,now+3600000,late).length,0);
 assert.equal(importedPhotoSlots(Date.parse('2026-10-09T17:30:00Z'))[0],Date.parse('2026-10-09T19:30:00Z'));
});
test('CTA is appended once, preserves source, uses self bio and rejects overflow',()=>{
 const r={connectionId:'b',username:'target_b',linkReady:true},s='Saved caption',a=importedPhotoCaption(s,'a',r);assert.match(a.caption,/@target_b/);assert.equal(a.caption,s+'\n\n'+a.cta);assert.deepEqual(importedPhotoCaption(a.caption,'a',r),a);assert.match(importedPhotoCaption(s,'b',r).caption,/my bio/);assert.throws(()=>importedPhotoCaption('x'.repeat(2200),'a',r),/2200/);
});
test('configuration defaults off, validates scope/link confirmation, CAS and explicit enable',async t=>{
 const f=await setup(t);const read=await f.call();assert.equal(read.data.enabled,false);assert.equal(read.data.revision,0);assert.deepEqual(read.data.config.connectionIds,[]);
 assert.equal((await f.call('PATCH',{...f.config,receivers:[]})).status,400);assert.equal((await f.call('PATCH',{...f.config,connectionIds:['outside']})).status,403);
 assert.equal((await f.call('PATCH',{...f.config,receivers:[{connectionId:'b',linkReady:false}]})).status,400);
 assert.equal((await f.call('PATCH',{...f.config,enabled:false,connectionIds:[],receivers:[]})).status,200);assert.equal((await f.call('PATCH',f.config)).status,409);
 assert.equal((await f.call('PATCH',{...f.config,revision:1})).status,200);assert.equal(f.requests.length,0);assert.equal(f.photoSent.length,0);
});
test('ready photos need no narration/render; atomic once-only allocation freezes CTA/images and honors three daily times',async t=>{
 const f=await setup(t);for(let i=0;i<6;i++)await f.ready(15);assert.equal((await f.call('PATCH',f.config)).status,200);
 assert.equal((await f.run()).created,2);assert.equal((await f.run()).created,0);
 for(const offset of [3*3600000,5*3600000])assert.equal((await f.run(now+offset)).created,2);
 const jobs=f.sqlite.prepare('SELECT * FROM factory_jobs ORDER BY id').all();assert.equal(jobs.length,6);assert.ok(jobs.every(j=>j.type==='psychology'));
 for(const j of jobs){const p=JSON.parse(j.payload_json);assert.equal(p.pages.length,15);assert.equal(p.hitPhoto,true);assert.equal(p.psychologyAutomation.mediaType,'photo');assert.equal(p.psychologyAutomation.isAiGenerated,true);assert.equal(p.plan.caption.split('Curious about').length,2);assert.ok(p.pages.every((v,i)=>v.index===i+1));}
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM psychology_video_hit_versions WHERE caption='Saved caption' AND script='' AND render_job_id='' AND publish_item_id<>''").get().n,6);
 assert.equal(f.sqlite.prepare('SELECT count(DISTINCT slot_at) n FROM psychology_imported_photo_slots').get().n,3);assert.equal(f.requests.length,0);
 const detail=await(await f.write('/'+f.sqlite.prepare('SELECT id FROM psychology_video_hits LIMIT 1').get().id,undefined,'GET')).json();assert.equal(detail.versions[0].photoReady,true);
});
test('pause/new revision races roll back slots, reservations and jobs together',async t=>{
 const f=await setup(t);await f.ready();await f.call('PATCH',f.config);const batch=f.db.batch.bind(f.db);let changed=false;
 f.db.batch=async list=>{if(!changed){changed=true;f.sqlite.prepare("UPDATE psychology_imported_photo_settings SET enabled=0,revision=revision+1,lease_token='' WHERE owner='admin'").run();}return batch(list);};
 assert.equal((await f.run()).created,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM factory_jobs').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_imported_photo_slots').get().n,0);assert.equal(f.sqlite.prepare('SELECT publish_item_id FROM psychology_video_hit_versions').get().publish_item_id,'');
});
test('publication permission is rechecked and a revoked grant cannot allocate',async t=>{
 const f=await setup(t);await f.ready();await f.call('PATCH',f.config);f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json='[]'").run();assert.equal((await f.run()).created,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM factory_jobs').get().n,0);assert.equal((await f.call()).status,403);
});
test('inventory shortage preserves reservations, fair next round reaches unserved account, same topic cooldown holds',async t=>{
 const f=await setup(t);const first=await f.ready();await f.ready(12,first.sourceId,2);await f.call('PATCH',f.config);
 assert.equal((await f.run()).created,2);await f.ready(12,first.sourceId,3);assert.equal((await f.run(now+3*3600000)).created,0);
 await f.ready();assert.equal((await f.run(now+3*3600000)).created,1);await f.ready();assert.equal((await f.run(now+3*3600000)).created,1);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_imported_photo_slots').get().n,4);
});
test('pause keeps committed jobs; re-enable/config changes cannot duplicate account/time',async t=>{
 const f=await setup(t);for(let i=0;i<4;i++)await f.ready();await f.call('PATCH',f.config);assert.equal((await f.run()).created,2);const before=f.sqlite.prepare('SELECT payload_json FROM factory_jobs ORDER BY id').all();
 assert.equal((await f.call('PATCH',{revision:1,enabled:false,pauseOnly:true})).status,200);assert.equal((await f.run()).created,0);
 assert.equal((await f.call('PATCH',{...f.config,revision:2})).status,200);assert.equal((await f.run()).created,0);assert.deepEqual(f.sqlite.prepare('SELECT payload_json FROM factory_jobs ORDER BY id').all(),before);
});
test('lease/CAS dispatch recovers dropped messages and queue failure without publishing',async t=>{
 const f=await setup(t);await f.ready();await f.call('PATCH',f.config);assert.equal((await dispatchImportedPhotos(f.env,now)).sent,1);assert.equal((await dispatchImportedPhotos(f.env,now)).sent,0);assert.equal((await dispatchImportedPhotos(f.env,now+61000)).sent,1);
 assert.deepEqual(f.scheduleSent[0],{kind:'imported-photos',owner:'admin'});f.sqlite.prepare('UPDATE psychology_imported_photo_settings SET lease_until=?').run(now+300000);assert.equal((await f.run()).created,0);assert.equal((await f.run(now+300001)).created,1);
});
test('disabled, over-limit, consumed/video material and renamed receiver do not allocate',async t=>{
 const f=await setup(t);const a=await f.ready(),b=await f.ready();await f.ready(16);f.sqlite.prepare('UPDATE psychology_video_hit_versions SET enabled=0 WHERE source_id=?').run(a.sourceId);f.sqlite.prepare("UPDATE psychology_video_hit_versions SET publish_item_id='existing',publish_state='reserved' WHERE source_id=?").run(b.sourceId);
 await f.call('PATCH',f.config);assert.equal((await f.run()).created,0);await f.ready();f.directory.accounts[1].username='renamed';assert.equal((await f.run()).created,0);assert.match((await f.call()).data.detail,/承接/);
});

test('bad frame candidate is quarantined and later complete photos still allocate',async t=>{
 const f=await setup(t),bad=await f.ready(),good=await f.ready();f.sqlite.prepare('UPDATE psychology_video_hit_versions SET created_at=created_at-1000 WHERE source_id=?').run(bad.sourceId);f.sqlite.prepare('UPDATE psychology_video_hit_frames SET frame_index=99 WHERE source_id=? AND version=1 AND frame_index=12').run(bad.sourceId);await f.call('PATCH',{...f.config,connectionIds:['a']});
 assert.equal((await f.run()).created,1);assert.equal(f.sqlite.prepare('SELECT source_id FROM psychology_imported_photo_slots').get().source_id,good.sourceId);
 const left=f.sqlite.prepare('SELECT publish_item_id FROM psychology_video_hit_versions WHERE source_id=?').get(bad.sourceId);assert.equal(left.publish_item_id,'');
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_imported_photo_skips').get().n,1);
});
test('cross-site writes fail and a transaction-time grant removal leaves no partial work',async t=>{
 const f=await setup(t);const r=new Request(BASE,{method:'PATCH',headers:{Origin:'https://other.test'},body:JSON.stringify(f.config)});assert.equal((await handleImportedPhotos(r,f.env,new URL(BASE),{user},{directory:f.directory,now})).status,403);
 await f.ready();await f.call('PATCH',f.config);const batch=f.db.batch.bind(f.db);f.db.batch=async rows=>{f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json='[]'").run();return batch(rows);};assert.equal((await f.run()).created,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM psychology_imported_photo_slots').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM factory_jobs').get().n,0);
});
test('photo queue and schedule queue failures recover without making new publication identities',async t=>{
 const f=await setup(t);await f.ready();await f.call('PATCH',{...f.config,connectionIds:['a']});f.env.SCHEDULE_QUEUE.send=async()=>{throw Error('queue unavailable');};await assert.rejects(dispatchImportedPhotos(f.env,now),/unavailable/);assert.equal(f.sqlite.prepare('SELECT dispatched_at FROM psychology_imported_photo_settings').get().dispatched_at,0);
 f.env.PHOTO_QUEUE.send=async()=>{throw Error('photo queue unavailable');};assert.equal((await f.run()).created,1);assert.equal((await f.run()).created,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM factory_jobs').get().n,1);assert.equal(f.requests.length,0);
});
