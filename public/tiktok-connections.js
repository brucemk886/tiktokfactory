const $ = (selector) => document.querySelector(selector);
const elements = {
  configuredDot: $("#configuredDot"), configuredLabel: $("#configuredLabel"),
  readyCount: $("#readyCount"), pendingCount: $("#pendingCount"), syncingCount: $("#syncingCount"), errorCount: $("#errorCount"),
  apiKey: $("#apiKey"), apiSecret: $("#apiSecret"), keyHint: $("#keyHint"), secretHint: $("#secretHint"),
  appPublicUrl: $("#appPublicUrl"), syncFrequency: $("#syncFrequency"), settingsStatus: $("#settingsStatus"), saveSettings: $("#saveSettings"),
  discoverButton: $("#discoverButton"), groupSelect: $("#groupSelect"), templateSelect: $("#templateSelect"), discoverySummary: $("#discoverySummary"), saveSelection: $("#saveSelection"),
  displayName: $("#displayName"), createConnection: $("#createConnection"), connectionList: $("#connectionList"),
  databaseHost: $("#databaseHost"), databasePort: $("#databasePort"), databaseName: $("#databaseName"), databaseUser: $("#databaseUser"),
  databasePassword: $("#databasePassword"), databasePasswordHint: $("#databasePasswordHint"), databaseSsl: $("#databaseSsl"),
  saveDatabase: $("#saveDatabase"), testDatabase: $("#testDatabase"), databaseStatus: $("#databaseStatus"), databaseSchema: $("#databaseSchema"),
  loadDatabaseData: $("#loadDatabaseData"), databaseSummary: $("#databaseSummary"), databaseTables: $("#databaseTables"), databaseVideos: $("#databaseVideos"),
  reloadButton: $("#reloadButton"), eventList: $("#eventList")
};

let state = { settings: {}, destination: {}, destinationDiscovery: null, destinationSnapshot: null, integrations: [], events: [], groups: [], connections: [] };

elements.saveSettings.addEventListener("click", saveSettings);
elements.discoverButton.addEventListener("click", discoverResources);
elements.saveSelection.addEventListener("click", saveSelection);
elements.createConnection.addEventListener("click", createConnection);
elements.saveDatabase.addEventListener("click", () => saveDatabaseSettings());
elements.testDatabase.addEventListener("click", testDatabaseConnection);
elements.loadDatabaseData.addEventListener("click", loadDatabaseData);
elements.reloadButton.addEventListener("click", refreshAllStatuses);
elements.connectionList.addEventListener("click", handleConnectionAction);

await loadOverview();
const callbackId = new URLSearchParams(location.search).get("integrationId");
if (callbackId) {
  const integration = await refreshStatus(callbackId, false);
  history.replaceState({}, "", "/tiktok-connections");
  await loadOverview();
  const completed = ["authorized", "ready", "syncing"].includes(integration.status);
  setStatus(
    completed
      ? "TikTok 授权已完成，Fivetran 正在同步数据。"
      : "已返回本地工厂，但授权尚未完成。请重新点击授权，并在 Fivetran 页面完成 Save & Test。",
    completed ? "success" : "error"
  );
}

