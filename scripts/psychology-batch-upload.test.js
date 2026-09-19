import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runGroupedVideoUpload,uploadPsychologyVideoAsset} from './psychology-batch-upload.js';

test('video uploads survive lost readiness response and never create individual remote batches',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'psy-group-upload-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const job={id:'test-job',payload:{videos:[{fileName:'test.mp4'}]}};
  let uploads=0,posts=0;
  const asset={assetKey:'temporary--'+crypto.randomUUID()+'.mp4',fileSize:100,contentType:'video/mp4'};
  const options={job,workDir:dir,uploadAsset:async()=>{uploads++;return asset;},call:async(url,body)=>{
    assert.match(url,/^\/api\/worker\/psychology-video\/test-job\/(state|ready)$/);
    if(url.endsWith('/state'))return {ready:false,receipt:{}};
    assert.deepEqual(body.asset,asset);posts++;if(posts===1)throw new Error('lost reply');
    return {waiting:true,groupId:'group-1'};
  }};
  await assert.rejects(runGroupedVideoUpload(options),/lost reply/);
  assert.equal((await runGroupedVideoUpload(options)).waiting,true);
  assert.equal(uploads,1);assert.equal(posts,2);
  const receipt=await runGroupedVideoUpload({...options,call:async()=>({receipt:{batchId:'accepted'}})});
  assert.equal(receipt.batchId,'accepted');assert.equal(uploads,1);
  await runGroupedVideoUpload({...options,call:async(url,body)=>url.endsWith('/state')?{ready:true}:({waiting:body && Object.keys(body).length===0})});
  assert.equal(uploads,1);
});
test('video asset upload stays within the local output directory',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'psy-group-files-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'test.mp4'),'test');
  let calls=0;
  const upload=async input=>{calls++;assert.equal(input.contentType,'video/mp4');assert.equal(input.filePath,path.join(dir,'test.mp4'));return {assetKey:'asset'};};
  assert.equal((await uploadPsychologyVideoAsset({video:{fileName:'test.mp4'},outputDir:dir,upload})).assetKey,'asset');
  for(const fileName of ['../secret.mp4','test.txt','missing.mp4'])await assert.rejects(uploadPsychologyVideoAsset({video:{fileName},outputDir:dir,upload}));
  assert.equal(calls,1);
});
