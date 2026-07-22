import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function createLocalAuthService({ workDir, initialGeeLark = {} }) {
  const storePath = path.join(workDir, "local-accounts.json");
  const sessions = new Map();
  fs.mkdirSync(workDir, { recursive: true });

  function hasUsers() {
    return readStore().users.some((user) => user.active !== false);
  }

  function getSession(req) {
    pruneSessions();
    const token = parseCookies(req.headers.cookie || "").lf_session;
    const session = token ? sessions.get(token) : null;
    if (!session || session.expiresAt < Date.now()) return null;
    const user = readStore().users.find((entry) => entry.id === session.userId && entry.active !== false);
    return user ? { token, user: publicUser(user) } : null;
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
      password: hashPassword(password),
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
    if (!user || !verifyPassword(password, user.password)) throw new Error("账号或密码不正确。");
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL_MS });
    return { token, user: publicUser(user) };
  }

  function logout(token) {
    if (token) sessions.delete(token);
  }

  function listUsers() {
    return readStore().users.map(publicUser);
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
      password: hashPassword(payload.password), createdAt: Date.now(), updatedAt: Date.now()
    };
    store.users.push(user);
    writeStore(store);
    return publicUser(user);
  }

  function updateUser(id, payload) {
    const store = readStore();
    const user = store.users.find((entry) => entry.id === String(id));
    if (!user) throw new Error("账号不存在。");
    const nextRole = payload.role === "admin" ? "admin" : "operator";
    const nextActive = payload.active !== false;
    if (user.role === "admin" && user.active !== false && (!nextActive || nextRole !== "admin") && activeAdminCount(store) <= 1) {
      throw new Error("至少需要保留一个启用中的管理员账号。");
    }
    user.displayName = String(payload.displayName ?? user.displayName).trim().slice(0, 40) || user.username;
    user.role = nextRole;
    user.active = nextActive;
    user.geelarkProfileId = validateProfileId(store, payload.geelarkProfileId || user.geelarkProfileId);
    user.allowedDirectory = normalizeDirectory(payload.allowedDirectory ?? user.allowedDirectory);
    user.allowedGeeLarkGroups = normalizeGroups(payload.allowedGeeLarkGroups ?? user.allowedGeeLarkGroups);
    if (String(payload.password || "")) {
      validatePassword(payload.password);
      user.password = hashPassword(payload.password);
    }
    user.updatedAt = Date.now();
    writeStore(store);
    return publicUser(user);
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

  return { hasUsers, getSession, setupAdmin, login, logout, listUsers, listProfiles, getProfile, createUser, updateUser, saveProfile, deleteProfile };
}

function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role, active: user.active !== false, geelarkProfileId: user.geelarkProfileId || "default", allowedDirectory: user.allowedDirectory || "", allowedGeeLarkGroups: normalizeGroups(user.allowedGeeLarkGroups) };
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
