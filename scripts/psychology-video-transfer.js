import fs from 'node:fs';
import path from 'node:path';
import {resolveStorageDirs} from './storage-paths.js';
import {readConfig} from './video-core.js';
export async function transferPsychologyVideo({job,root,settings,workerId,fetchImpl=fetch}){
 const id=job.id||job.jobId,payload=job.payload||{},headers={Authorization:'Bearer '+settings.token,'x-factory-worker':workerId};
 let method='POST',body='{}';headers['Content-Type']='application/json';
 if(job.type==='psychology-video-archive'){
  const name=String(payload.fileName||'');if(!name||path.basename(name)!==name||!(/\.(mp4|mov|webm)$/i).test(name))throw new Error('视频文件名无效。');
  const dir=fs.realpathSync(resolveStorageDirs(root,readConfig(root)).outputDir),file=fs.realpathSync(path.join(dir,name)),relative=path.relative(dir,file);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('视频不在工厂输出目录。');
  const size=fs.statSync(file).size;if(!size||size>95*1048576)throw new Error('仅支持95MB以内的成片。');
  method='PUT';body=fs.createReadStream(file);headers['Content-Type']='application/octet-stream';headers['X-File-Size']=String(size);headers['Content-Length']=String(size);
 }else if(job.type!=='psychology-selected-video')throw new Error('不是视频传输任务。');
 const response=await fetchImpl(settings.url+'/api/worker/psychology-video-transfer/'+encodeURIComponent(id),{method,headers,body,duplex:'half',signal:AbortSignal.timeout(180000)});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'视频传输失败');
 return {publishOnly:true,...(job.type==='psychology-selected-video'?{groupReady:true,publishSummary:data}:data)};
}
