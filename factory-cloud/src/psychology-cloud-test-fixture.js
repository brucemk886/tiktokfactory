import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handlePsychologyAutoPublish } from './psychology-auto-publish.js';
import { importPsychologyPeerHits } from './psychology-peer-hits-store.js';
import { kvSet } from './kv.js';

const BASE='https://factory.test';
const user={id:'admin',username:'admin',role:'admin',sidebarModules:['psychology-publish']};
export function input(overrides={}) {return {requestId:crypto.randomUUID(),name:'Test batch',mediaType:'video',template:'psychology',count:3,
  connectionIds:['a','b'],scheduleAt:Math.floor(Date.now()/1000)+7200,intervalMinutes:60,selection:'popular',...overrides};}
export async function fixture(t) {
  const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());
  const dir=new URL('../migrations/',import.meta.url);
  for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(new URL(file,dir),'utf8'));
  const db={prepare(sql){return {args:[],bind(...args){return {...this,args};},
    async first(){return sqlite.prepare(sql).get(...this.args)||null;},
    async all(){const before=sqlite.prepare('SELECT total_changes() n').get().n;const results=sqlite.prepare(sql).all(...this.args);return {results,meta:{changes:sqlite.prepare('SELECT total_changes() n').get().n-before}};},
    async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...this.args).changes)}};}};},
    async batch(items){sqlite.exec('BEGIN');try{const rows=[];for(const item of items)rows.push(await item.all());sqlite.exec('COMMIT');return rows;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  sqlite.prepare("INSERT INTO factory_users(id,username,role,password_hash,password_salt,sidebar_modules_json,created_at,updated_at) VALUES ('admin','admin','admin','','',?,0,0)").run(JSON.stringify(user.sidebarModules));
  await kvSet(db,'official-account-groups',{projects:[{id:'proj-psych',name:'心理学',moduleKey:'psychology'},{id:'proj-novel',name:'小说推文',moduleKey:'novel-promotion'}],
    groups:[{id:'g',name:'心理学账号',projectId:'proj-psych'},{id:'other',name:'小说',projectId:'proj-novel'}],assignments:{a:'g',b:'g',outside:'other'}});
  const requests=[],instances=new Map(),hydrate=new Map();
  t.mock.method(globalThis,'fetch',async (url,init={})=>{
    const address=String(url);
    if(address.includes('/api/v1/accounts')) return Response.json({accounts:[{id:'a',username:'alpha',scopes:['video.publish']},{id:'b',scopes:['video.publish']},{id:'outside',scopes:['video.publish']},{id:'read-only',scopes:['user.info.basic']}]});
    if(address.endsWith('/api/v1/publish/batches')) { requests.push(JSON.parse(init.body)); const request=JSON.parse(init.body),batchId=request.externalId.includes('-group-')?'remote-'+request.externalId:'remote-batch';return Response.json({batch:{id:batchId,tasks:request.items.map((item,index)=>({id:batchId+'-task-'+index,externalRef:item.externalRef}))}}); }
    if(address.includes('/api/v1/publish/batches/')) {
      const id=decodeURIComponent(address.split('/batches/').pop().split('?')[0]);
      return Response.json({batch:hydrate.get(id)||{id,tasks:[]}});
    }
    throw new Error('Unexpected network call '+address);
  });
  const env={DB:db,SIGNAL_DESK_BRIDGE_KEY:'test',WORKER_TOKEN:'test-worker',KIE_API_KEY:'test',ARCHIVE:{},
    PEER_PHOTO_WORKFLOW:{async get(id){if(!instances.has(id))throw new Error('not found');return {async status(){return {status:'queued'};},async restart(){instances.set(id,2);}};},
      async create({id}){instances.set(id,1);return {id};}}};
  await importPsychologyPeerHits(db,Array.from({length:5},(_,n)=>({videoUrl:'https://www.tiktok.com/@example/video/'+(100+n),title:'Video idea '+n,playCount:100+n})),user.id);
  await importPsychologyPeerHits(db,Array.from({length:3},(_,n)=>({videoUrl:'https://www.tiktok.com/@example/photo/'+(200+n),title:'Photo idea '+n,playCount:500+n})),user.id);
  async function call(method='GET',body,path='/api/psychology-auto-publish',actor=user) {
    const req=new Request(BASE+path,{method,...(body?{body:JSON.stringify(body)}:{})});
    return handlePsychologyAutoPublish(req,env,new URL(req.url),actor?{user:actor}:null);
  }
  return {db,sqlite,env,call,instances,requests,hydrate};
}
