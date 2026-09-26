import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,input} from './psychology-cloud-test-fixture.js';
import {handlePsychologyManagement,MANAGEMENT_API as API,MANAGEMENT_MODULES} from './psychology-management-api.js';
import {managedStyles,selectManagedStyle} from './psychology-managed-styles.js';
import {toPublicUser} from './auth.js';
import worker from './index.js';
const base='https://factory.test';
const modules=[...Object.values(MANAGEMENT_MODULES),'psychology-publish'];
const scopes=Object.keys(MANAGEMENT_MODULES).flatMap(m=>[m+':read',m+':write']);
async function setup(t,grant=scopes){
 const f=await fixture(t);f.publish=f.call;
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(modules));
 const user=()=>toPublicUser(f.sqlite.prepare("SELECT * FROM factory_users WHERE id='admin'").get());
 f.key=async(method='POST',body={scopes:grant},actor=user())=>{
  const req=new Request(base+'/api/psychology-management/api-key',{method,headers:{'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});
  return handlePsychologyManagement(req,f.env,new URL(req.url),{user:actor});
 };
 f.token=(await (await f.key()).json()).apiKey;
 f.call=async(path,method='GET',body,token=f.token)=>{
  const req=new Request(base+API+path,{method,headers:{Authorization:'Bearer '+token,'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  return worker.fetch(req,f.env,{});
 };
 return f;
}
async function value(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}

test('management key is scoped, hashed, revocable and checked against current admin permissions',async t=>{
 const f=await setup(t,['styles:read']);
 await value(await f.call('/styles'));
 assert.equal((await f.call('/styles','POST',{})).status,403);
 assert.equal((await f.call('/effects')).status,403);
 assert.equal((await f.call('/styles','GET',undefined,'psy_hits_fake')).status,401);
 const row=f.sqlite.prepare('SELECT * FROM psychology_management_keys').get();assert.notEqual(row.token_hash,f.token);assert.equal(row.token_hash.length,64);
 const meta=await value(await f.key('GET'));assert.equal(meta.apiKey,undefined);
 const old=f.token;f.token=(await value(await f.key('POST',{scopes}),201)).apiKey;
 assert.equal((await f.call('/styles','GET',undefined,old)).status,401);
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(['psychology-autopilot']));
 assert.equal((await f.call('/effects')).status,403);
 f.sqlite.exec("UPDATE factory_users SET active=0");assert.equal((await f.call('/autopilot')).status,401);
 f.sqlite.exec("UPDATE factory_users SET active=1");
 await value(await f.key('DELETE'));assert.equal((await f.call('/autopilot')).status,401);
 assert.equal(f.requests.length,0);
});

test('report plans are idempotent, owner scoped, revision guarded and never edit statistics',async t=>{
 const f=await setup(t);
 for(const module of ['effects','operations']){
  const body={requestId:crypto.randomUUID(),name:'Weekly',query:{period:'7d',group:'g',...(module==='operations'?{media:'photo',panel:'overview'}:{})}};
  const made=await value(await f.call('/'+module+'/views','POST',body),201);
  const id=made.item.id;
  assert.equal((await value(await f.call('/'+module+'/views','POST',body))).duplicate,true);
  assert.equal((await f.call('/'+module+'/views','POST',{...body,name:'Changed'})).status,409);
  const patched=await value(await f.call('/'+module+'/views/'+id,'PATCH',{revision:1,name:'Monthly',query:{period:'30d'}}));
  assert.equal(patched.item.revision,2);
  assert.equal((await f.call('/'+module+'/views/'+id,'PATCH',{revision:1,name:'stale'})).status,409);
  assert.equal((await value(await f.call('/'+module+'/views'))).items.length,1);
  assert.equal((await f.call('/'+module,'POST',{views:1234})).status,405);
  assert.equal((await f.call('/'+module+'?group=other')).status,403);
  assert.equal((await f.call('/'+module+'?module=other')).status,400);
 }
 assert.equal((await f.call('/effects?from=bad')).status,400);
 assert.equal((await f.call('/operations?media=bad')).status,400);
 assert.equal((await f.call('/operations?period=custom&from=invalid&to=invalid')).status,400);
 const row=f.sqlite.prepare('SELECT * FROM psychology_report_views LIMIT 1').get();
 f.sqlite.prepare('UPDATE psychology_report_views SET owner=? WHERE id=?').run('someone-else',row.id);
 assert.equal((await f.call('/'+row.module+'/views/'+row.id)).status,404);
 assert.equal((await f.call('/'+row.module+'?viewId='+row.id)).status,404);
 assert.equal(f.requests.length,0);
});

test('both report GET endpoints reuse current module reporting and do not publish',async t=>{
 const f=await setup(t);
 const operations=await value(await f.call('/operations?panel=overview&period=7d&media=photo'));
 assert.ok(operations);
 const effects=await value(await f.call('/effects?period=7d'));
 assert.ok(effects);
 assert.equal(f.requests.length,0);
});

test('style create, update, owner isolation and last-enabled protection',async t=>{
 const f=await setup(t);
 let data=await value(await f.call('/styles'));assert.equal(data.total,20);
 const body={requestId:crypto.randomUUID(),baseStyleId:'classic',label:'Calm blue',coverBg:'#123456'};
 const created=(await value(await f.call('/styles','POST',body),201)).item;
 assert.equal(created.enabled,false);
 assert.equal((await value(await f.call('/styles','POST',body))).duplicate,true);
 assert.equal((await f.call('/styles','POST',{...body,label:'different'})).status,409);
 const changed=(await value(await f.call('/styles/'+created.id,'PATCH',{revision:1,enabled:true}))).item;
 assert.equal(changed.revision,2);
 assert.equal((await f.call('/styles/'+created.id,'PATCH',{revision:1,label:'stale'})).status,409);
 assert.equal((await f.call('/styles/'+created.id,'PATCH',{revision:2,coverBg:'url(https://bad.test)'})).status,400);
 assert.equal((await f.call('/styles/'+created.id,'PATCH',{revision:2,layout:'html'})).status,400);
 assert.equal((await managedStyles(f.db,'another-admin')).length,20);
 data=await value(await f.call('/styles'));
 for(const s of data.items.filter(s=>s.builtin))await value(await f.call('/styles/'+s.id,'PATCH',{revision:s.revision,enabled:false}));
 assert.equal((await f.call('/styles/'+created.id,'PATCH',{revision:2,enabled:false})).status,409);
 const snapshot=selectManagedStyle(await managedStyles(f.db,'admin'),'random','');
 assert.equal(snapshot.id,created.id);assert.equal(snapshot.coverBg,'#123456');
 await value(await f.call('/styles/'+created.id,'PATCH',{revision:2,coverBg:'#654321'}));
 assert.equal(snapshot.coverBg,'#123456');
 assert.equal(selectManagedStyle(await managedStyles(f.db,'admin'),'fixed',created.id).coverBg,'#654321');
 const pool=await managedStyles(f.db,'admin');assert.throws(()=>selectManagedStyle(pool,'fixed','classic'));
 assert.equal(f.requests.length,0);
});

test('autopilot API creates paused without jobs, idempotent retries do not run, modifications require revision',async t=>{
 const f=await setup(t),body={requestId:crypto.randomUUID(),groupId:'g',strategy:'original',days:7,slots:[{hour:12,minute:0}]};
 const made=await value(await f.call('/autopilot','POST',body),201);
 assert.equal(made.status,'paused');
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM factory_jobs').get().n,0);
 assert.equal((await value(await f.call('/autopilot','POST',body))).duplicate,true);
 assert.equal((await f.call('/autopilot','POST',{...body,days:10})).status,409);
 const list=await value(await f.call('/autopilot?pageSize=1'));assert.equal(list.total,1);assert.equal(list.hasMore,false);
 const item=(await value(await f.call('/autopilot/'+made.id))).item;assert.equal(item.revision,made.revision);
 const updated=await value(await f.call('/autopilot/'+made.id,'PATCH',{revision:item.revision,strategy:'rewrite'}));
 assert.equal(updated.strategy,'rewrite');
 assert.equal((await f.call('/autopilot/'+made.id,'PATCH',{revision:item.revision,status:'active'})).status,409);
 const active=await value(await f.call('/autopilot/'+made.id,'PATCH',{revision:updated.revision,status:'active'}));assert.equal(active.status,'active');
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM factory_jobs').get().n,0);
 assert.equal((await f.call('/autopilot/'+made.id+'/run','POST',{})).status,404);
 assert.equal((await f.call('/autopilot?pageSize=101')).status,400);
 const schedule=await value(await f.call('/autopilot/'+made.id+'/schedule','PATCH',{revision:active.revision,slots:[{hour:11,minute:0}]}));
 assert.ok(schedule.effectiveAt>Date.now());
 f.sqlite.prepare('UPDATE psychology_autopilots SET ends_at=1 WHERE id=?').run(made.id);
 await value(await f.call('/autopilot/'+made.id,'PATCH',{revision:schedule.revision,status:'ended'}));
 assert.equal(f.requests.length,0);
});

test('external autopilot blocks lost group permissions and historical out-of-scope members',async t=>{
 const f=await setup(t),body={requestId:crypto.randomUUID(),groupId:'g',strategy:'original'};
 const made=await value(await f.call('/autopilot','POST',body),201);
 f.sqlite.prepare("INSERT INTO psychology_autopilot_accounts(autopilot_id,connection_id,status,reason,updated_at) VALUES(?,'outside','active','',1)").run(made.id);
 assert.equal((await value(await f.call('/autopilot'))).total,0);
 assert.equal((await f.call('/autopilot/'+made.id)).status,404);
 assert.equal((await f.call('/autopilot/'+made.id+'/impact')).status,403);
 assert.equal((await f.call('/autopilot/'+made.id,'PATCH',{revision:made.revision,status:'active'})).status,403);
 f.sqlite.prepare('DELETE FROM psychology_autopilot_accounts WHERE autopilot_id=?').run(made.id);
 f.sqlite.exec(`UPDATE factory_kv SET value_json=json_set(value_json,'$.groups[0].projectId','proj-novel') WHERE key='official-account-groups'`);
 assert.equal((await value(await f.call('/autopilot'))).total,0);
 assert.equal((await f.call('/autopilot/'+made.id,'PATCH',{revision:made.revision,status:'active'})).status,403);
 assert.equal((await f.call('/autopilot','POST',body)).status,403);
 assert.equal(f.requests.length,0);
});

test('external body validation, current publish permission, and key administration boundaries',async t=>{
 const f=await setup(t);
 const req=new Request(base+API+'/styles',{method:'POST',headers:{Authorization:'Bearer '+f.token,'content-type':'application/json'},body:' '.repeat(129*1024)});
 assert.equal((await worker.fetch(req,f.env,{})).status,413);
 assert.equal((await f.call('/styles','POST',[])).status,400);
 assert.equal((await f.key('POST',{scopes:['made-up:write']})).status,400);
 assert.equal((await f.key('POST',{}, {id:'x',role:'operator'})).status,403);
 f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(['psychology-autopilot']));
 assert.equal((await f.call('/autopilot','POST',{requestId:crypto.randomUUID(),groupId:'g',strategy:'original'})).status,403);
 assert.equal(f.requests.length,0);
});


test('style definitions freeze on queued photo jobs and are not changed on retry',async t=>{
 const f=await setup(t);
 const item=(await value(await f.call('/styles','POST',{requestId:crypto.randomUUID(),baseStyleId:'classic',label:'Blue',coverBg:'#123456',enabled:true}),201)).item;
 const body=input({mediaType:'photo',template:'photo-text',count:1,connectionIds:['a'],styleMode:'fixed',styleId:item.id});
 await value(await f.publish('POST',body),202);
 const before=f.sqlite.prepare('SELECT payload_json FROM factory_jobs').get().payload_json;
 const snapshot=JSON.parse(before).psychologyAutomation.styleDefinition;assert.equal(snapshot.id,item.id);assert.equal(snapshot.coverBg,'#123456');
 await value(await f.call('/styles/'+item.id,'PATCH',{revision:item.revision,coverBg:'#654321'}));
 await value(await f.publish('POST',body));
 assert.equal(f.sqlite.prepare('SELECT payload_json FROM factory_jobs').get().payload_json,before);
 assert.equal(f.requests.length,0);
});
