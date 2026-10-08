import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {removePublishedVideo,cleanPublishedVideo} from './psychology-video-cleanup.js';
function folder(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'video-cleanup-test-'));t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});return dir;}
test('local cleanup deletes only the exact renderer MP4; retries missing files and rejects path injection',t=>{
 const dir=folder(t),output=path.join(dir,'outputs');fs.mkdirSync(output);fs.writeFileSync(path.join(output,'render.mp4'),'target');fs.writeFileSync(path.join(output,'other.mp4'),'keep');fs.writeFileSync(path.join(dir,'input.mp4'),'external');
 assert.deepEqual(removePublishedVideo(output,'render','render.mp4'),{missing:false});assert.deepEqual(removePublishedVideo(output,'render','render.mp4'),{missing:true});assert.ok(fs.existsSync(path.join(output,'other.mp4'))&&fs.existsSync(path.join(dir,'input.mp4')));
 for(const [id,file] of [['..','../input.mp4'],['render','../input.mp4'],['render','other.mp4'],['../input','../input.mp4']])assert.throws(()=>removePublishedVideo(output,id,file),/文件名/);
 fs.mkdirSync(path.join(output,'folder.mp4'));assert.throws(()=>removePublishedVideo(output,'folder','folder.mp4'),/非普通/);
});
test('server-confirmed identity is required before deletion and acknowledgment supports interrupted retries',async t=>{
 const dir=folder(t);fs.writeFileSync(path.join(dir,'render.mp4'),'target');let calls=[],attempt=0;
 const options={root:dir,outputDir:dir,settings:{url:'https://factory.test',token:'synthetic'},workerId:'w',job:{id:'cleanup'},fetchImpl:async(url,init)=>{calls.push(url);assert.equal(init.headers['x-factory-worker'],'w');if(url.endsWith('/done')&&attempt++===0)return Response.json({error:'ack lost'},{status:503});return Response.json({renderJobId:'render',fileName:'render.mp4',cleanedAt:0});}};
 await assert.rejects(cleanPublishedVideo(options),/ack lost/);assert.equal(fs.existsSync(path.join(dir,'render.mp4')),false);await cleanPublishedVideo(options);assert.equal(calls.length,4);
 fs.writeFileSync(path.join(dir,'render.mp4'),'must keep');await assert.rejects(cleanPublishedVideo({...options,fetchImpl:async()=>Response.json({error:'not authorized'},{status:403})}),/not authorized/);assert.equal(fs.existsSync(path.join(dir,'render.mp4')),true);
});

test('Windows junction to a directory is refused without deleting the target',t=>{
 const dir=folder(t),output=path.join(dir,'outputs'),outside=path.join(dir,'source');fs.mkdirSync(output);fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'keep.txt'),'keep');fs.symlinkSync(outside,path.join(output,'linked.mp4'),'junction');assert.throws(()=>removePublishedVideo(output,'linked','linked.mp4'),/链接|非普通/);assert.ok(fs.existsSync(path.join(outside,'keep.txt')));
});
