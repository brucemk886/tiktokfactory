import fs from 'node:fs';
import path from 'node:path';

// The publish lane only uploads this video's asset. Cloud groups it with its siblings.
export async function runGroupedVideoUpload({job,workDir,call,uploadAsset,onProgress=()=>{}}) {
  const id=job.id||job.jobId,base='/api/worker/psychology-video/'+encodeURIComponent(id);
  const state=await call(base+'/state');
  if(state.receipt?.batchId)return state.receipt;
  if(state.ready)return call(base+'/ready',{});
  const video=(job.payload?.videos||job.payload?.generatedVideos||[])[0];
  if(!video?.fileName)throw new Error('没有已生成的视频。');
  if(typeof uploadAsset!=='function')throw new Error('当前工人尚不支持整批上传，请更新并重启空闲工人。');
  // Persist the successful upload before reporting readiness; a lost HTTP reply must not re-upload.
  const cacheDir=path.join(workDir,'psychology-publish-assets');
  fs.mkdirSync(cacheDir,{recursive:true});
  if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new Error('任务编号无效。');
  const cachePath=path.join(cacheDir,id+'.json');
  let asset;
  try{const cached=JSON.parse(fs.readFileSync(cachePath,'utf8'));if(cached.fileName===video.fileName)asset=cached.asset;}catch{}
  if(!asset?.assetKey){
    onProgress('正在上传视频，完成后等待同组内容…');
    asset=await uploadAsset(video);
    const temp=cachePath+'.tmp';fs.writeFileSync(temp,JSON.stringify({fileName:video.fileName,asset}));fs.renameSync(temp,cachePath);
  }
  return call(base+'/ready',{asset});
}

export async function uploadPsychologyVideoAsset({video,outputDir,upload}) {
  const fileName=String(video?.fileName||'');
  if(!fileName||path.basename(fileName)!==fileName||!/\.(mp4|mov|webm)$/i.test(fileName))throw new Error('视频文件名无效。');
  const root=fs.realpathSync(outputDir),filePath=fs.realpathSync(path.join(root,fileName));
  const relative=path.relative(root,filePath);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('视频文件不在输出目录中。');
  const type=/\.webm$/i.test(fileName)?'video/webm':/\.mov$/i.test(fileName)?'video/quicktime':'video/mp4';
  return upload({filePath,fileName,contentType:type});
}
