import {json,errorJson,readJson} from './http.js';
import {TOPIC_IMAGE_KEY,isHttpsImageUrl,parseSingleImageQuiz,serializeSingleImageQuiz,topicSource} from '../../scripts/psychology-topic-bank.js';
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
const available="i.enabled=1 AND NOT EXISTS(SELECT 1 FROM psychology_topic_image_uses u WHERE u.fingerprint=i.fingerprint)";
export async function imagePoolCounts(db,items){
 const ids=items.filter(t=>t.template==='psychology-target-2').map(t=>t.id);
 if(!ids.length)return items;
 const {results}=await db.prepare("SELECT i.topic_id,COUNT(*) total,SUM(CASE WHEN "+available+" THEN 1 ELSE 0 END) available,SUM(CASE WHEN EXISTS(SELECT 1 FROM psychology_topic_image_uses u WHERE u.fingerprint=i.fingerprint) THEN 1 ELSE 0 END) used FROM psychology_topic_images i WHERE i.topic_id IN (SELECT value FROM json_each(?)) GROUP BY i.topic_id").bind(JSON.stringify(ids)).all();
 const counts=new Map(results.map(r=>[r.topic_id,{total:r.total,available:r.available,used:r.used}]));
 return items.map(t=>t.template==='psychology-target-2'?{...t,imagePool:counts.get(t.id)||{total:0,available:0,used:0}}:t);
}
export async function imageBankCounts(db){
 return db.prepare("SELECT COUNT(DISTINCT i.fingerprint) availableImages,COUNT(DISTINCT i.topic_id) availableTopics FROM psychology_topic_images i JOIN psychology_template_topics t ON t.id=i.topic_id WHERE t.enabled=1 AND t.deleted_at=0 AND "+available).first();
}
export async function selectImageSources(db,config){
 const order={random:'RANDOM()',recent:'t.created_at DESC,t.id',priority:'t.priority DESC,t.created_at ASC,t.id','least-used':'t.usage_count ASC,t.last_used_at ASC,t.id'}[config.selection];
 if(!order)fail('抽取方式无效。');
 const {results}=await db.prepare("WITH candidates AS (SELECT t.*,i.id pool_image_id,i.image_key pool_image_key,i.image_url pool_image_url,ROW_NUMBER() OVER(PARTITION BY i.fingerprint ORDER BY "+order+") image_rank FROM psychology_template_topics t JOIN psychology_topic_images i ON i.topic_id=t.id WHERE t.template='psychology-target-2' AND t.enabled=1 AND t.deleted_at=0 AND "+available+" AND (?='' OR t.title LIKE ? OR t.content LIKE ? OR t.category LIKE ?)) SELECT * FROM candidates t WHERE image_rank=1 ORDER BY "+order+",RANDOM() LIMIT ?")
 .bind(config.query,'%'+config.query+'%','%'+config.query+'%','%'+config.query+'%',config.count).all();
 return results.map(row=>{
  const quiz=parseSingleImageQuiz(row.content);
  if(!quiz)fail('单图题目的四个选项不完整，请先编辑题目。');
  return {...topicSource({...row,content:serializeSingleImageQuiz({...quiz,imageKey:row.pool_image_key,imageUrl:row.pool_image_url})}),imageId:row.pool_image_id};
 });
}
export async function poolTopic(db,id){
 const topic=await db.prepare("SELECT * FROM psychology_template_topics WHERE id=? AND deleted_at=0 AND template='psychology-target-2'").bind(id).first();
 if(!topic)fail('单图题目不存在或已删除。',404);
 return topic;
}
export async function appendTopicImages(env,actor,id,input){
 const topic=await poolTopic(env.DB,id);
 if(!Number.isSafeInteger(input.revision)||input.revision!==topic.revision)fail('题目已修改，请重新打开图片管理后重试。',409);
 if(!Array.isArray(input.images)||!input.images.length||input.images.length>50)fail('每次补充 1–50 张图片。');
 const images=[];
 for(const raw of input.images){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('图片须为对象。');
  let imageKey=raw.imageKey||'',imageUrl=raw.imageUrl||'',fingerprint='';
  if(raw.assetId){
   const asset=await env.DB.prepare("SELECT * FROM factory_assets WHERE id=? AND owner_id=? AND status='ready'").bind(raw.assetId,actor).first();
   if(!asset)fail('素材不存在或不属于当前账号。',403);
   imageKey=asset.object_key;imageUrl='';fingerprint='sha256:'+asset.sha256;
  }
  if(imageKey){
   if(typeof imageKey!=='string'||!TOPIC_IMAGE_KEY.test(imageKey))fail('图片地址无效。');
   const file=await env.DB.prepare('SELECT fingerprint FROM psychology_topic_image_files WHERE object_key=?').bind(imageKey).first();
   if(!file&&!await env.ARCHIVE?.head(imageKey))fail('图片尚未上传或不存在。');
   fingerprint=fingerprint||file?.fingerprint||'key:'+imageKey;imageUrl='';
  }else{
   if(typeof imageUrl!=='string'||!isHttpsImageUrl(imageUrl))fail('请提供已上传图片或有效的 HTTPS 图片地址。');
   fingerprint='url:'+imageUrl;
  }
  images.push({imageKey,imageUrl,fingerprint});
 }
 const stamp=Date.now();
 // Parent revision predicates are evaluated in the same transaction as every image insert.
 const statements=[env.DB.prepare("UPDATE psychology_template_topics SET updated_at=updated_at WHERE id=? AND revision=? AND deleted_at=0").bind(id,input.revision)];
 for(const image of images)statements.push(env.DB.prepare("INSERT OR IGNORE INTO psychology_topic_images(id,topic_id,image_key,image_url,fingerprint,created_at) SELECT ?,id,?,?,?,? FROM psychology_template_topics WHERE id=? AND revision=? AND deleted_at=0")
 .bind('image-'+crypto.randomUUID(),image.imageKey,image.imageUrl,image.fingerprint,stamp,id,input.revision));
 const result=await env.DB.batch(statements);
 if(!result[0].meta?.changes)fail('题目已修改，请刷新后重试。',409);
 const created=result.slice(1).reduce((n,r)=>n+Number(r.meta?.changes||0),0);
 return {ok:true,created,skipped:images.length-created};
}
export async function handleTopicImages(request,env,url,actor,id,imageId){
 const topic=await poolTopic(env.DB,id);
 if(request.method==='GET'&&!imageId){
  const page=Math.max(1,Math.min(100000,Math.floor(Number(url.searchParams.get('page'))||1))),pageSize=20;
  const total=await env.DB.prepare('SELECT COUNT(*) n FROM psychology_topic_images WHERE topic_id=?').bind(id).first();
  const {results}=await env.DB.prepare("SELECT i.*,u.drawn_at,u.item_id FROM psychology_topic_images i LEFT JOIN psychology_topic_image_uses u ON u.fingerprint=i.fingerprint WHERE topic_id=? ORDER BY i.created_at DESC,i.id LIMIT ? OFFSET ?").bind(id,pageSize,(page-1)*pageSize).all();
  return json({topicId:id,revision:topic.revision,page,pageSize,total:total.n,hasMore:page*pageSize<total.n,items:results.map(i=>({id:i.id,imageKey:i.image_key,imageUrl:i.image_url,previewUrl:i.image_key?(url.pathname.startsWith('/api/integrations/')?url.origin+'/api/integrations/psychology/template-topics/assets?key=':'/api/psychology-template-topics/assets?key=')+encodeURIComponent(i.image_key):i.image_url,enabled:!!i.enabled,status:i.item_id?'used':i.enabled?'available':'disabled',drawnAt:i.drawn_at||0,itemId:i.item_id||''}))});
 }
 if(request.method==='POST'&&!imageId)return json(await appendTopicImages(env,actor,id,await readJson(request)),201);
 if(request.method==='PATCH'&&imageId){
  const input=await readJson(request);
  if(input.revision!==topic.revision)fail('题目已修改，请刷新后重试。',409);
  if(typeof input.enabled!=='boolean')fail('请提供 enabled。');
  const result=await env.DB.prepare("UPDATE psychology_topic_images SET enabled=? WHERE id=? AND topic_id=? AND EXISTS(SELECT 1 FROM psychology_template_topics WHERE id=? AND revision=? AND deleted_at=0)")
   .bind(input.enabled?1:0,imageId,id,id,input.revision).run();
  if(!result.meta?.changes)fail('图片或题目已变化，请刷新。',409);
  return json({ok:true});
 }
 return errorJson('不支持此请求方法。',405);
}

