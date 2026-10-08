import {removePublishedVideo} from './psychology-video-cleanup.js';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {imageUrl} from './psychology-video-hit-contract.js';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
function run(command,args){const r=spawnSync(command,args,{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});if(r.error||r.status!==0)throw new Error(command+'失败：'+String(r.error?.message||r.stderr).slice(-1500));return r.stdout;}
export function timing(frames,audioDuration){
 if(!Number.isFinite(audioDuration)||audioDuration<=0||audioDuration>1800)throw new Error('配音时长须在0–1800秒之间。');
 const sum=frames.reduce((n,f)=>n+f.durationSeconds,0);let at=0;
 return frames.map((f,i)=>{const start=at;at=i===frames.length-1?audioDuration:at+audioDuration*f.durationSeconds/sum;return {...f,start,end:at,duration:at-start};});
}
function assTime(seconds){const n=Math.round(seconds*100);return Math.floor(n/360000)+':'+String(Math.floor(n/6000)%60).padStart(2,'0')+':'+String(Math.floor(n/100)%60).padStart(2,'0')+'.'+String(n%100).padStart(2,'0');}
function assText(text){
 const plain=String(text||'').replace(/\\/g,'＼').replace(/{/g,'｛').replace(/}/g,'｝');
 return plain.split(/\r?\n/).flatMap(line=>{const words=line.match(/[\u4e00-\u9fff]|[^\s\u4e00-\u9fff]+/g)||[];const lines=[];let current='';for(const word of words){if((current+' '+word).length>32&&current){lines.push(current);current='';}current+=(current?' ':'')+word;}if(current)lines.push(current);return lines;}).join('\\N');
}
export function subtitles(frames){
 return '[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Microsoft YaHei,56,&H00FFFFFF,&H00FFFFFF,&H00202020,&H90000000,1,0,0,0,100,100,0,0,1,3,1,2,80,80,180,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'+frames.filter(f=>f.text).map(f=>'Dialogue: 0,'+assTime(f.start)+','+assTime(f.end)+',Default,,0,0,0,,'+assText(f.text)).join('\n')+'\n';
}
export async function publicImageAddress(value){
 const url=new URL(imageUrl(value)),addresses=await lookup(url.hostname,{all:true});
 if(!addresses.length||addresses.some(({address})=>!isIP(address)||/^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|22[4-9]\.|23\d\.|24\d\.|25\d\.|::|fc|fd|fe[89ab])/i.test(address)||address.includes('::ffff:')))throw new Error('图片域名解析到非公开地址。');return url;
}
export async function downloadFrame({frame,jobId,settings,workerId,fetchImpl=fetch,validateAddress=publicImageAddress}){
 let url,headers={};
 if(frame.assetId){url=settings.url+'/api/worker/psychology-video-hits/'+encodeURIComponent(jobId)+'/assets/'+frame.assetId;headers={Authorization:'Bearer '+settings.token,'x-factory-worker':workerId};}
 else url=String(await validateAddress(frame.imageUrl));
 let response;
 for(let redirects=0;redirects<4;redirects++){
  response=await fetchImpl(url,{headers,redirect:'manual',signal:AbortSignal.timeout(60000)});
  if(response.status>=300&&response.status<400){if(frame.assetId)throw new Error('私有素材不能重定向。');url=String(await validateAddress(new URL(response.headers.get('location'),url).href));continue;}break;
 }
 if(!response?.ok)throw new Error('第'+frame.index+'帧下载失败：HTTP '+response?.status);
 if(!/^image\/(png|jpeg|webp)(;|$)/i.test(response.headers.get('content-type')||''))throw new Error('仅支持PNG、JPEG、WebP图片。');
 const reader=response.body.getReader(),parts=[];let size=0;
 try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>8*1024*1024)throw new Error('单帧图片超过8MB。');parts.push(r.value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}
 return Buffer.concat(parts);
}
export async function synthesizeRemix({snapshot,root,config,workDir,file,fetchImpl=fetch}){
 let saved={};try{saved=JSON.parse(fs.readFileSync(path.join(workDir,'psychology-video-settings.json'),'utf8'));}catch{}
 const key=process.env.ELEVENLABS_API_KEY||saved.elevenLabsApiKey||config.elevenLabsApiKey;
 if(!key)throw new Error('ElevenLabs API Key未配置。');
 const voice=snapshot.voiceGender==='male'?'Gubgw9l4dtIoQA9YZHgx':'vChnJZ1Cu89g2XXumPfT';
 const response=await fetchImpl('https://api.elevenlabs.io/v1/text-to-speech/'+voice,{method:'POST',headers:{'xi-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({text:snapshot.script,model_id:'eleven_multilingual_v2',voice_settings:{stability:0.45,similarity_boost:0.75}}),signal:AbortSignal.timeout(180000)});
 if(!response.ok)throw new Error('ElevenLabs配音失败：HTTP '+response.status);
 const bytes=Buffer.from(await response.arrayBuffer());if(!bytes.length||bytes.length>30*1024*1024)throw new Error('配音文件大小无效。');fs.writeFileSync(file,bytes);return file;
}
export async function renderVideoRemix({snapshot,jobId,root,config={},workDir,outputDir,settings,workerId,audioPath,fetchImpl=fetch,validateAddress=publicImageAddress,onProgress=()=>{},width=1080,height=1920}){
 if(!/^[a-zA-Z0-9_-]+$/.test(jobId)||!Array.isArray(snapshot.frames)||!snapshot.frames.length||snapshot.frames.length>300)throw new Error('视频分镜任务无效。');
 const base=path.resolve(workDir,'psychology-video-hits');fs.mkdirSync(base,{recursive:true});
 const dir=path.join(fs.realpathSync(base),jobId);fs.mkdirSync(dir,{recursive:true});
 if(fs.lstatSync(dir).isSymbolicLink()||fs.realpathSync(dir)!==dir)throw Error('分镜临时目录无效。');
 try{fs.mkdirSync(outputDir,{recursive:true});
 onProgress({percent:5,message:'正在准备二创配音…'});
 const audio=audioPath||await synthesizeRemix({snapshot,root,config,workDir,file:path.join(dir,'narration.mp3'),fetchImpl});
 const duration=Number(run('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',audio]).trim());
 const frames=timing(snapshot.frames,duration);
 for(const [i,f] of frames.entries()){
  const raw=path.join(dir,'download-'+i+'.img'),image=path.join(dir,'frame-'+String(i).padStart(3,'0')+'.png');
  fs.writeFileSync(raw,await downloadFrame({frame:f,jobId,settings,workerId,fetchImpl,validateAddress}));
  run('ffmpeg',['-y','-v','error','-i',raw,'-vf','scale='+width+':'+height+':force_original_aspect_ratio=decrease,pad='+width+':'+height+':(ow-iw)/2:(oh-ih)/2:color=black','-frames:v','1',image]);fs.unlinkSync(raw);
  onProgress({percent:10+Math.round((i+1)/frames.length*55),message:'已准备 '+(i+1)+'/'+frames.length+' 帧'});
 }
 const concat=frames.map((f,i)=>"file 'frame-"+String(i).padStart(3,'0')+".png'\nduration "+f.duration.toFixed(6)).join('\n')+"\nfile 'frame-"+String(frames.length-1).padStart(3,'0')+".png'\n";
 fs.writeFileSync(path.join(dir,'frames.txt'),concat);fs.writeFileSync(path.join(dir,'captions.ass'),subtitles(frames));
 const fileName=jobId+'.mp4',output=path.join(outputDir,fileName);
 onProgress({percent:75,message:'正在合成逐帧二创视频…'});
 // Relative subtitle path avoids Windows drive-letter escaping; all args are passed without a shell.
 const args=['-y','-v','error','-f','concat','-safe','1','-i','frames.txt','-i',audio,'-vf','fps=30,subtitles=captions.ass,format=yuv420p','-t',String(duration),'-c:v','libx264','-preset','fast','-crf','20','-c:a','aac','-b:a','192k','-movflags','+faststart',output];
 const r=spawnSync('ffmpeg',args,{cwd:dir,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});if(r.error||r.status!==0)throw new Error('视频合成失败：'+String(r.error?.message||r.stderr).slice(-1500));
 return {results:[{id:jobId,fileName,videoUrl:'/outputs/'+fileName,title:snapshot.title,narration:snapshot.script,duration,frameCount:frames.length,sourceId:snapshot.sourceId,version:snapshot.version,template:'psychology-video-remix'}]};
 }catch(error){try{removePublishedVideo(outputDir,jobId,jobId+'.mp4');}catch{}throw error;}finally{if(path.dirname(dir)===fs.realpathSync(base)&&!fs.lstatSync(dir).isSymbolicLink()&&fs.realpathSync(dir)===dir)fs.rmSync(dir,{recursive:true,force:true});}
}
