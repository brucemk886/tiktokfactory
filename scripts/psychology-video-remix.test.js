import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {renderVideoRemix,timing,subtitles,downloadFrame} from './psychology-video-remix.js';
import {imageUrl,framesInput} from './psychology-video-hit-contract.js';
test('timing follows relative frame durations, escapes ASS directives, rejects unsafe image hosts',()=>{
 const frames=timing([{index:1,durationSeconds:1,text:'{\\pos(0,0)} literal'},{index:2,durationSeconds:3}],8);assert.equal(frames[0].end,2);assert.equal(frames[1].end,8);
 assert.doesNotMatch(subtitles(frames),/{\\pos/);
 for(const url of ['http://images.pexels.com/a.png','https://127.0.0.1/a.png','https://localhost/a.png','https://user:password@images.pexels.com/a.png','https://[::1]/a.png'])assert.throws(()=>imageUrl(url));
 assert.throws(()=>framesInput({frames:[{index:1,imageUrl:'https://images.pexels.com/a.png',assetId:crypto.randomUUID()}]}),/之一/);
});
test('private downloads only use the job endpoint and never forward bearer tokens on redirects',async()=>{
 let observed;
 const bytes=await downloadFrame({frame:{index:1,assetId:crypto.randomUUID()},jobId:'job',settings:{url:'https://factory.example.com',token:'synthetic'},workerId:'w',fetchImpl:async(url,options)=>{observed={url,options};return new Response('image',{headers:{'Content-Type':'image/png'}});}});
 assert.equal(bytes.length,5);assert.match(observed.url,/\/api\/worker\/psychology-video-hits\/job\/assets\//);assert.equal(observed.options.headers['x-factory-worker'],'w');
 await assert.rejects(downloadFrame({frame:{index:1,assetId:crypto.randomUUID()},jobId:'job',settings:{url:'https://factory.example.com',token:'synthetic'},workerId:'w',fetchImpl:async()=>new Response(null,{status:302,headers:{Location:'https://evil.com'}})}),/不能重定向/);
});
test('actual FFmpeg composition preserves two ordered images, audio, dimensions, subtitles and duration',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'video-remix-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const run=(args)=>{const r=spawnSync('ffmpeg',args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);};
 const images=[];
 for(const color of ['red','blue']){const file=path.join(dir,color+'.png');run(['-y','-v','error','-f','lavfi','-i','color=c='+color+':s=128x200','-frames:v','1',file]);images.push(fs.readFileSync(file));}
 const audio=path.join(dir,'audio.wav');run(['-y','-v','error','-f','lavfi','-i','sine=frequency=440:duration=2','-c:a','pcm_s16le',audio]);
 let fetches=0;
 const result=await renderVideoRemix({snapshot:{sourceId:'source',version:1,title:'Synthetic',script:'Synthetic narration',frames:[{index:1,imageUrl:'https://images.pexels.com/red.png',durationSeconds:1,text:'First frame'},{index:2,imageUrl:'https://images.pexels.com/blue.png',durationSeconds:1,text:'Second frame'}]},jobId:'remix-test',root:dir,workDir:path.join(dir,'work'),outputDir:path.join(dir,'outputs'),audioPath:audio,width:270,height:480,validateAddress:async x=>x,fetchImpl:async()=>new Response(images[fetches++],{headers:{'Content-Type':'image/png'}})});
 const file=path.join(dir,'outputs',result.results[0].fileName);assert.equal(result.results[0].outputPath,fs.realpathSync(file));const probe=spawnSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8',windowsHide:true}),info=JSON.parse(probe.stdout);
 assert.equal(info.streams[0].width,270);assert.equal(info.streams[0].height,480);assert.ok(info.streams.some(s=>s.codec_type==='audio'));assert.ok(Math.abs(Number(info.format.duration)-2)<0.1);assert.equal(fetches,2);assert.equal(fs.existsSync(path.join(dir,'work','psychology-video-hits','remix-test')),false);assert.ok(fs.existsSync(audio),'external audio must survive temporary cleanup');
 for(const [at,color] of [[0.3,'red'],[1.5,'blue']]){const r=spawnSync('ffmpeg',['-v','error','-ss',String(at),'-i',file,'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true});assert.equal(r.status,0);const b=r.stdout;assert.ok(color==='red'?b[0]>b[2]*2:b[2]>b[0]*2);}
});
