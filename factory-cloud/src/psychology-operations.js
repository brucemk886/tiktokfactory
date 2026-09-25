import { buildAutopilotReport } from '../../scripts/psychology-autopilot-report.js';
import { buildContentPerformance } from '../../scripts/psychology-content-performance.js';
import { copyIdentity } from './psychology-creative.js';
import { photoCopyKey } from './peer-photo-copy-cache.js';
import { json, errorJson } from "./http.js";
import { loadGroupStore, scopedAnalyticsAccounts } from "./official.js";
import { publicState, findProjectForModule, userAllowedGroupIds, normalizeAccountKey } from "../../scripts/official-account-group-store.js";
import { listLatestArchiveAccounts, accountsFromLatestArchive, loadVideosForAccounts } from "./official-archive-store.js";
import { buildOperationsReport, operationsWindow, parseObject } from "../../scripts/psychology-operations.js";
import { buildOpsFramework } from "../../scripts/psychology-ops-framework.js";
import { loadResolvedItems, EVOLUTION } from "./psychology-copy-evolution.js";

const DAY=86400000;
// Posts published in a period can come from batches created a few days earlier,
// and earlier uses of the same viral post can be older still.
const SCHEDULE_LEAD_MS=7*DAY,HISTORY_MS=30*DAY;

// The same framework numbers the report shows, for a given set of accounts.
export async function frameworkFor(env,{accounts,window,media="photo",videosByAccount,records,history,matureOnly=true}){
  videosByAccount=videosByAccount||await loadVideosForAccounts(env,env.DB,accounts.map(a=>a.schema),100);
  records=records||(await env.DB.prepare("SELECT value_json FROM factory_publish_records WHERE created_at>=? ORDER BY created_at DESC LIMIT 10000").bind(window.previousStart).all()).results.map(row=>parseObject(row.value_json));
  history=history||await loadResolvedItems(env.DB,window.previousStart-HISTORY_MS);
  const rows=buildContentPerformance({items:history.filter(i=>i.created_at>=window.previousStart-SCHEDULE_LEAD_MS),records,accounts,videosByAccount,media}).rows;
  if(media==='photo'){
    const peers=(await env.DB.prepare("SELECT video_url,topics_json FROM psychology_peer_hits WHERE media_type='photo'").all()).results||[];
    const bySource=new Map();
    for(const peer of peers){let key;try{key=photoCopyKey(peer.video_url);}catch{continue;}bySource.set(key,JSON.parse(peer.topics_json||'[]'));}
    for(const row of rows)row.topics=bySource.get(row.source)||[];
  }
  const framework=buildOpsFramework({rows,
    history,videosByAccount,accounts,window,media,matureOnly});
  return {framework,history,videosByAccount,records};
}

