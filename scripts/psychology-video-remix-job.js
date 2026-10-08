import fs from 'node:fs';
import {readConfig} from './video-core.js';
import {resolveStorageDirs} from './storage-paths.js';
import {loadSettings} from './factory-cloud-worker.js';
import {renderVideoRemix} from './psychology-video-remix.js';
const root=process.cwd(),payload=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),jobPath=process.argv[3],config=readConfig(root),storage=resolveStorageDirs(root,config),settings=loadSettings(storage.workDir);
const patch=value=>{let current={};try{current=JSON.parse(fs.readFileSync(jobPath,'utf8'));}catch{}fs.writeFileSync(jobPath,JSON.stringify({...current,...value}));};
try{const result=await renderVideoRemix({snapshot:payload.videoRemix,jobId:payload.jobId,root,config,...storage,settings,workerId:payload.workerId||settings.workerId,onProgress:p=>patch({status:'running',...p})});patch({status:'done',percent:100,message:'二创视频合成完成',...result});}
catch(error){patch({status:'failed',percent:100,error:error.message,message:error.message});process.exitCode=1;}
