import assert from 'node:assert/strict';
import test from 'node:test';
import {assignSelectedVideoItems} from '../public/psychology-video-picker.js';
const videos=n=>Array.from({length:n},(_,i)=>({id:'video-'+i,caption:'Saved caption '+i,videoHit:{sourceId:'source-'+i,version:1,revision:3}}));
const accounts=n=>Array.from({length:n},(_,i)=>({connectionId:'account-'+i}));
const config={scheduleAt:1900000000,intervalMinutes:37,isAiGenerated:false};
const distribution=items=>Object.groupBy(items,i=>i.connectionId);
test('20 videos / 10 accounts allocates two unique videos each with per-account intervals',()=>{
 const source=videos(20),targets=accounts(10),snapshot=structuredClone({source,targets});
 const items=assignSelectedVideoItems(source,targets,config,()=>0.25);
 assert.equal(new Set(items.map(i=>i.assetId)).size,20);assert.equal(items.length,20);
 for(const account of targets){const pair=distribution(items)[account.connectionId];assert.equal(pair.length,2);assert.deepEqual(pair.map(i=>i.scheduleAt),[config.scheduleAt,config.scheduleAt+37*60]);}
 for(const item of items){const original=source.find(v=>v.id===item.assetId);assert.equal(item.caption,original.caption);assert.deepEqual(item.videoHit,original.videoHit);assert.equal(item.isAiGenerated,false);}
 assert.deepEqual({source,targets},snapshot);assert.notDeepEqual(items.map(i=>i.assetId),source.map(v=>v.id));
});
test('random distributions remain balanced for every supported video/account count',()=>{
 for(let total=1;total<=20;total++)for(let count=1;count<=total;count++){
  const items=assignSelectedVideoItems(videos(total),accounts(count),config,()=>0.67),groups=Object.values(distribution(items));
  assert.equal(groups.length,count);assert.equal(new Set(items.map(i=>i.assetId)).size,total);
  assert.ok(Math.max(...groups.map(g=>g.length))-Math.min(...groups.map(g=>g.length))<=1);
  for(const group of groups)assert.deepEqual(group.map(i=>i.scheduleAt),group.map((_,i)=>config.scheduleAt+i*37*60));
 }
});
test('different random draws change matching, preserve captions and never duplicate accounts',()=>{
 const a=assignSelectedVideoItems(videos(20),accounts(10),config,()=>0.1),b=assignSelectedVideoItems(videos(20),accounts(10),config,()=>0.9);
 assert.notDeepEqual(a,b);
 const items=assignSelectedVideoItems([{id:'v1',assetId:'real',caption:''},{id:'v2',title:'Fallback'}],[{id:'a'},{connectionId:'a'}],{...config,isAiGenerated:true});
 assert.equal(new Set(items.map(i=>i.connectionId)).size,1);assert.equal(items.find(i=>i.assetId==='real').caption,'');assert.equal(items.find(i=>i.assetId==='v2').caption,'Fallback');assert.ok(items.every(i=>i.isAiGenerated));
});
test('invalid choices and schedules fail before any submission',()=>{
 for(const [vs,as,c] of [[[],accounts(1),config],[videos(21),accounts(1),config],[videos(1),[],config],[videos(1),accounts(2),config],[videos(1),accounts(1),{...config,scheduleAt:NaN}],[videos(1),accounts(1),{...config,intervalMinutes:0}],[videos(1),accounts(1),{...config,intervalMinutes:1.5}]])assert.throws(()=>assignSelectedVideoItems(vs,as,c));
});


test('new video selections default AI disclosure off and retain explicit choices',()=>{
 const {isAiGenerated:omitted,...schedule}=config;
 for(const selection of [schedule,{...schedule,isAiGenerated:false},{...schedule,isAiGenerated:true}]){
  const items=assignSelectedVideoItems(videos(3),accounts(2),selection);
  assert.ok(items.every(item=>item.isAiGenerated===(selection.isAiGenerated??false)));
 }
});