async function loadOverview() {
  try {
    const data = await requestJson("/api/fivetran-tiktok");
    state = { ...state, ...data };
    render();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function saveSettings() {
  setBusy(elements.saveSettings, true, "保存中...");
  try {
    const payload = {
      apiKey: elements.apiKey.value.trim(),
      apiSecret: elements.apiSecret.value.trim(),
      appPublicUrl: elements.appPublicUrl.value.trim() || location.origin,
      syncFrequency: Number(elements.syncFrequency.value)
    };
    const data = await requestJson("/api/fivetran-tiktok/settings", { method: "POST", body: JSON.stringify(payload) });
    state.settings = data.settings;
    elements.apiKey.value = "";
    elements.apiSecret.value = "";
    setStatus("Fivetran 配置已保存。", "success");
    renderSettings();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(elements.saveSettings, false, "保存配置");
  }
}

async function discoverResources() {
  setBusy(elements.discoverButton, true, "读取中...");
  elements.discoverySummary.textContent = "正在读取 Fivetran Group 与连接...";
  try {
    const data = await requestJson("/api/fivetran-tiktok/discover", { method: "POST", body: "{}" });
    state.groups = data.groups || [];
    state.connections = data.connections || [];
    renderDiscovery();
    elements.discoverySummary.textContent = `读取到 ${state.groups.length} 个 Group、${state.connections.length} 个连接，其中 ${data.likelyTikTokConnections?.length || 0} 个可能是 TikTok Organic。`;
  } catch (error) {
    elements.discoverySummary.textContent = error.message;
  } finally {
    setBusy(elements.discoverButton, false, "读取 Fivetran");
  }
}

async function saveSelection() {
  const groupId = elements.groupSelect.value;
  const templateConnectionId = elements.templateSelect.value;
  if (!groupId || !templateConnectionId) return setStatus("请选择 Group 和 TikTok Organic 模板连接。", "error");
  setBusy(elements.saveSelection, true, "保存中...");
  try {
    const data = await requestJson("/api/fivetran-tiktok/select", {
      method: "POST",
      body: JSON.stringify({ groupId, templateConnectionId, appPublicUrl: elements.appPublicUrl.value, syncFrequency: Number(elements.syncFrequency.value) })
    });
    state.settings = data.settings;
    setStatus("连接模板已保存，可以新增账号授权。", "success");
    renderSettings();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(elements.saveSelection, false, "保存选择");
  }
}

async function createConnection() {
  if (!state.settings.groupId || !state.settings.templateConnectionId) return setStatus("请先读取并保存 Fivetran 连接模板。", "error");
  setBusy(elements.createConnection, true, "创建中...");
  try {
    const idempotencyKey = crypto.randomUUID();
    const data = await requestJson("/api/fivetran-tiktok/integrations", {
      method: "POST",
      body: JSON.stringify({ displayName: elements.displayName.value.trim(), idempotencyKey })
    });
    state.integrations.unshift(data.integration);
    elements.displayName.value = "";
    renderConnections();
    await openConnectCard(data.integration.id);
    await loadOverview();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(elements.createConnection, false, "新增账号授权");
  }
}

async function handleConnectionAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  setBusy(button, true, "处理中...");
  try {
    if (action === "authorize") await openConnectCard(id);
    if (action === "status") await refreshStatus(id);
    if (["sync", "pause", "resume"].includes(action)) {
      const data = await requestJson(`/api/fivetran-tiktok/integrations/${encodeURIComponent(id)}/${action}`, { method: "POST", body: "{}" });
      replaceIntegration(data.integration);
      renderConnections();
    }
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(button, false, actionLabel(action));
  }
}

async function openConnectCard(id) {
  const data = await requestJson(`/api/fivetran-tiktok/integrations/${encodeURIComponent(id)}/connect-card`, { method: "POST", body: "{}" });
  replaceIntegration(data.integration);
  window.location.assign(data.connectCardUrl);
}

async function refreshAllStatuses() {
  setBusy(elements.reloadButton, true, "刷新中...");
  try {
    for (const integration of state.integrations.filter((item) => item.fivetranConnectionId && item.status !== "disconnected")) {
      await refreshStatus(integration.id, false);
    }
    await loadOverview();
  } finally {
    setBusy(elements.reloadButton, false, "刷新状态");
  }
}

async function refreshStatus(id, renderAfter = true) {
  const data = await requestJson(`/api/fivetran-tiktok/integrations/${encodeURIComponent(id)}/status`, { cache: "no-store" });
  replaceIntegration(data.integration);
  if (renderAfter) renderConnections();
  return data.integration;
}

function replaceIntegration(integration) {
  const index = state.integrations.findIndex((item) => item.id === integration.id);
  if (index < 0) state.integrations.unshift(integration); else state.integrations[index] = integration;
  renderSummary();
}

function render() {
  renderSettings();
  renderDiscovery();
  renderConnections();
  renderDestinationSettings();
  renderEvents();
  renderSummary();
}

async function saveDatabaseSettings({ silent = false } = {}) {
  setBusy(elements.saveDatabase, true, "保存中...");
  try {
    const data = await requestJson("/api/fivetran-tiktok/destination/settings", {
      method: "POST",
      body: JSON.stringify({
        host: elements.databaseHost.value.trim(),
        port: Number(elements.databasePort.value),
        database: elements.databaseName.value.trim(),
        user: elements.databaseUser.value.trim(),
        password: elements.databasePassword.value,
        ssl: elements.databaseSsl.checked
      })
    });
    state.destination = data.settings;
    elements.databasePassword.value = "";
    renderDestinationSettings();
    if (!silent) setDatabaseStatus("目标数据库配置已保存。", "success");
    return data.settings;
  } catch (error) {
    setDatabaseStatus(error.message, "error");
    if (silent) throw error;
    return null;
  } finally {
    setBusy(elements.saveDatabase, false, "保存数据库");
  }
}

async function testDatabaseConnection() {
  setBusy(elements.testDatabase, true, "连接中...");
  try {
    await saveDatabaseSettings({ silent: true });
    const result = await requestJson("/api/fivetran-tiktok/destination/test", { method: "POST", body: "{}" });
    setDatabaseStatus(`连接成功：${result.database} · ${result.role}`, "success");
    await discoverDatabaseSchemas();
  } catch (error) {
    setDatabaseStatus(error.message, "error");
  } finally {
    setBusy(elements.testDatabase, false, "测试连接");
  }
}

async function discoverDatabaseSchemas() {
  const data = await requestJson("/api/fivetran-tiktok/destination/discover", { cache: "no-store" });
  state.destinationDiscovery = data;
  renderDatabaseSchemas();
  const schema = elements.databaseSchema.value;
  const totalVideos = (data.schemas || []).reduce((sum, item) => sum + Number(item.videoCount || 0), 0);
  setDatabaseStatus(`已读取 ${data.schemas?.length || 0} 个 TikTok Schema、${totalVideos} 条视频。`, "success");
  return schema;
}

async function loadDatabaseData() {
  setBusy(elements.loadDatabaseData, true, "读取中...");
  try {
    if (!state.destinationDiscovery) await discoverDatabaseSchemas();
    const schema = elements.databaseSchema.value;
    if (!schema) throw new Error("未找到已同步的 TikTok Organic Schema。");
    state.destinationSnapshot = await requestJson(`/api/fivetran-tiktok/destination/snapshot?schema=${encodeURIComponent(schema)}&limit=30`, { cache: "no-store" });
    renderDatabaseSnapshot();
    setDatabaseStatus(`已读取 ${state.destinationSnapshot.profiles.length} 个账号、${state.destinationSnapshot.videos.length} 条最近视频。`, "success");
  } catch (error) {
    setDatabaseStatus(error.message, "error");
  } finally {
    setBusy(elements.loadDatabaseData, false, "读取同步数据");
  }
}

function renderDestinationSettings() {
  const settings = state.destination || {};
  elements.databaseHost.value = settings.host || "";
  elements.databasePort.value = String(settings.port || 5432);
  elements.databaseName.value = settings.database || "";
  elements.databaseUser.value = settings.user || "";
  elements.databaseSsl.checked = settings.ssl !== false;
  elements.databasePasswordHint.textContent = settings.hasPassword ? "已保存密码，留空不会覆盖" : "尚未保存密码";
  if (state.destinationDiscovery) renderDatabaseSchemas();
}

function renderDatabaseSchemas() {
  const current = elements.databaseSchema.value;
  const schemas = state.destinationDiscovery?.schemas || [];
  elements.databaseSchema.innerHTML = schemas.length
    ? schemas.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)} · ${formatNumber(item.videoCount)} 条视频</option>`).join("")
    : `<option value="">未找到 TikTok Schema</option>`;
  if (schemas.some((item) => item.name === current)) elements.databaseSchema.value = current;
}

function renderDatabaseSnapshot() {
  const snapshot = state.destinationSnapshot;
  if (!snapshot) return;
  const profile = snapshot.profiles[0] || {};
  elements.databaseSummary.hidden = false;
  elements.databaseSummary.innerHTML = `
    <div><span>同步 Schema</span><strong>${escapeHtml(snapshot.schema)}</strong></div>
    <div><span>账号</span><strong>${formatNumber(snapshot.profiles.length)}</strong></div>
    <div><span>视频</span><strong>${formatNumber(snapshot.counts.video || 0)}</strong></div>
    <div><span>账号粉丝</span><strong>${formatNumber(profile.followers || 0)}</strong></div>`;

  elements.databaseTables.hidden = false;
  elements.databaseTables.innerHTML = Object.entries(snapshot.counts || {})
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `<span>${escapeHtml(name)} · ${formatNumber(count)}</span>`)
    .join("");

  elements.databaseVideos.hidden = false;
  elements.databaseVideos.innerHTML = snapshot.videos.length ? `
    <table>
      <thead><tr><th>视频</th><th>播放</th><th>平均观看</th><th>完播率</th><th>流量来源</th><th>性别</th><th>同步时间</th><th>链接</th></tr></thead>
      <tbody>${snapshot.videos.map((video) => `
        <tr>
          <td title="${escapeHtml(video.caption)}">${escapeHtml(video.caption || video.id)}</td>
          <td>${formatNumber(video.views)}</td>
          <td class="metric-private">${formatSeconds(video.averageTimeWatched)}</td>
          <td class="metric-private">${formatPercent(video.fullWatchRate)}</td>
          <td class="source-list" title="${escapeHtml(formatBreakdown(video.impressionSources, "impressionSource"))}">${escapeHtml(formatBreakdown(video.impressionSources, "impressionSource"))}</td>
          <td class="source-list" title="${escapeHtml(formatBreakdown(video.audienceGender, "gender"))}">${escapeHtml(formatBreakdown(video.audienceGender, "gender"))}</td>
          <td>${video.syncedAt ? formatTime(video.syncedAt) : "-"}</td>
          <td>${video.shareUrl ? `<a href="${escapeHtml(video.shareUrl)}" target="_blank" rel="noreferrer">打开</a>` : "-"}</td>
        </tr>`).join("")}</tbody>
    </table>` : `<div class="empty-state">当前 Schema 尚无视频数据。</div>`;
}

function renderSettings() {
  const settings = state.settings || {};
  elements.keyHint.textContent = settings.configured ? `已保存 ${settings.maskedApiKey}` : "尚未配置";
  elements.secretHint.textContent = settings.hasApiSecret ? "已保存 Secret" : "尚未配置";
  elements.appPublicUrl.value = settings.appPublicUrl || location.origin;
  elements.syncFrequency.value = String(settings.syncFrequency || 360);
  elements.groupSelect.value = settings.groupId || elements.groupSelect.value;
  elements.templateSelect.value = settings.templateConnectionId || elements.templateSelect.value;
  elements.configuredLabel.textContent = settings.configured ? "Fivetran 已配置" : "Fivetran 未配置";
  elements.configuredDot.parentElement.classList.toggle("is-ready", settings.configured === true);
}

function renderDiscovery() {
  const groupId = state.settings.groupId || "";
  const groups = state.groups.length ? state.groups : (groupId ? [{ id: groupId, name: `已保存 · ${groupId}` }] : []);
  elements.groupSelect.innerHTML = `<option value="">选择 Group</option>${groups.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")}`;
  elements.groupSelect.value = groups.some((item) => item.id === groupId) ? groupId : "";
  renderTemplateOptions();
  elements.groupSelect.onchange = renderTemplateOptions;
}

