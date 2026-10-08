import fs from 'node:fs';
import path from 'node:path';
import {resolveStorageDirs} from './storage-paths.js';
export function removePublishedVideo(outputDir,renderJobId,fileName){
 if(!/^[a-zA-Z0-9_-]+$/.test(renderJobId)||fileName!==renderJobId+'.mp4')throw Error('清理文件名无效。');
 if(!fs.existsSync(outputDir))return {missing:true};
 const base=fs.realpathSync(outputDir),target=path.resolve(base,fileName);
 if(path.dirname(target)!==base)throw Error('文件不在成片目录内。');
 let stat;try{stat=fs.lstatSync(target);}catch(error){if(error.code==='ENOENT')return {missing:true};throw error;}
 if(stat.isSymbolicLink()||!stat.isFile()||fs.realpathSync(target)!==target)throw Error('拒绝清理链接或非普通成片文件。');
 fs.unlinkSync(target);return {missing:false};
}
export async function cleanPublishedVideo({root,config={},outputDir,settings,workerId,job,fetchImpl=fetch}){
 const jobId=job.id||job.jobId,endpoint='/api/worker/psychology-video-hits/cleanup/'+encodeURIComponent(jobId);
 const call=async suffix=>{const response=await fetchImpl(settings.url+endpoint+suffix,{method:'POST',headers:{Authorization:'Bearer '+settings.token,'x-factory-worker':workerId,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(30000)});const data=await response.json();if(!response.ok)throw Error(data.error||'未获得成片清理授权。');return data;};
 const manifest=await call('');
 if(!manifest.cleanedAt)removePublishedVideo(outputDir||resolveStorageDirs(root,config).outputDir,manifest.renderJobId,manifest.fileName);
 await call('/done');return {cleaned:true,renderJobId:manifest.renderJobId};
}
