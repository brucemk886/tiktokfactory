import test from 'node:test';
import assert from 'node:assert/strict';
import {assignTaskGroupRoles} from './psychology-task-group-policy.js';
test('reviewers are stable, capped, deterministic and preserve existing members',()=>{
 const rows=Array.from({length:70},(_,i)=>({connectionId:String(i).padStart(3,'0'),accountPool:'normal',n:5}));
 rows.push({connectionId:'fresh',accountPool:'observing',n:0,isNew:true},{connectionId:'old',accountPool:'observing',n:3},
  {connectionId:'paused',accountPool:'strong',n:30,paused:true},{connectionId:'weak',accountPool:'diagnostic',n:10});
 const result=assignTaskGroupRoles(rows,{previousReview:new Set(['069'])});
 assert.equal(result.filter(a=>a.role==='review').length,60);assert.equal(result.find(a=>a.connectionId==='069').role,'review');
 assert.equal(result.find(a=>a.connectionId==='paused').role,'strong');assert.equal(result.find(a=>a.connectionId==='fresh').role,'launch');
 assert.equal(result.find(a=>a.connectionId==='old').role,'observing');assert.equal(result.find(a=>a.connectionId==='weak').role,'diagnostic');
 assert.deepEqual(assignTaskGroupRoles([...rows].reverse(),{previousReview:new Set(['069'])}).filter(a=>a.role==='review').map(a=>a.connectionId).sort(),result.filter(a=>a.role==='review').map(a=>a.connectionId).sort());
 assert.throws(()=>assignTaskGroupRoles(rows,{reviewTarget:61}),RangeError);
});
test('blocked stable accounts cannot take reviewer capacity',()=>{
 const result=assignTaskGroupRoles([{connectionId:'blocked',accountPool:'strong',n:8,blocked:true},...Array.from({length:5},(_,i)=>({connectionId:'ok'+i,accountPool:'normal',n:5}))],{reviewTarget:5});
 assert.equal(result.find(a=>a.connectionId==='blocked').role,'strong');assert.equal(result.filter(a=>a.role==='review').length,5);
});
