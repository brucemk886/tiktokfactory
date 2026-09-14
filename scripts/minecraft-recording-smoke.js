import { resolveStoredOutput } from "./output-storage.js";
// Isolated, opt-in per-video smoke: synthetic footage replaces the actual game.
// Exercises real spool communication, final mux, item skip and system-failure stop.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(process.env.MINECRAFT_SMOKE_ROOT || path.join(root,'artifacts'),`minecraft-sequential-smoke-${Date.now()}`),workDir=path.join(dir,'work');
fs.mkdirSync(path.join(workDir,'caption-cache'),{recursive:true});
const json=(file,data)=>fs.writeFileSync(file,JSON.stringify(data,null,2));
function run(command,args){const p=spawnSync(command,args,{windowsHide:true,encoding:'utf8',maxBuffer:5e6});if(p.status!==0)throw new Error(`${command}: ${p.stderr||p.error}`);return p.stdout;}
const fixture=path.join(dir,'fixture.mp4'),audio=path.join(dir,'fixture.wav');
run('ffmpeg',['-y','-v','error','-f','lavfi','-i','testsrc2=size=540x960:rate=30','-t','17','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',fixture]);
run('ffmpeg',['-y','-v','error','-f','lavfi','-i','sine=frequency=220:sample_rate=44100','-t','12',audio]);
const words=['I','found','the','hidden','letter.','She','never','told','me','the','whole','story.'].map((text,i)=>({text,start:i,end:i+0.8}));
const hash=crypto.createHash('sha256').update('reddit-mix-caption-cache-v1').update('\0').update('scribe_v2').update('\0').update(fs.readFileSync(audio)).digest('hex');
json(path.join(workDir,'caption-cache',`${hash}.json`),{text:words.map(w=>w.text).join(' '),words,cues:words});
json(path.join(dir,'config.json'),{width:1080,height:1920,fps:30,workDir,outputDir:path.join(dir,'outputs'),novelOutputDailyFolders:true,novelRenderWorkDir:path.join(dir,'render-temp'),minecraftSimulator:{autoStart:false}});
const payload=path.join(dir,'payload.json'),job=path.join(dir,'job.json');
const settings={taskId:'isolated-per-video',jobId:'isolated-per-video',videoTemplate:'parkour',parkourSource:'simulator',totalVideos:3,autoCaptions:true,ttsReadback:false,subtitleAnimationMode:'word-pop',openingTitleEnabled:true,endCardEnabled:true,audioItems:[{path:audio,id:'fixture-audio',novelId:'fixture-novel',scriptId:'fixture-script',platform:'NovelMaster',promotionCode:'TEST123',openingTitle:'I found the hidden letter.'}]};
json(payload,settings);json(job,{status:'queued'});
const {createFactoryBridge}=createRequire(import.meta.url)(path.join(process.env.MINECRAFT_ROOT||path.resolve(root,'../minecraft'),'electron/factory-recording-bridge.cjs'));
const bridge=createFactoryBridge(path.join(workDir,'minecraft-recording'));bridge.heartbeat();
let requestCount=0,mode='item-failure',systemRequests=0,timerError=null;
const timer=setInterval(()=>{try{
 const request=bridge.next();if(!request)return;
 if(mode==='system-failure'){systemRequests++;bridge.report({id:request.id,status:'failed',fatal:true,error:'未检测到正在运行的 Minecraft（测试）'});return;}
 requestCount++;
 const finished=JSON.parse(fs.readFileSync(job,'utf8')).results?.length || 0;
 assert.equal(finished,Math.max(0,requestCount-2),'Previous video must finish before recording the next one');
 if(requestCount===1){bridge.report({id:request.id,status:'failed',error:'连续三次画面质检失败（测试）'});return;}
 const filePath=path.join(dir,`fresh-${requestCount}.mp4`);fs.copyFileSync(fixture,filePath);
 bridge.report({id:request.id,status:'done',clips:[{id:`fresh-${requestCount}`,filePath,duration:17,accepted:true}]});
}catch(error){timerError=error;}},20);
async function generate(){
 const child=spawn(process.execPath,[path.join(root,'scripts/reddit-mix-job.js'),payload,job],{cwd:dir,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 const kill=setTimeout(()=>child.kill(),120000);
 try{const code=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);});if(timerError)throw timerError;return {code,logs,result:JSON.parse(fs.readFileSync(job))};}
 finally{clearTimeout(kill);}
}
try{
 const {code,logs,result}=await generate();assert.equal(code,0,`${result.message}\n${logs}`);assert.equal(result.status,'done');assert.equal(result.results.length,3);assert.equal(result.failedVideoCount,1);assert.equal(requestCount,4);
 const seen=new Set();
 for(const video of result.results){
  assert.equal(video.parkourSource,'simulator');assert.equal(video.novelPromotionCode,'TEST123');assert.equal(video.scriptId,'fixture-script');assert.equal(video.clips.length,1);assert.equal(video.clips[0].start,0);assert.equal(video.clips[0].duration,12);assert.ok(!seen.has(video.clips[0].assetId));seen.add(video.clips[0].assetId);
  const output=resolveStoredOutput(path.join(dir,'outputs'),video.fileName);const probe=JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output]));assert.match(path.basename(path.dirname(output)),/^\d{4}-\d{2}-\d{2}$/);assert.ok(probe.streams.some(s=>s.codec_type==='audio'));assert.ok(Math.abs(Number(probe.format.duration)-12)<0.2);run('ffmpeg',['-v','error','-i',output,'-f','null','-']);
 }
 const output=resolveStoredOutput(path.join(dir,'outputs'),result.results[0].fileName);
 for(const t of [1,6,10])run('ffmpeg',['-y','-v','error','-ss',String(t),'-i',output,'-frames:v','1','-vf','scale=540:960',path.join(dir,`frame-${t}.png`)]);
 mode='system-failure';json(payload,{...settings,taskId:'isolated-system-failure',jobId:'isolated-system-failure'});json(job,{status:'queued'});
 const failed=await generate();assert.equal(failed.code,1);assert.equal(failed.result.status,'failed');assert.equal(systemRequests,1);assert.match(failed.result.message,/未检测到/);
 json(path.join(dir,'verification.json'),{fixtureOnly:true,sequential:true,requestCount,skippedItems:1,systemRequests,systemStopped:true,videos:result.results,output,decoded:true});
 console.log(JSON.stringify({fixtureOnly:true,sequential:true,requestCount,skippedItems:1,systemStopped:true,output,report:path.join(dir,'verification.json')},null,2));
}finally{clearInterval(timer);bridge.close();}
