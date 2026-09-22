import {json,readJson,errorJson} from './http.js';
import {signalDesk} from './signal-desk.js';
import {loadAutoUser} from './psychology-auto-publish.js';
import {assertOfficialPublishAccess} from './official.js';
const BASE='/api/psychology-auto-replies';
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
const parse=s=>{try{return JSON.parse(s||'{}');}catch{return {};}};
const assertUser=u=>{if(!u||u.role!=='admin'||!u.sidebarModules?.includes('psychology-comments'))fail('没有自动回复管理权限。',403);};
const hub=(env,path,options)=>signalDesk(env,env.DB,path,{...options,signal:AbortSignal.timeout(25000)});
const scanPath=(row,extra={})=>'/api/v1/publish/comments/scan?'+new URLSearchParams({connectionId:row.connection_id,videoId:row.video_id,cursor:row.cursor||'0',...extra});
const externalId=row=>'psychology-reply:'+row.id;
export function matchReplyChoice(text){
 const value=String(text||'').normalize('NFKC').trim();
 const match=value.match(/^(?:(?:i\s+)?(?:choose|pick|chose|chose option|choose option|option|answer|my choice is|my answer is)\s*[:：]?\s*|(?:我选|选择|选|答案是|答案)\s*[:：]?\s*)?([ABCD])(?:[\s.!！。,,，:：❤️💖👍]*)$/iu);
 return match?match[1].toUpperCase():'';
}
export function validateReplyAnswers(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('请填写 A/B/C/D 回复文案。');
 const answers={};for(const key of ['A','B','C','D']){const value=input[key];if(typeof value!=='string'||!value.trim()||[...value.trim()].length>150)fail(key+' 回复须为1–150个字符。');answers[key]=value.trim();}return answers;
}
async function access(env,user,connectionId){
 assertUser(user);
 const scoped=await assertOfficialPublishAccess(env,user,{module:'psychology',connectionIds:[connectionId]},{fresh:true});
 const account=scoped.accounts.find(a=>(a.connectionId||a.id)===connectionId);
 if(!['comment.list','comment.list.manage'].every(scope=>account?.scopes?.includes(scope)))fail('账号需要评论读取和评论管理权限，请重新授权。',403);
 return account;
}
export async function handlePsychologyAutoReplies(request,env,url,session){
 if(!url.pathname.startsWith(BASE))return null;
 const user=session?.user;assertUser(user);const db=env.DB;
 if(request.method!=='GET'&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return errorJson('不允许跨站修改。',403);
 if(url.pathname===BASE&&request.method==='GET'){
  const page=Math.max(1,Math.min(100000,Math.floor(Number(url.searchParams.get('page'))||1)));
  const rows=await db.prepare(`SELECT w.*,(SELECT COUNT(*) FROM psychology_reply_items r WHERE r.watch_id=w.id AND r.status='published') AS sent_count,
   (SELECT COUNT(*) FROM psychology_reply_items r WHERE r.watch_id=w.id AND r.status IN ('pending','sending')) AS pending_count,
   (SELECT COUNT(*) FROM psychology_reply_items r WHERE r.watch_id=w.id AND r.status IN ('failed','needs_review')) AS error_count
   FROM psychology_reply_watches w WHERE created_by=? ORDER BY created_at DESC LIMIT 10 OFFSET ?`).bind(user.username,(page-1)*10).all();
  const total=await db.prepare('SELECT COUNT(*) n FROM psychology_reply_watches WHERE created_by=?').bind(user.username).first();
  return json({items:rows.results,total:total.n,page});
 }
 if(url.pathname===BASE&&request.method==='POST'){
  const b=await readJson(request),now=Date.now(),connectionId=String(b.connectionId||''),videoId=String(b.videoId||'');
  if(!/^\d{5,30}$/.test(videoId)||!connectionId||connectionId.length>128)fail('请选择账号并填写正确的视频 ID。');
  const startAt=Number(b.startAt),endAt=Number(b.endAt),max=Number(b.maxReplies);
  if(!Number.isSafeInteger(startAt)||!Number.isSafeInteger(endAt)||startAt<now-300000||startAt>now+7*86400000||endAt<=Math.max(startAt,now)||endAt-startAt>7*86400000||!Number.isInteger(max)||max<1||max>500)fail('开始时间最多提前7天，持续时间1–168小时，回复上限1–500条。');
  if(!user.sidebarModules?.includes('psychology-topic-bank'))fail('没有模板题库权限。',403);
  const topic=await db.prepare('SELECT * FROM psychology_template_topics WHERE id=? AND deleted_at=0').bind(String(b.topicId||'')).first();
  if(!topic)fail('请先选择题库中的具体题目。',404);
  const answers=validateReplyAnswers(b.answers),account=await access(env,user,connectionId);
  await hub(env,scanPath({connection_id:connectionId,video_id:videoId},{validateOnly:'1'}));
  const id=crypto.randomUUID();
  const added=await db.prepare(`INSERT INTO psychology_reply_watches(id,created_by,connection_id,account_name,video_id,topic_id,title,answers_json,start_at,end_at,max_replies,next_scan_at,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(connection_id,video_id) DO NOTHING`).bind(id,user.username,connectionId,account.username||account.displayName||'',videoId,topic.id,topic.title,JSON.stringify(answers),startAt,endAt,max,Math.max(now,startAt),now,now).run();
  if(!added.meta?.changes)fail('此视频已存在自动回复任务，请在列表查看或恢复，避免重复回复。',409);
  return json({id},201);
 }
 const m=url.pathname.match(/^\/api\/psychology-auto-replies\/([^/]+)(?:\/(records|pause|resume|check))?$/);
 if(m){
  const row=await db.prepare('SELECT * FROM psychology_reply_watches WHERE id=? AND created_by=?').bind(m[1],user.username).first();
  if(!row)fail('任务不存在。',404);
  if(m[2]==='records'&&request.method==='GET'){
   const page=Math.max(1,Math.min(100000,Math.floor(Number(url.searchParams.get('page'))||1)));
   const items=await db.prepare('SELECT * FROM psychology_reply_items WHERE watch_id=? ORDER BY created_at DESC,id LIMIT 20 OFFSET ?').bind(row.id,(page-1)*20).all();
   const n=await db.prepare('SELECT COUNT(*) n FROM psychology_reply_items WHERE watch_id=?').bind(row.id).first();return json({items:items.results,total:n.n,page});
  }
  if(request.method==='POST'&&['pause','resume'].includes(m[2])){
   if(m[2]==='resume'){if(row.end_at<=Date.now()||row.status==='completed')fail('任务已结束，请查看处理记录。');await access(env,user,row.connection_id);}
   await db.prepare("UPDATE psychology_reply_watches SET status=?,next_scan_at=?,error='',updated_at=? WHERE id=? AND status<>'completed'").bind(m[2]==='pause'?'paused':'active',Date.now(),Date.now(),row.id).run();return json({ok:true});
  }
  if(m[2]==='check'&&request.method==='POST'){
   await access(env,user,row.connection_id);const b=await readJson(request);
   const item=await db.prepare("SELECT * FROM psychology_reply_items WHERE id=? AND watch_id=? AND status IN ('sending','failed','needs_review')").bind(String(b.id||''),row.id).first();if(!item)fail('没有可核对的记录。',404);
   const receipt=await hub(env,'/api/v1/publish/comments?externalId='+encodeURIComponent(externalId(item)));
   await applyReceipt(db,item,receipt.comment,Date.now());return json({ok:true});
  }
 }
 return errorJson('不支持此请求。',405);
}
async function applyReceipt(db,item,r,now){
 if(!r||r.externalId!==externalId(item)||r.connectionId!==item.connection_id||r.videoId!==item.video_id||r.parentCommentId!==item.parent_comment_id||!['published','failed','needs_review','submitting'].includes(r.status))fail('中台回复回执不匹配。',502);
 await db.prepare('UPDATE psychology_reply_items SET status=?,comment_id=?,reason=?,next_check_at=?,updated_at=? WHERE id=?').bind(r.status==='submitting'?'sending':r.status,r.commentId||'',r.errorCode||'',now+60000,now,item.id).run();
}
export async function runAutoReplies(env,deps={}){
 const started=Date.now(),db=env.DB,now=deps.now??Date.now(),clock=()=>now+Date.now()-started,call=deps.call||((p,o)=>hub(env,p,o));
 const check=deps.assertAccess|| (async row=>access(env,await loadAutoUser(db,row.created_by),row.connection_id));
 const rows=(await db.prepare("SELECT * FROM psychology_reply_watches WHERE status='active' AND next_scan_at<=? AND lease_until<=? "+(deps.watchId?" AND id=?":"")+" ORDER BY next_scan_at,created_at LIMIT 10").bind(...(deps.watchId?[now,now,deps.watchId]:[now,now])).all()).results;
 let cursor=0;
 async function work(row){
  const token=crypto.randomUUID();
  const claim=await db.prepare("UPDATE psychology_reply_watches SET lease_token=?,lease_until=? WHERE id=? AND status='active' AND lease_until<=?").bind(token,clock()+180000,row.id,clock()).run();if(!claim.meta?.changes)return;
  const alive=async()=>Boolean(await db.prepare("SELECT id FROM psychology_reply_watches WHERE id=? AND status='active' AND lease_token=? AND lease_until>? AND end_at>?").bind(row.id,token,clock(),clock()).first());
  const finish=async(fields)=>{const values={lease_token:'',lease_until:0,dispatch_at:0,updated_at:now,...fields};await db.prepare('UPDATE psychology_reply_watches SET '+Object.keys(values).map(k=>k+'=?').join(',')+' WHERE id=? AND lease_token=?').bind(...Object.values(values),row.id,token).run();};
  try{
   if(row.end_at<=now){await db.prepare("UPDATE psychology_reply_items SET status='cancelled',reason='任务已到截止时间',updated_at=? WHERE watch_id=? AND status='pending'").bind(now,row.id).run();await finish({status:'completed'});return;}
   if(row.start_at>now){await finish({next_scan_at:row.start_at});return;}
   await check(row);
   let scanCursor=row.cursor,nextScan=Math.max(now+60000,row.last_scan_at+300000);
   if((row.cursor!=='0'||!row.last_scan_at||row.last_scan_at+300000<=now)&&await alive()){
    const page=await call(scanPath(row));
    if(page.connectionId!==row.connection_id||page.videoId!==row.video_id||!Array.isArray(page.comments)||page.comments.length>200||typeof page.hasMore!=='boolean'||(page.hasMore&&(!/^\d{1,30}$/.test(page.nextCursor)||page.nextCursor===row.cursor)))fail('评论分页返回异常。',502);
    let allocated=(await db.prepare("SELECT COUNT(*) n FROM psychology_reply_items WHERE watch_id=? AND status<>'skipped'").bind(row.id).first()).n;
    const answers=validateReplyAnswers(parse(row.answers_json));
    for(const c of page.comments){
     if(!/^\d{5,30}$/.test(String(c.id||'')))continue;
     const choice=matchReplyChoice(c.text);let reason=c.owned?'账号自己的评论':c.hidden?'隐藏评论':c.parentCommentId?'评论下的回复':!choice?'未明确选择单个 A/B/C/D':'';
     if(!reason&&allocated>=row.max_replies)reason='已达到任务回复上限';
     const added=await db.prepare(`INSERT OR IGNORE INTO psychology_reply_items(id,watch_id,connection_id,video_id,parent_comment_id,comment_text,author_name,choice,text,status,reason,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM psychology_reply_watches WHERE id=? AND lease_token=? AND status='active')`).bind(crypto.randomUUID(),row.id,row.connection_id,row.video_id,String(c.id),String(c.text||'').slice(0,2000),String(c.authorName||'').slice(0,200),choice,reason?'':answers[choice],reason?'skipped':'pending',reason,now,now,row.id,token).run();
     if(added.meta?.changes&&!reason)allocated++;
    }
    scanCursor=page.hasMore?page.nextCursor:'0';nextScan=now+(page.hasMore?60000:300000);
    await db.prepare('UPDATE psychology_reply_watches SET cursor=?,last_scan_at=? WHERE id=? AND lease_token=?').bind(scanCursor,now,row.id,token).run();
   }
   const item=await db.prepare("SELECT * FROM psychology_reply_items WHERE watch_id=? AND status IN ('pending','sending') AND next_check_at<=? ORDER BY CASE status WHEN 'sending' THEN 0 ELSE 1 END,created_at,id LIMIT 1").bind(row.id,now).first();
   if(item&&await alive()){
    const lock=await db.prepare(`INSERT INTO psychology_reply_account_locks(connection_id,lease_token,lease_until) VALUES(?,?,?)
     ON CONFLICT(connection_id) DO UPDATE SET lease_token=excluded.lease_token,lease_until=excluded.lease_until WHERE psychology_reply_account_locks.lease_until<=?`).bind(row.connection_id,token,clock()+60000,clock()).run();
    if(lock.meta?.changes){
     let receipt;
     try{
      if(item.attempts){try{receipt=await call('/api/v1/publish/comments?externalId='+encodeURIComponent(externalId(item)));}catch(e){if(e.statusCode!==404)throw e;}}
      if(!receipt){
       if(!await alive())return await finish({next_scan_at:now+60000});
       await db.prepare("UPDATE psychology_reply_items SET status='sending',attempts=attempts+1,updated_at=? WHERE id=?").bind(now,item.id).run();item.attempts++;
       try{receipt=await call('/api/v1/publish/comments',{method:'POST',body:{externalId:externalId(item),connectionId:item.connection_id,videoId:item.video_id,parentCommentId:item.parent_comment_id,text:item.text}});}catch(e){if(e.responseData?.comment)receipt=e.responseData;else throw e;}
      }
      await applyReceipt(db,item,receipt.comment,now);
     }catch(e){await db.prepare('UPDATE psychology_reply_items SET status=?,reason=?,next_check_at=?,updated_at=? WHERE id=?').bind(item.attempts>=3?'needs_review':[400,401,403,404].includes(e.statusCode)?'failed':'sending',String(e.message||'请求失败').slice(0,500),now+60000,now,item.id).run();}
    }
   }
   const pending=await db.prepare("SELECT id FROM psychology_reply_items WHERE watch_id=? AND status IN ('pending','sending') LIMIT 1").bind(row.id).first();
   await finish({next_scan_at:pending?now+60000:nextScan,error:''});
  }catch(e){await finish({next_scan_at:now+300000,error:String(e.message||'扫描失败').slice(0,500),...([400,401,403,404].includes(e.statusCode)?{status:'paused'}:{})});}
 }
 await Promise.all(Array.from({length:4},async()=>{while(cursor<rows.length)await work(rows[cursor++]);}));
 return {checked:rows.length};
}

export async function dispatchAutoReplies(env){
 if(!env.REPLY_QUEUE)return {sent:0};
 const now=Date.now();
 const rows=(await env.DB.prepare(`UPDATE psychology_reply_watches SET dispatch_at=? WHERE id IN
  (SELECT id FROM psychology_reply_watches WHERE status='active' AND next_scan_at<=? AND lease_until<=? AND dispatch_at<? ORDER BY next_scan_at LIMIT 120) RETURNING id`)
  .bind(now,now,now,now-120000).all()).results;
 try{for(let i=0;i<rows.length;i+=100)await env.REPLY_QUEUE.sendBatch(rows.slice(i,i+100).map(r=>({body:{watchId:r.id}})));}
 catch(e){await env.DB.prepare('UPDATE psychology_reply_watches SET dispatch_at=0 WHERE dispatch_at=?').bind(now).run();throw e;}
 return {sent:rows.length};
}
export async function consumeAutoReplies(batch,env){
 for(const message of batch.messages){
  if(typeof message.body?.watchId!=='string'){message.ack();continue;}
  try{await runAutoReplies(env,{watchId:message.body.watchId});message.ack();}catch{message.retry({delaySeconds:60});}
 }
}
