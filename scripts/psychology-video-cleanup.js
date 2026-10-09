import fs from 'node:fs';
import path from 'node:path';
import {resolveStorageDirs} from './storage-paths.js';
export function removePublishedVideo(outputDir,renderJobId,fileName){
 if(!/^[a-zA-Z0-9_-]+$/.test(renderJobId)||fileName!==renderJobId+'.mp4')throw Error('清理文件名无效。');
 // An unavailable/moved root is not evidence that its files were deleted.
 if(!fs.statSync(outputDir).isDirectory())throw Error('成片目录不可用，保留清理任务等待重试。');
 const base=fs.realpathSync(outputDir),target=path.resolve(base,fileName);
 if(path.dirname(target)!==base)throw Error('文件不在成片目录内。');
 let stat;try{stat=fs.lstatSync(target);}catch(error){if(error.code==='ENOENT')return {missing:true};throw error;}
 if(stat.isSymbolicLink()||!stat.isFile()||fs.realpathSync(target)!==target)throw Error('拒绝清理链接或非普通成片文件。');
 fs.unlinkSync(target);return {missing:false};
}
export async function cleanPublishedVideo({root,config={},outputDir,settings,workerId,job,fetchImpl=fetch}){
 const jobId=job.id||job.jobId,endpoint='/api/worker/psychology-video-hits/cleanup/'+encodeURIComponent(jobId);
 const call=async(suffix,body={})=>{const response=await fetchImpl(settings.url+endpoint+suffix,{method:'POST',headers:{Authorization:'Bearer '+settings.token,'x-factory-worker':workerId,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const data=await response.json();if(!response.ok)throw Error(data.error||'未获得成片清理授权。');return data;};
 let manifest=await call('');
 if(!manifest.cleanedAt){
  let directory=outputDir||resolveStorageDirs(root,config).outputDir;
  if(!manifest.outputPath){
   // Legacy renders did not record their output root. Require locating the real
   // file, then persist that root before unlink so an interrupted retry is safe.
   if(!/^[a-zA-Z0-9_-]+$/.test(manifest.renderJobId)||manifest.fileName!==manifest.renderJobId+'.mp4')throw Error('清理文件名无效。');
   const target=path.join(fs.realpathSync(directory),manifest.fileName);
   let stat;try{stat=fs.lstatSync(target);}catch(error){if(error.code==='ENOENT')throw Error('旧成片未记录输出路径，当前目录未找到文件；请恢复原输出目录后重试。');throw error;}
   if(stat.isSymbolicLink()||!stat.isFile()||fs.realpathSync(target)!==target)throw Error('拒绝清理链接或非普通成片文件。');
   manifest=await call('',{outputPath:target});
   if(manifest.outputPath!==target)throw Error('原成片路径未保存，保留文件等待重试。');
  }
  if(manifest.outputPath){
   if(!path.isAbsolute(manifest.outputPath)||path.basename(manifest.outputPath)!==manifest.fileName||manifest.outputPath.split(/[\\/]/).some(part=>part==='..'||part==='.'))throw Error('记录的成片路径或文件名无效。');
   directory=path.dirname(manifest.outputPath);
  }
  removePublishedVideo(directory,manifest.renderJobId,manifest.fileName);
 }
 await call('/done');return {cleaned:true,renderJobId:manifest.renderJobId};
}
