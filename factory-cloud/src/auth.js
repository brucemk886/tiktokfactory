import { ensureModuleProjects, publicState, rememberAccountAliases, accountsFromArchiveRows } from "../../scripts/official-account-group-store.js";
import { homePathForUser, publicSidebarModules, sidebarModuleIdsForRole } from "./sidebar.js";
import { kvGet } from "./kv.js";
import {
  clearSessionCookie,
  errorJson,
  hashPassword,
  json,
  now,
  parseCookies,
  randomToken,
  readJson,
  sessionCookie,
  sha256Hex,
  verifyPassword
} from "./http.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function handleAuth(request, env, url) {
  const method = request.method;
  const pathname = url.pathname;

  if (method === "POST" && pathname === "/api/auth/setup") {
    if (await hasUsers(env.DB)) return errorJson("管理员账号已初始化。", 409);
    const payload = await readJson(request);
    const bootstrap = String(env.BOOTSTRAP_SECRET || "").trim();
    if (bootstrap && String(payload.bootstrapSecret || "") !== bootstrap) {
      return errorJson("初始化密钥不正确。", 403);
    }
    const user = await createUserRecord(env.DB, {
      username: payload.username,
      password: payload.password,
      displayName: payload.displayName || "管理员",
      role: "admin"
    });
    const session = await createSession(env.DB, user.id);
    return json({ ok: true, user: toPublicUser(user), home: homePathForUser(toPublicUser(user)) }, 201, {
      "Set-Cookie": sessionCookie(session.token, url.protocol === "https:")
    });
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const payload = await readJson(request);
    const username = normalizeUsername(payload.username);
    const row = await env.DB.prepare("SELECT * FROM factory_users WHERE username = ?").bind(username).first();
    if (!row || row.active === 0) return errorJson("账号或密码不正确。", 401);
    if (!await passwordMatches(row, payload.password)) return errorJson("账号或密码不正确。", 401);
    const session = await createSession(env.DB, row.id);
    const user = toPublicUser(row);
    return json({ ok: true, user, home: homePathForUser(user) }, 200, {
      "Set-Cookie": sessionCookie(session.token, url.protocol === "https:")
    });
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    const token = parseCookies(request.headers.get("cookie") || "").lf_session;
    if (token) {
      await env.DB.prepare("DELETE FROM factory_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
    }
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(url.protocol === "https:") });
  }

  const session = await getSession(request, env.DB);
  if (method === "GET" && pathname === "/api/auth/me") {
    if (!session) return errorJson("请先登录。", 401);
    return json({
      user: session.user,
      home: homePathForUser(session.user),
      profiles: session.user.role === "admin" ? await listProfiles(env.DB) : [],
      sidebarModules: publicSidebarModules()
    });
  }

  return null;
}

export async function handleAccounts(request, env, url, session) {
  if (!url.pathname.startsWith("/api/admin/")) return null;
  if (!session) return errorJson("请先登录。", 401);
  if (session.user.role !== "admin") return errorJson("仅管理员可以管理账号。", 403);
  const method = request.method;
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/admin/accounts") {
    const store = rememberAccountAliases(
      ensureModuleProjects(await kvGet(env.DB, "official-account-groups", {})),
      accountsFromArchiveRows(((await env.DB.prepare("SELECT account_key, label, profile_json FROM official_accounts_latest").all()).results) || [])
    );
    return json({
      users: await listUsers(env.DB),
      profiles: await listProfiles(env.DB),
      sidebarModules: publicSidebarModules(),
      accountGroups: publicState(store),
      currentUserId: session.user.id
    });
  }

  if (method === "POST" && pathname === "/api/admin/accounts") {
    const payload = await readJson(request);
    const user = await createUserRecord(env.DB, payload);
    return json({ user: toAdminUser(user) }, 201);
  }

  const accountMatch = pathname.match(/^\/api\/admin\/accounts\/([^/]+)$/);
  if (method === "PATCH" && accountMatch) {
    const user = await updateUserRecord(env.DB, decodeURIComponent(accountMatch[1]), await readJson(request));
    return json({ user });
  }
  if (method === "DELETE" && accountMatch) {
    await deleteUserRecord(env.DB, decodeURIComponent(accountMatch[1]), session.user.id);
    return json({ ok: true });
  }

  if (method === "POST" && pathname === "/api/admin/geelark-profiles") {
    return json({ profile: await saveProfile(env.DB, await readJson(request)) });
  }

  const groupMatch = pathname.match(/^\/api\/admin\/geelark-profiles\/([^/]+)\/groups$/);
  if (method === "GET" && groupMatch) {
    return json({ groups: [], accountCount: 0, note: "GeeLark 分组将在配置 API Key 后从官方接口读取。" });
  }

  const profileMatch = pathname.match(/^\/api\/admin\/geelark-profiles\/([^/]+)$/);
  if (method === "DELETE" && profileMatch) {
    await deleteProfile(env.DB, decodeURIComponent(profileMatch[1]));
    return json({ ok: true });
  }

  return null;
}

