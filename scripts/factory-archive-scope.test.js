import assert from "node:assert/strict";
import test from "node:test";
import { factoryArchiveKeys, filterFactoryArchiveAccounts } from "./factory-archive-scope.js";
const base = { projects: [{id:"p",name:"Business"}], groups: [{id:"g",name:"Linked",projectId:"p"},{id:"loose",name:"Loose"}], assignments: { "one":"g", "external":"loose", "deleted":"missing" } };
test("only explicit valid business assignments can receive archives", () => {
  assert.deepEqual(factoryArchiveKeys(base), ["tiktok:one"]);
  assert.deepEqual(factoryArchiveKeys({...base,projects:[]}), []);
  assert.deepEqual(factoryArchiveKeys({...base,assignments:{}}), []);
  assert.deepEqual(factoryArchiveKeys({...base,aliases:{one:"canonical"}}), ["tiktok:canonical"]);
});
test("receiver rejects unlinked customers and empty scope denies all", () => {
  const rows=[{schema:"tiktok:one"},{schema:"tiktok:external"},{schema:"one"}];
  assert.deepEqual(filterFactoryArchiveAccounts(rows,factoryArchiveKeys(base)),[rows[0]]);
  assert.deepEqual(filterFactoryArchiveAccounts(rows,[]),[]);
});


test("scope endpoint requires bridge authentication and cannot revive legacy assignments", async () => {
  const { handleSignalDeskIntegration } = await import("../factory-cloud/src/factory-storage.js");
  const db={prepare(sql){let key;return {bind(value){key=value;return this;},async first(){return {value_json:JSON.stringify(key==="official-account-groups"?base:{})};},async all(){return {results:[]};}};}};
  const url=new URL("https://factory.test/api/integrations/signal-desk/archive-scope");
  const env={DB:db,SIGNAL_DESK_BRIDGE_KEY:"test-only"};
  await assert.rejects(()=>handleSignalDeskIntegration(new Request(url),env,url),error=>error.statusCode===401);
  const response=await handleSignalDeskIntegration(new Request(url,{headers:{Authorization:"Bearer test-only"}}),env,url);
  assert.deepEqual(await response.json(),{accountKeys:[]});
});
test("receiver stores nothing for a customer without a factory assignment", async () => {
  const {applyOfficialArchivePush}=await import("../factory-cloud/src/official-archive-store.js");
  const writes=[];
  const db={prepare(sql){let key;return {bind(value){key=value;return this;},async first(){return sql.includes("factory_kv")?{value_json:JSON.stringify(base)}:{};},async all(){return {results:[]};},async run(){writes.push(sql);return {};}};},async batch(rows){writes.push(rows);return [];}};
  const result=await applyOfficialArchivePush({},db,{accounts:[{schema:"tiktok:external",videos:[{id:"private",views:3}]}]});
  assert.equal(result.upserted,0);
  assert.equal(writes.length,0);
});
