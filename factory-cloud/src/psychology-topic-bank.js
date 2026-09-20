import { json,errorJson,readJson,sha256Hex,randomToken } from "./http.js";
import { TOPIC_TEMPLATES,validateTopicTemplate,normalizeTopic,collectTopicWriteItems,topicFingerprintText,topicSource } from "../../scripts/psychology-topic-bank.js";
export const PSYCHOLOGY_TOPIC_API="/api/integrations/psychology/template-topics";
const BASE="/api/psychology-template-topics";
export function assertTopicBankUser(user){
  if(!user || user.role!=="admin" || !(user.sidebarModules||[]).includes("psychology-topic-bank"))
    throw Object.assign(new Error("没有模板题库管理权限。"),{statusCode:403});
}
const publicTopic=row=>({id:row.id,template:row.template,title:row.title,content:row.content,category:row.category,priority:row.priority,enabled:Boolean(row.enabled),usageCount:row.usage_count,lastUsedAt:row.last_used_at,revision:row.revision,createdAt:row.created_at});
export async function topicCounts(db){
  const{results}=await db.prepare("SELECT template,COUNT(*) AS total,SUM(enabled) AS enabled,SUM(CASE WHEN enabled=1 AND usage_count=0 THEN 1 ELSE 0 END) AS unused FROM psychology_template_topics WHERE deleted_at=0 GROUP BY template").all();
  return Object.fromEntries(TOPIC_TEMPLATES.map(t=>[t.id,results.find(r=>r.template===t.id)||{total:0,enabled:0,unused:0}]));
}
export async function selectTopicSources(db,config){
  validateTopicTemplate(config.template);
  const order={random:"RANDOM()",recent:"created_at DESC,id",priority:"priority DESC,created_at ASC,id","least-used":"usage_count ASC,last_used_at ASC,priority DESC,id"}[config.selection];
  if(!order)throw Object.assign(new Error("题库抽取规则无效。"),{statusCode:400});
  const{results}=await db.prepare("SELECT * FROM psychology_template_topics WHERE template=? AND enabled=1 AND deleted_at=0"+
    (config.onlyUnused?" AND usage_count=0":"")+" AND (?='' OR title LIKE ? OR content LIKE ? OR category LIKE ?) ORDER BY "+order+" LIMIT ?")
    .bind(config.template,config.query,"%"+config.query+"%","%"+config.query+"%","%"+config.query+"%",config.count).all();
  return results.map(topicSource);
}
export function topicUsageStatement(db,source,batchId,itemId,config,stamp){
  return db.prepare("INSERT INTO psychology_topic_usage(topic_id,batch_id,item_id,template,revision,only_unused,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(source.id,batchId,itemId,config.template,source.revision,config.onlyUnused?1:0,stamp);
}
const reject=(message,statusCode)=>{throw Object.assign(new Error(message),{statusCode});};
async function readImport(request){
  if(!/^application\/json(?:;|$)/i.test(request.headers.get("content-type")||""))reject("请使用 Content-Type: application/json。",415);
  const limit=1024*1024;
  if(Number(request.headers.get("content-length"))>limit)reject("请求最多 1 MB。",413);
  if(!request.body)reject("请提交 JSON 题目数据。",400);
  const reader=request.body.getReader(),chunks=[];let size=0;
  while(true){
    const{value,done}=await reader.read();if(done)break;
    size+=value.byteLength;
    if(size>limit){await reader.cancel();reject("请求最多 1 MB。",413);}
    chunks.push(value);
  }
  const body=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(body));}catch{reject("请求体不是有效 JSON。",400);}
}
async function externalActor(request,db){
  const token=(request.headers.get("authorization")||"").match(/^Bearer (\S+)$/i)?.[1];
  if(!token||!token.startsWith("psy_topics_")||token.length>200)reject("请提供模板题库专用 Bearer API Key。",401);
  const key=await db.prepare(`SELECT k.owner_id FROM psychology_template_topic_keys k
    JOIN factory_users u ON u.id = k.owner_id WHERE k.token_hash = ? AND u.active = 1 AND u.role = 'admin'`)
    .bind(await sha256Hex(token)).first();
  if(!key)reject("API Key 无效、已停用或所属账号不可用。",401);
  return key.owner_id;
}
export async function writeIntegrationTopics(db,input,actor){
  const topics=collectTopicWriteItems(input);
  const stamp=Date.now(),statements=[],planned=[];
  for(const topic of topics){
    const fingerprint=await sha256Hex(topicFingerprintText(topic));
    const id="topic-"+fingerprint;
    planned.push({id,topic});
    statements.push(db.prepare("INSERT OR IGNORE INTO psychology_template_topics(id,template,title,content,category,priority,enabled,fingerprint,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id,topic.template,topic.title,topic.content,topic.category,topic.priority,topic.enabled?1:0,fingerprint,actor,stamp,stamp));
  }
  const result=await db.batch(statements);
  const items=planned.map((row,index)=>({id:row.id,template:row.topic.template,title:row.topic.title,status:Number(result[index].meta?.changes||0)?"created":"skipped"}));
  const created=items.filter(item=>item.status==="created").length;
  return {accepted:topics.length,created,skipped:topics.length-created,items};
}
export async function handlePsychologyTopicBank(request,env,url,session){
  const external=url.pathname===PSYCHOLOGY_TOPIC_API;
  if(!external && !url.pathname.startsWith(BASE))return null;
  try{
    const db=env.DB;
    if(external){
      const actor=await externalActor(request,db);
      if(request.method!=="POST")return errorJson("此密钥仅支持 POST 写入模板题库。",405);
      return json(await writeIntegrationTopics(db,await readImport(request),actor));
    }
    if(!session)return errorJson("请先登录。",401);
    assertTopicBankUser(session.user);
    const user=session.user;
    if(url.pathname===BASE+"/api-key"){
      if(request.method!=="GET" && request.headers.get("origin") && request.headers.get("origin")!==url.origin)return errorJson("不允许跨站修改。",403);
      if(request.method==="GET"){
        const key=await db.prepare("SELECT token_prefix, created_at FROM psychology_template_topic_keys WHERE owner_id = ?").bind(user.id).first();
        return json({configured:Boolean(key),prefix:key?.token_prefix||"",createdAt:key?.created_at||null,endpoint:PSYCHOLOGY_TOPIC_API});
      }
      if(request.method==="POST"){
        const apiKey="psy_topics_"+randomToken(32),createdAt=Date.now();
        await db.prepare(`INSERT INTO psychology_template_topic_keys(owner_id,token_hash,token_prefix,created_at) VALUES(?,?,?,?)
          ON CONFLICT(owner_id) DO UPDATE SET token_hash=excluded.token_hash,token_prefix=excluded.token_prefix,created_at=excluded.created_at`)
          .bind(user.id,await sha256Hex(apiKey),apiKey.slice(0,18),createdAt).run();
        return json({apiKey,createdAt,endpoint:PSYCHOLOGY_TOPIC_API},201);
      }
      if(request.method==="DELETE"){
        await db.prepare("DELETE FROM psychology_template_topic_keys WHERE owner_id = ?").bind(user.id).run();
        return json({ok:true});
      }
      return errorJson("不支持此请求方法。",405);
    }
    if(url.pathname===BASE && request.method==="GET"){
      const template=validateTopicTemplate(url.searchParams.get("template")||"psychology"),query=(url.searchParams.get("query")||"").slice(0,100);
      const enabled=url.searchParams.get("enabled")||"all";
      if(!["all","active","inactive"].includes(enabled))return errorJson("启用筛选无效。",400);
      const page=Math.max(1,Math.min(100000,Math.floor(Number(url.searchParams.get("page"))||1)));
      const where="template=? AND deleted_at=0"+(enabled==="active"?" AND enabled=1":enabled==="inactive"?" AND enabled=0":"")+" AND (?='' OR title LIKE ? OR content LIKE ? OR category LIKE ?)";
      const args=[template,query,"%"+query+"%","%"+query+"%","%"+query+"%"];
      const[total,rows,counts]=await Promise.all([
        db.prepare("SELECT COUNT(*) AS n FROM psychology_template_topics WHERE "+where).bind(...args).first(),
        db.prepare("SELECT * FROM psychology_template_topics WHERE "+where+" ORDER BY created_at DESC,id LIMIT 20 OFFSET ?").bind(...args,(page-1)*20).all(),topicCounts(db)]);
      return json({templates:TOPIC_TEMPLATES,counts,total:total.n,page,items:rows.results.map(publicTopic)});
    }
    if(url.pathname===BASE+"/import" && request.method==="POST"){
      const input=await readJson(request),template=validateTopicTemplate(input.template);
      if(!/^[0-9a-f-]{36}$/i.test(String(input.requestId||"")))return errorJson("提交编号无效，请重试。",400);
      if(!Array.isArray(input.items)||!input.items.length||input.items.length>100)return errorJson("每次可导入1–100条题目。",400);
      const topics=input.items.map((item,index)=>{try{return normalizeTopic(item,template);}catch(error){throw Object.assign(error,{message:"第"+(index+1)+"条："+error.message});}});
      const id=await sha256Hex(user.username+":"+input.requestId),hash=await sha256Hex(JSON.stringify(topics));
      const prior=await db.prepare("SELECT * FROM psychology_topic_imports WHERE id=?").bind(id).first();
      if(prior){if(prior.payload_hash!==hash)return errorJson("该提交编号对应的内容已改变，请重新提交。",409);return json({duplicate:true,received:topics.length});}
      const stamp=Date.now(),statements=[db.prepare("INSERT INTO psychology_topic_imports(id,payload_hash,created_by,created_at) VALUES (?,?,?,?)").bind(id,hash,user.username,stamp)];
      for(const[index,topic]of topics.entries()){
        statements.push(db.prepare("INSERT OR IGNORE INTO psychology_template_topics(id,template,title,content,category,priority,enabled,fingerprint,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
          .bind("topic-"+id.slice(0,32)+"-"+index,template,topic.title,topic.content,topic.category,topic.priority,topic.enabled?1:0,await sha256Hex(topicFingerprintText(topic)),user.username,stamp,stamp));
      }
      try{
        const result=await db.batch(statements);const created=result.slice(1).reduce((n,r)=>n+Number(r.meta?.changes||0),0);
        return json({received:topics.length,created,skipped:topics.length-created},201);
      }catch(error){
        const winner=await db.prepare("SELECT * FROM psychology_topic_imports WHERE id=?").bind(id).first();
        if(winner?.payload_hash===hash)return json({duplicate:true,received:topics.length});
        throw error;
      }
    }
    const match=url.pathname.match(/^\/api\/psychology-template-topics\/(topic-[a-z0-9-]+)$/);
    if(match&&["PATCH","DELETE"].includes(request.method)){
      const row=await db.prepare("SELECT * FROM psychology_template_topics WHERE id=? AND deleted_at=0").bind(match[1]).first();
      if(!row)return errorJson("题目不存在或已删除。",404);
      const input=await readJson(request);
      if(Number(input.revision)!==row.revision)return errorJson("题目已被修改，请刷新后重试。",409);
      let statement;
      if(request.method==="DELETE")statement=db.prepare("UPDATE psychology_template_topics SET deleted_at=?,enabled=0,revision=revision+1 WHERE id=? AND revision=? AND deleted_at=0").bind(Date.now(),row.id,row.revision);
      else{
        const topic=normalizeTopic({...row,...input},row.template);
        statement=db.prepare("UPDATE psychology_template_topics SET title=?,content=?,category=?,priority=?,enabled=?,fingerprint=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND deleted_at=0")
          .bind(topic.title,topic.content,topic.category,topic.priority,topic.enabled?1:0,await sha256Hex(topicFingerprintText(topic)),Date.now(),row.id,row.revision);
      }
      try{const result=await statement.run();if(!result.meta?.changes)return errorJson("题目已变化，请刷新重试。",409);}
      catch(error){if(String(error.message).includes("UNIQUE"))return errorJson("当前题库已存在相同题目和内容。",409);throw error;}
      return json({ok:true});
    }
    return errorJson("不支持此请求。",405);
  }catch(error){return errorJson(error.message||"题库操作失败。",error.statusCode||400);}
}
