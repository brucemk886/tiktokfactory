const $ = (selector) => document.querySelector(selector);
let state = { page: 1, pageSize: 20, total: 0, items: [] };

$("#saveSettingsBtn").addEventListener("click", saveSettings);
$("#syncBtn").addEventListener("click", syncTopics);
$("#searchBtn").addEventListener("click", () => loadTopics(1));
$("#query").addEventListener("keydown", (event) => { if (event.key === "Enter") loadTopics(1); });
$("#prevBtn").addEventListener("click", () => loadTopics(Math.max(1, state.page - 1)));
$("#nextBtn").addEventListener("click", () => loadTopics(state.page + 1));
$("#topicList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-use-topic]");
  if (button) location.href = `/psychology?topic=${encodeURIComponent(button.dataset.useTopic)}`;
});

loadSettings();
loadTopics(1);

async function loadSettings() {
  try {
    const data = await api("/api/psychology-topics/settings");
    $("#apiUrl").value = data.apiUrl || "";
    $("#authType").value = data.authType || "none";
    $("#apiToken").placeholder = data.tokenConfigured ? "已保存，留空保持不变" : "填写 Token 或 API Key";
    renderSummary(data);
  } catch (error) { showStatus(error.message, true); }
}

async function saveSettings() {
  setBusy("#saveSettingsBtn", true);
  try {
    const data = await api("/api/psychology-topics/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(settingsPayload()) });
    $("#apiToken").value = "";
    showStatus("连接配置已保存。");
    renderSummary(data.settings);
  } catch (error) { showStatus(error.message, true); } finally { setBusy("#saveSettingsBtn", false); }
}

async function syncTopics() {
  setBusy("#syncBtn", true, "正在更新...");
  try {
    await api("/api/psychology-topics/settings", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(settingsPayload()) });
    $("#apiToken").value = "";
    const data = await api("/api/psychology-topics/sync", { method:"POST" });
    showStatus(`更新完成，共读取 ${data.total} 条题目。`);
    await Promise.all([loadSettings(), loadTopics(1)]);
  } catch (error) { showStatus(error.message, true); } finally { setBusy("#syncBtn", false, "更新题库"); }
}

async function loadTopics(page) {
  try {
    const query = encodeURIComponent($("#query").value.trim());
    const data = await api(`/api/psychology-topics?query=${query}&page=${page}&pageSize=${state.pageSize}`);
    state = data;
    renderTopics();
  } catch (error) { $("#topicList").innerHTML = `<div class="module-empty">${escapeHtml(error.message)}</div>`; }
}

function renderTopics() {
  $("#resultCount").textContent = `${state.total} 条`;
  $("#topicTotal").textContent = state.total;
  const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
  $("#pageText").textContent = `${state.page} / ${pages}`;
  $("#prevBtn").disabled = state.page <= 1;
  $("#nextBtn").disabled = state.page >= pages;
  if (!state.items.length) return $("#topicList").innerHTML = '<div class="module-empty">没有匹配的题目。</div>';
  $("#topicList").innerHTML = state.items.map((item) => {
    const options = (item.options || []).map((option) => `${option.label}. ${option.text}`).join(" · ") || item.answerGuide || "暂无选项说明";
    return `<article class="topic-card"><h3>${escapeHtml(item.question)}</h3><div class="topic-options">${escapeHtml(options)}</div><div class="topic-card-footer"><span>${escapeHtml(item.id)}</span><button class="module-button primary" type="button" data-use-topic="${escapeHtml(item.id)}">用于生成视频</button></div></article>`;
  }).join("");
}

function renderSummary(data) {
  $("#topicTotal").textContent = data.total || 0;
  $("#syncedAt").textContent = data.syncedAt ? new Date(data.syncedAt).toLocaleString("zh-CN", { month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" }) : "--";
  $("#sourceState").textContent = data.apiUrl ? "已配置" : "未配置";
  $("#sourceUrl").textContent = data.apiUrl || "请配置 API";
}

function settingsPayload() {
  return { apiUrl:$("#apiUrl").value.trim(), authType:$("#authType").value, apiToken:$("#apiToken").value.trim() };
}

async function api(url, options) {
  const response = await fetch(url, { cache:"no-store", ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败：HTTP ${response.status}`);
  return data;
}

function showStatus(message, error = false) { $("#settingsStatus").textContent = message || ""; $("#settingsStatus").classList.toggle("error", error); }
function setBusy(selector, busy, text) { const button=$(selector); button.disabled=busy; if(text) button.textContent=text; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char])); }
