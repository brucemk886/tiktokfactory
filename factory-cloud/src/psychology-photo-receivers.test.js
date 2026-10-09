import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,input} from './psychology-cloud-test-fixture.js';
import {handleVideoHits} from './psychology-video-hits.js';
import {kvSet} from './kv.js';
import {normalizeAutoPublish} from '../../scripts/psychology-auto-publish.js';
import {photoReceiverPool,drawPhotoReceiver,applyPhotoReceiverCaption} from './psychology-photo-receivers.js';
import {enqueueAutoPhotoRender,assertAutoJobAccess} from './psychology-auto-publish.js';
const actor={id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-publish','psychology-video-hits']};
const photoInput=(refs,extra={})=>input({mediaType:'photo',template:'selected-photo',sourceType:'video-hits',isAiGenerated:false,connectionIds:['a'],count:refs.length,photoVersions:refs,...extra});
async function setup(t){
 const f=await fixture(t);f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(actor.sidebarModules));
 f.env.PHOTO_BROWSER={};f.sent=[];f.env.PHOTO_QUEUE={async send(x){f.sent.push(x);}};
 f.accounts=['a','b','c'].map((id,i)=>({id,username:['alpha','beta','gamma'][i],scopes:['video.publish']}));
 const original=globalThis.fetch;t.mock.method(globalThis,'fetch',async(url,init)=>String(url).includes('/api/v1/accounts')?Response.json({accounts:f.accounts}):original(url,init));
 await kvSet(f.db,'official-account-groups',{projects:[{id:'proj-psych',name:'心理学',moduleKey:'psychology'}],groups:[{id:'g',name:'心理学账号',projectId:'proj-psych'}],assignments:{a:'g',b:'g',c:'g'}});
 for(const a of f.accounts){f.sqlite.prepare('INSERT INTO official_account_assignments(account_key,group_id) VALUES(?,?)').run('tiktok:'+a.id,'g');f.sqlite.prepare('INSERT INTO official_accounts_latest(account_key,profile_json,synced_at) VALUES(?,?,?)').run('tiktok:'+a.id,JSON.stringify({username:a.username,followers:1500}),Date.now());}
 f.settings=(receivers=f.accounts,revision=1,owner='admin')=>f.sqlite.prepare('INSERT INTO psychology_imported_photo_settings(owner,revision,config_json) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision,config_json=excluded.config_json').run(owner,revision,JSON.stringify({receivers:receivers.map(a=>({connectionId:a.id,username:a.username,linkReady:true,...a})),cta:{mention:'Take the test at {account}.',self:'Take the test via my bio.'}}));
 f.write=async(path,body,method='PUT')=>{const req=new Request('https://factory.test/api/psychology-video-hits'+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),...body})});return handleVideoHits(req,f.env,new URL(req.url),{user:actor});};
 f.ready=async()=>{const sourceId=(await(await f.write('',{externalId:crypto.randomUUID(),videoUrl:'https://www.tiktok.com/@qa/video/1',title:'Original title',script:'Original text'},'POST')).json()).id;
 await f.write('/'+sourceId+'/versions/1',{revision:0,title:'Saved title',caption:'Saved caption #psychology',script:'Saved script'});
 await f.write('/'+sourceId+'/frames/1',{revision:1,frames:[{index:1,imageUrl:'https://images.example.com/one.jpg'},{index:2,imageUrl:'https://images.example.com/two.jpg'}]});
 await f.write('/'+sourceId+'/versions/1',{revision:2,enabled:true});return {sourceId,version:1,revision:3};};
 f.jobs=()=>f.sqlite.prepare('SELECT * FROM factory_jobs ORDER BY id').all();return f;
}
test('manual photo opt-in is typed, photo-only and omitted when disabled for backward-compatible replay',()=>{
 const body=input({mediaType:'photo',template:'photo-text'}),plain=normalizeAutoPublish(body);
 assert.deepEqual(normalizeAutoPublish({...body,mentionReceiver:false}),plain);assert.equal(Object.hasOwn(plain,'mentionReceiver'),false);
 assert.equal(normalizeAutoPublish({...body,mentionReceiver:true}).mentionReceiver,true);
 for(const extra of [{mentionReceiver:'true'},{mentionReceiver:true,mediaType:'video',template:'psychology'},{mentionReceiver:true,libraryStrategy:'pools'},{mentionReceiver:true,poolContext:{}}])assert.throws(()=>normalizeAutoPublish({...body,...extra}),/手动|请选择/);
});
test('receiver pool reads only current owner saved settings, fresh grants, linked eligible and authorized accounts',async t=>{
 const f=await setup(t);f.settings(undefined,1,'someone-else');assert.deepEqual((await photoReceiverPool(f.env,actor)).receivers,[]);
 f.settings();let pool=await(await f.call('GET',null,'/api/psychology-auto-publish/photo-receivers')).json();assert.equal(pool.receivers.length,3);assert.equal(pool.revision,1);
 f.settings([{...f.accounts[0],linkReady:false},f.accounts[1],f.accounts[2]]);f.sqlite.prepare('UPDATE official_accounts_latest SET profile_json=? WHERE account_key=?').run(JSON.stringify({username:'beta',followers:999}),'tiktok:b');
 assert.deepEqual((await photoReceiverPool(f.env,actor)).receivers,[{connectionId:'c',username:'gamma'}]);
 f.accounts[2].username='renamed';assert.deepEqual((await photoReceiverPool(f.env,actor)).receivers,[]);f.accounts[2].username='gamma';f.accounts[2].scopes=[];assert.deepEqual((await photoReceiverPool(f.env,actor)).receivers,[]);
 f.accounts[2].scopes=['video.publish'];f.sqlite.prepare("UPDATE official_account_assignments SET group_id='other' WHERE account_key='tiktok:c'").run();assert.deepEqual((await photoReceiverPool(f.env,actor)).receivers,[]);
 f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json='[]'").run();await assert.rejects(photoReceiverPool(f.env,actor),e=>e.statusCode===403);assert.equal(f.jobs().length,0);assert.equal(f.requests.length,0);
});
test('draw excludes self, uses the full remaining pool, preserves content and appends CTA once with length checks',()=>{
 const pool={revision:7,receivers:[{connectionId:'a',username:'alpha'},{connectionId:'b',username:'beta'},{connectionId:'c',username:'gamma'}],mention:'Visit {account}.'};
 const first=drawPhotoReceiver(pool,'a',()=>0),last=drawPhotoReceiver(pool,'a',()=>0.999);assert.equal(first.username,'beta');assert.equal(last.username,'gamma');assert.equal(first.settingsRevision,7);
 assert.throws(()=>drawPhotoReceiver({...pool,receivers:[pool.receivers[0]]},'a'),/其他可用/);
 const original={title:'Source title',caption:'Original caption',scenes:[{body:'Original body'}]},copy=applyPhotoReceiverCaption(original,first);
 assert.equal(copy.caption,'Original caption\n\nVisit @beta.');assert.deepEqual(copy.scenes,original.scenes);assert.equal(original.caption,'Original caption');assert.deepEqual(applyPhotoReceiverCaption(copy,first),copy);
 assert.throws(()=>applyPhotoReceiverCaption({caption:'x'.repeat(2199)},first),/2200/);assert.equal(applyPhotoReceiverCaption(original,null),original);
});
test('selected photos independently freeze a receiver per item, expose final copy, and replay without re-drawing or changing source',async t=>{
 const f=await setup(t);f.settings();const refs=[await f.ready(),await f.ready()],body=photoInput(refs,{mentionReceiver:true});let draws=0;t.mock.method(Math,'random',()=>draws++===0?0:0.999);
 assert.equal((await f.call('POST',body)).status,202);const jobs=f.jobs(),payloads=jobs.map(j=>JSON.parse(j.payload_json));assert.deepEqual(payloads.map(p=>p.psychologyAutomation.photoReceiver.username),['beta','gamma']);
 assert.deepEqual(payloads.map(p=>p.plan.caption),['Saved caption #psychology\n\nTake the test at @beta.','Saved caption #psychology\n\nTake the test at @gamma.']);assert.ok(payloads.every(p=>p.pages.length===2));
 assert.ok(f.sqlite.prepare('SELECT caption FROM psychology_video_hit_versions').all().every(r=>r.caption==='Saved caption #psychology'));
 const page=await(await f.call()).json();assert.deepEqual(page.batches[0].items.map(i=>i.photoReceiver.username),['beta','gamma']);assert.equal(page.batches[0].items[0].finalCaption,payloads[0].plan.caption);
 f.settings([],2);assert.equal((await(await f.call('POST',body)).json()).duplicate,true);assert.deepEqual(f.jobs().map(j=>j.payload_json),jobs.map(j=>j.payload_json));assert.equal(draws,2);assert.equal(f.requests.length,0);
});
test('unchecked selected photo creation needs no receiver settings and keeps original caption',async t=>{
 const f=await setup(t),ref=await f.ready();await f.call('POST',photoInput([ref]));const p=JSON.parse(f.jobs()[0].payload_json);assert.equal(p.psychologyAutomation.photoReceiver,undefined);assert.equal(p.plan.caption,'Saved caption #psychology');
});
test('empty and self-only pools reject before reserving sources or creating jobs',async t=>{
 const f=await setup(t),ref=await f.ready(),body=photoInput([ref],{mentionReceiver:true});await assert.rejects(f.call('POST',body),/其他可用/);f.settings([f.accounts[0]]);await assert.rejects(f.call('POST',body),/其他可用/);
 assert.equal(f.jobs().length,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_batches').get().n,0);assert.equal(f.sqlite.prepare('SELECT publish_item_id FROM psychology_video_hit_versions').get().publish_item_id,'');
});
test('saved receiver settings revision race rolls back the entire selected-photo transaction',async t=>{
 const f=await setup(t);f.settings();const ref=await f.ready(),batch=f.db.batch.bind(f.db);f.db.batch=async items=>{f.settings([],2);return batch(items);};
 await assert.rejects(f.call('POST',photoInput([ref],{mentionReceiver:true})),e=>e.statusCode===409);assert.equal(f.jobs().length,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_publish_batches').get().n,0);assert.equal(f.sqlite.prepare('SELECT publish_item_id FROM psychology_video_hit_versions').get().publish_item_id,'');
});
test('queued photo task rechecks frozen receiver access and refuses rename or revoked authorization without rerouting',async t=>{
 const f=await setup(t);f.settings([f.accounts[1]]);await f.call('POST',photoInput([await f.ready()],{mentionReceiver:true}));const job=f.jobs()[0];await assertAutoJobAccess(f.env,job);
 f.accounts[1].username='changed';await assert.rejects(assertAutoJobAccess(f.env,job),e=>e.statusCode===403);f.accounts[1].username='beta';f.accounts[1].scopes=[];await assert.rejects(assertAutoJobAccess(f.env,job),e=>e.statusCode===403);
 assert.equal(JSON.parse(f.jobs()[0].payload_json).psychologyAutomation.photoReceiver.username,'beta');assert.equal(f.requests.length,0);
});
test('generated photo source freezes recipient before generation and final handoff appends CTA without changing page content',async t=>{
 const f=await setup(t);f.settings([f.accounts[1]]);const body=input({mediaType:'photo',template:'photo-text',connectionIds:['a'],count:1,mentionReceiver:true,styleMode:'legacy'});await f.call('POST',body);
 const source=f.jobs()[0],before=JSON.parse(source.payload_json);assert.equal(before.psychologyAutomation.photoReceiver.username,'beta');
 const result={plan:{title:'A pause',caption:'Take a moment'},results:[{template:'cover',title:'Pause before you reply',textKind:'cover'},{template:'content',title:'Notice',body:'What story are you telling yourself?'}]};
 f.sqlite.prepare("UPDATE factory_jobs SET status='done',result_json=? WHERE id=?").run(JSON.stringify(result),source.id);f.settings([f.accounts[2]],2);await enqueueAutoPhotoRender(f.env,source.id);await enqueueAutoPhotoRender(f.env,source.id);
 const render=f.jobs().find(j=>j.id===source.id+'-render'),payload=JSON.parse(render.payload_json);assert.equal(payload.plan.caption,'Take a moment\n\nTake the test at @beta.');assert.deepEqual(payload.pages,result.results);assert.equal(payload.psychologyAutomation.photoReceiver.settingsRevision,1);assert.equal(f.jobs().length,2);assert.equal(f.requests.length,0);
});
test('generated photo receiver revision race leaves no batches, tasks or workflow dispatches',async t=>{
 const f=await setup(t);f.settings();const batch=f.db.batch.bind(f.db);f.db.batch=async items=>{f.settings([],2);return batch(items);};await assert.rejects(f.call('POST',input({mediaType:'photo',template:'photo-text',connectionIds:['a'],count:1,mentionReceiver:true})),e=>e.statusCode===409);assert.equal(f.jobs().length,0);assert.equal(f.instances.size,0);
});