export async function getSession(request, db) {
  const token = parseCookies(request.headers.get("cookie") || "").lf_session;
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const session = await db.prepare("SELECT * FROM factory_sessions WHERE token_hash = ?").bind(tokenHash).first();
  if (!session || Number(session.expires_at) < now()) return null;
  const row = await db.prepare("SELECT * FROM factory_users WHERE id = ?").bind(session.user_id).first();
  if (!row || row.active === 0) return null;
  return { token, user: toPublicUser(row) };
}

export async function hasUsers(db) {
  const row = await db.prepare("SELECT COUNT(*) AS count FROM factory_users WHERE active = 1").first();
  return Number(row?.count || 0) > 0;
}

async function listUsers(db) {
  const { results } = await db.prepare("SELECT * FROM factory_users ORDER BY created_at").all();
  return (results || []).map(toAdminUser);
}

export async function listProfiles(db) {
  await ensureDefaultProfile(db);
  const { results } = await db.prepare("SELECT * FROM factory_geelark_profiles ORDER BY created_at").all();
  return (results || []).map(publicProfile);
}

export async function getProfile(db, id) {
  await ensureDefaultProfile(db);
  return db.prepare("SELECT * FROM factory_geelark_profiles WHERE id = ?").bind(String(id || "default")).first();
}

async function ensureDefaultProfile(db) {
  const existing = await db.prepare("SELECT id FROM factory_geelark_profiles WHERE id = ?").bind("default").first();
  if (existing) return;
  const stamp = now();
  await db.prepare(`
    INSERT INTO factory_geelark_profiles (id, name, api_base_url, app_id, api_key, created_at, updated_at)
    VALUES ('default', '默认 GeeLark 账号', 'https://openapi.geelark.cn', '', '', ?, ?)
  `).bind(stamp, stamp).run();
}

