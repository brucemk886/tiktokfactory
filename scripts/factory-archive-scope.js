import { normalizeStore, normalizeAccountKey } from "./official-account-group-store.js";

// Only an assignment to an existing group inside an existing project opts in.
export function factoryArchiveKeys(value = {}) {
  const store = normalizeStore(value);
  const groups = new Set(store.groups.filter(group => group.projectId).map(group => group.id));
  return [...new Set(Object.entries(store.assignments)
    .filter(([, group]) => groups.has(group))
    .map(([key]) => `tiktok:${normalizeAccountKey(store.aliases[key] || key)}`))];
}

export function filterFactoryArchiveAccounts(accounts, allowedKeys) {
  const allowed = new Set(allowedKeys);
  return (Array.isArray(accounts) ? accounts : []).filter(account => allowed.has(String(account?.schema || "")));
}
