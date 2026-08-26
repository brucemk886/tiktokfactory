export const STORE_VERSION = 1;

export const MODULE_PROJECTS = Object.freeze([
  { id: "proj-novel", name: "小说推文", moduleKey: "novel-promotion" },
  { id: "proj-mid", name: "中视频", moduleKey: "mid-video" },
  { id: "proj-psych", name: "心理学", moduleKey: "psychology" },
]);

export function normalizeStore(value = {}) {
  const rawGroups = Array.isArray(value.groups) ? value.groups : [];
  const projects = Array.isArray(value.projects)
    ? value.projects.map((item) => {
      const id = safeId(item.id);
      const inherited = rawGroups.some((group) => safeId(group.projectId) === id && group.reportEnabled);
      return {
        id,
        name: String(item.name || "").trim().slice(0, 40),
        moduleKey: inferModuleKey(item),
        reportEnabled: Boolean(item.reportEnabled) || inherited,
      };
    }).filter((item) => item.id && item.name)
    : [];
  const knownProjects = new Set(projects.map((item) => item.id));
  const groups = rawGroups.map((item) => ({
    id: safeId(item.id),
    name: String(item.name || "").trim().slice(0, 40),
    projectId: knownProjects.has(safeId(item.projectId)) ? safeId(item.projectId) : "",
  })).filter((item) => item.id && item.name);
  const knownGroups = new Set(groups.map((item) => item.id));
  const assignments = {};
  for (const [rawKey, rawGroupId] of Object.entries(value.assignments && typeof value.assignments === "object" ? value.assignments : {})) {
    const key = normalizeAccountKey(rawKey);
    const groupId = safeId(rawGroupId);
    if (key && knownGroups.has(groupId)) assignments[key] = groupId;
  }
  const aliases = {};
  for (const [rawKey, rawPrimary] of Object.entries(value.aliases && typeof value.aliases === "object" ? value.aliases : {})) {
    const key = normalizeAccountKey(rawKey);
    const primary = normalizeAccountKey(rawPrimary);
    if (key && primary) aliases[key] = primary;
  }
  return { version: STORE_VERSION, projects, groups, assignments, aliases };
}

export function publicState(store) {
  const normalized = rememberAccountAliases(store);
  return {
    projects: normalized.projects.map((project) => ({
      ...project,
      groupCount: normalized.groups.filter((group) => group.projectId === project.id).length,
    })),
    groups: publicGroups(normalized),
    assignments: { ...normalized.assignments },
    accountCount: uniqueAccountCount(normalized),
  };
}

export function publicGroups(store) {
  const normalized = rememberAccountAliases(store);
  return normalized.groups.map((group) => ({
    id: group.id,
    name: group.name,
    projectId: group.projectId,
    projectName: normalized.projects.find((item) => item.id === group.projectId)?.name || "",
    accountCount: uniqueAccountCount(normalized, group.id),
  }));
}

export function createProject(store, name, { moduleKey = "" } = {}) {
  const next = normalizeStore(store);
  const project = {
    id: newId(next.projects, "proj"),
    name: requireName(name, next.projects),
    moduleKey: inferModuleKey({ name, moduleKey }),
    reportEnabled: false,
  };
  next.projects.push(project);
  return next;
}

export function findProjectForModule(store, moduleKey) {
  const next = ensureModuleProjects(store);
  const key = inferModuleKey({ moduleKey, name: moduleKey });
  return next.projects.find((item) => item.moduleKey === key) || null;
}

export function ensureModuleProjects(store) {
  const next = normalizeStore(store);
  for (const preset of MODULE_PROJECTS) {
    const existing = next.projects.find((item) => item.id === preset.id || item.moduleKey === preset.moduleKey || item.name === preset.name);
    if (existing) {
      existing.moduleKey = existing.moduleKey || preset.moduleKey;
      continue;
    }
    next.projects.push({ ...preset });
  }
  return next;
}

export function renameProject(store, projectId, name) {
  return updateProject(store, projectId, { name });
}

export function updateProject(store, projectId, patch = {}) {
  const next = normalizeStore(store);
  const project = next.projects.find((item) => item.id === safeId(projectId));
  if (!project) throw statusError(404, "没有找到这个项目。");
  if (patch.name != null) project.name = requireName(patch.name, next.projects, project.id);
  if (patch.reportEnabled != null) project.reportEnabled = Boolean(patch.reportEnabled);
  return next;
}