async function createUserRecord(db, payload) {
  await ensureDefaultProfile(db);
  const username = normalizeUsername(payload.username);
  validatePassword(payload.password);
  const exists = await db.prepare("SELECT id FROM factory_users WHERE username = ?").bind(username).first();
  if (exists) throw Object.assign(new Error("该登录账号已存在。"), { statusCode: 409 });
  const role = payload.role === "operator" ? "operator" : "admin";
  const hashed = await hashPassword(payload.password);
  const user = {
    id: crypto.randomUUID(),
    username,
    display_name: String(payload.displayName || username).trim().slice(0, 40) || username,
    role,
    active: payload.active === false ? 0 : 1,
    password_hash: hashed.hash,
    password_salt: hashed.salt,
    password_plain: String(payload.password),
    geelark_profile_id: String(payload.geelarkProfileId || "default"),
    allowed_directory: String(payload.allowedDirectory || "").trim(),
    allowed_geelark_groups_json: JSON.stringify(normalizeGroups(payload.allowedGeeLarkGroups)),
    allowed_account_groups_json: JSON.stringify(normalizeGroups(payload.allowedAccountGroups)),
    sidebar_modules_json: JSON.stringify(normalizeSidebarModules(payload.sidebarModules, role)),
    created_at: now(),
    updated_at: now()
  };
  await db.prepare(`
    INSERT INTO factory_users (
      id, username, display_name, role, active, password_hash, password_salt, password_plain,
      geelark_profile_id, allowed_directory, allowed_geelark_groups_json, allowed_account_groups_json,
      sidebar_modules_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    user.id, user.username, user.display_name, user.role, user.active, user.password_hash, user.password_salt, user.password_plain,
    user.geelark_profile_id, user.allowed_directory, user.allowed_geelark_groups_json, user.allowed_account_groups_json,
    user.sidebar_modules_json, user.created_at, user.updated_at
  ).run();
  return user;
}

async function updateUserRecord(db, id, payload) {
  const row = await db.prepare("SELECT * FROM factory_users WHERE id = ?").bind(String(id)).first();
  if (!row) throw Object.assign(new Error("账号不存在。"), { statusCode: 404 });
  const nextRole = payload.role === undefined ? row.role : (payload.role === "admin" ? "admin" : "operator");
  const nextActive = payload.active === undefined ? row.active : (payload.active === false ? 0 : 1);
  if (row.role === "admin" && row.active !== 0 && (nextActive === 0 || nextRole !== "admin")) {
    const admins = await db.prepare("SELECT COUNT(*) AS count FROM factory_users WHERE role = 'admin' AND active = 1").first();
    if (Number(admins?.count || 0) <= 1) throw Object.assign(new Error("至少需要保留一个启用中的管理员账号。"), { statusCode: 400 });
  }
  let hash = row.password_hash;
  let salt = row.password_salt;
  let passwordPlain = row.password_plain || "";
  if (String(payload.password || "")) {
    validatePassword(payload.password);
    const hashed = await hashPassword(payload.password);
    hash = hashed.hash;
    salt = hashed.salt;
    passwordPlain = String(payload.password);
  }
  const displayName = String(payload.displayName ?? row.display_name).trim().slice(0, 40) || row.username;
  const modules = JSON.stringify(normalizeSidebarModules(payload.sidebarModules ?? parseJson(row.sidebar_modules_json, []), nextRole));
  await db.prepare(`
    UPDATE factory_users SET
      display_name = ?, role = ?, active = ?, password_hash = ?, password_salt = ?, password_plain = ?,
      geelark_profile_id = ?, allowed_directory = ?, allowed_geelark_groups_json = ?,
      allowed_account_groups_json = ?, sidebar_modules_json = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    displayName, nextRole, nextActive, hash, salt, passwordPlain,
    String(payload.geelarkProfileId || row.geelark_profile_id || "default"),
    String(payload.allowedDirectory ?? row.allowed_directory ?? ""),
    JSON.stringify(normalizeGroups(payload.allowedGeeLarkGroups ?? parseJson(row.allowed_geelark_groups_json, []))),
    JSON.stringify(normalizeGroups(payload.allowedAccountGroups ?? parseJson(row.allowed_account_groups_json, []))),
    modules, now(), row.id
  ).run();
  const updated = await db.prepare("SELECT * FROM factory_users WHERE id = ?").bind(row.id).first();
  return toAdminUser(updated);
}

async function deleteUserRecord(db, id, currentUserId) {
  const row = await db.prepare("SELECT * FROM factory_users WHERE id = ?").bind(String(id)).first();
  if (!row) throw Object.assign(new Error("账号不存在。"), { statusCode: 404 });
  if (row.id === currentUserId) throw Object.assign(new Error("不能删除当前正在使用的账号。"), { statusCode: 400 });
  if (row.role === "admin" && row.active !== 0) {
    const admins = await db.prepare("SELECT COUNT(*) AS count FROM factory_users WHERE role = 'admin' AND active = 1").first();
    if (Number(admins?.count || 0) <= 1) throw Object.assign(new Error("至少需要保留一个启用中的管理员账号。"), { statusCode: 400 });
  }
  await db.prepare("DELETE FROM factory_sessions WHERE user_id = ?").bind(row.id).run();
  await db.prepare("DELETE FROM factory_users WHERE id = ?").bind(row.id).run();
}

