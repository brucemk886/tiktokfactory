import { scopeOfficialAccess } from './official-account-group-store.js';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
const result=[];
for(const n of [20,200,400]){
 const accounts=Array.from({length:n},(_,i)=>({id:'account-'+i,username:'test'+i,scopes:['video.publish']}));
 const store={projects:[{id:'p',name:'Psychology',moduleKey:'psychology'}],groups:[{id:'g',name:'Group',projectId:'p'}],assignments:Object.fromEntries(accounts.map(a=>[a.id,'g']))};
 const start=performance.now();for(let i=0;i<10;i++)scopeOfficialAccess({accounts},store,{role:'admin'},'psychology');
 result.push({accounts:n,repeats:10,meanMilliseconds:(performance.now()-start)/10});
}
console.log(JSON.stringify(result,null,2));if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');