export function deleteProject(store, projectId) {
  const next = normalizeStore(store);
  const id = safeId(projectId);
  if (!next.projects.some((item) => item.id === id)) throw statusError(404, "没有找到这个项目。");
  next.projects = next.projects.filter((item) => item.id !== id);
  for (const group of next.groups) {
    if (group.projectId === id) group.projectId = "";
  }
  return next;
}

export function createGroup(store, name, { projectId = "" } = {}) {
  const next = normalizeStore(store);
  const targetProject = safeId(projectId);
  if (targetProject && !next.projects.some((item) => item.id === targetProject)) {
    throw statusError(404, "没有找到这个项目。");
  }
  next.groups.push({
    id: newId(next.groups, "otg"),
    name: requireName(name, next.groups),
    projectId: targetProject,
  });
  return next;
}

export function updateGroup(store, groupId, patch = {}) {
  const next = normalizeStore(store);
  const group = next.groups.find((item) => item.id === safeId(groupId));
  if (!group) throw statusError(404, "没有找到这个分组。");
  if (patch.name != null) group.name = requireName(patch.name, next.groups, group.id);
  if (patch.projectId != null) {
    const targetProject = safeId(patch.projectId);
    if (targetProject && !next.projects.some((item) => item.id === targetProject)) {
      throw statusError(404, "没有找到这个项目。");
    }
    group.projectId = targetProject;
  }
  return next;
}

export function deleteGroup(store, groupId) {
  const next = normalizeStore(store);
  const id = safeId(groupId);
  if (!next.groups.some((item) => item.id === id)) throw statusError(404, "没有找到这个分组。");
  next.groups = next.groups.filter((item) => item.id !== id);
  for (const [key, value] of Object.entries(next.assignments)) {
    if (value === id) {
      delete next.assignments[key];
      delete next.aliases[key];
    }
  }
  return next;
}

export function assignAccounts(store, { accounts = [], groupId = "" } = {}) {
  const next = normalizeStore(store);
  const targetId = safeId(groupId);
  if (targetId && !next.groups.some((item) => item.id === targetId)) throw statusError(404, "没有找到这个分组。");
  const items = Array.isArray(accounts) ? accounts : [];
  if (!items.length) throw statusError(400, "请先选择要分组的账号。");
  for (const account of items) {
    const keys = officialAccountKeys(account);
    const primary = keys[0] || "";
    for (const key of keys) {
      if (targetId) {
        next.assignments[key] = targetId;
        if (primary) next.aliases[key] = primary;
      } else {
        delete next.assignments[key];
        delete next.aliases[key];
      }
    }
  }
  return next;
}

export function attachAccounts(payload = {}, store) {
  const normalized = rememberAccountAliases(store, payload.accounts);
  const accounts = Array.isArray(payload.accounts)
    ? payload.accounts.map((account) => attachAccount(account, normalized))
    : payload.accounts;
  return {
    ...payload,
    accounts,
    projects: publicState(normalized).projects,
    groups: publicGroups(normalized),
    ungroupedCount: Array.isArray(accounts) ? accounts.filter((account) => !account.groupId).length : 0,
  };
}

export function officialAccountKeys(account = {}) {
  return Array.from(new Set([
    account.accountKey,
    account.connectionId,
    account.id,
    account.schema,
    account.username,
    account.profile?.username,
  ].map(normalizeAccountKey).filter(Boolean)));
}

export function rememberAccountAliases(store, accounts = []) {
  const next = normalizeStore(store);
  for (const account of Array.isArray(accounts) ? accounts : []) {
    const keys = officialAccountKeys(account);
    const primary = keys[0] || "";
    if (!primary) continue;
    for (const key of keys) next.aliases[key] = primary;
  }
  return next;
}

export function uniqueAccountCount(store, groupId = "") {
  const next = rememberAccountAliases(store);
  const target = safeId(groupId);
  const primaries = new Set();
  for (const [key, assigned] of Object.entries(next.assignments)) {
    if (target && assigned !== target) continue;
    primaries.add(next.aliases[key] || key);
  }
  return primaries.size;
}

export function accountsFromArchiveRows(rows = []) {
  return rows.map((row) => {
    let profile = row.profile;
    if (!profile || typeof profile !== "object") {
      try { profile = JSON.parse(row.profile_json || "{}"); } catch { profile = {}; }
    }
    const label = String(row.label || "");
    const username = profile.username || row.username || (label.startsWith("@") ? label.slice(1) : "");
    return {
      accountKey: row.account_key || row.accountKey || row.schema,
      schema: row.account_key || row.schema,
      label: row.label,
      username,
      profile: profile.username ? profile : { ...profile, username },
    };
  });
}

