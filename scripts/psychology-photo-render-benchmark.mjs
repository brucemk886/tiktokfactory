// Local Chrome only. Never uploads or publishes. Usage: node scripts/psychology-photo-render-benchmark.mjs [output.json]
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { openCardRenderer } from './psychology-auto-photo-job.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const samples=[];let bytes=0;
for(let post=0;post<12;post++){
 const start=performance.now();const renderer=await openCardRenderer(root);
 try{for(let i=0;i<6;i++){
 const data=await renderer.render({template:i?'content':'cover',title:i?'Notice the pattern':'Why you pull away when someone gets close',body:'Taking a pause can help you understand what you feel. Name the feeling, ask for space, and agree on when to reconnect.'},i,'photo-original');
 bytes+=Buffer.from(data.split(',')[1],'base64').byteLength;
 }}finally{await renderer.close();}
 samples.push(performance.now()-start);
}
const sorted=[...samples].sort((a,b)=>a-b),total=samples.reduce((a,b)=>a+b,0);
const result={scope:'12 fresh Chrome lifecycles, 6 text cards each; no AI/network/upload; overlay photos not measured',posts:12,images:72,totalSeconds:total/1000,meanPostSeconds:total/12000,p95PostSeconds:sorted[Math.ceil(sorted.length*.95)-1]/1000,totalJpegBytes:bytes,meanJpegBytes:Math.round(bytes/72),projected600LocalRenderHours:total/12*600/3600000};
console.log(JSON.stringify(result,null,2));if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');
