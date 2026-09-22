import { validateReplyAnswers } from './psychology-auto-replies.js';
import { json, readJson, errorJson } from './http.js';
import { TOPIC_TEMPLATES, validateTopicTemplate } from '../../scripts/psychology-topic-bank.js';
import { signalDesk } from './signal-desk.js';
import { loadAutoUser } from './psychology-auto-publish.js';
import { assertOfficialPublishAccess } from './official.js';
const BASE='/api/psychology-comments';
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
const parse=value=>{try{return JSON.parse(value||'{}');}catch{return {};}};
const active=['waiting_publish','pending','sending','checking'];
export async function commentTemplate(db,template) {
  return await db.prepare('SELECT * FROM psychology_comment_templates WHERE template=?').bind(template).first()
    || {template,enabled:0,delay_minutes:120,caption:"Follow for the answer — I'll reveal it in the comments in {hours} hours."};
}
export function freezeComment(source,config,setting) {
  if(!setting.enabled || config.mediaType!=='video')return null;
  if(config.sourceType!=='topic-bank')fail('此模板已开启定时揭晓，请从模板题库抽题并填写揭晓评论。');
  const text=String(source.revealComment||'').trim();
  if(!text||text.length>2000)fail('题目「'+source.title+'」缺少有效揭晓评论，请先在模板题库填写。');
  const replyConfig=setting.auto_reply_enabled?{topicId:source.id,answers:validateReplyAnswers(source.replyOptions),hours:setting.reply_hours||48,maxReplies:setting.reply_max||100}:null;
  return {...(replyConfig?{replyConfig}:{}),text,delayMinutes:setting.delay_minutes,caption:String(setting.caption||'').replaceAll('{hours}',String(setting.delay_minutes/60)).replaceAll('{minutes}',String(setting.delay_minutes))};
}
export function insertScheduledComment(db,item,source,snapshot,createdBy,stamp) {
  return db.prepare(`INSERT INTO psychology_scheduled_comments
    (id,batch_id,created_by,template,connection_id,account_name,title,text,delay_minutes,caption,created_at,updated_at,reply_config_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(item.id,item.batchId,createdBy,item.template,item.connectionId,
      item.account?.username||item.account?.name||item.connectionId,source.title,snapshot.text,snapshot.delayMinutes,snapshot.caption,stamp,stamp,JSON.stringify(snapshot.replyConfig||{}));
}
function assertUser(user) {if(!user||user.role!=='admin'||!user.sidebarModules?.includes('psychology-comments'))fail('没有定时评论管理权限。',403);}
export async function handlePsychologyComments(request,env,url,session) {
  if(!url.pathname.startsWith(BASE))return null;
  assertUser(session?.user);const db=env.DB,user=session.user;
  if(request.method!=='GET'&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return errorJson('不允许跨站修改。',403);
  if(url.pathname===BASE+'/templates') {
    if(request.method==='GET')return json({templates:await Promise.all(TOPIC_TEMPLATES.map(async t=>({...t,...await commentTemplate(db,t.id)})))});
    if(request.method==='PUT') {
      const body=await readJson(request),template=validateTopicTemplate(body.template),minutes=Number(body.delayMinutes),caption=String(body.caption||'').trim();
      if(typeof body.enabled!=='boolean'||!Number.isInteger(minutes)||minutes<1||minutes>10080||caption.length>500)fail('延迟须为1–10080分钟，引导文案最多500字符。');
      const previous=await commentTemplate(db,template);
      const replyEnabled=body.autoReplyEnabled??Boolean(previous.auto_reply_enabled),hours=Number(body.replyHours??previous.reply_hours??48),max=Number(body.replyMax??previous.reply_max??100);
      if(typeof replyEnabled!=='boolean'||!Number.isInteger(hours)||hours<1||hours>168||!Number.isInteger(max)||max<1||max>500)fail('自动回复持续时间须为1–168小时，每视频上限1–500条。');
      if(replyEnabled&&!body.enabled)fail('自动回复须同时开启定时揭晓评论。');
      await db.prepare(`INSERT INTO psychology_comment_templates(template,enabled,delay_minutes,caption,updated_at,auto_reply_enabled,reply_hours,reply_max) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(template) DO UPDATE SET enabled=excluded.enabled,delay_minutes=excluded.delay_minutes,caption=excluded.caption,updated_at=excluded.updated_at,auto_reply_enabled=excluded.auto_reply_enabled,reply_hours=excluded.reply_hours,reply_max=excluded.reply_max`)
        .bind(template,body.enabled?1:0,minutes,caption,Date.now(),replyEnabled?1:0,hours,max).run();return json({ok:true});
    }
  }
  if(url.pathname===BASE&&request.method==='GET') {
    const page=Math.max(1,Math.min(100000,Number(url.searchParams.get('page'))||1)),status=url.searchParams.get('status')||'';
    if(status&&!['waiting_publish','pending','sending','checking','published','failed','needs_review','cancelled'].includes(status))fail('状态无效。');
    const where='created_by=?'+(status?' AND status=?':''),args=status?[user.username,status]:[user.username];
    const [count,rows]=await Promise.all([db.prepare('SELECT COUNT(*) n FROM psychology_scheduled_comments WHERE '+where).bind(...args).first(),
      db.prepare('SELECT * FROM psychology_scheduled_comments WHERE '+where+' ORDER BY created_at DESC,id LIMIT 10 OFFSET ?').bind(...args,(page-1)*10).all()]);
    return json({items:rows.results,total:count.n,page});
  }
  const match=url.pathname.match(/^\/api\/psychology-comments\/([^/]+)\/(cancel|check)$/);
  if(match&&request.method==='POST') {
    const row=await db.prepare('SELECT * FROM psychology_scheduled_comments WHERE id=? AND created_by=?').bind(match[1],user.username).first();
    if(!row)fail('评论任务不存在。',404);
    if(match[2]==='cancel') {
      const changed=await db.prepare("UPDATE psychology_scheduled_comments SET status='cancelled',updated_at=? WHERE id=? AND status IN ('waiting_publish','pending') AND lease_until=0 AND attempts=0").bind(Date.now(),row.id).run();
      if(!changed.meta?.changes)fail('该评论已开始提交，无法取消。',409);
    } else {
      if(!['failed','needs_review'].includes(row.status))fail('只能核对失败或待核对任务。',409);
      await db.prepare("UPDATE psychology_scheduled_comments SET status=?,next_check_at=0,lease_until=0 WHERE id=? AND status IN ('failed','needs_review')").bind(row.attempts?'checking':row.video_id?'pending':'waiting_publish',row.id).run();
    }
    return json({ok:true});
  }
  return errorJson('不支持此请求。',405);
}
export async function runScheduledComments(env,deps={}) {
  const db=env.DB,now=deps.now||Date.now(),call=deps.call||((path,options)=>signalDesk(env,db,path,options));
  const rows=(await db.prepare(`SELECT c.*,i.deleted_at,i.receipt_json,j.status AS job_status FROM psychology_scheduled_comments c
    JOIN psychology_publish_items i ON i.id=c.id LEFT JOIN factory_jobs j ON j.id=i.job_id
    WHERE c.status IN ('waiting_publish','pending','sending','checking') AND c.next_check_at<=? AND c.lease_until<=?
    ORDER BY c.next_check_at,c.created_at LIMIT 40`).bind(now,now).all()).results;
  const batches=new Map(),access=new Map();let cursor=0,processed=0;
  async function update(id,status,error='',fields={}) {
    const values={status,error,lease_until:0,updated_at:now,...fields};
    await db.prepare('UPDATE psychology_scheduled_comments SET '+Object.keys(values).map(k=>k+'=?').join(',')+' WHERE id=?').bind(...Object.values(values),id).run();
  }
  async function work(row) {
    const claimed=await db.prepare("UPDATE psychology_scheduled_comments SET lease_until=? WHERE id=? AND lease_until<=? AND status IN ('waiting_publish','pending','sending','checking')").bind(now+120000,row.id,now).run();
    if(!claimed.meta?.changes)return;
    try {
      if(row.deleted_at) {await update(row.id,row.attempts?'needs_review':'cancelled','原发布任务已删除。');return;}
      if(row.status==='waiting_publish') {
        const receipt=parse(row.receipt_json);
        if(!receipt.batchId){await update(row.id,'waiting_publish',row.job_status==='failed'?'视频生成或提交失败，等待发布任务恢复。':'',{next_check_at:now+300000});return;}
        if(!batches.has(receipt.batchId))batches.set(receipt.batchId,call('/api/v1/publish/batches/'+encodeURIComponent(receipt.batchId)));
        const batch=(await batches.get(receipt.batchId)).batch;
        const remote=batch?.tasks?.find(t=>t.id===receipt.remoteTaskId||t.externalRef===row.id);
        if(remote && remote.connectionId!==row.connection_id)fail('发布回执账号不匹配。',403);
        if(['failed','rejected','canceled','cancelled','status_timeout'].includes(remote?.status)){await update(row.id,'waiting_publish','原作品发布失败，等待发布任务恢复。',{next_check_at:now+300000});return;}
        const videoId=String(remote?.videoId||''),publishedAt=Number(remote?.publishedAt||remote?.completedAt||0);
        if(remote?.status!=='published'||!/^\d{5,30}$/.test(videoId)||!Number.isFinite(publishedAt)||publishedAt<=0){await update(row.id,'waiting_publish','等待作品发布成功及作品编号。',{next_check_at:now+300000});return;}
        const due=publishedAt+row.delay_minutes*60000;
        const videoUrl=/^https:\/\/(www\.)?tiktok\.com\//i.test(remote.videoUrl||'')?remote.videoUrl:'';
        const statements=[db.prepare("UPDATE psychology_scheduled_comments SET status='pending',error='',lease_until=0,updated_at=?,video_id=?,video_url=?,published_at=?,time_basis=?,due_at=?,next_check_at=? WHERE id=?")
          .bind(now,videoId,videoUrl,publishedAt,remote.publishedAt?'published':'confirmed',due,due,row.id)];
        const reply=parse(row.reply_config_json);
        if(reply.answers)statements.push(db.prepare(`INSERT INTO psychology_reply_watches
          (id,created_by,connection_id,account_name,video_id,topic_id,title,answers_json,start_at,end_at,max_replies,next_scan_at,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(connection_id,video_id) DO NOTHING`)
          .bind('reveal:'+row.id,row.created_by,row.connection_id,row.account_name,videoId,reply.topicId,row.title,JSON.stringify(validateReplyAnswers(reply.answers)),due,due+reply.hours*3600000,reply.maxReplies,due,now,now));
        await db.batch(statements);return;
      }
      if(row.due_at>now){await update(row.id,'pending','',{next_check_at:row.due_at});return;}
      const externalId='psychology-reveal:'+row.id;
      // All recovery uses the same hub idempotency key. A review check never creates a missing request.
      if(row.attempts>0||row.status==='checking') {
        try {
          const old=await call('/api/v1/publish/comments?externalId='+encodeURIComponent(externalId));
          await applyReceipt(row,old.comment);return;
        } catch(error) {
          if(error.statusCode!==404)throw error;
          if(row.status==='checking'){await update(row.id,'needs_review','中台未找到评论记录，请核对原发布任务。');return;}
        }
      }
      const accessKey=row.created_by+':'+row.connection_id;
      if(!access.has(accessKey))access.set(accessKey,(async()=>{
        if(deps.assertAccess)return deps.assertAccess(row);
        const user=await loadAutoUser(db,row.created_by);
        const scoped=await assertOfficialPublishAccess(env,user,{module:'psychology',connectionIds:[row.connection_id]},{fresh:false});
        const account=scoped.accounts.find(a=>(a.connectionId||a.id)===row.connection_id);
        if(!account?.scopes?.includes('comment.list.manage'))fail('账号缺少评论管理权限，请重新授权。',403);
      })());
      await access.get(accessKey);
      await db.prepare("UPDATE psychology_scheduled_comments SET status='sending',attempts=attempts+1,updated_at=? WHERE id=?").bind(now,row.id).run();
      row.attempts++;
      let receipt;
      try {receipt=await call('/api/v1/publish/comments',{method:'POST',body:{externalId,connectionId:row.connection_id,videoId:row.video_id,text:row.text},signal:AbortSignal.timeout(45000)});}
      catch(error){if(error.responseData?.comment)receipt=error.responseData;else throw error;}
      await applyReceipt(row,receipt.comment);
    } catch(error) {
      const permanent=[400,401,403,404].includes(error.statusCode);
      const status=permanent?'failed':row.attempts>=3?'needs_review':row.status==='waiting_publish'?'waiting_publish':row.status==='checking'?'checking':'sending';
      await update(row.id,status,String(error.message||'中台请求失败').slice(0,500),{next_check_at:now+60000});
    }
  }
  async function applyReceipt(row,receipt) {
    if(!receipt||receipt.externalId!=='psychology-reveal:'+row.id||receipt.connectionId!==row.connection_id||receipt.videoId!==row.video_id)fail('中台评论回执不匹配。',502);
    if(!['published','failed','needs_review','submitting'].includes(receipt.status))fail('中台评论状态无效。',502);
    await update(row.id,receipt.status==='submitting'?'sending':receipt.status,receipt.errorCode||'',{comment_id:String(receipt.commentId||''),next_check_at:now+60000});
  }
  // Keep separate from image render concurrency; each post consumes at most one comment write.
  async function worker(){while(cursor<rows.length){const row=rows[cursor++];await work(row);processed++;}}
  await Promise.all([worker(),worker()]);return {processed};
}
