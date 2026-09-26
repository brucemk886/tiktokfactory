import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAutoPhotoJob } from './psychology-auto-photo-job.js';
const chrome=process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

test('photo worker resumes completed uploads, renders remaining JPEG and submits once', {skip:!fs.existsSync(chrome)}, async t=>{
  const workDir=fs.mkdtempSync(path.join(os.tmpdir(),'psychology-auto-test-'));
  t.after(()=>fs.rmSync(workDir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(workDir,'factory-cloud-worker.json'),JSON.stringify({url:'https://worker.test',token:'fake-token'}));
  const previous={url:process.env.FACTORY_CLOUD_URL,token:process.env.FACTORY_WORKER_TOKEN};
  process.env.FACTORY_CLOUD_URL='https://worker.test';process.env.FACTORY_WORKER_TOKEN='fake-token';
  t.after(()=>{for(const [name,value] of [['FACTORY_CLOUD_URL',previous.url],['FACTORY_WORKER_TOKEN',previous.token]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}});
  const calls=[],patches=[];
  t.mock.method(globalThis,'fetch',async(url,options={})=>{
    assert.ok(String(url).startsWith('https://worker.test/'),'no real provider calls');
    calls.push({url:String(url),options});
    if(String(url).includes('/api/worker/jobs/'))return Response.json({job:{workerId:'worker-1'}});
    assert.equal(options.headers['x-factory-worker'],'worker-1');
    if(String(url).endsWith('/state'))return Response.json({assets:{0:{assetKey:'already-uploaded'}},receipt:{}});
    if(String(url).endsWith('/upload')){
      const body=JSON.parse(options.body);assert.equal(body.index,1);assert.match(body.dataUrl,/^data:image\/jpeg;base64,/);
      const bytes=Buffer.from(body.dataUrl.split(',')[1],'base64');assert.equal(bytes[0],255);assert.equal(bytes[1],216);assert.ok(bytes.length>10000);
      return Response.json({assetKey:'second-image'});
    }
    if(String(url).endsWith('/publish'))return Response.json({batchId:'batch-1'});
    throw new Error('Unexpected network request');
  });
  await runAutoPhotoJob({root:fileURLToPath(new URL("../",import.meta.url)),workDir,payload:{jobId:'photo-job',psychologyAutomation:{template:'photo-text',styleId:'style-'+ 'a'.repeat(32),styleDefinition:{id:'style-'+ 'a'.repeat(32),layout:'center',coverBg:'#123456',coverInk:'#ffffff',bg:'#ffffff',ink:'#123456',accent:'#789abc',revision:1}},
    pages:[{template:'cover',title:'Pause before replying'},{template:'content',title:'Notice your needs',body:'You can take your time.\nYou can ask for space.'}]},
    patchJob:patch=>patches.push(patch)});
  assert.equal(calls.filter(c=>c.url.endsWith('/upload')).length,1);
  assert.equal(calls.filter(c=>c.url.endsWith('/publish')).length,1);
  assert.equal(patches.at(-1).status,'done');assert.equal(patches.at(-1).publishSummary.batchId,'batch-1');
});

import { publishErrorMessage } from './publish-error-message.js';
test('publication diagnostics include HTTP and nested network codes without leaking credentials',()=>{
 const error=Object.assign(new Error('fetch failed'),{cause:Object.assign(new Error('socket closed'),{code:'ECONNRESET'})});
 assert.match(publishErrorMessage(error,'图片上传'),/图片上传失败（ECONNRESET）/);
 assert.match(publishErrorMessage(Object.assign(new Error('rejected'),{statusCode:400}),'提交中台'),/HTTP 400/);
 assert.doesNotMatch(publishErrorMessage(new Error('Bearer fake-secret https://test/?token=other-secret')),/fake-secret|other-secret/);
});
