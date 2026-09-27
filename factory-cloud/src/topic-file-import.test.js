import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './psychology-cloud-test-fixture.js';
import {importTopicFile,importTopicBytes,chatFileUrl,topicFileInput} from './topic-file-import.js';
import {topicImageStatus} from './topic-image-operation.js';
const user={id:'admin',role:'admin',sidebarModules:['psychology-topic-bank']};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64');
const input=(extra={})=>({requestId:crypto.randomUUID(),title:'Why closeness feels scary',content:'A gentle reflection',image:{file_id:'file-chat-test',download_url:'https://files.oaiusercontent.com/test.png?sig=private-test'},...extra});
async function setup(t){
 const f=await fixture(t);f.sqlite.prepare('UPDATE factory_users SET sidebar_modules_json=?').run(JSON.stringify(user.sidebarModules));
 const objects=new Map(),calls=[];
 delete f.env.OPENAI_API_KEY;delete f.env.TOPIC_IMAGE_WORKFLOW;
 f.env.ARCHIVE={async head(k){return objects.get(k)||null;},async put(k,b,o){assert.deepEqual(o.onlyIf,{etagDoesNotMatch:'*'});if(objects.has(k))return null;const stored={size:b.length,body:b,customMetadata:o.customMetadata};objects.set(k,stored);return stored;}};
 f.env.fetch=async(url,init)=>{assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.headers,undefined);calls.push(url);return new Response(png,{headers:{'content-type':'image/png'}});};
 return {...f,objects,calls};
}
test('chat PNG imports without a key; signed URL is not stored, returning real topic ID and private asset',async t=>{
 const f=await setup(t),i=input();const out=await importTopicFile(f.env,user,i,'https://factory.test');
 assert.equal(out.status,'completed');assert.equal(out.topic.enabled,false);assert.equal(out.imageSource,'chatgpt-file');assert.equal(out.imageGeneration,undefined);assert.equal(out.asset.mimeType,'image/png');assert.match(out.asset.url,/^https:\/\/factory.test\/api\//);
 const row=f.sqlite.prepare('SELECT * FROM factory_ai_operations').get();assert.doesNotMatch(JSON.stringify(row),/private-test|download_url/);
 assert.equal(f.sqlite.prepare('SELECT source FROM factory_assets').get().source,'chatgpt-file');
 assert.equal((await importTopicFile(f.env,user,{...i,image:{...i.image,download_url:i.image.download_url+'-refreshed'}})).topic.id,out.topic.id);assert.equal(f.calls.length,1);assert.equal(f.requests.length,0);
});
test('single-image quiz has actual image bound to four choices and reveal comment',async t=>{
 const f=await setup(t),i=input({template:'psychology-target-2',choices:['A','B','C','D'].map(copy=>({copy})),revealComment:'The reveal'});
 const out=await importTopicFile(f.env,user,i);const row=f.sqlite.prepare('SELECT * FROM psychology_template_topics WHERE id=?').get(out.topic.id);assert.equal(row.cover_asset_id,out.asset.id);assert.match(row.content,/psychology-topics/);assert.equal(row.reveal_comment,'The reveal');
});
test('schema rejects missing files and invalid topics before download or creating a task',async t=>{
 const f=await setup(t);
 for(const i of [input({image:undefined}),input({template:'psychology-target-2'}),input({template:'psychology-collage',choices:['A','B','C','D'].map(copy=>({copy}))}),input({template:'psychology'}),input({title:''})])await assert.rejects(importTopicFile(f.env,user,i));
 assert.equal(f.calls.length,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_ai_operations').get().n,0);
 assert.ok(topicFileInput.safeParse(input()).success);
});
test('only HTTPS ChatGPT file hosts allowed; sandbox, lookalikes, credentials, IPs and redirects blocked',async t=>{
 const f=await setup(t);
 for(const url of ['sandbox:/mnt/data/a.png','https://127.0.0.1/a','http://files.oaiusercontent.com/a','https://oaiusercontent.com.evil.test/a','https://evil.test/oaiusercontent.com','https://user:pass@files.oaiusercontent.com/a','https://files.oaiusercontent.com:444/a','https://files.oaiusercontent.com/a#secret']){
  assert.throws(()=>chatFileUrl(url));await assert.rejects(importTopicFile(f.env,user,input({image:{file_id:'file-test',download_url:url}})));
 }
 assert.equal(f.calls.length,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_ai_operations').get().n,0);
 let requests=0;f.env.fetch=async()=>{requests++;return new Response(null,{status:302,headers:{location:'http://169.254.169.254/credentials'}});};
 await assert.rejects(importTopicFile(f.env,user,input()),e=>e.code==='FILE_HOST_NOT_ALLOWED');assert.equal(requests,1);assert.equal(f.objects.size,0);
});
test('expired URL can refresh on the same file ID and request without creating duplicates',async t=>{
 const f=await setup(t),i=input(),fetch=f.env.fetch;f.env.fetch=async()=>new Response('expired',{status:403});
 await assert.rejects(importTopicFile(f.env,user,i),e=>e.code==='FILE_HTTP_403');assert.equal(f.objects.size,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_template_topics').get().n,0);
 f.env.fetch=fetch;const result=await importTopicFile(f.env,user,{...i,image:{...i.image,download_url:'https://files.oaiusercontent.com/test.png?sig=new'}});assert.equal(result.status,'completed');assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_ai_operations').get().n,1);
});
test('bad/oversized/truncated images produce no assets or topics and never leak signed URL errors',async t=>{
 const f=await setup(t);
 for(const response of [new Response('<html>not image</html>'),new Response(png.subarray(0,33)),new Response(png,{headers:{'content-length':String(9*1024*1024)}}),new Response(new Uint8Array(8*1024*1024+1))]){
  f.env.fetch=async()=>response;await assert.rejects(importTopicFile(f.env,user,input()),e=>['INVALID_IMAGE','IMAGE_TOO_LARGE'].includes(e.code));
 }
 f.env.fetch=async()=>{throw new Error('https://files.oaiusercontent.com/a?secret=private');};await assert.rejects(importTopicFile(f.env,user,input()),e=>e.code==='FILE_DOWNLOAD_FAILED'&&!e.message.includes('private'));
 assert.equal(f.objects.size,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_template_topics').get().n,0);
});
test('R2 commit followed by lost acknowledgement recovers without downloading again',async t=>{
 const f=await setup(t),i=input(),put=f.env.ARCHIVE.put;f.env.ARCHIVE.put=async(...args)=>{await put(...args);throw Error('lost acknowledgement');};
 await assert.rejects(importTopicFile(f.env,user,i),e=>e.code==='FILE_IMPORT_RETRY');f.env.ARCHIVE.put=put;
 const out=await importTopicFile(f.env,user,i);assert.equal(out.status,'completed');assert.equal(f.calls.length,1);assert.equal(f.objects.size,1);
});
test('D1 import failure reuses saved bytes and asset with same request on retry',async t=>{
 const f=await setup(t),i=input(),batch=f.db.batch;f.db.batch=async()=>{throw Error('D1 temporary');};
 await assert.rejects(importTopicFile(f.env,user,i),e=>e.code==='FILE_IMPORT_RETRY');assert.equal(f.objects.size,1);
 f.db.batch=batch;const out=await importTopicFile(f.env,user,i);assert.equal(out.status,'completed');assert.equal(f.calls.length,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_template_topics').get().n,1);
});
test('request ID conflicts and owner boundaries protect stored topics',async t=>{
 const f=await setup(t),i=input();await importTopicFile(f.env,user,i);
 await assert.rejects(importTopicFile(f.env,user,{...i,title:'Different'}),e=>e.code==='REQUEST_ID_CONFLICT');
 await assert.rejects(importTopicFile(f.env,user,{...i,image:{...i.image,file_id:'different'}}),e=>e.code==='REQUEST_ID_CONFLICT');
 await assert.rejects(topicImageStatus(f.env,{...user,id:'other'},i.requestId),e=>e.statusCode===404);assert.equal(f.calls.length,1);
});
test('concurrent retries claim a single download and return one stored topic',async t=>{
 const f=await setup(t),i=input();await Promise.all([importTopicFile(f.env,user,i),importTopicFile(f.env,user,i)]);
 const out=await importTopicFile(f.env,user,i);assert.equal(out.status,'completed');assert.equal(f.calls.length,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_template_topics').get().n,1);
});
test('revoked permission before start or during download prevents writes',async t=>{
 const f=await setup(t),i=input();await assert.rejects(importTopicFile(f.env,{...user,role:'operator'},i),e=>e.statusCode===403);
 f.env.fetch=async()=>{f.sqlite.exec('UPDATE factory_users SET active=0');return new Response(png);};
 await assert.rejects(importTopicFile(f.env,user,i),e=>e.statusCode===403);assert.equal(f.objects.size,0);
 await assert.rejects(importTopicFile(f.env,user,i),e=>e.statusCode===403);
});
test('interrupted receiving task can be resumed after bounded lease expires',async t=>{
 const f=await setup(t),i=input();f.env.fetch=async()=>new Response(null,{status:403});await assert.rejects(importTopicFile(f.env,user,i));
 f.sqlite.prepare("UPDATE factory_ai_operations SET status='receiving',updated_at=?").run(Date.now()-190000);
 f.env.fetch=async()=>new Response(png);assert.equal((await importTopicFile(f.env,user,i)).status,'completed');
});


test('reported ChatGPT Blob host imports and retries without storing signed URLs',async t=>{
 const f=await setup(t),url='https://oaisdmntprwestus.blob.core.windows.net/image/test.png?sig=private-blob',i=input({image:{file_id:'file-blob',download_url:url}});
 const result=await importTopicFile(f.env,user,i);assert.equal(result.status,'completed');assert.equal(result.topic.enabled,false);assert.equal(f.calls[0],url);
 const replay=await importTopicFile(f.env,user,{...i,image:{...i.image,download_url:url+'-renewed'}});assert.equal(replay.topic.id,result.topic.id);assert.equal(f.calls.length,1);
 assert.doesNotMatch(JSON.stringify(f.sqlite.prepare('SELECT * FROM factory_ai_operations').get()),/private-blob|download_url/);assert.equal(f.requests.length,0);
});

test('Blob compatibility pattern is bounded and every redirect remains checked',async t=>{
 const host='oaisdmntprwestus.blob.core.windows.net';
 assert.equal(chatFileUrl('https://'+host.toUpperCase()+'/image.png'),'https://'+host+'/image.png');
 for(const region of ['westus3','eastus2','northeurope'])assert.equal(new URL(chatFileUrl('https://oaisdmntpr'+region+'.blob.core.windows.net/x')).hostname,'oaisdmntpr'+region+'.blob.core.windows.net');
 for(const url of ['http://'+host+'/x','https://'+host+':444/x','https://user:pass@'+host+'/x','https://'+host+'/x#fragment','https://'+host+'.evil.test/x','https://child.'+host+'/x','https://oaisdmntpr.blob.core.windows.net/x','https://oaisdmntpr-westus.blob.core.windows.net/x','https://oaisdmntprabcdefghijklmnop.blob.core.windows.net/x','https://unrelated.blob.core.windows.net/x','blob:https://'+host+'/id'])assert.throws(()=>chatFileUrl(url),e=>e.code==='FILE_HOST_NOT_ALLOWED');
 const f=await setup(t),i=input();let urls=[];
 f.env.fetch=async(url,init)=>{urls.push(url);assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.equal(init.headers,undefined);return urls.length===1?new Response(null,{status:302,headers:{location:'https://'+host+'/image.png?sig=private-redirect'}}):new Response(png);};
 assert.equal((await importTopicFile(f.env,user,i)).status,'completed');assert.equal(urls.length,2);
 // An allowed Blob URL cannot redirect into another tenant or a private address.
 for(const location of ['https://unrelated.blob.core.windows.net/x','http://169.254.169.254/x']){
  let calls=0;f.env.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{location}});};
  await assert.rejects(importTopicFile(f.env,user,input({image:{file_id:'file-blocked',download_url:'https://'+host+'/x'}})),e=>e.code==='FILE_HOST_NOT_ALLOWED');assert.equal(calls,1);
 }
});


test('actual PNG bytes import without any remote fetch and recover identically',async t=>{
 const f=await setup(t),{image,...draft}=input(),args={...draft,imageBase64:png.toString('base64')};
 f.env.fetch=async()=>{throw Error('bytes path must never download');};
 const result=await importTopicBytes(f.env,user,args);assert.equal(result.status,'completed');assert.equal(result.imageSource,'client-png');assert.equal(result.topic.enabled,false);
 assert.equal((await importTopicBytes(f.env,user,args)).topic.id,result.topic.id);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_template_topics').get().n,1);
 assert.doesNotMatch(JSON.stringify(f.sqlite.prepare('SELECT * FROM factory_ai_operations').get()),/imageBase64|download_url/);assert.equal(f.calls.length,0);
 await assert.rejects(importTopicBytes(f.env,user,{...args,title:'changed'}),e=>e.code==='REQUEST_ID_CONFLICT');
 await assert.rejects(importTopicBytes(f.env,{...user,role:'operator'},args),e=>e.statusCode===403);
});

test('byte upload refuses malformed or oversized inputs before writing anything',async t=>{
 const f=await setup(t),{image,...draft}=input();
 for(const imageBase64 of ['YQ==','data:image/png;base64,YQ==','!!!!','', 'A'.repeat(4*Math.ceil(8*1024*1024/3)+4)])await assert.rejects(importTopicBytes(f.env,user,{...draft,imageBase64}));
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM factory_ai_operations').get().n,0);assert.equal(f.objects.size,0);
});


test('PNG bytes are decoded with CRC, filters, palette and bounded decompression checks',async()=>{
 const {decodeTopicPng,pngCrc}=await import('./topic-png.js'),{deflateSync}=await import('node:zlib');
 const chunk=(type,data)=>{const t=Buffer.from(type),n=Buffer.alloc(4),crc=Buffer.alloc(4);n.writeUInt32BE(data.length);crc.writeUInt32BE(pngCrc(Buffer.concat([t,data])));return Buffer.concat([n,t,data,crc]);};
 const make=({w=1,h=1,depth=8,type=6,raw=Buffer.from([0,1,2,3,255]),compressed,interlace=0,extra=[],split=false}={})=>{
  const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=depth;header[9]=type;header[12]=interlace;
  const data=compressed||deflateSync(raw),parts=split?[chunk('IDAT',data.subarray(0,3)),chunk('IDAT',data.subarray(3))]:[chunk('IDAT',data)];
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...extra,...parts,chunk('IEND',Buffer.alloc(0))]);
 };
 for(const filter of [0,1,2,3,4])assert.equal((await decodeTopicPng(make({raw:Buffer.from([filter,0,0,0,255]),split:true}))).width,1);
 assert.equal((await decodeTopicPng(make({interlace:1}))).height,1);
 assert.equal((await decodeTopicPng(make({type:0,depth:16,raw:Buffer.from([0,255,255])}))).width,1);
 const badCrc=Buffer.from(png);badCrc[52]^=1;
 for(const bytes of [badCrc,make({w:4097}),make({raw:Buffer.from([5,0,0,0,0])}),make({raw:Buffer.alloc(200000)}),make({raw:Buffer.from([0])}),make({compressed:Buffer.from('bad-deflate')}),make({type:3,raw:Buffer.from([0,0])}),make({type:3,raw:Buffer.from([0,1]),extra:[chunk('PLTE',Buffer.from([255,0,0]))]}),make({extra:[chunk('ABCD',Buffer.alloc(0))]}),make({extra:[chunk('acTL',Buffer.alloc(8))]})])await assert.rejects(decodeTopicPng(bytes),e=>e.code==='INVALID_IMAGE');
 assert.equal((await decodeTopicPng(make({type:3,raw:Buffer.from([0,0]),extra:[chunk('PLTE',Buffer.from([255,0,0]))]}))).width,1);
});

test('byte upload resumes stored content after an import failure without another download',async t=>{
 const f=await setup(t),{image,...draft}=input(),args={...draft,imageBase64:png.toString('base64')},batch=f.db.batch;
 f.db.batch=async()=>{throw Error('transient database error');};
 await assert.rejects(importTopicBytes(f.env,user,args),e=>e.code==='FILE_IMPORT_RETRY');assert.equal(f.objects.size,1);
 f.db.batch=batch;assert.equal((await importTopicBytes(f.env,user,args)).status,'completed');assert.equal(f.calls.length,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM psychology_template_topics').get().n,1);
});
