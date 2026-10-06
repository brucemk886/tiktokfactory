import { trackedWebsiteLink } from './psychology-website-data.js';

export const SHORT_LINK_PREFIX='/go/';
export const shortWebsiteLink=code=>'https://deeppersonaai.com/go/'+code;
const validCode=code=>/^[a-f0-9]{10}$/.test(code);
export async function createWebsiteLinks(db,context,now=Date.now()){
 const accounts=context.accounts.filter(a=>a.candidate&&a.canPublish&&trackedWebsiteLink(a));
 for(const account of accounts){
  for(let attempt=0;attempt<5;attempt++){
   const existing=await db.prepare('SELECT code FROM psychology_website_links WHERE project_key=? AND connection_id=?').bind(context.projectId,account.connectionId).first();
   if(existing)break;
   const code=crypto.randomUUID().replaceAll('-','').slice(0,10);
   await db.prepare('INSERT OR IGNORE INTO psychology_website_links(code,project_key,connection_id,created_at) VALUES(?,?,?,?)').bind(code,context.projectId,account.connectionId,now).run();
   const saved=await db.prepare('SELECT code FROM psychology_website_links WHERE project_key=? AND connection_id=?').bind(context.projectId,account.connectionId).first();
   if(saved)break;
   if(attempt===4)throw new Error('Short link creation failed');
  }
 }
 return {ok:true,eligibleAccounts:accounts.length};
}
export async function readWebsiteLinks(db,context,window){
 const ids=JSON.stringify(context.accounts.map(a=>a.connectionId));
 const result=await db.prepare(`SELECT l.connection_id connectionId,l.code,l.created_at createdAt,
 COALESCE(SUM(d.requests-d.filtered),0) visits,COALESCE(SUM(d.requests),0) requests,
 COALESCE(SUM(d.filtered),0) filtered
 FROM psychology_website_links l LEFT JOIN psychology_website_link_days d
 ON d.code=l.code AND d.day>=? AND d.day<=?
 WHERE l.project_key=? AND l.connection_id IN (SELECT value FROM json_each(?))
 GROUP BY l.code,l.connection_id,l.created_at`).bind(window.from,window.to,context.projectId,ids).all();
 if(result.success===false||!Array.isArray(result.results))throw new Error('Short link statistics unavailable');
 return result.results.map(row=>({...row,trackingUrl:shortWebsiteLink(row.code)}));
}
export function excludedLinkRequest(request){
 const agent=request.headers.get('user-agent')||'';
 const purpose=(request.headers.get('purpose')||'')+' '+(request.headers.get('sec-purpose')||'');
 return !agent||/bot|crawler|spider|preview|facebookexternalhit|headless|curl|wget/i.test(agent)||/prefetch|prerender|preview/i.test(purpose);
}
export async function handleWebsiteShortLink(request,env,url,ctx,{now=Date.now()}={}){
 if(!url.pathname.startsWith(SHORT_LINK_PREFIX))return null;
 const headers={'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'};
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...headers,Allow:'GET, HEAD'}});
 const code=url.pathname.slice(SHORT_LINK_PREFIX.length);
 if(!validCode(code))return new Response('Link not found',{status:404,headers});
 const row=await env.DB.prepare('SELECT connection_id FROM psychology_website_links WHERE code=?').bind(code).first();
 const target=row&&trackedWebsiteLink({connectionId:row.connection_id});
 if(!target)return new Response('Link not found',{status:404,headers});
 if(request.method==='GET'){
  const day=new Date(now+8*3600000).toISOString().slice(0,10);
  const record=env.DB.prepare(`INSERT INTO psychology_website_link_days(code,day,requests,filtered) VALUES(?,?,1,?)
   ON CONFLICT(code,day) DO UPDATE SET requests=requests+1,filtered=filtered+excluded.filtered`)
   .bind(code,day,Number(excludedLinkRequest(request))).run().catch(()=>console.error(JSON.stringify({event:'website-link-count-failed'})));
  if(ctx?.waitUntil)ctx.waitUntil(record);else await record;
 }
 return new Response(null,{status:302,headers:{...headers,Location:target}});
}