export async function handlePsychologyOperations(request, env, url, session) {
  if(url.pathname!=="/api/psychology-operations")return null;
  if(request.method!=="GET")return errorJson("仅支持读取报表。",405);
  const user=session?.user;
  if(!user || !(user.sidebarModules||[]).includes("psychology-ops-report"))return errorJson("没有心理学运营报表权限。",403);
  try {
    const window=operationsWindow(url.searchParams);
    const media=url.searchParams.get("media")||"photo",group=url.searchParams.get("group")||"";
    if(!["video","photo"].includes(media))return errorJson("内容类型无效。",400);
    const detailed=url.searchParams.get("details")==="1";
    const store=await loadGroupStore(env.DB), project=findProjectForModule(store,"psychology"), allowed=userAllowedGroupIds(user);
    const groups=publicState(store).groups.filter(g=>g.projectId===project?.id && (!allowed || allowed.has(g.id)));
    if(group && !groups.some(g=>g.id===group))return errorJson("没有这个分组的权限。",403);
    const archived=accountsFromLatestArchive(await listLatestArchiveAccounts(env.DB));
    const archivedKeys=new Set(archived.map(a=>normalizeAccountKey(a.schema)));
    // A group member without analytics yet still has publication/execution data.
    const unsynced=[...new Set(Object.keys(store.assignments||{}).map(normalizeAccountKey))].filter(key=>key&&!archivedKeys.has(key))
      .map(key=>({schema:'tiktok:'+key,connectionId:key,username:key,label:key,latestSyncAt:0}));
    const accounts=scopedAnalyticsAccounts([...archived,...unsynced],store,user,"psychology").filter(a=>!group||a.groupId===group);
    const groupIds=groups.filter(g=>!group||g.id===group).map(g=>g.id);
    const accountIds=JSON.stringify(accounts.map(a=>normalizeAccountKey(a.schema)));
    const [videosByAccount,recordRows,itemRows,history,autopilotRows]=await Promise.all([
      loadVideosForAccounts(env,env.DB,accounts.map(a=>a.schema),100,{concurrency:24,repair:false}),
      env.DB.prepare("SELECT value_json FROM factory_publish_records WHERE created_at>=? AND created_at<? ORDER BY created_at DESC LIMIT 10001").bind(window.previousStart,Date.now()+1).all(),
      env.DB.prepare(`SELECT i.id,i.source_id,i.batch_id,i.job_id,i.connection_id,i.receipt_json,i.publish_group_id,json_object('name',json_extract(b.config_json,'$.name'),'mediaType',json_extract(b.config_json,'$.mediaType'),'template',json_extract(b.config_json,'$.template')) config_json,b.created_at,
        c.source_key,c.variant_id,c.rewrite_model,c.style_id,c.copy_hash,${detailed ? "c.copy_json,CASE WHEN COALESCE(c.copy_hash,'')='' THEN json_extract(original.result_json,'$.plan') END AS original_plan,json_extract(original.payload_json,'$.peerSource.videoUrl') AS original_url" : "NULL copy_json,NULL original_plan,NULL original_url"},
        j.type,j.status,j.title,j.error,json_extract(j.result_json,'$.publishFailed') AS publish_failed,
        json_extract(j.result_json,'$.publishError') AS publish_error
        FROM psychology_publish_items i JOIN psychology_publish_batches b ON b.id=i.batch_id
        LEFT JOIN factory_jobs j ON j.id=i.job_id LEFT JOIN factory_jobs original ON original.id=i.id LEFT JOIN psychology_creative_snapshots c ON c.item_id=i.id WHERE b.created_at>=? AND b.created_at<?
        ORDER BY b.created_at DESC,i.id LIMIT 5001`).bind(window.start-SCHEDULE_LEAD_MS,window.end).all(),
      detailed ? Promise.resolve(null) : loadResolvedItems(env.DB,window.previousStart-HISTORY_MS),
      detailed ? Promise.resolve({results:[]}) : env.DB.prepare(`SELECT i.id,i.batch_id,i.connection_id,i.schedule_at,i.deleted_at,i.receipt_json,i.execution_status,
        p.id pilot_id,p.group_id,p.group_name,COALESCE(NULLIF(json_extract(b.config_json,'$.libraryStrategy'),''),p.strategy) strategy,
        json_extract(b.config_json,'$.mediaType') media_type,c.variant_id,j.status,g.status group_status,r.value_json record_json
        FROM psychology_autopilot_slots s JOIN psychology_autopilots p ON p.id=s.autopilot_id
        JOIN psychology_publish_items i ON instr(','||s.batch_id||',',','||i.batch_id||',')>0
        JOIN psychology_publish_batches b ON b.id=i.batch_id LEFT JOIN psychology_creative_snapshots c ON c.item_id=i.id
        LEFT JOIN factory_jobs j ON j.id=i.job_id LEFT JOIN psychology_publish_groups g ON g.id=i.publish_group_id
        LEFT JOIN factory_publish_records r ON r.id='psychology:'||i.id
        WHERE p.group_id IN (SELECT value FROM json_each(?)) AND replace(i.connection_id,'tiktok:','') IN (SELECT value FROM json_each(?))
          AND s.slot_at>=? AND s.slot_at<? AND i.schedule_at>=? AND i.schedule_at<?
        ORDER BY i.schedule_at,i.id LIMIT 20001`).bind(JSON.stringify(groupIds),accountIds,window.start-DAY,window.end,window.start/1000,window.end/1000).all(),
    ]);
    const records=(recordRows.results||[]).slice(0,10000).map(row=>parseObject(row.value_json));
    const recordedTasks=new Set(records.map(r=>r.autoTaskId));
    for(const item of (autopilotRows.results||[]).slice(0,20000)){
      const record=parseObject(item.record_json);
      if(record.autoTaskId&&!recordedTasks.has(record.autoTaskId)){records.push(record);recordedTasks.add(record.autoTaskId);}
    }
    const items=(itemRows.results||[]).slice(0,5000);
    for(const item of items){
      if(!item.copy_hash&&item.original_plan){const identity=await copyIdentity(parseObject(item.original_plan));item.copy_hash=identity.hash;item.copy_json=JSON.stringify(identity.copy);}
      if(!item.source_key&&item.original_url){try{item.source_key=photoCopyKey(item.original_url);}catch{item.source_key=item.source_id;}}
    }
    const inWindow=row=>row.time>=window.start&&row.time<window.end;
    if(detailed){
      const detail=buildContentPerformance({items,records,accounts,videosByAccount,media});
      return json({content:{...detail,rows:detail.rows.filter(inWindow)},updatedAt:Date.now()});
    }
    const report=buildOperationsReport({window,accounts,videosByAccount,records,items,media});
    const {framework}=await frameworkFor(env,{accounts,window,media,videosByAccount,records,history,matureOnly:false});
    const autopilot=buildAutopilotReport({items:autopilotRows.results.slice(0,20000),records,accounts,videosByAccount,window,media});
    return json({...report,autopilot,content:null,framework,evolution:EVOLUTION,groups,projectName:project?.name||"心理学",updatedAt:Date.now(),
      archiveAt:accounts.some(a=>Number(a.latestSyncAt)>0)?Math.min(...accounts.map(a=>Number(a.latestSyncAt)||0).filter(t=>t>0)):0,
      limited:autopilotRows.results.length>20000 || (recordRows.results||[]).length>10000 || (itemRows.results||[]).length>5000 || history.length>=20000,
      coverage:"播放分析基于每个账号最近100条已同步作品的当前累计播放，按作品发布日期汇总，并非每日新增播放。历史较多时，上期数据可能不完整。"});
  }catch(error){return errorJson(error.message||"读取运营报表失败。",400);}
}
