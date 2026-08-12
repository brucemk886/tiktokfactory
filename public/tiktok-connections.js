const elements = {
  bridgeUrl: document.querySelector("#bridgeUrl"),
  bridgeApiKey: document.querySelector("#bridgeApiKey"),
  authorizeLink: document.querySelector("#authorizeLink"),
  settingsSummary: document.querySelector("#settingsSummary"),
  statusMessage: document.querySelector("#statusMessage"),
  accountList: document.querySelector("#accountList"),
  saveButton: document.querySelector("#saveButton"),
  testButton: document.querySelector("#testButton"),
  refreshButton: document.querySelector("#refreshButton"),
};

elements.saveButton?.addEventListener("click", saveSettings);
elements.testButton?.addEventListener("click", testConnection);
elements.refreshButton?.addEventListener("click", loadAccounts);
elements.bridgeUrl?.addEventListener("input", updateAuthorizeLink);

await loadSettings();
await loadAccounts();

async function loadSettings() {
  try {
    const result = await requestJson("/api/private-tiktok/settings");
    const settings = result.settings || {};
    elements.bridgeUrl.value = settings.baseUrl || "https://tiktokaitool.com";
    elements.settingsSummary.textContent = settings.configured ? `已连接 · ${settings.baseUrl}` : "尚未配置桥接 API Key。";
    updateAuthorizeLink();
  } catch (error) {
    elements.settingsSummary.textContent = error.message || "读取配置失败。";
  }
}

async function saveSettings() {
  setBusy(elements.saveButton, true, "保存中...");
  try {
    const result = await requestJson("/api/private-tiktok/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: elements.bridgeUrl.value.trim(), apiKey: elements.bridgeApiKey.value.trim() }),
    });
    elements.bridgeApiKey.value = "";
    elements.settingsSummary.textContent = result.settings?.configured ? `已连接 · ${result.settings.baseUrl}` : "配置已保存，但尚未填写 API Key。";
    updateAuthorizeLink();
    await loadAccounts();
  } catch (error) {
    showStatus(error.message || "保存配置失败。", true);
  } finally {
    setBusy(elements.saveButton, false, "保存配置");
  }
}

async function testConnection() {
  setBusy(elements.testButton, true, "测试中...");
  try {
    const result = await requestJson("/api/private-tiktok/test", { method: "POST", body: "{}" });
    showStatus(`连接成功，读取到 ${Number(result.accountCount || 0)} 个已授权账号。`);
  } catch (error) {
    showStatus(error.message || "连接测试失败。", true);
  } finally {
    setBusy(elements.testButton, false, "测试连接");
  }
}

async function loadAccounts() {
  setBusy(elements.refreshButton, true, "刷新中...");
  elements.accountList.innerHTML = '<div class="empty-state">正在读取已授权账号...</div>';
  try {
    const result = await requestJson("/api/private-tiktok/accounts");
    const accounts = Array.isArray(result.accounts) ? result.accounts : [];
    renderAccounts(accounts);
    showStatus(`已读取 ${accounts.length} 个已授权账号。`);
  } catch (error) {
    elements.accountList.innerHTML = '<div class="empty-state">暂时无法读取账号。</div>';
    showStatus(error.message || "读取已授权账号失败。", true);
  } finally {
    setBusy(elements.refreshButton, false, "刷新账号");
  }
}

function renderAccounts(accounts) {
  if (!accounts.length) {
    elements.accountList.innerHTML = '<div class="empty-state">暂无已授权账号。请先前往 TikTok AI Tool 完成授权。</div>';
    return;
  }
  elements.accountList.innerHTML = accounts.map((account) => {
    const profile = account.profile || {};
    const username = profile.username ? `@${profile.username}` : profile.displayName || account.label || "TikTok 账号";
    const displayName = profile.displayName && profile.displayName !== profile.username ? profile.displayName : "官方授权账号";
    const videoCount = Number(account.syncedVideoCount ?? account.videoCount ?? 0);
    const syncedAt = formatTime(account.syncedAt || account.updatedAt);
    return `<article class="account-row">
      <div><strong>${escapeHtml(username)}</strong><span>${escapeHtml(displayName)}</span></div>
      <div><small>视频</small><b>${formatNumber(videoCount)}</b></div>
      <div><small>最近同步</small><b>${escapeHtml(syncedAt)}</b></div>
      <div><small>状态</small><b class="ready-pill">已授权</b></div>
    </article>`;
  }).join("");
}

function updateAuthorizeLink() {
  const baseUrl = String(elements.bridgeUrl?.value || "https://tiktokaitool.com").trim().replace(/\/+$/, "");
  elements.authorizeLink.href = `${baseUrl || "https://tiktokaitool.com"}/dashboard?view=connect`;
}

function showStatus(message, isError = false) {
  elements.statusMessage.hidden = false;
  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.toggle("is-error", isError);
}

function setBusy(button, busy, label) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = label;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

function formatNumber(value) { return Number(value || 0).toLocaleString("zh-CN"); }
function formatTime(value) {
  const timestamp = Number(value || 0);
  return timestamp ? new Date(timestamp).toLocaleString("zh-CN", { hour12: false }) : "尚未同步";
}
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
