import {json} from './http.js';
import {videoHitUser,allFrames} from './psychology-video-hits.js';
import {hitAdmin,hitLibraryScope} from './psychology-video-hit-access.js';
import {hasPsychologyModule} from './psychology-permissions.js';
import {importSource,fail} from '../../scripts/psychology-video-hit-contract.js';
// Read-only readiness, evaluated before counts/pagination. Publication still revalidates and reserves.
export async function handleVideoHitReady(request,env,url,session){
 const mediaFile=url.pathname.match(/^\/api\/psychology-video-hits\/ready\/media\/([a-zA-Z0-9_-]+)\/file$/);
 if(url.pathname!=='/api/psychology-video-hits/ready'&&!mediaFile)return null;
 if(mediaFile&&['GET','HEAD'].includes(request.method)){
  const user=await videoHitUser(env.DB,session?.user),scope=hitLibraryScope(user);
  const a=await env.DB.prepare("SELECT a.* FROM psychology_video_assets a WHERE a.id=? AND "+scope.sql+" AND a.status='ready' AND a.cleanup_state='active' AND (EXISTS(SELECT 1 FROM psychology_video_hit_videos d WHERE d.id=a.id AND d.cleanup_state='active') OR EXISTS(SELECT 1 FROM psychology_video_hit_render_assets r WHERE r.asset_id=a.id))").bind(mediaFile[1],...scope.args).first();
  if(!a)fail('成片不可用或无权访问。',404);const object=await env.ARCHIVE.get(a.r2_key,{range:request.headers});if(!object)fail('成片文件已失效。',404);
  const headers=new Headers({'Content-Type':a.content_type,'Cache-Control':'private, no-store','Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff'}),range=object.range;
  if(range?.length){headers.set('Content-Range','bytes '+range.offset+'-'+(range.offset+range.length-1)+'/'+object.size);headers.set('Content-Length',String(range.length));}else headers.set('Content-Length',String(object.size));
  return new Response(request.method==='HEAD'?null:object.body,{status:range?.length?206:200,headers});
 }
 if(request.method!=='GET'||mediaFile)fail('请求方法不存在。',405);
 const user=await videoHitUser(env.DB,session?.user),p=url.searchParams,page=Number(p.get('page')||1),size=12,media=p.get('mediaType')||'all',q=(p.get('q')||'').slice(0,100),importer=p.get('importSource')?importSource(p.get('importSource')):'',id=p.get('sourceId')||'',version=Number(p.get('version')||0),revision=Number(p.get('revision')||0);
 if(!Number.isInteger(page)||page<1||page>10000||!['all','photo','video'].includes(media))fail('筛选或页码无效。');
 if((id||version||revision)&&(!/^vh-[a-f0-9]{32}$/.test(id)||!Number.isInteger(version)||version<1||version>2147483647||!Number.isSafeInteger(revision)||revision<1))fail('素材标识无效。');
 const cte=`WITH candidates AS (
 SELECT v.*,s.title source_title,s.external_id,s.import_source,s.owner_id,u.username owner_username,
 (v.input_mode='frames' AND
  (SELECT COUNT(*) FROM psychology_video_hit_frames f WHERE f.source_id=v.source_id AND f.version=v.version) BETWEEN 1 AND 15 AND
  (SELECT MIN(frame_index) FROM psychology_video_hit_frames f WHERE f.source_id=v.source_id AND f.version=v.version)=1 AND
  (SELECT MAX(frame_index) FROM psychology_video_hit_frames f WHERE f.source_id=v.source_id AND f.version=v.version)=(SELECT COUNT(*) FROM psychology_video_hit_frames f WHERE f.source_id=v.source_id AND f.version=v.version) AND
  NOT EXISTS(SELECT 1 FROM psychology_video_hit_frames f WHERE f.source_id=v.source_id AND f.version=v.version AND ((f.asset_id='' AND f.image_url='') OR (f.asset_id<>'' AND NOT EXISTS(SELECT 1 FROM psychology_video_hit_assets a WHERE a.id=f.asset_id AND a.cleanup_state='active'))))) can_photo,
 (SELECT a.id FROM psychology_video_assets a WHERE a.status='ready' AND a.cleanup_state='active' AND (
  (v.input_mode='video' AND a.id=v.video_asset_id AND EXISTS(SELECT 1 FROM psychology_video_hit_videos d JOIN factory_users uploader ON uploader.id=d.owner_id WHERE d.id=a.id AND d.cleanup_state='active' AND a.owner=uploader.username AND NOT EXISTS(SELECT 1 FROM psychology_video_hit_video_usage used WHERE used.owner_id=d.owner_id AND used.digest=d.digest))) OR
  (v.input_mode='frames' AND v.render_revision=v.revision AND v.render_source_revision=s.revision AND a.source_job_id=v.render_job_id AND a.result_index=0 AND EXISTS(SELECT 1 FROM factory_jobs j WHERE j.id=v.render_job_id AND j.status='done' AND j.worker_id<>'' AND json_extract(j.result_json,'$.results[0].fileName') IS NOT NULL) AND EXISTS(SELECT 1 FROM psychology_video_hit_render_assets r WHERE r.asset_id=a.id AND r.source_id=v.source_id AND r.version=v.version))
 ) ORDER BY a.created_at DESC,a.id LIMIT 1) ready_asset_id
 FROM psychology_video_hit_versions v JOIN psychology_video_hits s ON s.id=v.source_id LEFT JOIN factory_users u ON u.id=s.owner_id
 WHERE (s.owner_id=? OR ?=1) AND s.archived_at=0 AND v.enabled=1 AND v.cleaned_at=0 AND v.publish_item_id='' AND v.publish_state<>'published' AND v.published_at=0
 AND NOT EXISTS(SELECT 1 FROM psychology_peer_account_usage used WHERE used.source_id=v.source_id||':v'||v.version)
 AND (?='' OR s.import_source=?) AND (v.title LIKE ? OR v.caption LIKE ? OR s.title LIKE ? OR s.external_id LIKE ?)
 AND (?='' OR (v.source_id=? AND v.version=? AND v.revision=?))
 ), ready AS (SELECT * FROM candidates WHERE can_photo=1 OR ready_asset_id IS NOT NULL) `;
 const args=[user.id,hitAdmin(user),importer,importer,...Array(4).fill('%'+q+'%'),id,id,version,revision];
 const filter=media==='photo'?'can_photo=1':media==='video'?'ready_asset_id IS NOT NULL':'1=1';
 const [counts,rows]=await Promise.all([
  env.DB.prepare(cte+'SELECT COUNT(*) total,COALESCE(SUM(can_photo),0) photos,COUNT(ready_asset_id) videos FROM ready').bind(...args).first(),
  env.DB.prepare(cte+'SELECT * FROM ready WHERE '+filter+' ORDER BY updated_at DESC,source_id,version LIMIT ? OFFSET ?').bind(...args,size,(page-1)*size).all()
 ]);
 const total=media==='photo'?counts.photos:media==='video'?counts.videos:counts.total;
 const items=await Promise.all(rows.results.map(async v=>({ref:{sourceId:v.source_id,version:v.version,revision:v.revision},title:v.title,caption:v.caption||v.title,name:v.name,sourceTitle:v.source_title,externalId:v.external_id,importSource:v.import_source,ownerUsername:v.owner_username||'',canPhoto:Boolean(v.can_photo),canVideo:Boolean(v.ready_asset_id),assetId:v.ready_asset_id||'',previewUrl:v.ready_asset_id?'/api/psychology-video-hits/ready/media/'+v.ready_asset_id+'/file':'',frames:v.can_photo?(await allFrames(env.DB,v.source_id,v.version)).map(f=>({index:f.index,previewUrl:f.previewUrl,text:f.text})):[],updatedAt:v.updated_at})));
 if(id&&!items.length)fail('这条素材已修改、已提交发布或尚未准备好，请返回待发布素材刷新后重新选择。',409);
 return json({page,pageSize:size,total,hasMore:page*size<total,counts,canPublish:hasPsychologyModule(user,'psychology-publish'),items});
}
