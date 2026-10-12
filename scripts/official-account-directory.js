// Public directory snapshots contain no credentials or full analytics profiles.
export function directoryKeys(account = {}) {
  const ids = [account.schema, account.accountKey, account.connectionId, account.id].filter(Boolean);
  return [...new Set((ids.length ? ids : [account.username, account.profile?.username]).map(value => String(value || '').trim().replace(/^@/, '').replace(/^tiktok:/i, '')).filter(Boolean))];
}

export function mergeAccountDirectory(archived = [], live = [], { complete = true } = {}) {
  const byKey = new Map();
  for (const account of archived) for (const key of directoryKeys(account)) byKey.set(key, account);
  const seen = new Set(), result = [];
  for (const account of complete ? live : [...live, ...archived]) {
    const keys = directoryKeys(account);
    if (!keys.length || keys.some(key => seen.has(key))) continue;
    const previous = keys.map(key => byKey.get(key)).find(Boolean) || {};
    result.push({ ...previous, ...account, profile: { ...previous.profile, ...account.profile } });
    keys.forEach(key => seen.add(key));
  }
  return result;
}

export function directorySnapshotAccounts(accounts = []) {
  return accounts.map(account => {
    const row = {};
    for (const key of ['schema', 'accountKey', 'connectionId', 'id', 'label', 'username', 'status']) {
      if (typeof account[key] === 'string') row[key] = account[key];
    }
    for (const key of ['videoCount', 'syncedVideoCount', 'syncedAt', 'latestSyncAt', 'updatedAt', 'views', 'followers']) {
      if (typeof account[key] === 'number' && Number.isFinite(account[key])) row[key] = account[key];
    }
    row.profile = {};
    for (const key of ['username', 'displayName', 'avatarUrl']) {
      if (typeof account.profile?.[key] === 'string') row.profile[key] = account.profile[key];
    }
    if (account.publishRisk) row.publishRisk = {
      flagged: Boolean(account.publishRisk.flagged), reason: String(account.publishRisk.reason || ''),
      label: String(account.publishRisk.label || ''), count: Number(account.publishRisk.count) || 0,
      lastAt: Number(account.publishRisk.lastAt) || 0,
    };
    return row;
  });
}

export function attachDirectoryRisk(accounts, publishAccounts = []) {
  const risks = new Map();
  for (const account of publishAccounts) for (const key of directoryKeys(account)) risks.set(key, account.publishRisk);
  return accounts.map(account => {
    const risk = directoryKeys(account).map(key => risks.get(key)).find(Boolean);
    return risk ? { ...account, publishRisk: risk } : account;
  });
}
