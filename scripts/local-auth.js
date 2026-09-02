import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sidebarModuleIdsForRole } from "./sidebar-modules.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createLocalAuthService({ workDir, initialGeeLark = {} }) {
  const storePath = path.join(workDir, "local-accounts.json");
  const sessions = new Map();
  const sidebarMigrationOverrides = new Map();
  fs.mkdirSync(workDir, { recursive: true });
  migrateStore();

  function hasUsers() {
    return readStore().users.some((user) => user.active !== false);
  }

  function migrateStore() {
    if (!fs.existsSync(storePath)) return;
    try {
      const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
      const version = Number(store.version || 1);
      if (version >= 28) return;
      for (const user of Array.isArray(store.users) ? store.users : []) {
        if (!Array.isArray(user.sidebarModules)) continue;
        user.sidebarModules = user.sidebarModules.filter((moduleId) => !["project-hub", "audio-library"].includes(moduleId));
        if (version < 3 && user.role === "admin" && !user.sidebarModules.includes("tiktok-connections")) {
          user.sidebarModules.push("tiktok-connections");
        }
        if (version < 6 && user.role === "admin" && !user.sidebarModules.includes("novel-library")) {
          const operatorIndex = user.sidebarModules.indexOf("operator");
          user.sidebarModules.splice(operatorIndex >= 0 ? operatorIndex + 1 : user.sidebarModules.length, 0, "novel-library");
        }
        if (version < 7 && user.role === "admin" && !user.sidebarModules.includes("official-publish-records")) {
          const statsIndex = user.sidebarModules.indexOf("stats");
          user.sidebarModules.splice(statsIndex >= 0 ? statsIndex + 1 : user.sidebarModules.length, 0, "official-publish-records");
        }
        if (version < 8 && user.role === "admin" && !user.sidebarModules.includes("official-analytics")) {
          const publishIndex = user.sidebarModules.indexOf("official-publish-records");
          user.sidebarModules.splice(publishIndex >= 0 ? publishIndex + 1 : user.sidebarModules.length, 0, "official-analytics");
        }
        if (version < 10 && user.role === "admin" && !user.sidebarModules.includes("rewrite-records")) {
          const libraryIndex = user.sidebarModules.indexOf("novel-library");
          const strategyIndex = user.sidebarModules.indexOf("novel-strategy");
          const insertAt = strategyIndex >= 0 ? strategyIndex + 1 : libraryIndex >= 0 ? libraryIndex : user.sidebarModules.length;
          user.sidebarModules.splice(insertAt, 0, "rewrite-records");
        }
        if (version < 11 && user.role === "admin") {
          const extras = ["hub", "mid-video", "podcast"].filter((moduleId) => !user.sidebarModules.includes(moduleId));
          user.sidebarModules = [...extras, ...user.sidebarModules];
        }
        if (version < 11 && user.role === "operator" && !user.sidebarModules.includes("hub")) {
          user.sidebarModules.unshift("hub");
        }
        if (version < 12 && user.role === "admin" && !user.sidebarModules.includes("geelark-novel-effects")) {
          const geelarkIndex = user.sidebarModules.indexOf("operator-third-party");
          user.sidebarModules.splice(geelarkIndex >= 0 ? geelarkIndex + 1 : user.sidebarModules.length, 0, "geelark-novel-effects");
        }
        if (version < 13 && user.role === "admin" && !user.sidebarModules.includes("novel-rewrite")) {
          const libraryIndex = user.sidebarModules.indexOf("novel-library");
          user.sidebarModules.splice(libraryIndex >= 0 ? libraryIndex + 1 : user.sidebarModules.length, 0, "novel-rewrite");
        }
        if (version < 14 && !user.sidebarModules.includes("geelark-tasks")) {
          const insertAt = user.role === "operator"
            ? Math.max(0, user.sidebarModules.indexOf("tasks"))
            : (() => {
              const geelarkIndex = user.sidebarModules.indexOf("geelark-novel-effects");
              const thirdPartyIndex = user.sidebarModules.indexOf("operator-third-party");
              return geelarkIndex >= 0 ? geelarkIndex : thirdPartyIndex >= 0 ? thirdPartyIndex + 1 : user.sidebarModules.length;
            })();
          user.sidebarModules.splice(insertAt, 0, "geelark-tasks");
        }
        if (version < 15) {
          user.sidebarModules = user.sidebarModules.filter((moduleId) => !["novel-rewrite", "rewrite-records"].includes(moduleId));
        }
        if (version < 16 && user.role === "operator") {
          user.sidebarModules = user.sidebarModules.filter((moduleId) => moduleId !== "hub");
        }
        if (version < 17 && user.role === "admin" && !user.sidebarModules.includes("work-journal")) {
          const accountsIndex = user.sidebarModules.indexOf("accounts");
          user.sidebarModules.splice(accountsIndex >= 0 ? accountsIndex : user.sidebarModules.length, 0, "work-journal");
        }
        if (version < 18 && user.role === "admin" && user.sidebarModules.includes("work-journal")) {
          const modules = user.sidebarModules.filter((moduleId) => moduleId !== "work-journal");
          const accountsIndex = modules.indexOf("accounts");
          modules.splice(accountsIndex >= 0 ? accountsIndex : modules.length, 0, "work-journal");
          user.sidebarModules = modules;
        }
        if (version < 19) {
          const allowed = new Set(sidebarModuleIdsForRole(user.role));
          user.sidebarModules = user.sidebarModules.filter((moduleId) => allowed.has(moduleId));
          if (user.role === "admin" && !user.sidebarModules.includes("local-queue")) {
            user.sidebarModules.unshift("local-queue");
          }
        }
        if (version < 20 && user.role === "admin" && !user.sidebarModules.includes("geelark-profiles")) {
          const settingsIndex = user.sidebarModules.indexOf("analytics-settings");
          user.sidebarModules.splice(settingsIndex >= 0 ? settingsIndex + 1 : user.sidebarModules.length, 0, "geelark-profiles");
        }
        if (version < 21 && user.role === "admin" && !user.sidebarModules.includes("tasks")) {
          const queueIndex = user.sidebarModules.indexOf("local-queue");
          user.sidebarModules.splice(queueIndex >= 0 ? queueIndex + 1 : 1, 0, "tasks");
        }
        if (version < 22 && user.role !== "admin") {
          user.sidebarModules = sidebarModuleIdsForRole(user.role);
        }
        if (version < 23 && user.role !== "admin") {
          user.sidebarModules = sidebarModuleIdsForRole(user.role);
        }
        if (version < 24 && user.role !== "admin") {
          user.sidebarModules = sidebarModuleIdsForRole(user.role);
        }
        if (version < 25 && user.role === "admin" && !user.sidebarModules.includes("asset-usage")) {
          const tasksIndex = user.sidebarModules.indexOf("tasks");
          user.sidebarModules.splice(tasksIndex >= 0 ? tasksIndex + 1 : user.sidebarModules.length, 0, "asset-usage");
        }
        if (version < 26 && user.role === "admin") {
          const midVideoLocal = ["mid-video", "schulte", "podcast", "ai"];
          const rest = user.sidebarModules.filter((moduleId) => !midVideoLocal.includes(moduleId));
          const queueIndex = rest.indexOf("local-queue");
          rest.splice(queueIndex >= 0 ? queueIndex + 1 : 0, 0, ...midVideoLocal);
          user.sidebarModules = rest;
        }
        if (version < 27 && user.role === "admin" && !user.sidebarModules.includes("quiz")) {
          const schulteIndex = user.sidebarModules.indexOf("schulte");
          user.sidebarModules.splice(schulteIndex >= 0 ? schulteIndex + 1 : user.sidebarModules.length, 0, "quiz");
        }
        if (version < 28 && user.role === "admin" && !user.sidebarModules.includes("psychology-narrative")) {
          const schulteIndex = user.sidebarModules.indexOf("schulte");
          user.sidebarModules.splice(schulteIndex >= 0 ? schulteIndex + 1 : user.sidebarModules.length, 0, "psychology-narrative");
        }
      }
      store.version = 28;
      try {
        fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
      } catch {
        for (const user of store.users) {
          if (user.id && Array.isArray(user.sidebarModules)) {
            sidebarMigrationOverrides.set(user.id, [...user.sidebarModules]);
          }
        }
      }
    } catch {
      // Leave malformed legacy data untouched; normal store recovery handles it.
    }
  }

  function getSession(req) {
    pruneSessions();
    const token = parseCookies(req.headers.cookie || "").lf_session;
    const session = token ? sessions.get(token) : null;
    if (!session || session.expiresAt < Date.now()) return null;
    const user = readStore().users.find((entry) => entry.id === session.userId && entry.active !== false);
    return user ? { token, user: toPublicUser(user) } : null;
  }

  function setupAdmin({ username, password, displayName }) {
    if (hasUsers()) throw new Error("管理员账号已初始化。");
    const cleanUsername = normalizeUsername(username);
    validatePassword(password);
    const store = readStore();
    ensureDefaultProfile(store);
    const user = {
      id: crypto.randomUUID(),
      username: cleanUsername,
      displayName: String(displayName || "管理员").trim().slice(0, 40) || "管理员",
      role: "admin",
      active: true,
      geelarkProfileId: "default",
      allowedDirectory: "",
      allowedGeeLarkGroups: [],
      sidebarModules: sidebarModuleIdsForRole("admin"),
      password: hashPassword(password),
      passwordPlain: String(password),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    store.users.push(user);
    writeStore(store);
    return user;
  }

  function login({ username, password }) {
    const cleanUsername = normalizeUsername(username);
    const user = readStore().users.find((entry) => entry.username === cleanUsername && entry.active !== false);
    const candidates = Array.from(new Set([String(password || ""), String(password || "").trim()].filter(Boolean)));
    const matched = user && candidates.some((candidate) => verifyPassword(candidate, user.password) || (user.passwordPlain && candidate === user.passwordPlain));
    if (!matched) throw new Error("账号或密码不正确。");
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
    return { token, user: toPublicUser(user) };
  }

  function logout(token) {
    if (token) sessions.delete(token);
  }

  function listUsers() {
    return readStore().users.map((user) => ({
      ...toPublicUser(user),
      password: String(user.passwordPlain || "")
    }));
  }

  function listProfiles() {
    return readStore().geelarkProfiles.map(publicProfile);
  }

  function getProfile(id) {
    const profileId = String(id || "default");
    const store = readStore();
    ensureDefaultProfile(store);
    const profile = store.geelarkProfiles.find((entry) => entry.id === profileId);
    return profile ? { ...profile } : null;
  }

  function createUser(payload) {
    const store = readStore();
    const username = normalizeUsername(payload.username);
    validatePassword(payload.password);
    if (store.users.some((user) => user.username === username)) throw new Error("该登录账号已存在。");
    const role = payload.role === "admin" ? "admin" : "operator";
    const profileId = validateProfileId(store, payload.geelarkProfileId);
    const user = {
      id: crypto.randomUUID(), username,
      displayName: String(payload.displayName || username).trim().slice(0, 40) || username,
      role, active: payload.active !== false, geelarkProfileId: profileId,
      allowedDirectory: normalizeDirectory(payload.allowedDirectory),
      allowedGeeLarkGroups: normalizeGroups(payload.allowedGeeLarkGroups),
      sidebarModules: normalizeSidebarModules(payload.sidebarModules, role),
      password: hashPassword(payload.password),
      passwordPlain: String(payload.password),
      createdAt: Date.now(), updatedAt: Date.now()
    };
    store.users.push(user);
    writeStore(store);
    return listUsers().find((item) => item.id === user.id);
  }

  function updateUser(id, payload) {
    const store = readStore();
    const user = store.users.find((entry) => entry.id === String(id));
    if (!user) throw new Error("账号不存在。");
    const nextRole = payload.role === undefined
      ? user.role
      : (payload.role === "admin" ? "admin" : "operator");
    const nextActive = payload.active === undefined ? user.active !== false : payload.active !== false;
    if (user.role === "admin" && user.active !== false && (!nextActive || nextRole !== "admin") && activeAdminCount(store) <= 1) {
      throw new Error("至少需要保留一个启用中的管理员账号。");
    }
    user.displayName = String(payload.displayName ?? user.displayName).trim().slice(0, 40) || user.username;
    user.role = nextRole;
    user.active = nextActive;
    user.geelarkProfileId = validateProfileId(store, payload.geelarkProfileId || user.geelarkProfileId);
    user.allowedDirectory = normalizeDirectory(payload.allowedDirectory ?? user.allowedDirectory);
    user.allowedGeeLarkGroups = normalizeGroups(payload.allowedGeeLarkGroups ?? user.allowedGeeLarkGroups);
    user.sidebarModules = normalizeSidebarModules(payload.sidebarModules ?? user.sidebarModules, nextRole);
    if (String(payload.password || "")) {
      validatePassword(payload.password);
      user.password = hashPassword(payload.password);
      user.passwordPlain = String(payload.password);
    }
    user.updatedAt = Date.now();
    writeStore(store);
    sidebarMigrationOverrides.delete(user.id);
    return listUsers().find((item) => item.id === user.id);
  }

  function deleteUser(id, currentUserId) {
    const store = readStore();
    const user = store.users.find((entry) => entry.id === String(id));
    if (!user) throw new Error("账号不存在。");
    if (user.id === currentUserId) throw new Error("不能删除当前正在使用的账号。");
    if (user.role === "admin" && user.active !== false && activeAdminCount(store) <= 1) {
      throw new Error("至少需要保留一个启用中的管理员账号。");
    }
    store.users = store.users.filter((entry) => entry.id !== user.id);
    writeStore(store);
    sidebarMigrationOverrides.delete(user.id);
    for (const [token, session] of sessions.entries()) {
      if (session.userId === user.id) sessions.delete(token);
    }
    return { ok: true };
  }

  function saveProfile(payload) {
    const store = readStore();
    const isNew = !payload.id;
    const id = isNew ? safeId(`profile-${crypto.randomUUID().slice(0, 8)}`) : String(payload.id);
    let profile = store.geelarkProfiles.find((entry) => entry.id === id);
    if (!profile) {
      profile = { id, createdAt: Date.now(), apiKey: "", appId: "", apiBaseUrl: "https://openapi.geelark.cn" };
      store.geelarkProfiles.push(profile);
    }
    profile.name = String(payload.name || profile.name || "未命名 GeeLark 账号").trim().slice(0, 60) || "未命名 GeeLark 账号";
    profile.apiBaseUrl = String(payload.apiBaseUrl || profile.apiBaseUrl || "https://openapi.geelark.cn").trim();
    profile.appId = String(payload.appId ?? profile.appId ?? "").trim();
    if (String(payload.apiKey || "").trim()) profile.apiKey = String(payload.apiKey).trim();
    profile.updatedAt = Date.now();
    writeStore(store);
    return publicProfile(profile);
  }

  function deleteProfile(id) {
    const profileId = String(id);
    if (profileId === "default") throw new Error("默认 GeeLark 配置不能删除，可直接修改。");
    const store = readStore();
    if (store.users.some((user) => user.geelarkProfileId === profileId)) throw new Error("仍有登录账号正在使用此 GeeLark 配置，不能删除。");
    store.geelarkProfiles = store.geelarkProfiles.filter((profile) => profile.id !== profileId);
    writeStore(store);
  }

  function readStore() {
    const fallback = { version: 1, users: [], geelarkProfiles: [] };
    try {
      const value = JSON.parse(fs.readFileSync(storePath, "utf8"));
      const store = { ...fallback, ...value, users: Array.isArray(value.users) ? value.users : [], geelarkProfiles: Array.isArray(value.geelarkProfiles) ? value.geelarkProfiles : [] };
      ensureDefaultProfile(store);
      return store;
    } catch {
      const store = structuredClone(fallback);
      ensureDefaultProfile(store);
      return store;
    }
  }

  function ensureDefaultProfile(store) {
    if (store.geelarkProfiles.some((profile) => profile.id === "default")) return;
    const geelark = initialGeeLark || {};
    store.geelarkProfiles.unshift({
      id: "default", name: "默认 GeeLark 账号",
      apiBaseUrl: String(geelark.apiBaseUrl || "https://openapi.geelark.cn"),
      appId: String(geelark.appId || ""), apiKey: String(geelark.apiKey || ""),
      createdAt: Date.now(), updatedAt: Date.now()
    });
  }

  function writeStore(store) {
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
  }

  function toPublicUser(user) {
    const migratedModules = sidebarMigrationOverrides.get(user.id);
    return publicUser(migratedModules ? { ...user, sidebarModules: migratedModules } : user);
  }

  return { hasUsers, getSession, setupAdmin, login, logout, listUsers, listProfiles, getProfile, createUser, updateUser, deleteUser, saveProfile, deleteProfile };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active !== false,
    geelarkProfileId: user.geelarkProfileId || "default",
    allowedDirectory: user.allowedDirectory || "",
    allowedGeeLarkGroups: normalizeGroups(user.allowedGeeLarkGroups),
    sidebarModules: normalizeSidebarModules(user.sidebarModules, user.role)
  };
}

