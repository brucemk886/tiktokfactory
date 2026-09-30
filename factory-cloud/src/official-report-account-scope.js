// Read-only report scope. Assignments remain current and authoritative; stored
// aliases and lightweight profile metadata identify one account across its keys.
const normalizeKeySQL = value => {
  const key = `ltrim(trim(COALESCE(${value},'')),'@')`;
  return `substr(CASE WHEN lower(substr(${key},1,7))='tiktok:' THEN substr(${key},8) ELSE ${key} END,1,160)`;
};

// One binding: JSON authorized group IDs. Exposes allowed(account_key,current_group).
// Resolve every assignment before filtering groups: a moved primary assignment
// must override an old username alias still pointing at an authorized group.
// An alias never restores a removed direct primary grant. Unknown legacy keys
// resolve to themselves and unsynced primary assignments remain eligible.
export const reportAccountScopeSQL = `WITH report_assignment_keys AS MATERIALIZED (
    SELECT ${normalizeKeySQL('account_key')} raw_key,group_id FROM official_account_assignments),
  report_archive_identities AS MATERIALIZED (
    SELECT ${normalizeKeySQL('account_key')} primary_key,
      ${normalizeKeySQL("json_extract(profile_json,'$.username')")} username_key,
      ${normalizeKeySQL("CASE WHEN substr(label,1,1)='@' THEN label ELSE '' END")} label_key
    FROM official_accounts_latest),
  report_alias_candidates AS MATERIALIZED (
    SELECT primary_key alias_key,primary_key,1 priority FROM report_archive_identities
    UNION ALL SELECT ${normalizeKeySQL('j.key')},${normalizeKeySQL('j.value')},0
      FROM factory_kv k CROSS JOIN json_each(k.value_json,'$.aliases') j
      WHERE k.key='official-account-groups' AND j.type='text'
    UNION ALL SELECT username_key,primary_key,2 FROM report_archive_identities
    UNION ALL SELECT label_key,primary_key,2 FROM report_archive_identities),
  report_alias_priorities AS (SELECT alias_key,min(priority) priority FROM report_alias_candidates
    WHERE alias_key<>'' AND primary_key<>'' GROUP BY alias_key),
  report_account_aliases AS MATERIALIZED (
    SELECT c.alias_key,CASE WHEN count(DISTINCT c.primary_key)=1 THEN min(c.primary_key) END primary_key
    FROM report_alias_candidates c JOIN report_alias_priorities p USING(alias_key,priority) GROUP BY c.alias_key),
  report_account_assignments AS MATERIALIZED (
    SELECT a.raw_key,a.group_id,CASE WHEN m.alias_key IS NULL THEN a.raw_key ELSE m.primary_key END primary_key
    FROM report_assignment_keys a LEFT JOIN report_account_aliases m ON m.alias_key=a.raw_key),
  report_primary_groups AS MATERIALIZED (
    SELECT primary_key,CASE
      WHEN count(DISTINCT CASE WHEN raw_key=primary_key THEN group_id END)=1
        THEN min(CASE WHEN raw_key=primary_key THEN group_id END)
      END current_group
    FROM report_account_assignments WHERE primary_key IS NOT NULL AND primary_key<>'' GROUP BY primary_key),
  allowed AS MATERIALIZED (SELECT 'tiktok:'||primary_key account_key,current_group FROM report_primary_groups
    WHERE current_group IN (SELECT value FROM json_each(?)))`;
