import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STORE_VERSION = 1;
const UNGROUPED = "";

export function createOfficialTikTokAccountGroups({ workDir } = {}) {
  if (!workDir) throw new Error("Official TikTok account groups require a work directory.");
  const storePath = path.join(workDir, "official-tiktok-account-groups.json");

  function getState() {
    return publicState(readStore(storePath));
  }

  function createGroup(name) {
    const store = readStore(storePath);
    const group = { id: newGroupId(store), name: requireGroupName(name, store) };
    store.groups.push(group);
    writeStore(storePath, store);
    return publicState(store);
  }

  function renameGroup(groupId, name) {
    const store = readStore(storePath);
    const group = store.groups.find((item) => item.id === safeId(groupId));
    if (!group) throw statusError(404, "没有找到这个分组。");
    group.name = requireGroupName(name, store, group.id);
    writeStore(storePath, store);
    return publicState(store);
  }

  function deleteGroup(groupId) {
    const store = readStore(storePath);
    const id = safeId(groupId);
    if (!store.groups.some((item) => item.id === id)) throw statusError(404, "没有找到这个分组。");
    store.groups = store.groups.filter((item) => item.id !== id);
    for (const [key, value] of Object.entries(store.assignments)) {
      if (value === id) delete store.assignments[key];
    }
    writeStore(storePath, store);
    return publicState(store);
  }

  function assignAccounts({ accounts = [], groupId = "" } = {}) {
    const store = readStore(storePath);
    const targetId = safeId(groupId);
    if (targetId && !store.groups.some((item) => item.id === targetId)) throw statusError(404, "没有找到这个分组。");
    const items = Array.isArray(accounts) ? accounts : [];
    if (!items.length) throw statusError(400, "请先选择要分组的账号。");
    for (const account of items) {
      for (const key of officialAccountKeys(account)) {
        if (targetId) store.assignments[key] = targetId;
        else delete store.assignments[key];
      }
    }
    writeStore(storePath, store);
    return publicState(store);
  }

  function attach(payload = {}) {
    const store = readStore(storePath);
    const accounts = Array.isArray(payload.accounts) ? payload.accounts.map((account) => attachAccount(account, store)) : payload.accounts;
    return {
      ...payload,
      accounts,
      groups: publicGroups(store),
      ungroupedCount: Array.isArray(accounts) ? accounts.filter((account) => !account.groupId).length : 0
    };
  }

  return { getState, createGroup, renameGroup, deleteGroup, assignAccounts, attach };
}

export function officialAccountKeys(account = {}) {
  const values = [
    account.connectionId,
    account.id,
    account.schema,
    account.accountKey,
    account.username,
    account.profile?.username
  ];
  return Array.from(new Set(values.map(normalizeAccountKey).filter(Boolean)));
}

function attachAccount(account, store) {
  const group = findGroup(account, store);
  return {
    ...account,
    groupId: group?.id || "",
    groupName: group?.name || ""
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

function publicState(store) {
  return {
    groups: publicGroups(store),
    assignments: { ...store.assignments },
    accountCount: Object.keys(store.assignments).length
  };
}

function publicGroups(store) {
  return store.groups.map((group) => ({
    id: group.id,
    name: group.name,
    accountCount: Object.values(store.assignments).filter((groupId) => groupId === group.id).length
  }));
}

function requireGroupName(value, store, currentId = "") {
  const name = String(value || "").trim().slice(0, 40);
  if (!name) throw statusError(400, "请填写分组名称。");
  if (store.groups.some((item) => item.id !== currentId && item.name.toLowerCase() === name.toLowerCase())) {
    throw statusError(409, "已经有同名分组。");
  }
  return name;
}

function newGroupId(store) {
  let id = "";
  do id = `otg-${crypto.randomBytes(4).toString("hex")}`;
  while (store.groups.some((item) => item.id === id));
  return id;
}

function readStore(filePath) {
  try {
    return normalizeStore(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return normalizeStore({});
  }
}

function writeStore(filePath, store) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(normalizeStore(store), null, 2), "utf8");
}

function normalizeStore(value) {
  const groups = Array.isArray(value?.groups)
    ? value.groups.map((item) => ({ id: safeId(item.id), name: String(item.name || "").trim().slice(0, 40) })).filter((item) => item.id && item.name)
    : [];
  const known = new Set(groups.map((item) => item.id));
  const assignments = {};
  for (const [rawKey, rawGroupId] of Object.entries(value?.assignments && typeof value.assignments === "object" ? value.assignments : {})) {
    const key = normalizeAccountKey(rawKey);
    const groupId = safeId(rawGroupId);
    if (key && known.has(groupId)) assignments[key] = groupId;
  }
  return { version: STORE_VERSION, groups, assignments };
}

function normalizeAccountKey(value) {
  let key = String(value || "").trim().replace(/^@/, "");
  if (key.toLowerCase().startsWith("tiktok:")) key = key.slice(7);
  return key.slice(0, 160);
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 80);
}

function statusError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export { UNGROUPED };
