import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './psychology-cloud-test-fixture.js';
import { runProductionCheck } from './psychology-production-checks.js';
const stamp=s=>Date.parse(s),key='psychology-production-check-v1';
test('ordinary minute ticks do not scan accounts, queue, or database outside three check windows',async()=>{
 const env={DB:{prepare(){assert.fail('no database outside operating checks');}}};
 for(const at of ['2026-10-02T11:59:00Z','2026-10-02T13:00:00Z','2026-10-02T15:45:00Z','2026-10-02T23:59:00Z'])assert.deepEqual(await runProductionCheck(env,stamp(at)),{skipped:true});
});
test('three Pacific daily windows run each once, even with overlapping and delayed cron delivery',async t=>{
 const f=await fixture(t);let plans=0,recalcs=0;
 const actions={refreshCapacity:async()=>0,runPlans:async()=>{plans++;return {pilot:{batches:['b'],errors:[]}};},recalculate:async()=>{recalcs++;return {advanced:1};}};
 for(const at of ['2026-10-02T12:00:00Z','2026-10-02T15:30:00Z','2026-10-03T00:00:00Z']){
  const n=stamp(at);await Promise.all([runProductionCheck(f.env,n,actions),runProductionCheck(f.env,n,actions)]);await runProductionCheck(f.env,n+60000,actions);
 }
 assert.equal(plans,3);assert.equal(recalcs,3);assert.equal(f.requests.length,0);
 assert.equal(JSON.parse(f.sqlite.prepare('SELECT value_json FROM factory_kv WHERE key=?').get(key).value_json).key,'2026-10-02:17:00');
});
test('failed or abandoned check does not turn into minute retries; next scheduled check recovers',async t=>{
 const f=await fixture(t);let plans=0,recalcs=0;
 const actions={refreshCapacity:async()=>0,runPlans:async()=>{plans++;throw Error('synthetic');},recalculate:async()=>{recalcs++;return {};}};
 const start=stamp('2026-10-02T12:00:00Z');const result=await runProductionCheck(f.env,start,actions);assert.equal(result.status,'failed');
 await runProductionCheck(f.env,start+60000,actions);assert.equal(plans,1);assert.equal(recalcs,1);
 await runProductionCheck(f.env,stamp('2026-10-02T15:30:00Z'),actions);assert.equal(plans,2);
 f.sqlite.prepare('UPDATE factory_kv SET value_json=? WHERE key=?').run(JSON.stringify({scheduledAt:stamp('2026-10-02T15:30:00Z'),status:'running'}),key);
 await runProductionCheck(f.env,stamp('2026-10-03T00:00:00Z'),actions);assert.equal(plans,3);
});
test('winter check uses Pacific standard time rather than a fixed UTC offset',async t=>{
 const f=await fixture(t);let calls=0;const actions={refreshCapacity:async()=>0,runPlans:async()=>{calls++;return {};},recalculate:async()=>({})};
 assert.equal((await runProductionCheck(f.env,stamp('2026-11-02T12:00:00Z'),actions)).skipped,true);
 await runProductionCheck(f.env,stamp('2026-11-02T13:00:00Z'),actions);assert.equal(calls,1);
});