async function saveProfile(db, payload) {
  await ensureDefaultProfile(db);
  const isNew = !payload.id;
  const id = isNew ? `profile-${crypto.randomUUID().slice(0, 8)}` : String(payload.id);
  let profile = await db.prepare("SELECT * FROM factory_geelark_profiles WHERE id = ?").bind(id).first();
  const stamp = now();
  if (!profile) {
    await db.prepare(`
      INSERT INTO factory_geelark_profiles (id, name, api_base_url, app_id, api_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, "未命名 GeeLark 账号", "https://openapi.geelark.cn", "", "", stamp, stamp).run();
    profile = await db.prepare("SELECT * FROM factory_geelark_profiles WHERE id = ?").bind(id).first();
  }
  const apiKey = String(payload.apiKey || "").trim() || profile.api_key;
  await db.prepare(`
    UPDATE factory_geelark_profiles SET name = ?, api_base_url = ?, app_id = ?, api_key = ?, updated_at = ?
    WHERE id = ?
  `).bind(
    String(payload.name || profile.name || "未命名 GeeLark 账号").trim().slice(0, 60) || "未命名 GeeLark 账号",
    String(payload.apiBaseUrl || profile.api_base_url || "https://openapi.geelark.cn").trim(),
    String(payload.appId ?? profile.app_id ?? "").trim(),
    apiKey,
    stamp,
    id
  ).run();
  return publicProfile(await db.prepare("SELECT * FROM factory_geelark_profiles WHERE id = ?").bind(id).first());
}

async function deleteProfile(db, id) {
  const profileId = String(id);
  if (profileId === "default") throw Object.assign(new Error("默认 GeeLark 配置不能删除，可直接修改。"), { statusCode: 400 });
  const used = await db.prepare("SELECT id FROM factory_users WHERE geelark_profile_id = ?").bind(profileId).first();
  if (used) throw Object.assign(new Error("仍有登录账号正在使用此 GeeLark 配置，不能删除。"), { statusCode: 400 });
  await db.prepare("DELETE FROM factory_geelark_profiles WHERE id = ?").bind(profileId).run();
}

async function createSession(db, userId) {
  const token = randomToken();
  const stamp = now();
  await db.prepare(`
    INSERT INTO factory_sessions (token_hash, user_id, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(await sha256Hex(token), userId, stamp + SESSION_TTL_MS, stamp, stamp).run();
  return { token };
}

function toPublicUser(row) {
  const role = row.role === "operator" ? "operator" : "admin";
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.displayName || row.username,
    role,
    active: row.active !== 0 && row.active !== false,
    geelarkProfileId: row.geelark_profile_id || row.geelarkProfileId || "default",
    allowedDirectory: row.allowed_directory || row.allowedDirectory || "",
    allowedGeeLarkGroups: normalizeGroups(parseJson(row.allowed_geelark_groups_json, row.allowedGeeLarkGroups || [])),
    allowedAccountGroups: normalizeGroups(parseJson(row.allowed_account_groups_json, row.allowedAccountGroups || [])),
    sidebarModules: normalizeSidebarModules(withOpsReportModules(withWorkJournalModule(parseJson(row.sidebar_modules_json, row.sidebarModules), role), role), role)
  };
}

function toAdminUser(row) {
  return {
    ...toPublicUser(row),
    password: String(row.password_plain || row.passwordPlain || "")
  };
}

function publicProfile(profile) {
  return {
    id: profile.id,
    name: profile.name,
    apiBaseUrl: profile.api_base_url || profile.apiBaseUrl,
    appId: profile.app_id || profile.appId || "",
    hasApiKey: Boolean(profile.api_key || profile.apiKey),
    updatedAt: Number(profile.updated_at || profile.updatedAt || 0)
  };
}

function normalizeUsername(value) {
  const username = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) throw Object.assign(new Error("登录账号需为 3-32 位英文、数字、点、下划线或短横线。"), { statusCode: 400 });
  return username;
}

async function passwordMatches(row, password) {
  const candidates = Array.from(new Set([String(password ?? ""), String(password ?? "").trim()].filter(Boolean)));
  for (const candidate of candidates) {
    if (await verifyPassword(candidate, row.password_salt, row.password_hash)) return true;
    if (row.password_plain && candidate === row.password_plain) return true;
  }
  return false;
}

function validatePassword(password) {
  if (String(password || "").length < 8) throw Object.assign(new Error("密码至少需要 8 位。"), { statusCode: 400 });
}

function normalizeGroups(value) {
  const groups = Array.isArray(value) ? value : String(value || "").split(/[,，\n]/);
  return Array.from(new Set(groups.map((group) => String(group || "").trim()).filter(Boolean))).slice(0, 100);
}

function withOpsReportModules(value, role) {
  const modules = Array.isArray(value) ? [...value] : [];
  if (!modules.length) return value;
  const midVideoIds = ["mid-video", "schulte", "podcast", "ai", "asset-usage", "mid-video-effects", "mid-video-ops-report", "mid-video-publish"];
  const psychologyIds = ["psychology-topics", "psychology", "psychology-effects", "psychology-ops-report", "psychology-publish"];
  const novelIds = ["novel-strategy", "novel-library", "novel-effects", "novel-ops-report", "novel-publish", "operator-official", "tasks"];
  if (modules.some((moduleId) => midVideoIds.includes(moduleId))) {
    insertModuleAfter(modules, "asset-usage", "mid-video-effects");
    insertModuleAfter(modules, "mid-video-effects", "mid-video-ops-report");
    insertModuleAfter(modules, "mid-video-ops-report", "mid-video-publish");
  }
  if (modules.some((moduleId) => psychologyIds.includes(moduleId))) {
    insertModuleAfter(modules, "psychology", "psychology-effects");
    insertModuleAfter(modules, "psychology-effects", "psychology-ops-report");
    insertModuleAfter(modules, "psychology-ops-report", "psychology-publish");
  }
  if (modules.some((moduleId) => novelIds.includes(moduleId))) {
    insertModuleAfter(modules, "novel-effects", "novel-ops-report");
    insertModuleAfter(modules, "novel-ops-report", "novel-publish");
  }
  if (role === "admin") {
    insertModuleAfter(modules, "analytics-settings", "geelark-profiles");
  }
  return modules;
}

function insertModuleAfter(modules, afterId, moduleId) {
  const existing = modules.indexOf(moduleId);
  if (existing >= 0) modules.splice(existing, 1);
  const after = modules.indexOf(afterId);
  modules.splice(after >= 0 ? after + 1 : modules.length, 0, moduleId);
}

function withWorkJournalModule(value, role) {
  if (role !== "admin") return value;
  const modules = Array.isArray(value) ? [...value] : [];
  if (!modules.length) return value;
  const withoutJournal = modules.filter((moduleId) => moduleId !== "work-journal");
  const accountsIndex = withoutJournal.indexOf("accounts");
  withoutJournal.splice(accountsIndex >= 0 ? accountsIndex : withoutJournal.length, 0, "work-journal");
  return withoutJournal;
}

function normalizeSidebarModules(value, role) {
  const allowed = sidebarModuleIdsForRole(role);
  if (!Array.isArray(value)) return role === "operator" ? [] : [...allowed];
  const selected = new Set(value.map((item) => String(item || "").trim()).filter(Boolean));
  return allowed.filter((moduleId) => selected.has(moduleId));
}

function parseJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  try {
    return JSON.parse(value || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
