import { buildContentPerformance } from '../../scripts/psychology-content-performance.js';
import { photoCopyKey } from './peer-photo-copy-cache.js';
import { loadVideosForAccounts } from "./official-archive-store.js";
import { parseObject } from "../../scripts/psychology-operations.js";
import { buildOpsFramework } from "../../scripts/psychology-ops-framework.js";
import { loadResolvedItems } from "./psychology-copy-evolution.js";

const DAY=86400000;
// Posts published in a period can come from batches created a few days earlier,
// and earlier uses of the same viral post can be older still.
const SCHEDULE_LEAD_MS=7*DAY,HISTORY_MS=30*DAY;

// The same framework numbers the report shows, for a given set of accounts.
export async function frameworkFor(env,{accounts,window,media="photo",videosByAccount,records,history,matureOnly=true,peerRows}){
  videosByAccount=videosByAccount||await loadVideosForAccounts(env,env.DB,accounts.map(a=>a.schema),100);
  records=records||(await env.DB.prepare("SELECT value_json FROM factory_publish_records WHERE created_at>=? ORDER BY created_at DESC LIMIT 10000").bind(window.previousStart).all()).results.map(row=>parseObject(row.value_json));
  history=history||await loadResolvedItems(env.DB,window.previousStart-HISTORY_MS);
  const rows=buildContentPerformance({items:history.filter(i=>i.created_at>=window.previousStart-SCHEDULE_LEAD_MS),records,accounts,videosByAccount,media}).rows;
  if(media==='photo'){
    const peers=peerRows||(await env.DB.prepare("SELECT video_url,topics_json FROM psychology_peer_hits WHERE media_type='photo'").all()).results||[];
    const bySource=new Map();
    for(const peer of peers){let key;try{key=photoCopyKey(peer.video_url);}catch{continue;}bySource.set(key,JSON.parse(peer.topics_json||'[]'));}
    for(const row of rows)row.topics=bySource.get(row.source)||[];
  }
  const framework=buildOpsFramework({rows,
    history,videosByAccount,accounts,window,media,matureOnly});
  return {framework,history,videosByAccount,records};
}

export {handleScalableOperations as handlePsychologyOperations} from './psychology-report-query.js';
