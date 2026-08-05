import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const API_BASE_URL = "https://api.fivetran.com";
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [800, 2_000];
const CONNECT_CARD_TTL_MS = 24 * 60 * 60 * 1000;

export function createFivetranTikTokService({ workDir, fetchImpl = globalThis.fetch, now = () => Date.now(), sleep = defaultSleep } = {}) {
  if (!workDir) throw new Error("Fivetran service requires a work directory.");
  if (typeof fetchImpl !== "function") throw new Error("Fivetran service requires fetch support.");

  const settingsPath = path.join(workDir, "fivetran-settings.json");
  const integrationsPath = path.join(workDir, "fivetran-tiktok-integrations.json");
  const eventsPath = path.join(workDir, "fivetran-tiktok-events.json");
  fs.mkdirSync(workDir, { recursive: true });

  function getPublicSettings() {
    const settings = readSettings();
    return {
      configured: Boolean(settings.apiKey && settings.apiSecret),
      maskedApiKey: maskValue(settings.apiKey),
      hasApiSecret: Boolean(settings.apiSecret),
      groupId: settings.groupId || "",
      templateConnectionId: settings.templateConnectionId || "",
      appPublicUrl: settings.appPublicUrl || "http://127.0.0.1:3010",
      syncFrequency: Number(settings.syncFrequency || 360),
      updatedAt: Number(settings.updatedAt || 0)
    };
  }

  function saveSettings(payload = {}) {
    const current = readSettings();
    const next = {
      ...current,
      apiKey: clean(payload.apiKey) || current.apiKey || "",
      apiSecret: clean(payload.apiSecret) || current.apiSecret || "",
      groupId: payload.groupId === undefined ? (current.groupId || "") : clean(payload.groupId),
      templateConnectionId: payload.templateConnectionId === undefined
        ? (current.templateConnectionId || "")
        : clean(payload.templateConnectionId),
      appPublicUrl: normalizePublicUrl(payload.appPublicUrl ?? current.appPublicUrl ?? "http://127.0.0.1:3010"),
      syncFrequency: normalizeSyncFrequency(payload.syncFrequency ?? current.syncFrequency ?? 360),
      updatedAt: now()
    };
    if (!next.apiKey || !next.apiSecret) throw httpError(400, "请填写 Fivetran API Key 和 API Secret。");
    writeJson(settingsPath, next);
    appendEvent({ type: "settings.saved", status: "success" });
    return getPublicSettings();
  }

  async function discover() {
    ensureConfigured();
    const settings = readSettings();
    const [groups, connections] = await Promise.all([
      listAll("/v1/groups", "items"),
      listAll(`/v1/connections${settings.groupId ? `?group_id=${encodeURIComponent(settings.groupId)}` : ""}`, "items")
    ]);
    const normalizedGroups = groups.map(normalizeGroup);
    const normalizedConnections = connections.map(normalizeConnectionSummary);
    return {
      groups: normalizedGroups,
      connections: normalizedConnections,
      likelyTikTokConnections: normalizedConnections.filter(isLikelyTikTokConnection)
    };
  }

  async function selectDiscoverySettings(payload = {}) {
    const next = saveSettings({
      groupId: payload.groupId,
      templateConnectionId: payload.templateConnectionId,
      appPublicUrl: payload.appPublicUrl,
      syncFrequency: payload.syncFrequency
    });
    if (next.templateConnectionId) {
      const template = await request("GET", `/v1/connections/${encodeURIComponent(next.templateConnectionId)}`);
      if (next.groupId && String(template.group_id || template.groupId || "") !== next.groupId) {
        throw httpError(400, "所选模板连接不属于当前 Fivetran Group。");
      }
    }
    return next;
  }

  function listIntegrations({ ownerUserId = "", includeDisconnected = true } = {}) {
    return readIntegrations()
      .filter((item) => !ownerUserId || item.ownerUserId === ownerUserId)
      .filter((item) => includeDisconnected || item.status !== "disconnected")
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .map(publicIntegration);
  }

  function getIntegration(id, ownerUserId = "") {
    const item = readIntegrations().find((entry) => entry.id === String(id));
    if (!item || (ownerUserId && item.ownerUserId !== ownerUserId)) throw httpError(404, "TikTok 授权记录不存在。");
    return item;
  }

  async function createIntegration({ ownerUserId, ownerUsername, displayName, idempotencyKey } = {}) {
    ensureConfigured({ requireSelection: true });
    const key = clean(idempotencyKey);
    const records = readIntegrations();
    if (key) {
      const existing = records.find((item) => item.ownerUserId === ownerUserId && item.idempotencyKey === key);
      if (existing) return publicIntegration(existing);
    }

    const settings = readSettings();
    const template = await request("GET", `/v1/connections/${encodeURIComponent(settings.templateConnectionId)}`);
    const service = clean(template.service);
    if (!service) throw httpError(400, "模板连接缺少 service，无法创建 TikTok Organic 连接。");
    if (!isLikelyTikTokConnection({ service, serviceName: template.service })) {
      throw httpError(400, `所选模板不是 TikTok Organic 连接（service: ${service}）。`);
    }

    const id = crypto.randomUUID();
    const schema = createSchemaName(ownerUsername || ownerUserId, id);
    const record = {
      id,
      ownerUserId: clean(ownerUserId),
      ownerUsername: clean(ownerUsername),
      displayName: clean(displayName).slice(0, 80) || `TikTok ${new Date(now()).toLocaleString("zh-CN")}`,
      schema,
      fivetranConnectionId: "",
      service,
      status: "creating",
      setupState: "incomplete",
      syncState: "scheduled",
      idempotencyKey: key,
      createdAt: now(),
      updatedAt: now(),
      lastCheckedAt: 0,
      lastSyncAt: 0,
      lastError: ""
    };
    records.push(record);
    writeIntegrations(records);
    appendEvent({ integrationId: id, ownerUserId: record.ownerUserId, type: "connection.create_started", status: "pending" });

    try {
      const created = await request("POST", "/v1/connections", {
        body: {
          group_id: settings.groupId,
          service,
          run_setup_tests: false,
          paused: false,
          sync_frequency: settings.syncFrequency,
          destination_schema_names: normalizeDestinationSchemaNames(template.destination_schema_names),
          config: {
            ...copyReusableConfig(template.config),
            schema
          }
        }
      });
      record.fivetranConnectionId = clean(created.id);
      record.status = "pending_authorization";
      record.setupState = clean(created.status?.setup_state || created.setup_state) || "incomplete";
      record.syncState = clean(created.status?.sync_state || created.sync_state) || "scheduled";
      record.updatedAt = now();
      writeIntegrations(records);
      appendEvent({ integrationId: id, ownerUserId: record.ownerUserId, type: "connection.created", status: "success", fivetranConnectionId: record.fivetranConnectionId });
      return publicIntegration(record);
    } catch (error) {
      record.status = "error";
      record.lastError = safeErrorMessage(error);
      record.updatedAt = now();
      writeIntegrations(records);
      appendEvent({ integrationId: id, ownerUserId: record.ownerUserId, type: "connection.create_failed", status: "error", message: record.lastError });
      throw error;
    }
  }

  async function createConnectCard(id, ownerUserId = "") {
    const record = getIntegration(id, ownerUserId);
    if (!record.fivetranConnectionId) throw httpError(409, "Fivetran 连接尚未创建完成。");
    if (record.status === "disconnected") throw httpError(409, "该连接已断开，请先恢复连接。");
    const settings = readSettings();
    const redirectUri = `${settings.appPublicUrl}/tiktok-connections/callback?integrationId=${encodeURIComponent(record.id)}`;
    const card = await request("POST", `/v1/connections/${encodeURIComponent(record.fivetranConnectionId)}/connect-card`, {
      body: {
        connect_card_config: {
          redirect_uri: redirectUri,
          hide_setup_guide: true
        }
      }
    });
    const connectCardUrl = clean(card.connect_card?.uri || card.connect_card_uri || card.uri || card.url);
    if (!connectCardUrl) throw httpError(502, "Fivetran 没有返回 Connect Card 授权地址。");
    updateRecord(record.id, (item) => ({
      ...item,
      status: item.status === "error" ? "pending_authorization" : item.status,
      connectCardExpiresAt: now() + CONNECT_CARD_TTL_MS,
      updatedAt: now()
    }));
    appendEvent({ integrationId: record.id, ownerUserId: record.ownerUserId, type: "connect_card.created", status: "success" });
    return { integration: publicIntegration(getIntegration(record.id)), connectCardUrl, expiresAt: now() + CONNECT_CARD_TTL_MS };
  }

  function renameIntegration(id, displayName, ownerUserId = "") {
    getIntegration(id, ownerUserId);
    const nextName = clean(displayName).slice(0, 80);
    if (!nextName) throw httpError(400, "Please provide an account identifier, for example @your_tiktok_account.");
    const updated = updateRecord(id, (item) => ({ ...item, displayName: nextName, updatedAt: now() }));
    appendEvent({ integrationId: id, ownerUserId: updated.ownerUserId, type: "connection.label_updated", status: "success" });
    return publicIntegration(updated);
  }

  async function refreshStatus(id, ownerUserId = "") {
    const record = getIntegration(id, ownerUserId);
    if (!record.fivetranConnectionId) return publicIntegration(record);
    const remote = await request("GET", `/v1/connections/${encodeURIComponent(record.fivetranConnectionId)}`);
    const remoteStatus = remote.status || {};
    const setupState = clean(remoteStatus.setup_state || remote.setup_state) || record.setupState;
    const syncState = clean(remoteStatus.sync_state || remote.sync_state) || record.syncState;
    const succeededAt = parseTime(remote.succeeded_at || remoteStatus.succeeded_at);
    const failedAt = parseTime(remote.failed_at || remoteStatus.failed_at);
    const status = record.status === "disconnected"
      ? "disconnected"
      : mapConnectionStatus({ setupState, syncState, succeededAt, failedAt, paused: remote.paused });
    const updated = updateRecord(record.id, (item) => ({
      ...item,
      status,
      setupState,
      syncState,
      paused: remote.paused === true,
      lastCheckedAt: now(),
      lastSyncAt: Math.max(succeededAt, item.lastSyncAt || 0),
      lastError: failedAt > succeededAt ? "Fivetran 最近一次同步失败，请查看连接详情。" : "",
      updatedAt: now()
    }));
    return publicIntegration(updated);
  }

  async function syncNow(id, ownerUserId = "") {
    const record = getIntegration(id, ownerUserId);
    if (!record.fivetranConnectionId) throw httpError(409, "Fivetran 连接尚未创建完成。");
    await request("POST", `/v1/connections/${encodeURIComponent(record.fivetranConnectionId)}/sync`, { body: {} });
    const updated = updateRecord(record.id, (item) => ({ ...item, status: "syncing", syncState: "syncing", updatedAt: now() }));
    appendEvent({ integrationId: record.id, ownerUserId: record.ownerUserId, type: "sync.requested", status: "success" });
    return publicIntegration(updated);
  }

  async function pauseIntegration(id, ownerUserId = "") {
    const record = getIntegration(id, ownerUserId);
    if (record.fivetranConnectionId) {
      await request("PATCH", `/v1/connections/${encodeURIComponent(record.fivetranConnectionId)}`, { body: { paused: true } });
    }
    const updated = updateRecord(record.id, (item) => ({ ...item, status: "disconnected", paused: true, updatedAt: now() }));
    appendEvent({ integrationId: record.id, ownerUserId: record.ownerUserId, type: "connection.paused", status: "success" });
    return publicIntegration(updated);
  }

  async function resumeIntegration(id, ownerUserId = "") {
    const record = getIntegration(id, ownerUserId);
    if (!record.fivetranConnectionId) throw httpError(409, "Fivetran 连接尚未创建完成。");
    await request("PATCH", `/v1/connections/${encodeURIComponent(record.fivetranConnectionId)}`, { body: { paused: false } });
    const updated = updateRecord(record.id, (item) => ({ ...item, status: "pending_authorization", paused: false, updatedAt: now() }));
    appendEvent({ integrationId: record.id, ownerUserId: record.ownerUserId, type: "connection.resumed", status: "success" });
    return publicIntegration(updated);
  }

  function listEvents({ ownerUserId = "", limit = 100 } = {}) {
    return readJson(eventsPath, [])
      .filter((item) => !ownerUserId || item.ownerUserId === ownerUserId)
      .slice(-Math.max(1, Math.min(500, Number(limit) || 100)))
      .reverse();
  }

  async function listAll(initialPath, collectionKey) {
    const items = [];
    let nextPath = initialPath;
    let page = 0;
    while (nextPath && page < 20) {
      const data = await request("GET", nextPath);
      const pageItems = Array.isArray(data?.[collectionKey]) ? data[collectionKey] : [];
      items.push(...pageItems);
      const cursor = clean(data?.next_cursor);
      nextPath = cursor ? appendQuery(initialPath, "cursor", cursor) : "";
      page += 1;
    }
    return items;
  }

  async function request(method, pathname, { body } = {}) {
    const settings = ensureConfigured();
    const url = pathname.startsWith("http") ? pathname : `${API_BASE_URL}${pathname}`;
    let lastError = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetchImpl(url, {
          method,
          signal: controller.signal,
          headers: {
            Accept: "application/json;version=2",
            Authorization: `Basic ${Buffer.from(`${settings.apiKey}:${settings.apiSecret}`).toString("base64")}`,
            ...(body === undefined ? {} : { "Content-Type": "application/json" })
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
        const text = await response.text();
        const payload = parseJson(text);
        if (response.ok) return payload?.data ?? payload ?? {};
        const message = clean(payload?.message || payload?.data?.message || payload?.code || text).slice(0, 500);
        const error = httpError(response.status, `Fivetran API 请求失败（${response.status}）：${message || "未知错误"}`);
        error.retryable = response.status === 429 || response.status >= 500;
        lastError = error;
        if (!error.retryable || attempt >= RETRY_DELAYS_MS.length) throw error;
      } catch (error) {
        lastError = normalizeRequestError(error);
        if (!lastError.retryable || attempt >= RETRY_DELAYS_MS.length) throw lastError;
      } finally {
        clearTimeout(timeout);
      }
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
    throw lastError || httpError(502, "Fivetran API 请求失败。");
  }

  function ensureConfigured({ requireSelection = false } = {}) {
    const settings = readSettings();
    if (!settings.apiKey || !settings.apiSecret) throw httpError(400, "请先配置 Fivetran API Key 和 API Secret。");
    if (requireSelection && (!settings.groupId || !settings.templateConnectionId)) {
      throw httpError(400, "请先发现并选择 Fivetran Group 和现有 TikTok Organic 模板连接。");
    }
    return settings;
  }

  function readSettings() {
    return {
      apiKey: clean(process.env.FIVETRAN_API_KEY),
      apiSecret: clean(process.env.FIVETRAN_API_SECRET),
      groupId: clean(process.env.FIVETRAN_GROUP_ID),
      templateConnectionId: clean(process.env.FIVETRAN_EXISTING_TIKTOK_CONNECTION_ID),
      appPublicUrl: clean(process.env.APP_PUBLIC_URL) || "http://127.0.0.1:3010",
      syncFrequency: 360,
      ...readJson(settingsPath, {})
    };
  }

  function readIntegrations() {
    const value = readJson(integrationsPath, []);
    return Array.isArray(value) ? value : [];
  }

  function writeIntegrations(records) {
    writeJson(integrationsPath, records);
  }

  function updateRecord(id, updater) {
    const records = readIntegrations();
    const index = records.findIndex((item) => item.id === String(id));
    if (index < 0) throw httpError(404, "TikTok 授权记录不存在。");
    records[index] = updater(records[index]);
    writeIntegrations(records);
    return records[index];
  }

  function appendEvent(event) {
    const events = readJson(eventsPath, []);
    const next = Array.isArray(events) ? events : [];
    next.push({ id: crypto.randomUUID(), at: now(), ...event });
    writeJson(eventsPath, next.slice(-2_000));
  }

  return {
    getPublicSettings,
    saveSettings,
    discover,
    selectDiscoverySettings,
    listIntegrations,
    createIntegration,
    createConnectCard,
    renameIntegration,
    refreshStatus,
    syncNow,
    pauseIntegration,
    resumeIntegration,
    listEvents
  };
}

function normalizeGroup(item = {}) {
  return { id: clean(item.id), name: clean(item.name) || clean(item.id), createdAt: parseTime(item.created_at) };
}

function normalizeConnectionSummary(item = {}) {
  const status = item.status || {};
  return {
    id: clean(item.id),
    name: clean(item.name || item.schema || item.config?.schema || item.id),
    service: clean(item.service),
    groupId: clean(item.group_id),
    schema: clean(item.schema || item.config?.schema),
    setupState: clean(status.setup_state || item.setup_state),
    syncState: clean(status.sync_state || item.sync_state),
    paused: item.paused === true
  };
}

function isLikelyTikTokConnection(item = {}) {
  const value = `${item.service || ""} ${item.serviceName || ""} ${item.name || ""}`.toLowerCase();
  return value.includes("tiktok") && !value.includes("ads");
}

function mapConnectionStatus({ setupState, syncState, succeededAt, failedAt, paused }) {
  if (paused) return "paused";
  if (setupState === "broken") return "error";
  if (setupState !== "connected") return "pending_authorization";
  if (syncState === "syncing" || syncState === "rescheduled") return "syncing";
  if (failedAt > succeededAt) return "error";
  if (succeededAt > 0) return "ready";
  return "authorized";
}

function publicIntegration(item) {
  return {
    id: item.id,
    displayName: item.displayName,
    schema: item.schema,
    fivetranConnectionId: item.fivetranConnectionId,
    service: item.service,
    status: item.status,
    setupState: item.setupState,
    syncState: item.syncState,
    paused: item.paused === true,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastCheckedAt: item.lastCheckedAt,
    lastSyncAt: item.lastSyncAt,
    connectCardExpiresAt: item.connectCardExpiresAt || 0,
    lastError: item.lastError || ""
  };
}

function copyReusableConfig(config = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const blocked = /secret|token|password|credential|auth|private|key/i;
  return Object.fromEntries(Object.entries(config).filter(([key, value]) => {
    if (key === "schema" || blocked.test(key)) return false;
    return value === null || ["string", "number", "boolean"].includes(typeof value);
  }));
}

function createSchemaName(owner, id) {
  const cleanOwner = String(owner || "account").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "account";
  return `tiktok_org_${cleanOwner}_${String(id).replace(/-/g, "").slice(0, 8)}`.slice(0, 63);
}

function normalizeDestinationSchemaNames(value) {
  return value === "SOURCE_NAMING" ? "SOURCE_NAMING" : "FIVETRAN_NAMING";
}

function normalizeSyncFrequency(value) {
  const allowed = [5, 15, 30, 60, 120, 180, 360, 480, 720, 1440];
  const number = Number(value);
  return allowed.includes(number) ? number : 360;
}

function normalizePublicUrl(value) {
  let parsed;
  try {
    parsed = new URL(clean(value) || "http://127.0.0.1:3010");
  } catch {
    throw httpError(400, "回调地址格式不正确。");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw httpError(400, "回调地址只支持 HTTP 或 HTTPS。");
  return parsed.origin;
}

function parseTime(value) {
  if (!value) return 0;
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number > 1e12 ? number : number * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function appendQuery(pathname, key, value) {
  return `${pathname}${pathname.includes("?") ? "&" : "?"}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function maskValue(value) {
  const text = clean(value);
  if (!text) return "";
  if (text.length <= 8) return `${text.slice(0, 2)}***`;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function safeErrorMessage(error) {
  return String(error?.message || "未知错误").replace(/Basic\s+[A-Za-z0-9+/=]+/g, "Basic [REDACTED]").slice(0, 800);
}

function normalizeRequestError(error) {
  if (error?.statusCode) return error;
  if (error?.name === "AbortError") {
    const timeoutError = httpError(504, "Fivetran API 请求超时（30 秒）。");
    timeoutError.retryable = true;
    return timeoutError;
  }
  const normalized = httpError(502, `Fivetran API 连接失败：${safeErrorMessage(error)}`);
  normalized.retryable = true;
  return normalized;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function parseJson(value) {
  if (!value) return {};
  try { return JSON.parse(value); } catch { return { message: String(value) }; }
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return structuredClone(fallback); }
}

function writeJson(filePath, value) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function clean(value) {
  return String(value ?? "").trim();
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
