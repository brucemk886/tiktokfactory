// Read only the current, scoped connection identities; never match by display name.
export async function withPublishFollowers(db, accounts) {
 const keys=[...new Set(accounts.flatMap(a=>{const id=String(a.connectionId||a.id||'').replace(/^tiktok:/,'');return id?[id,'tiktok:'+id]:[];}))];
 if(!keys.length)return [];
 const {results}=await db.prepare('SELECT account_key,profile_json,synced_at FROM official_accounts_latest WHERE account_key IN (SELECT value FROM json_each(?)) ORDER BY synced_at ASC').bind(JSON.stringify(keys)).all();
 const stats=new Map();
 for(const row of results){
  let profile;try{profile=JSON.parse(row.profile_json);}catch{profile=null;}
  const value=profile?.followers??profile?.followerCount;
  const valid=(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isSafeInteger(Number(value))&&Number(value)>=0;
  stats.set(row.account_key.replace(/^tiktok:/,''),{followers:valid?Number(value):null,followersSyncedAt:Number(row.synced_at)||0});
 }
 return accounts.map(a=>({...a,...(stats.get(String(a.connectionId||a.id||'').replace(/^tiktok:/,''))||{followers:null,followersSyncedAt:0})}));
}
export async function assertPublishFollowers(db, config, accounts) {
 if(!config.minFollowers)return;
 const selected=await withPublishFollowers(db,accounts.filter(a=>config.connectionIds.includes(String(a.connectionId||a.id))));
 const byId=new Map(selected.map(a=>[String(a.connectionId||a.id),a]));
 const blocked=config.connectionIds.filter(id=>{const a=byId.get(id);return !a||a.followers===null||a.followers<config.minFollowers;});
 if(blocked.length){
  const names=blocked.map(id=>{const a=byId.get(id);return (a?.username||a?.displayName||id)+'（'+(a?.followers==null?'粉丝待同步':a.followers+' 粉丝')+'）';});
  throw Object.assign(new Error('所选账号未满足至少 '+config.minFollowers+' 粉丝：'+names.join('、')+'。请同步数据后重新选号。'),{statusCode:409});
 }
}
