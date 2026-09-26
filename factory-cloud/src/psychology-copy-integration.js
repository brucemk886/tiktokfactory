import {json,sha256Hex} from './http.js';
import {photoCopyKey} from './peer-photo-copy-cache.js';
import {normalizePsychologyPeerHit,psychologyPeerHitFromRow} from './psychology-peer-hits-store.js';
import {normalizeVariant} from './psychology-creative.js';
import {checkRewrite,checkSharedLines} from './psychology-rewrite-quality.js';
import {filterPhotoPageTexts} from './photo-page-filter.js';

export const PSYCHOLOGY_COPY_API='/api/integrations/psychology/copy-library';
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
const parse=value=>JSON.parse(value||'{}');
const sourceKey=row=>{try{return photoCopyKey(row.source_url);}catch{return row.id;}};
const ORIGINAL_GUARD=['id','updated_at','content_json','source_json','title','status','attempt'];
const VARIANT_GUARD=['id','owner','title','caption','pages_json','enabled','comparison_json','quality_score','score_reason','rewrite_model','review_status','reviewed_at','deleted_at'];
const guard=(row,fields)=>({sql:fields.map(k=>`${k} IS ?`).join(' AND '),args:fields.map(k=>row[k]??null)});
const revision=(row,fields)=>sha256Hex(JSON.stringify(fields.map(k=>row[k]??null)));
function checkPatch(input,fields){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('请提交 JSON 修改对象。');
 if(Object.keys(input).some(k=>!['revision',...fields].includes(k)))fail('包含只读或未知字段，请仅提交 revision 和要修改的字段。');
 if(!Object.keys(input).some(k=>k!=='revision'))fail('请至少提交一个修改字段。');
}
const text=(value,limit,field,empty=true)=>{
 if(typeof value!=='string'||value.length>limit||(!empty&&!value.trim()))fail(`${field} 须为${empty?'':'非空'}文本，最多 ${limit} 字符。`);
 return value.trim();
};
function strings(value,maxItems,maxLength,field){
 if(!Array.isArray(value)||value.length>maxItems)fail(`${field} 须为最多 ${maxItems} 项的文本数组。`);
 return value.map(v=>text(v,maxLength,field,false));
}
function paging(url){
 const page=Number(url.searchParams.get('page')||1),pageSize=Number(url.searchParams.get('pageSize')||20);
 if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)fail('page 须为 1–100000，pageSize 须为 1–100 的整数。');
 return {page,pageSize};
}
const pageMeta=(total,page,pageSize)=>({total,page,pageSize,totalPages:Math.max(1,Math.ceil(total/pageSize)),hasMore:page*pageSize<total});
async function originalItem(db,row,providedPeer){
 const peer=providedPeer!==undefined?providedPeer:await db.prepare('SELECT * FROM psychology_peer_hits WHERE id=?').bind(row.id).first();
 return {id:row.id,sourceKey:sourceKey(row),mediaType:row.media_type,title:row.title,sourceUrl:row.source_url,status:row.status,content:parse(row.content_json),error:row.error,createdAt:row.created_at,updatedAt:row.updated_at,revision:await revision(row,ORIGINAL_GUARD),peer:psychologyPeerHitFromRow(peer)};
}
async function variantItem(row){
 return {id:row.id,externalId:row.external_id,sourceKey:row.source_key,title:row.title,caption:row.caption,pages:JSON.parse(row.pages_json),enabled:!!row.enabled,rewriteModel:row.rewrite_model,score:row.quality_score,scoreReason:row.score_reason,comparison:row.comparison_json?parse(row.comparison_json):null,reviewStatus:row.review_status,reviewReason:row.review_reason,rawResponse:row.raw_response,createdAt:row.created_at,revision:await revision(row,VARIANT_GUARD)};
}
async function patchOriginal(db,row,input){
 checkPatch(input,['title','caption','pages','transcript','onScreenText','topics','topComments','topCommentsNote']);
 if(input.revision!==await revision(row,ORIGINAL_GUARD))fail('文案已变化或 revision 缺失，请重新读取后核对修改。',409);
 if(row.status==='running')fail('文案正在提取，请提取完成后再修改。',409);
 const content={...parse(row.content_json),mediaType:row.media_type};
 const title=Object.hasOwn(input,'title')?text(input.title,2000,'title',false):row.title;
 content.title=title;
 if(Object.hasOwn(input,'caption'))content.caption=text(input.caption,12000,'caption');
 if(row.media_type==='photo'){
  if(Object.hasOwn(input,'transcript')||Object.hasOwn(input,'onScreenText'))fail('图文请使用 pages，视频请使用 transcript/onScreenText。');
  if(Object.hasOwn(input,'pages')){
   const pages=strings(input.pages,6,10000,'pages');
   if(!pages.length||filterPhotoPageTexts(pages).length!==pages.length)fail('pages 须包含 1–6 页有效正文，每页最多 500 字符，不接受纯页码或符号。');
   content.pages=pages.map((text,index)=>({index:index+1,text}));
  }
 }else{
  if(Object.hasOwn(input,'pages'))fail('视频原文请使用 transcript/onScreenText。');
  if(Object.hasOwn(input,'transcript'))content.transcript=text(input.transcript,12000,'transcript',false);
  if(Object.hasOwn(input,'onScreenText'))content.onScreenText=strings(input.onScreenText,100,2000,'onScreenText');
 }
 const complete=row.media_type==='photo'?content.pages?.length>0:!!content.transcript?.trim();
 const editsText=['title','caption','pages','transcript','onScreenText'].some(k=>Object.hasOwn(input,k));
 if(editsText&&!complete)fail('请同时补齐图文 pages 或视频 transcript，再保存文案。');
 const peer=await db.prepare('SELECT * FROM psychology_peer_hits WHERE id=?').bind(row.id).first();
 const metadata=['topics','topComments','topCommentsNote'].filter(k=>Object.hasOwn(input,k));
 if(metadata.length&&!peer)fail('原帖来源记录不存在，无法修改题材或评论。',409);
 const normalized=metadata.length?await normalizePsychologyPeerHit({videoUrl:row.source_url,mediaType:row.media_type,...Object.fromEntries(metadata.map(k=>[k,input[k]]))}):null;
 if(Object.hasOwn(input,'topics')&&!normalized.topics?.length)fail('topics 须有 1–3 个题材。');
 if(Object.hasOwn(input,'topComments')&&!Array.isArray(input.topComments))fail('topComments 须为数组。');
 const source={...parse(row.source_json),title};
 source.videoData={...(source.videoData||{}),...(editsText?{copy:content.caption||'',caption:content.caption||'',...(row.media_type==='photo'?{pageTexts:content.pages.map(p=>p.text)}:{transcript:content.transcript,onScreenText:content.onScreenText||[]})}:{})};
 if(normalized)for(const k of metadata)source.videoData[k]=normalized[k];
 const old=guard(row,ORIGINAL_GUARD),stamp=Math.max(Date.now(),row.updated_at+1);
 const exists=`EXISTS (SELECT 1 FROM psychology_copy_library WHERE ${old.sql})`;
 const statements=[];
 // Every dependent write uses the same compare-and-set guard; D1 batch is atomic.
 if(peer){
  const data={...parse(peer.video_data_json),...source.videoData};
  statements.push(db.prepare(`UPDATE psychology_peer_hits SET title=?,video_data_json=?,topics_json=?,comments_json=?,comments_note=?,updated_at=? WHERE id=? AND ${exists}`)
   .bind(title,JSON.stringify(data),Object.hasOwn(input,'topics')?JSON.stringify(normalized.topics):peer.topics_json,Object.hasOwn(input,'topComments')?JSON.stringify(normalized.topComments):peer.comments_json,Object.hasOwn(input,'topCommentsNote')?normalized.topCommentsNote:peer.comments_note,stamp,row.id,...old.args));
 }
 if(editsText)statements.push(db.prepare(`DELETE FROM psychology_photo_copy_cache WHERE source_key=? AND ${exists}`).bind(sourceKey(row),...old.args));
 statements.push(db.prepare(`UPDATE psychology_copy_library SET title=?,content_json=?,source_json=?,updated_at=?,attempt=attempt+?,status=?,error=?,provider=?,completed_at=? WHERE ${old.sql} RETURNING id`)
  .bind(title,JSON.stringify(content),JSON.stringify(source),stamp,editsText?1:0,editsText?'done':row.status,editsText?'':row.error,editsText?'api-edited':row.provider,editsText?stamp:row.completed_at,...old.args));
 const results=await db.batch(statements);
 if(!results.at(-1).results?.length)fail('文案已变化，请重新读取后重试。',409);
 return originalItem(db,await db.prepare('SELECT * FROM psychology_copy_library WHERE id=?').bind(row.id).first());
}
async function patchVariant(db,row,source,input){
 checkPatch(input,['title','caption','pages','enabled','rewriteModel','score','scoreReason','comparison']);
 if(input.revision!==await revision(row,VARIANT_GUARD))fail('改写版本已变化或 revision 缺失，请重新读取。',409);
 if(Object.hasOwn(input,'enabled')&&typeof input.enabled!=='boolean')fail('enabled 须为布尔值。');
 const contentChanged=['title','caption','pages'].some(k=>Object.hasOwn(input,k)&&JSON.stringify(input[k])!==JSON.stringify(k==='pages'?JSON.parse(row.pages_json):row[k]));
 if(row.review_status!=='approved'&&input.enabled===true)fail('未通过质检的版本须在页面人工审核，API 不能直接启用。',409);
 const variant=normalizeVariant({externalId:row.external_id,sourceKey:row.source_key,title:row.title,caption:row.caption,pages:JSON.parse(row.pages_json),rewriteModel:row.rewrite_model,score:contentChanged?null:row.quality_score,scoreReason:contentChanged?'':row.score_reason,comparison:contentChanged?null:(row.comparison_json?parse(row.comparison_json):null),...input});
 if(contentChanged){
  checkRewrite(variant,(parse(source.content_json).pages||[]).map(p=>p.text));
  await checkSharedLines(db,[{sourceKey:row.source_key,pages:variant.pages,label:'API 修改'}]);
 }
 const fingerprint=await sha256Hex(JSON.stringify([row.source_key,variant.title,variant.caption,variant.pages]));
 const old=guard(row,VARIANT_GUARD);
 const result=await db.prepare(`UPDATE psychology_copy_variants SET title=?,caption=?,pages_json=?,fingerprint=?,enabled=?,rewrite_model=?,quality_score=?,score_reason=?,comparison_json=? WHERE ${old.sql}`)
  .bind(variant.title,variant.caption,JSON.stringify(variant.pages),fingerprint,Object.hasOwn(input,'enabled')?(input.enabled?1:0):row.enabled,variant.rewriteModel,variant.score,variant.scoreReason,variant.comparison?JSON.stringify(variant.comparison):'',...old.args).run();
 if(!result.meta?.changes)fail('改写版本已变化，请重新读取。',409);
 return variantItem(await db.prepare('SELECT * FROM psychology_copy_variants WHERE id=? AND owner=?').bind(row.id,row.owner).first());
}
export async function handleCopyIntegration(request,env,url,actor,readBody){
 const db=env.DB,path=url.pathname.slice(PSYCHOLOGY_COPY_API.length);
 if(!['GET','PATCH'].includes(request.method))fail('文案库支持 GET 和 PATCH；新增仍使用原同行爆款 POST 接口。',405);
 if(!path&&request.method==='GET'){
  const {page,pageSize}=paging(url),media=url.searchParams.get('mediaType')||'all',status=url.searchParams.get('status')||'done';
  if(!['all','photo','video'].includes(media)||!['all','done','queued','running','failed'].includes(status))fail('mediaType 或 status 无效。');
  const query='%'+String(url.searchParams.get('q')||'').slice(0,200)+'%';
  const where="(?='all' OR media_type=?) AND (?='all' OR status=?) AND (title LIKE ? OR content_json LIKE ? OR source_url LIKE ? OR id LIKE ?)";
  const args=[media,media,status,status,query,query,query,query];
  const total=(await db.prepare('SELECT COUNT(*) n FROM psychology_copy_library WHERE '+where).bind(...args).first()).n;
  const rows=(await db.prepare('SELECT * FROM psychology_copy_library WHERE '+where+' ORDER BY created_at DESC,id LIMIT ? OFFSET ?').bind(...args,pageSize,(page-1)*pageSize).all()).results;
  const peers=rows.length?(await db.prepare('SELECT * FROM psychology_peer_hits WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(rows.map(r=>r.id))).all()).results:[];
  const byId=new Map(peers.map(r=>[r.id,r]));
  return json({...pageMeta(total,page,pageSize),items:await Promise.all(rows.map(row=>originalItem(db,row,byId.get(row.id)||null)))});
 }
 const match=path.match(/^\/(psy-[a-f0-9]{32})(?:\/(rewrites)(?:\/([a-f0-9]{64}))?)?$/);
 if(!match)fail('接口地址不存在。',404);
 const row=await db.prepare('SELECT * FROM psychology_copy_library WHERE id=?').bind(match[1]).first();
 if(!row)fail('文案不存在。',404);
 if(!match[2])return json({item:request.method==='GET'?await originalItem(db,row):await patchOriginal(db,row,await readBody(request))});
 const owner=(await db.prepare('SELECT username FROM factory_users WHERE id=?').bind(actor).first())?.username;
 if(!owner)fail('所属管理员账号不可用。',401);
 if(!match[3]){
  if(request.method!=='GET')fail('请指定改写版本 ID。',405);
  const {page,pageSize}=paging(url),status=url.searchParams.get('status')||'all';
  const filters={all:'1=1',pending:"review_status='pending'",enabled:"review_status='approved' AND enabled=1",disabled:"review_status='approved' AND enabled=0"};
  if(!Object.hasOwn(filters,status))fail('改写状态无效。');
  const where='owner=? AND source_key=? AND deleted_at=0 AND '+filters[status],args=[owner,sourceKey(row)];
  const total=(await db.prepare('SELECT COUNT(*) n FROM psychology_copy_variants WHERE '+where).bind(...args).first()).n;
  const rows=(await db.prepare('SELECT * FROM psychology_copy_variants WHERE '+where+' ORDER BY quality_score DESC,created_at DESC,id LIMIT ? OFFSET ?').bind(...args,pageSize,(page-1)*pageSize).all()).results;
  return json({...pageMeta(total,page,pageSize),items:await Promise.all(rows.map(variantItem))});
 }
 const variant=await db.prepare('SELECT * FROM psychology_copy_variants WHERE id=? AND owner=? AND source_key=? AND deleted_at=0').bind(match[3],owner,sourceKey(row)).first();
 if(!variant)fail('改写版本不存在或不属于当前账号/原文。',404);
 return json({item:request.method==='GET'?await variantItem(variant):await patchVariant(db,variant,row,await readBody(request))});
}