function publicProfile(profile) {
  return { id: profile.id, name: profile.name, apiBaseUrl: profile.apiBaseUrl, appId: profile.appId, hasApiKey: Boolean(profile.apiKey), updatedAt: profile.updatedAt || profile.createdAt || 0 };
}

function normalizeUsername(value) {
  const username = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) throw new Error("登录账号需为 3-32 位英文、数字、点、下划线或短横线。");
  return username;
}

function validatePassword(password) {
  if (String(password || "").length < 8) throw new Error("密码至少需要 8 位。");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 32).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, stored) {
  if (!stored?.salt || !stored?.hash) return false;
  const actual = crypto.scryptSync(String(password || ""), stored.salt, 32).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(stored.hash, "hex"));
}

function validateProfileId(store, value) {
  const id = String(value || "default");
  if (!store.geelarkProfiles.some((profile) => profile.id === id)) throw new Error("请选择有效的 GeeLark 配置。");
  return id;
}

function activeAdminCount(store) {
  return store.users.filter((user) => user.role === "admin" && user.active !== false).length;
}

function normalizeDirectory(value) {
  return String(value || "").trim().replace(/[\\/]+$/, "");
}

function normalizeGroups(value) {
  const groups = Array.isArray(value) ? value : String(value || "").split(/[,，\n]/);
  return Array.from(new Set(groups.map((group) => String(group || "").trim()).filter(Boolean))).slice(0, 100);
}

function normalizeSidebarModules(value, role) {
  const allowed = sidebarModuleIdsForRole(role);
  if (!Array.isArray(value)) return [...allowed];
  const selected = new Set(value.map((item) => String(item || "").trim()).filter(Boolean));
  return allowed.filter((moduleId) => selected.has(moduleId));
}

function parseCookies(value) {
  return Object.fromEntries(String(value || "").split(";").map((item) => item.trim()).filter(Boolean).map((item) => {
    const index = item.indexOf("=");
    return [decodeURIComponent(index < 0 ? item : item.slice(0, index)), decodeURIComponent(index < 0 ? "" : item.slice(index + 1))];
  }));
}

function pruneSessions() {
  // Session storage is intentionally memory-only: a service restart signs everyone out.
}

function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 80);
}
