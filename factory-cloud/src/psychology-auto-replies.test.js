import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './psychology-cloud-test-fixture.js';
import {runAutoReplies,matchReplyChoice,validateReplyAnswers,handlePsychologyAutoReplies,dispatchAutoReplies,consumeAutoReplies} from './psychology-auto-replies.js';
import {writeIntegrationTopics,handlePsychologyTopicBank} from './psychology-topic-bank.js';
const video='7686683886444760328',answers={A:'Answer A',B:'Answer B',C:'Answer C',D:'Answer D'};
const user={id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-comments','psychology-publish','psychology-topic-bank']};
async function setup(t){
 const f=await fixture(t),now=Date.now();let sent=0,scans=0,posts=[],page={comments:[{id:'12345678',text:'I choose C',authorName:'viewer'}],hasMore:false,nextCursor:'0'},receipts=new Map();
 const add=(id='watch',extra={})=>{const r={id,created_by:'admin',connection_id:'a',account_name:'alpha',video_id:video,topic_id:'topic',title:'Test',answers_json:JSON.stringify(answers),start_at:now-1000,end_at:now+86400000,max_replies:100,created_at:now,updated_at:now,...extra};const keys=Object.keys(r);f.sqlite.prepare('INSERT INTO psychology_reply_watches('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...Object.values(r));};add();
 const call=async(path,options)=>{if(path.includes('/scan?')){scans++;return {connectionId:'a',videoId:video,...page};}if(options){sent++;posts.push(options.body);const comment={...options.body,status:'published',commentId:'99999999'};receipts.set(options.body.externalId,comment);return {comment};}const key=new URL('https://hub.test'+path).searchParams.get('externalId');if(!receipts.has(key))throw Object.assign(new Error('missing'),{statusCode:404});return {comment:receipts.get(key)};};
 const run=(time=now,extra={})=>runAutoReplies(f.env,{now:time,assertAccess:async()=>{},call,...extra});
 return {...f,now,run,call,add,receipts,posts,sent:()=>sent,scans:()=>scans,setPage:p=>page=p,rows:()=>f.sqlite.prepare('SELECT * FROM psychology_reply_items ORDER BY parent_comment_id').all(),watch:()=>f.sqlite.prepare("SELECT * FROM psychology_reply_watches WHERE id='watch'").get()};
}
test('choice matching is conservative and answers are bounded',()=>{
 for(const [s,v] of [['A','A'],['选B','B'],['I choose C','C'],['option D!','D'],['Ａ','A'],['A or B',''],['I have a question',''],['not A',''],['B because I like it','']])assert.equal(matchReplyChoice(s),v);
 assert.deepEqual(validateReplyAnswers(answers),answers);assert.throws(()=>validateReplyAnswers({...answers,A:''}));assert.throws(()=>validateReplyAnswers({...answers,A:'x'.repeat(151)}));
});
test('future start waits; explicit choice replies once with correct target and answer',async t=>{
 const f=await setup(t);f.sqlite.prepare('UPDATE psychology_reply_watches SET start_at=?').run(f.now+600000);await f.run();assert.equal(f.scans(),0);
 await f.run(f.now+600000);assert.equal(f.sent(),1);assert.equal(f.posts[0].text,'Answer C');assert.equal(f.posts[0].parentCommentId,'12345678');
 await f.run(f.now+1000000);assert.equal(f.sent(),1);assert.equal(f.rows()[0].status,'published');
});
test('pagination persists cursor and cron overlap cannot duplicate replies',async t=>{
 const f=await setup(t);f.setPage({comments:[{id:'12345678',text:'A'}],hasMore:true,nextCursor:'50'});
 await Promise.all([f.run(),f.run()]);assert.equal(f.sent(),1);assert.equal(f.watch().cursor,'50');
 f.setPage({comments:[{id:'12345679',text:'B'}],hasMore:false,nextCursor:'0'});await f.run(f.now+61000);assert.equal(f.sent(),2);assert.equal(f.watch().cursor,'0');
});
test('own, hidden, nested and ambiguous comments skip; limit reserves only allowed replies',async t=>{
 const f=await setup(t);f.sqlite.prepare('UPDATE psychology_reply_watches SET max_replies=1').run();f.setPage({hasMore:false,nextCursor:'0',comments:[{id:'11111111',text:'A',owned:true},{id:'22222222',text:'B',hidden:true},{id:'33333333',text:'C',parentCommentId:'1'},{id:'44444444',text:'A or B'},{id:'55555555',text:'A'},{id:'66666666',text:'D'}]});await f.run();assert.equal(f.sent(),1);assert.equal(f.rows().filter(r=>r.status==='skipped').length,5);
});
test('pending sends are paced without scanning again before five minutes',async t=>{
 const f=await setup(t);f.setPage({hasMore:false,nextCursor:'0',comments:[{id:'12345678',text:'A'},{id:'12345679',text:'B'}]});await f.run();assert.equal(f.sent(),1);await f.run(f.now+61000);assert.equal(f.sent(),2);assert.equal(f.scans(),1);
});
test('pause, expiration and revoked permission prevent sending',async t=>{
 const f=await setup(t);f.sqlite.prepare("UPDATE psychology_reply_watches SET status='paused'").run();await f.run();assert.equal(f.sent(),0);
 f.sqlite.prepare("UPDATE psychology_reply_watches SET status='active'").run();await f.run(f.now,{assertAccess:async()=>{throw Object.assign(new Error('revoked'),{statusCode:403});}});assert.equal(f.watch().status,'paused');assert.equal(f.sent(),0);
 f.sqlite.prepare("UPDATE psychology_reply_watches SET status='active',end_at=?,next_scan_at=0").run(f.now-1);await f.run();assert.equal(f.watch().status,'completed');assert.equal(f.sent(),0);
});
test('lost response recovers by receipt lookup without another write',async t=>{
 const f=await setup(t);await f.run(f.now,{call:async(p,o)=>{const r=await f.call(p,o);if(o)throw new Error('lost');return r;}});assert.equal(f.rows()[0].status,'sending');await f.run(f.now+61000);assert.equal(f.sent(),1);assert.equal(f.rows()[0].status,'published');
});
test('uncertain hub receipt stops automatic retry and checks target identity',async t=>{
 const f=await setup(t);await f.run(f.now,{call:async(p,o)=>o?{comment:{...o.body,status:'needs_review'}}:f.call(p,o)});assert.equal(f.rows()[0].status,'needs_review');await f.run(f.now+400000);assert.equal(f.sent(),0);
});
test('queue dispatcher batches work and consumer handles only specified watch',async t=>{
 const f=await setup(t);const messages=[];f.env.REPLY_QUEUE={sendBatch:async b=>messages.push(...b)};await dispatchAutoReplies(f.env);await dispatchAutoReplies(f.env);assert.equal(messages.length,1);assert.equal(messages[0].body.watchId,'watch');
 let ack=0;await consumeAutoReplies({messages:[{body:{},ack(){ack++;}}]},f.env);assert.equal(ack,1);
});
test('records and actions require owner and permission',async t=>{
 const f=await setup(t);await f.run();
 const req=(suffix,method='GET',actor=user)=>{const url=new URL('https://factory.test/api/psychology-auto-replies'+suffix);return handlePsychologyAutoReplies(new Request(url,{method}),f.env,url,{user:actor});};
 const rows=await (await req('/watch/records')).json();assert.equal(rows.total,1);
 await assert.rejects(req('/watch/records','GET',{...user,username:'other'}),e=>e.statusCode===404);
 await assert.rejects(req('','GET',{...user,role:'operator'}),e=>e.statusCode===403);
 await req('/watch/pause','POST');assert.equal(f.watch().status,'paused');
});
test('topic reply options survive import and old-client edits',async t=>{
 const f=await setup(t);await writeIntegrationTopics(f.db,{template:'psychology-collage',title:'Question',content:'Script',replyOptions:answers},'admin');
 const row=f.sqlite.prepare('SELECT * FROM psychology_template_topics').get();assert.deepEqual(JSON.parse(row.reply_options_json),answers);
 const url=new URL('https://factory.test/api/psychology-template-topics/'+row.id);await handlePsychologyTopicBank(new Request(url,{method:'PATCH',body:JSON.stringify({revision:row.revision,title:'Edited'})}),f.env,url,{user});
 assert.deepEqual(JSON.parse(f.sqlite.prepare('SELECT * FROM psychology_template_topics').get().reply_options_json),answers);
});

test('create API validates video through hub, freezes answers and rejects duplicate enrollment',async t=>{
 const f=await setup(t);f.sqlite.prepare('DELETE FROM psychology_reply_watches').run();
 await writeIntegrationTopics(f.db,{template:'psychology-collage',title:'Enroll',content:'Script',replyOptions:answers},'admin');const topic=f.sqlite.prepare('SELECT id FROM psychology_template_topics').get();let validations=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(String(url).includes('/api/v1/accounts'))return Response.json({accounts:[{id:'a',username:'alpha',scopes:['video.publish','comment.list','comment.list.manage']}]});
  assert.ok(String(url).includes('/comments/scan?'));assert.ok(String(url).includes('validateOnly=1'));validations++;assert.equal(init.method,'GET');return Response.json({});
 });
 const url=new URL('https://factory.test/api/psychology-auto-replies'),body={connectionId:'a',videoId:video,topicId:topic.id,answers,startAt:Date.now()+120000,endAt:Date.now()+86400000,maxReplies:50};
 const create=b=>handlePsychologyAutoReplies(new Request(url,{method:'POST',body:JSON.stringify(b)}),f.env,url,{user});
 assert.equal((await create(body)).status,201);assert.equal(validations,1);assert.deepEqual(JSON.parse(f.sqlite.prepare('SELECT answers_json FROM psychology_reply_watches').get().answers_json),answers);
 await assert.rejects(create(body),e=>e.statusCode===409);
 await assert.rejects(create({...body,answers:{...answers,A:''}}),e=>e.statusCode===400);
});
test('account pace lock covers separate video watches and malformed pages do not advance cursor',async t=>{
 const f=await setup(t);f.add('watch2',{video_id:'88888888'});
 await f.run(f.now,{call:async(p,o)=>{if(p.includes('/scan?'))return {connectionId:'a',videoId:new URL('https://hub.test'+p).searchParams.get('videoId'),comments:[{id:'12345678',text:'A'}],hasMore:false,nextCursor:'0'};return f.call(p,o);}});
 assert.equal(f.sent(),1);
 f.sqlite.prepare("UPDATE psychology_reply_watches SET next_scan_at=0,last_scan_at=0,cursor='50' WHERE id='watch'").run();
 await f.run(f.now+61000,{watchId:'watch',call:async()=>({connectionId:'a',videoId:video,comments:[],hasMore:true,nextCursor:'50'})});assert.equal(f.watch().cursor,'50');assert.match(f.watch().error,/分页/);
});
