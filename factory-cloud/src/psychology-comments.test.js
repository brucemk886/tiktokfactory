import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,input} from './psychology-cloud-test-fixture.js';
import {commentTemplate,freezeComment,insertScheduledComment,runScheduledComments,handlePsychologyComments} from './psychology-comments.js';
import {writeIntegrationTopics,handlePsychologyTopicBank} from './psychology-topic-bank.js';
import {parseTopicImport} from '../../public/psychology-topic-import.js';
const admin={id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-publish','psychology-topic-bank','psychology-comments']};
async function ready(t) {
 const f=await fixture(t);await f.call('POST',input({count:1,connectionIds:['a']}));
 const item=f.sqlite.prepare('SELECT * FROM psychology_publish_items').get();
 await insertScheduledComment(f.db,{id:item.id,batchId:item.batch_id,template:'psychology',connectionId:'a',account:{username:'alpha'}},{title:'Test question'},{text:'Answer A',delayMinutes:120,caption:''},'admin',1000).run();
 f.sqlite.prepare('UPDATE psychology_publish_items SET receipt_json=?').run(JSON.stringify({batchId:'remote',remoteTaskId:'task'}));
 const now=Date.now(),videoId='7686683886444760328',remote={id:'task',connectionId:'a',externalRef:item.id,status:'published',videoId,publishedAt:now,completedAt:now+1000};
 let sends=0;const receipts=new Map();
 async function call(path,options) {
  if(path.includes('/batches/'))return {batch:{tasks:[remote]}};
  if(options?.method==='POST'){sends++;const b=options.body;const comment={...b,status:'published',commentId:'123456789'};receipts.set(b.externalId,comment);return {comment};}
  const id=new URL('https://hub.test'+path).searchParams.get('externalId');if(!receipts.has(id))throw Object.assign(new Error('missing'),{statusCode:404});return {comment:receipts.get(id)};
 }
 const read=()=>f.sqlite.prepare('SELECT * FROM psychology_scheduled_comments').get();
 const run=(time=now,extra={})=>runScheduledComments(f.env,{now:time,call,assertAccess:async()=>{},...extra});
 return {...f,id:item.id,now,remote,videoId,run,read,call,receipts,sends:()=>sends};
}
test('default is off and answer/teaser are frozen independently from rendering script',async t=>{
 const f=await fixture(t),cfg=await commentTemplate(f.db,'psychology');assert.equal(cfg.enabled,0);assert.equal(cfg.delay_minutes,120);
 assert.equal(freezeComment({},{mediaType:'video'},cfg),null);
 assert.throws(()=>freezeComment({title:'missing'},{mediaType:'video',sourceType:'topic-bank'},{...cfg,enabled:1}),/揭晓评论/);
 assert.deepEqual(freezeComment({revealComment:'Answer'},{mediaType:'video',sourceType:'topic-bank'},{...cfg,enabled:1}),{text:'Answer',delayMinutes:120,caption:"Follow for the answer — I'll reveal it in the comments in 2 hours."});
});
test('actual publication time starts delay; schedule and creation times do not',async t=>{
 const f=await ready(t);f.remote.publishedAt=f.now+3600000;await f.run();assert.equal(f.read().due_at,f.now+10800000);assert.equal(f.sends(),0);
 await f.run(f.now+10799999);assert.equal(f.sends(),0);await f.run(f.now+10800000);assert.equal(f.sends(),1);assert.equal(f.read().status,'published');
 await f.run(f.now+11000000);assert.equal(f.sends(),1);
});
test('late item ID waits and completedAt is the conservative time fallback',async t=>{
 const f=await ready(t);f.remote.videoId='';f.remote.publishedAt=0;await f.run();assert.equal(f.read().status,'waiting_publish');
 f.remote.videoId=f.videoId;await f.run(f.now+300000);assert.equal(f.read().time_basis,'confirmed');assert.equal(f.read().due_at,f.remote.completedAt+7200000);
});
test('failed video waits for recovery without commenting',async t=>{
 const f=await ready(t);f.remote.status='failed';await f.run();assert.equal(f.read().status,'waiting_publish');assert.equal(f.sends(),0);
 f.remote.status='published';await f.run(f.now+300000);assert.equal(f.read().status,'pending');
});
test('cancelled/deleted tasks never send and duplicate cron claims only once',async t=>{
 const f=await ready(t);await f.run();await Promise.all([f.run(f.now+7200000),f.run(f.now+7200000)]);assert.equal(f.sends(),1);
});
test('deleted parent cancels unsent comments',async t=>{
 const f=await ready(t);f.sqlite.prepare('UPDATE psychology_publish_items SET deleted_at=1').run();await f.run();assert.equal(f.read().status,'cancelled');assert.equal(f.sends(),0);
});
test('revoked access prevents a due comment from being sent',async t=>{
 const f=await ready(t);await f.run();await f.run(f.now+7200000,{assertAccess:async()=>{throw Object.assign(new Error('revoked'),{statusCode:403});}});
 assert.equal(f.sends(),0);assert.equal(f.read().status,'failed');
});
test('lost POST response is resolved by GET without a second write',async t=>{
 const f=await ready(t);await f.run();await f.run(f.now+7200000,{call:async(path,options)=>{const result=await f.call(path,options);if(options)throw new Error('timeout');return result;}});
 assert.equal(f.read().status,'sending');await f.run(f.now+7260000);assert.equal(f.sends(),1);assert.equal(f.read().status,'published');
});
test('hub uncertain result is displayed and never blindly retried',async t=>{
 const f=await ready(t);await f.run();await f.run(f.now+7200000,{call:async(path,options)=>{if(!options)return f.call(path);throw Object.assign(new Error('409'),{statusCode:409,responseData:{comment:{...options.body,status:'needs_review',errorCode:'upstream_request_uncertain'}}});}});
 assert.equal(f.read().status,'needs_review');await f.run(f.now+9999999);assert.equal(f.sends(),0);
});
test('expired lease resumes with stable idempotency; future due date still blocks',async t=>{
 const f=await ready(t);await f.run();f.sqlite.prepare("UPDATE psychology_scheduled_comments SET status='sending',attempts=1,lease_until=?,next_check_at=0").run(f.now+100);
 await f.run(f.now);assert.equal(f.sends(),0);await f.run(f.now+7200000);assert.equal(f.sends(),1);
});
test('template settings API enforces permissions, valid delay and preserves pending snapshots',async t=>{
 const f=await ready(t),url=new URL('https://factory.test/api/psychology-comments/templates');
 const req=body=>new Request(url,{method:'PUT',body:JSON.stringify(body)});
 await assert.rejects(handlePsychologyComments(req({}),f.env,url,{user:{...admin,role:'operator'}}),e=>e.statusCode===403);
 await assert.rejects(handlePsychologyComments(req({template:'psychology',enabled:true,delayMinutes:0}),f.env,url,{user:admin}),/延迟/);
 assert.equal((await handlePsychologyComments(req({template:'psychology',enabled:true,delayMinutes:60,caption:'Later {hours}'}),f.env,url,{user:admin})).status,200);
 assert.equal(f.read().delay_minutes,120);
});
test('CSV/API/edit keep reveal answers and batches snapshot without exposing them in video script',async t=>{
 const f=await fixture(t);assert.equal(parseTopicImport('题目,揭晓评论\nQuestion,Answer')[0].revealComment,'Answer');
 await writeIntegrationTopics(f.db,{template:'psychology-collage',title:'Question',content:'Public script',revealComment:'Private answer',replyOptions:{A:'A answer',B:'B answer',C:'C answer',D:'D answer'}},'admin');
 const topic=f.sqlite.prepare('SELECT * FROM psychology_template_topics').get();assert.equal(topic.reveal_comment,'Private answer');
 const url=new URL('https://factory.test/api/psychology-template-topics/'+topic.id);
 const res=await handlePsychologyTopicBank(new Request(url,{method:'PATCH',body:JSON.stringify({revision:topic.revision,priority:40})}),f.env,url,{user:admin});assert.equal(res.status,200);assert.equal(f.sqlite.prepare('SELECT reveal_comment FROM psychology_template_topics').get().reveal_comment,'Private answer');
 f.sqlite.prepare("INSERT INTO psychology_comment_templates(template,enabled,delay_minutes,caption,auto_reply_enabled) VALUES('psychology-collage',1,120,'Answer in {hours} hours',1)").run();
 const previous=globalThis.fetch;t.mock.method(globalThis,'fetch',async(url,init)=>{const result=await previous(url,init);if(String(url).includes('/accounts')){const data=await result.json();data.accounts.forEach(a=>a.scopes.push('comment.list.manage','comment.list'));return Response.json(data);}return result;});
 const body=input({template:'psychology-collage',sourceType:'topic-bank',count:1,connectionIds:['a'],selection:'priority'});
 assert.equal((await f.call('POST',body,undefined,admin)).status,202);
 const job=JSON.parse(f.sqlite.prepare('SELECT payload_json FROM factory_jobs').get().payload_json);
 assert.equal(JSON.parse(f.sqlite.prepare('SELECT reply_config_json FROM psychology_scheduled_comments').get().reply_config_json).answers.A,'A answer');assert.ok(!JSON.stringify(job).includes('A answer'));assert.ok(!JSON.stringify(job).includes('Private answer'));assert.match(job.publish.videoDesc,/Answer in 2 hours/);
 f.sqlite.prepare("UPDATE psychology_template_topics SET reveal_comment='Changed'").run();assert.equal(f.sqlite.prepare('SELECT text FROM psychology_scheduled_comments').get().text,'Private answer');
 assert.equal((await f.call('POST',body,undefined,admin)).status,200);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_scheduled_comments').get().n,1);
});

test('cancel API prevents execution; submitting requests cannot be cancelled',async t=>{
 const f=await ready(t),url=new URL('https://factory.test/api/psychology-comments/'+f.id+'/cancel');
 assert.equal((await handlePsychologyComments(new Request(url,{method:'POST'}),f.env,url,{user:admin})).status,200);
 await f.run(f.now+9999999);assert.equal(f.sends(),0);
 f.sqlite.prepare("UPDATE psychology_scheduled_comments SET status='sending',attempts=1").run();
 await assert.rejects(handlePsychologyComments(new Request(url,{method:'POST'}),f.env,url,{user:admin}),e=>e.statusCode===409);
});
test('manual verification remains read-only across transport failures and missing receipt',async t=>{
 const f=await ready(t);await f.run();f.sqlite.prepare("UPDATE psychology_scheduled_comments SET status='checking',attempts=1").run();
 await f.run(f.now+7200000,{call:async()=>{throw new Error('temporary network');}});assert.equal(f.read().status,'checking');
 await f.run(f.now+7260000);assert.equal(f.read().status,'needs_review');assert.equal(f.sends(),0);
});
test('a missing answer rejects the whole batch without jobs or usage writes',async t=>{
 const f=await fixture(t);await writeIntegrationTopics(f.db,{template:'psychology-collage',title:'No answer'},'admin');
 f.sqlite.prepare("INSERT INTO psychology_comment_templates(template,enabled) VALUES('psychology-collage',1)").run();
 const old=globalThis.fetch;t.mock.method(globalThis,'fetch',async(url,init)=>{const r=await old(url,init);if(String(url).includes('/accounts')){const d=await r.json();d.accounts.forEach(a=>a.scopes.push('comment.list.manage','comment.list'));return Response.json(d);}return r;});
 await assert.rejects(f.call('POST',input({template:'psychology-collage',sourceType:'topic-bank',count:1,connectionIds:['a'],selection:'priority'}),undefined,admin),/揭晓评论/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_jobs').get().n,0);assert.equal(f.sqlite.prepare('SELECT SUM(usage_count) n FROM psychology_template_topics').get().n,0);
});

const replies={A:'Answer A',B:'Answer B',C:'Answer C',D:'Answer D'};
test('template replies freeze per-topic answers and require complete options',()=>{
 const setting={enabled:1,delay_minutes:120,auto_reply_enabled:1,reply_hours:48,reply_max:80};
 const source={id:'question-1',title:'Question',revealComment:'Reveal',replyOptions:replies};
 const snapshot=freezeComment(source,{mediaType:'video',sourceType:'topic-bank'},setting);
 assert.deepEqual(snapshot.replyConfig,{topicId:'question-1',answers:replies,hours:48,maxReplies:80});
 assert.throws(()=>freezeComment({...source,replyOptions:{}},{mediaType:'video',sourceType:'topic-bank'},setting));
 assert.equal(freezeComment(source,{mediaType:'photo',sourceType:'topic-bank'},setting),null);
});
test('confirmed receipt automatically enrolls the correct video and frozen question once',async t=>{
 const f=await ready(t),config={topicId:'question-1',answers:replies,hours:48,maxReplies:80};
 f.sqlite.prepare('UPDATE psychology_scheduled_comments SET reply_config_json=?').run(JSON.stringify(config));
 f.remote.status='failed';await f.run();assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_reply_watches').get().n,0);
 f.remote.status='published';await f.run(f.now+300000);
 const w=f.sqlite.prepare('SELECT * FROM psychology_reply_watches').get();
 assert.equal(w.connection_id,'a');assert.equal(w.video_id,f.videoId);assert.equal(w.topic_id,'question-1');assert.deepEqual(JSON.parse(w.answers_json),replies);
 assert.equal(w.start_at,f.now+7200000);assert.equal(w.end_at,w.start_at+48*3600000);assert.equal(w.max_replies,80);assert.equal(f.sends(),0);
 f.sqlite.prepare("UPDATE psychology_scheduled_comments SET status='waiting_publish',next_check_at=0").run();await f.run(f.now+400000);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_reply_watches').get().n,1);
});
test('legacy scheduled comments do not silently enroll replies',async t=>{
 const f=await ready(t);await f.run();assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_reply_watches').get().n,0);
});
test('linked reply template settings require reveals and bounded duration',async t=>{
 const f=await ready(t),url=new URL('https://factory.test/api/psychology-comments/templates');
 const put=b=>handlePsychologyComments(new Request(url,{method:'PUT',body:JSON.stringify({template:'psychology',enabled:true,delayMinutes:120,autoReplyEnabled:true,replyHours:48,replyMax:80,...b})}),f.env,url,{user:admin});
 await assert.rejects(put({enabled:false}));await assert.rejects(put({replyHours:169}));await put({});
 const row=await commentTemplate(f.db,'psychology');assert.equal(row.auto_reply_enabled,1);assert.equal(row.reply_max,80);
});
