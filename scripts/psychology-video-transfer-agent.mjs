// Sidecar for already-running workers: handles only explicit preview/selected-video jobs.
// No hello/requeue, rendering, planning, or other publication types are claimed.
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadSettings} from './factory-cloud-worker.js';
import {readConfig} from './video-core.js';
import {resolveStorageDirs} from './storage-paths.js';
import {transferPsychologyVideo} from './psychology-video-transfer.js';
const root=path.resolve(process.argv[2]||path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
const settings=loadSettings(resolveStorageDirs(root,readConfig(root)).workDir),workerId=settings.workerId;
if(!settings.url||!settings.token||!workerId)throw new Error('需要已配置的工人身份。');
async function call(endpoint,body){const response=await fetch(settings.url+endpoint,{method:'POST',headers:{Authorization:'Bearer '+settings.token,'x-factory-worker':workerId,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'队列读取失败');return data;}
console.log('Video transfer sidecar ready; only explicit preview/selected-video work is enabled.');
while(true){
 try{
  const data=await call('/api/worker/claim',{workerId,types:['psychology-video-archive','psychology-selected-video'],psychologyVideoTransfer:true,psychologyBatchUpload:true,psychologyPublishRetry:true});
  if(data.job){const job=data.job,id=job.id||job.jobId;let completion;
   try{const result=await transferPsychologyVideo({job,root,settings,workerId});completion={result,percent:100,message:job.type==='psychology-video-archive'?'云端预览已准备好':'视频已上传，等待发布回执'};}
   catch(error){completion={error:String(error.message).slice(0,500),percent:0};}
   await call('/api/worker/jobs/'+encodeURIComponent(id)+'/complete',completion);
  }
 }catch(error){console.error(new Date().toISOString(),String(error.message).slice(0,300));}
 await new Promise(resolve=>setTimeout(resolve,5000));
}
