import { ensureModuleProjects,rememberAccountAliases } from '../../scripts/official-account-group-store.js';
import { factoryArchiveKeys } from '../../scripts/factory-archive-scope.js';
import { accountsFromLatestArchive } from './official-archive-store.js';

export async function readReportQueries(db,queries){
 const entries=Object.entries(queries).filter(([,query])=>query),results=await db.batch(entries.map(([,query])=>query));
 return Object.fromEntries(entries.map(([name],i)=>[name,results[i]]));
}
// One round trip, fresh on every request. Only lightweight profile fields are
// needed; canonical assignments remain authoritative, including an empty set.
export async function loadReportContext(db){
 const rows=await readReportQueries(db,{
  settings:db.prepare("SELECT value_json FROM factory_kv WHERE key='official-account-groups'"),
  assignments:db.prepare('SELECT account_key,group_id FROM official_account_assignments'),
  accounts:db.prepare(`SELECT account_key,snapshot_date,synced_at,label,error,video_count,views,likes,comments,shares,reach,
   json_object('username',json_extract(profile_json,'$.username'),'displayName',json_extract(profile_json,'$.displayName')) profile_json
   FROM official_accounts_latest ORDER BY label COLLATE NOCASE LIMIT 5000`),
 });
 const raw=JSON.parse(rows.settings.results[0]?.value_json||'{}');
 raw.assignments=Object.fromEntries(rows.assignments.results.map(r=>[r.account_key,r.group_id]));
 const accounts=accountsFromLatestArchive(rows.accounts.results);
 const store=rememberAccountAliases(ensureModuleProjects(raw),accounts),allowed=new Set(factoryArchiveKeys(store));
 return {store,archived:accounts.filter(a=>allowed.has(a.schema)),accountRows:rows.accounts.results.filter(row=>allowed.has(row.account_key))};
}
