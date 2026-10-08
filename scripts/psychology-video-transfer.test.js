import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {transferPsychologyVideo} from './psychology-video-transfer.js';
test('preview worker reads only a named output file; selected publication sends no local file',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'psy-transfer-'));t.after(()=>{if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('psy-transfer-'))throw new Error('Bad temp root');fs.rmSync(root,{recursive:true,force:true});});
 fs.writeFileSync(path.join(root,'config.json'),'{}');fs.mkdirSync(path.join(root,'outputs'));fs.writeFileSync(path.join(root,'outputs','sample.mp4'),'sample');
 const calls=[],settings={url:'https://factory.test',token:'fake'};const fetchImpl=async(url,init)=>{calls.push({url,method:init.method,body:await new Response(init.body).text()});return Response.json({ready:true});};
 await transferPsychologyVideo({root,settings,workerId:'w',job:{id:'archive',type:'psychology-video-archive',payload:{fileName:'sample.mp4'}},fetchImpl});assert.deepEqual(calls.map(x=>[x.method,x.body]),[['PUT','sample']]);
 await transferPsychologyVideo({root,settings,workerId:'w',job:{id:'publish',type:'psychology-selected-video',payload:{}},fetchImpl});assert.equal(calls[1].method,'POST');assert.equal(calls[1].body,'{}');
 await assert.rejects(transferPsychologyVideo({root,settings,workerId:'w',job:{id:'bad',type:'psychology-video-archive',payload:{fileName:'../sample.mp4'}},fetchImpl}),/文件名/);assert.equal(calls.length,2);
});
