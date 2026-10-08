// Scoped renderer for an already-running factory; no hello, restart, or old planning.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadSettings} from './factory-cloud-worker.js';
import {readConfig} from './video-core.js';
import {resolveStorageDirs} from './storage-paths.js';
import {renderVideoRemix} from './psychology-video-remix.js';
const root=path.resolve(process.argv[2]||path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
const config=readConfig(root),storage=resolveStorageDirs(root,config),settings=loadSettings(storage.workDir),workerId=settings.workerId;
if(!settings.url||!settings.token||!workerId)throw new Error('需要已配置的工人身份。');
async function call(endpoint,body){
 const r=await fetch(settings.url+endpoint,{method:'POST',headers:{Authorization:'Bearer '+settings.token,'x-factory-worker':workerId,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 const data=await r.json();if(!r.ok)throw new Error(data.error||'队列读取失败');return data;
}
console.log('Video remix renderer ready; only explicit psychology-video-remix tasks are claimed.');
while(true){
 try{
  const data=await call('/api/worker/claim',{workerId,types:['psychology-video-remix'],psychologyVideoRemix:true,psychologyBatchUpload:true});const job=data.job;
  if(job){
   const id=job.id||job.jobId;let completion;
   try{const result=await renderVideoRemix({snapshot:job.payload.videoRemix,jobId:id,root,config,...storage,settings,workerId});completion={result:{...result,...(job.payload.psychologyAutomation?{publishPending:true}:{})},percent:100,message:'二创视频合成完成'};}
   catch(error){completion={error:String(error.message).slice(0,1000),percent:100};}
   // Retry only the same completion; never claim another task until this outcome is acknowledged.
   let acknowledged=false;while(!acknowledged){try{await call('/api/worker/jobs/'+encodeURIComponent(id)+'/complete',completion);acknowledged=true;break;}catch(e){console.error('Completion retry',id,e.message);await new Promise(r=>setTimeout(r,5000));}}
  }
 }catch(error){console.error(new Date().toISOString(),String(error.message).slice(0,300));}
 await new Promise(resolve=>setTimeout(resolve,5000));
}