function renderTemplateOptions() {
  const groupId = elements.groupSelect.value;
  let available = state.connections.filter((item) => !groupId || item.groupId === groupId);
  const selected = state.settings.templateConnectionId || "";
  if (!available.length && selected) available = [{ id: selected, name: `已保存 · ${selected}`, service: "tiktok_organic_app" }];
  elements.templateSelect.innerHTML = `<option value="">选择现有 TikTok Organic 连接</option>${available.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.service || "unknown")}</option>`).join("")}`;
  elements.templateSelect.value = available.some((item) => item.id === selected) ? selected : "";
}

function renderConnections() {
  elements.connectionList.innerHTML = state.integrations.length ? state.integrations.map((item) => {
    const canSync = ["authorized", "ready", "syncing"].includes(item.status);
    const paused = ["paused", "disconnected"].includes(item.status);
    return `<article class="connection-row">
      <div class="connection-name"><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(item.schema)}</small></div>
      <div class="connection-meta"><span>最近同步：${item.lastSyncAt ? formatTime(item.lastSyncAt) : "尚未同步"}</span><span>${escapeHtml(item.fivetranConnectionId || "正在创建连接")}</span></div>
      <span class="status-pill" data-status="${escapeHtml(item.status)}">${statusLabel(item.status)}</span>
      <div class="row-actions">
        ${paused ? `<button class="secondary-button" data-action="resume" data-id="${item.id}">恢复</button>` : `<button class="secondary-button" data-action="authorize" data-id="${item.id}">授权</button>`}
        <button class="secondary-button" data-action="status" data-id="${item.id}">查状态</button>
        ${canSync ? `<button class="secondary-button" data-action="sync" data-id="${item.id}">立即同步</button>` : ""}
        ${!paused ? `<button class="secondary-button" data-action="pause" data-id="${item.id}">暂停</button>` : ""}
      </div>
    </article>`;
  }).join("") : `<div class="empty-state">尚未创建账号连接。</div>`;
  renderSummary();
}

function renderEvents() {
  elements.eventList.innerHTML = state.events.length ? state.events.map((item) => `<div class="event-row"><time>${formatTime(item.at)}</time><strong>${escapeHtml(eventLabel(item.type))}</strong><span>${escapeHtml(item.status || "")}</span></div>`).join("") : `<div class="empty-state">暂无事件。</div>`;
}

function renderSummary() {
  const counts = { ready: 0, pending: 0, syncing: 0, error: 0 };
  for (const item of state.integrations) {
    if (["ready", "authorized"].includes(item.status)) counts.ready += 1;
    else if (item.status === "syncing") counts.syncing += 1;
    else if (item.status === "error") counts.error += 1;
    else if (!["disconnected", "paused"].includes(item.status)) counts.pending += 1;
  }
  elements.readyCount.textContent = counts.ready;
  elements.pendingCount.textContent = counts.pending;
  elements.syncingCount.textContent = counts.syncing;
  elements.errorCount.textContent = counts.error;
}

function statusLabel(status) {
  return ({ creating: "创建中", pending_authorization: "等待授权", authorized: "已授权", syncing: "同步中", ready: "可用", error: "异常", paused: "已暂停", disconnected: "已断开" })[status] || status || "未知";
}

function eventLabel(type) {
  return ({ "settings.saved": "保存配置", "connection.create_started": "开始创建连接", "connection.created": "连接已创建", "connection.create_failed": "连接创建失败", "connect_card.created": "生成授权链接", "sync.requested": "请求手动同步", "connection.paused": "暂停连接", "connection.resumed": "恢复连接" })[type] || type || "系统事件";
}

function actionLabel(action) {
  return ({ authorize: "授权", status: "查状态", sync: "立即同步", pause: "暂停", resume: "恢复" })[action] || "操作";
}

function setStatus(message, tone = "") {
  elements.settingsStatus.textContent = message;
  elements.settingsStatus.dataset.tone = tone;
}

function setDatabaseStatus(message, tone = "") {
  elements.databaseStatus.textContent = message;
  elements.databaseStatus.dataset.tone = tone;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = label;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}

function formatTime(value) {
  const date = new Date(Number(value));
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { hour12: false }) : "-";
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
}

function formatSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? `${seconds.toFixed(1)}s` : "-";
}

function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  const percent = numeric <= 1 ? numeric * 100 : numeric;
  return `${percent.toFixed(1)}%`;
}

function formatBreakdown(items, labelKey) {
  if (!Array.isArray(items) || !items.length) return "-";
  return items
    .slice()
    .sort((a, b) => Number(b.percentage || 0) - Number(a.percentage || 0))
    .slice(0, 3)
    .map((item) => `${item[labelKey] || "-"} ${formatPercent(item.percentage)}`)
    .join(" / ");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