export function normalizeAccountKey(value) {
  let key = String(value || "").trim().replace(/^@/, "");
  if (key.toLowerCase().startsWith("tiktok:")) key = key.slice(7);
  return key.slice(0, 160);
}

export function groupAssignmentKeys(store, groupId) {
  const id = safeId(groupId);
  return Object.entries(normalizeStore(store).assignments)
    .filter(([, value]) => value === id)
    .map(([key]) => key);
}

export function accountMatchesGroup(account, store, groupId) {
  const keys = new Set(groupAssignmentKeys(store, groupId));
  return officialAccountKeys(account).some((key) => keys.has(key));
}

export function accountMatchesProject(account, store, projectId) {
  const next = normalizeStore(store);
  const groupIds = next.groups.filter((item) => item.projectId === safeId(projectId)).map((item) => item.id);
  return groupIds.some((groupId) => accountMatchesGroup(account, next, groupId));
}

export function archiveAccountKeysForScope(store, accountRows = [], { groupId = "", projectId = "", groupIds = null } = {}) {
  return accountsFromArchiveRows(accountRows)
    .filter((account) => {
      if (groupId) return accountMatchesGroup(account, store, groupId);
      if (Array.isArray(groupIds)) return accountMatchesAnyGroup(account, store, groupIds);
      if (projectId) return accountMatchesProject(account, store, projectId);
      return true;
    })
    .map((account) => account.accountKey || account.schema)
    .filter(Boolean);
}

export function userAllowedGroupIds(user) {
  if (!user || user.role === "admin") return null;
  return new Set((Array.isArray(user.allowedAccountGroups) ? user.allowedAccountGroups : []).map((id) => safeId(id)).filter(Boolean));
}

export function accountMatchesAnyGroup(account, store, groupIds) {
  const ids = Array.from(groupIds || []).map((id) => safeId(id)).filter(Boolean);
  return ids.some((groupId) => accountMatchesGroup(account, store, groupId));
}

export function scopeOfficialAccess(payload = {}, store, user, moduleKey = "") {
  const next = rememberAccountAliases(store, payload.accounts);
  const attached = attachAccounts(payload, next);
  const project = moduleKey ? findProjectForModule(next, moduleKey) : null;
  const allowedIds = userAllowedGroupIds(user);
  let groups = publicGroups(next);
  if (project) groups = groups.filter((group) => group.projectId === project.id);
  if (allowedIds) groups = groups.filter((group) => allowedIds.has(group.id));
  const groupIdSet = new Set(groups.map((group) => group.id));
  const accounts = (attached.accounts || []).filter((account) => {
    if (project && !accountMatchesProject(account, next, project.id)) return false;
    if (allowedIds && !accountMatchesAnyGroup(account, next, groupIdSet)) return false;
    return true;
  });
  return {
    module: moduleKey || "",
    project: project ? publicState(next).projects.find((item) => item.id === project.id) || project : null,
    groups,
    accounts,
    projects: publicState(next).projects,
  };
}

function attachAccount(account, store) {
  const group = findGroup(account, store);
  const project = store.projects.find((item) => item.id === group?.projectId);
  return {
    ...account,
    groupId: group?.id || "",
    groupName: group?.name || "",
    projectId: project?.id || "",
    projectName: project?.name || "",
    reportEnabled: Boolean(project?.reportEnabled),
  };
}

function findGroup(account, store) {
  for (const key of officialAccountKeys(account)) {
    const groupId = store.assignments[key];
    const group = store.groups.find((item) => item.id === groupId);
    if (group) return group;
  }
  return null;
}

function inferModuleKey(item = {}) {
  const key = String(item.moduleKey || "").trim();
  if (["novel-promotion", "mid-video", "psychology"].includes(key)) return key;
  const text = `${item.id || ""} ${item.name || ""} ${key}`.toLowerCase();
  if (text.includes("novel") || text.includes("小说")) return "novel-promotion";
  if (text.includes("mid") || text.includes("中视频")) return "mid-video";
  if (text.includes("psych") || text.includes("心理")) return "psychology";
  return key;
}

function requireName(value, items, currentId = "") {
  const name = String(value || "").trim().slice(0, 40);
  if (!name) throw statusError(400, "请填写名称。");
  if (items.some((item) => item.id !== currentId && item.name.toLowerCase() === name.toLowerCase())) {
    throw statusError(409, "已经有同名项。");
  }
  return name;
}

function newId(items, prefix) {
  let id = "";
  do {
    id = `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  } while (items.some((item) => item.id === id));
  return id;
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 80);
}

function statusError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export { safeId };
