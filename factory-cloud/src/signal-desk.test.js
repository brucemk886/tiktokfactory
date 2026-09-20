import assert from 'node:assert/strict';
import test from 'node:test';
import {signalDesk} from './signal-desk.js';
const db={prepare(){return {bind(){return this;},async first(){return null;}};}};
const env={SIGNAL_DESK_BRIDGE_KEY:'test',SIGNAL_DESK_BASE_URL:'https://hub.test'};
test('HTTP 200 business errors are errors, not empty successful batch receipts',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:'账号授权已失效'}));
 await assert.rejects(signalDesk(env,db,'/api/v1/publish/batches'),e=>e.statusCode===502&&e.message==='账号授权已失效');
});
test('successful batch responses and actual error HTTP statuses are preserved',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({batch:{id:'batch'}}));
 assert.equal((await signalDesk(env,db,'/api/v1/publish/batches')).batch.id,'batch');
 globalThis.fetch=async()=>Response.json({error:'账号授权已失效'},{status:401});
 await assert.rejects(signalDesk(env,db,'/api/v1/publish/batches'),e=>e.statusCode===401);
});
