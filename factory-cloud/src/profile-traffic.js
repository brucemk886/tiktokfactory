// Only authorized account keys reach this reader. No remote requests on page load.
export async function loadProfileTraffic(db, accounts, fromKey, toKey) {
  const keys = accounts.map(row => row.account_key);
  const result = keys.length ? await db.prepare(`SELECT account_key,
    json_extract(profile_json, '$.insights._daily_traffic.status') status,
    json_extract(profile_json, '$.insights._daily_traffic.attemptedAt') attempted_at,
    json_extract(profile_json, '$.insights._daily_traffic.days') days_json
    FROM official_accounts_latest WHERE account_key IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(keys)).all() : {results: []};
  return summarizeProfileTraffic(accounts, result.results || [], fromKey, toKey);
}

export function summarizeProfileTraffic(accounts, samples, fromKey, toKey) {
  const validCount = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const index = new Map(samples.map(row => [row.account_key, row]));
  const expectedDays = Math.max(1, Math.round((Date.parse(toKey) - Date.parse(fromKey)) / 86400000) + 1);
  const summary = {videoViews: null, profileViews: null, pairedVideoViews: 0, pairedProfileViews: 0,
    pairedDays: 0, coveredAccounts: 0, totalAccounts: accounts.length, expectedDays,
    latestDate: '', updatedAt: 0, ratio: null};
  const rows = accounts.map(account => {
    const sample = index.get(account.account_key) || {};
    let days = [];
    try { days = JSON.parse(sample.days_json || '[]'); } catch {}
    const unique = new Map((Array.isArray(days) ? days : []).filter(day => day && /^\d{4}-\d{2}-\d{2}$/.test(day.date)
      && day.date >= fromKey && day.date <= toKey).map(day => [day.date, day]));
    const row = {accountKey: account.account_key, label: account.label || account.account_key,
      videoViews: null, profileViews: null, pairedVideoViews: 0, pairedProfileViews: 0,
      pairedDays: 0, expectedDays, latestDate: '', updatedAt: 0, ratio: null,
      syncStatus: sample.status || 'pending', attemptedAt: Number(sample.attempted_at) || 0};
    for (const day of unique.values()) {
      const video = validCount(day.videoViews), profile = validCount(day.profileViews);
      if (video) row.videoViews = (row.videoViews ?? 0) + day.videoViews;
      if (profile) row.profileViews = (row.profileViews ?? 0) + day.profileViews;
      if (video && profile) {
        row.pairedDays++;
        row.pairedVideoViews += day.videoViews;
        row.pairedProfileViews += day.profileViews;
      }
      if (video || profile) {
        row.latestDate = row.latestDate > day.date ? row.latestDate : day.date;
        row.updatedAt = Math.max(row.updatedAt, Number(day.updatedAt) || 0);
      }
    }
    row.ratio = row.pairedDays && row.pairedVideoViews > 0 ? row.pairedProfileViews / row.pairedVideoViews : null;
    for (const key of ['videoViews', 'profileViews']) if (row[key] !== null) summary[key] = (summary[key] ?? 0) + row[key];
    for (const key of ['pairedDays', 'pairedVideoViews', 'pairedProfileViews']) summary[key] += row[key];
    if (row.pairedDays) summary.coveredAccounts++;
    summary.latestDate = summary.latestDate > row.latestDate ? summary.latestDate : row.latestDate;
    summary.updatedAt = Math.max(summary.updatedAt, row.updatedAt);
    return row;
  });
  summary.ratio = summary.pairedDays && summary.pairedVideoViews > 0 ? summary.pairedProfileViews / summary.pairedVideoViews : null;
  rows.sort((a,b) => (b.profileViews ?? -1) - (a.profileViews ?? -1) || a.label.localeCompare(b.label));
  return {timezone: 'UTC', fromKey, toKey, summary, accounts: rows};
}
