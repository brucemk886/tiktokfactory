import { buildContentPerformance } from '../../scripts/psychology-content-performance.js';
import { copyIdentity } from './psychology-creative.js';
import { photoCopyKey } from './peer-photo-copy-cache.js';
import { json, errorJson } from "./http.js";
import { loadGroupStore, scopedAnalyticsAccounts } from "./official.js";
import { publicState, findProjectForModule, userAllowedGroupIds } from "../../scripts/official-account-group-store.js";
import { listLatestArchiveAccounts, accountsFromLatestArchive, loadVideosForAccounts } from "./official-archive-store.js";
import { buildOperationsReport, operationsWindow, parseObject } from "../../scripts/psychology-operations.js";
import { buildCopyInsights } from "../../scripts/psychology-copy-insights.js";
import { loadResolvedItems } from "./psychology-copy-evolution.js";

// Earlier uses of a post can predate the report window.
const HISTORY_MS=90*86400000;

export async function handlePsychologyOperations(request, env, url, session) {
  if(url.pathname!=="/api/psychology-operations")return null;
  if(request.method!=="GET")return errorJson("仅支持读取报表。",405);
  const user=session?.user;
  if(!user || !(user.sidebarModules||[]).includes("psychology-ops-report"))return errorJson("没有心理学运营报表权限。",403);
  try {
    const window=operationsWindow(url.searchParams);
    const media=url.searchParams.get("media")||"all",group=url.searchParams.get("group")||"";
    if(!["all","video","photo"].includes(media))return errorJson("内容类型无效。",400);
    const store=await loadGroupStore(env.DB), project=findProjectForModule(store,"psychology"), allowed=userAllowedGroupIds(user);
    const groups=publicState(store).groups.filter(g=>g.projectId===project?.id && (!allowed || allowed.has(g.id)));
    if(group && !groups.some(g=>g.id===group))return errorJson("没有这个分组的权限。",403);
    const accounts=scopedAnalyticsAccounts(accountsFromLatestArchive(await listLatestArchiveAccounts(env.DB)),store,user,"psychology").filter(a=>!group||a.groupId===group);
    const [videosByAccount,recordRows,itemRows]=await Promise.all([
      loadVideosForAccounts(env,env.DB,accounts.map(a=>a.schema),100),
      env.DB.prepare("SELECT value_json FROM factory_publish_records WHERE created_at>=? AND created_at<? ORDER BY created_at DESC LIMIT 10001").bind(window.previousStart,Date.now()+1).all(),
      env.DB.prepare(`SELECT i.id,i.source_id,i.batch_id,i.job_id,i.connection_id,i.receipt_json,i.publish_group_id,b.config_json,b.created_at,
        c.source_key,c.variant_id,c.style_id,c.copy_hash,c.copy_json,json_extract(original.result_json,'$.plan') AS original_plan,json_extract(original.payload_json,'$.peerSource.videoUrl') AS original_url,
        j.type,j.status,j.title,j.error,json_extract(j.result_json,'$.publishFailed') AS publish_failed,
        json_extract(j.result_json,'$.publishError') AS publish_error
        FROM psychology_publish_items i JOIN psychology_publish_batches b ON b.id=i.batch_id
        LEFT JOIN factory_jobs j ON j.id=i.job_id LEFT JOIN factory_jobs original ON original.id=i.id LEFT JOIN psychology_creative_snapshots c ON c.item_id=i.id WHERE b.created_at>=? AND b.created_at<?
        ORDER BY b.created_at DESC,i.id LIMIT 5001`).bind(window.start,window.end).all(),
    ]);
    const records=(recordRows.results||[]).slice(0,10000).map(row=>parseObject(row.value_json));
    const items=(itemRows.results||[]).slice(0,5000);
    for(const item of items){
      if(!item.copy_hash&&item.original_plan){const identity=await copyIdentity(parseObject(item.original_plan));item.copy_hash=identity.hash;item.copy_json=JSON.stringify(identity.copy);}
      if(!item.source_key&&item.original_url){try{item.source_key=photoCopyKey(item.original_url);}catch{item.source_key=item.source_id;}}
    }
    const content=buildContentPerformance({items:media==='video'?[]:items,records,accounts,videosByAccount});
    const report=buildOperationsReport({window,accounts,videosByAccount,records,items,media});
    const insights=media==='video'?null:buildCopyInsights({rows:content.rows,accounts,history:await loadResolvedItems(env.DB,window.start-HISTORY_MS),videosByAccount});
    return json({...report,content,insights,groups,projectName:project?.name||"心理学",updatedAt:Date.now(),
      archiveAt:accounts.length?Math.min(...accounts.map(a=>Number(a.latestSyncAt)||0)):0,
      limited:(recordRows.results||[]).length>10000 || (itemRows.results||[]).length>5000,
      coverage:"播放分析基于每个账号最近100条已同步作品的当前累计播放，按作品发布日期汇总，并非每日新增播放。历史较多时，上期数据可能不完整。"});
  }catch(error){return errorJson(error.message||"读取运营报表失败。",400);}
}
