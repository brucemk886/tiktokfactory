const params = new URLSearchParams(location.search);
const elements = {
  pageTitle: document.querySelector("#pageTitle"),
  pageLead: document.querySelector("#pageLead"),
  pickerView: document.querySelector("#pickerView"),
  workView: document.querySelector("#workView"),
  novelPicker: document.querySelector("#novelPicker"),
  novelTitle: document.querySelector("#novelTitle"),
  novelMeta: document.querySelector("#novelMeta"),
  novelStats: document.querySelector("#novelStats"),
  sourceExcerpt: document.querySelector("#sourceExcerpt"),
  scriptList: document.querySelector("#scriptList"),
  form: document.querySelector("#rewriteForm"),
  versionLabel: document.querySelector("#versionLabel"),
  originalText: document.querySelector("#originalText"),
  rewriteText: document.querySelector("#rewriteText"),
  rewriteCount: document.querySelector("#rewriteCount"),
  saveButton: document.querySelector("#saveRewriteBtn"),
  formStatus: document.querySelector("#formStatus"),
  effectsLink: document.querySelector("#effectsLink"),
  recordsLink: document.querySelector("#recordsLink")
};

const state = { novelId: params.get("novel") || "", novel: readStashedNovel(), novels: [], parentScriptId: "" };

elements.novelPicker.addEventListener("change", () => {
  const id = elements.novelPicker.value;
  if (id) location.assign(`/novel-rewrite?novel=${encodeURIComponent(id)}`);
});
elements.form.addEventListener("submit", saveRewrite);
elements.rewriteText.addEventListener("input", updateCount);
updateCount();
loadPage();

async function loadPage() {
  if (state.novel && state.novel.id === state.novelId) renderWork();
  try {
    const data = await api("/api/novel-content");
    state.novels = data.novels || [];
    if (!state.novelId) {
      renderPicker();
      return;
    }
    const novel = state.novels.find((item) => item.id === state.novelId)
      || (await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}`).catch(() => ({}))).novel;
    if (!novel) throw new Error("没有找到这本小说，请从书单重新点「改写」。");
    state.novel = novel;
    renderWork();
  } catch (error) {
    if (state.novel) {
      renderWork();
      setStatus(error.message || "已先带入书单内容，完整数据稍后可刷新。", "error");
      return;
    }
    elements.pickerView.hidden = false;
    elements.workView.hidden = true;
    elements.pageLead.textContent = error.message || "读取小说失败。";
  }
}

function renderPicker() {
  elements.pickerView.hidden = false;
  elements.workView.hidden = true;
  elements.pageTitle.textContent = "文案改写";
  elements.novelPicker.innerHTML = `<option value="">请选择小说</option>${state.novels.map((novel) =>
    `<option value="${escapeHtml(novel.id)}">${escapeHtml(novel.title)} · ${escapeHtml(novel.platform || "未设置平台")}</option>`
  ).join("")}`;
}

function renderWork() {
  const novel = state.novel;
  elements.pickerView.hidden = true;
  elements.workView.hidden = false;
  elements.pageTitle.textContent = `改写 · ${novel.title}`;
  elements.novelTitle.textContent = novel.title;
  elements.novelMeta.innerHTML = [
    novel.platform,
    novel.category,
    novel.promotionCode,
    novel.featured ? "重点" : "",
    novel.hit ? novel.hitLabel || "爆款" : ""
  ].filter(Boolean).map((value) => `<span>${escapeHtml(value)}</span>`).join("");
  elements.novelStats.textContent = `${formatNumber(novel.scripts?.length || 0)} 个开头版本 · ${formatNumber(novel.performance?.videoCount || 0)} 条视频 · ${formatNumber(novel.performance?.totalViews || 0)} 播放`;
  elements.sourceExcerpt.textContent = excerpt(novel.sourceContent, 400);
  elements.effectsLink.href = "/novel-effects";
  elements.recordsLink.href = `/rewrite-records?novel=${encodeURIComponent(novel.id)}`;
  const scripts = novel.scripts || [];
  const defaultScript = scripts.find((item) => !item.parentScriptId) || scripts[0] || null;
  renderScripts(scripts);
  selectBase(defaultScript?.id || "");
}

function renderScripts(scripts) {
  if (!scripts.length) {
    elements.scriptList.innerHTML = `<div class="empty-script">还没有开头版本。左侧章节只作素材对照，右边写一段口播即可。</div>`;
    return;
  }
  elements.scriptList.innerHTML = [
    ...scripts.map((script) => `
      <button class="script-item${script.id === state.parentScriptId ? " is-active" : ""}" type="button" data-script-id="${escapeHtml(script.id)}">
        <strong>${escapeHtml(script.versionLabel || script.title || "未命名版本")}</strong>
        <small>${script.parentScriptId ? "改写版本" : "原版本"} · ${formatNumber(script.performance?.totalViews || 0)} 播放</small>
        <p>${escapeHtml(excerpt(script.text, 80))}</p>
      </button>`)
  ].join("");
  elements.scriptList.querySelectorAll("[data-script-id]").forEach((button) => {
    button.addEventListener("click", () => selectBase(button.dataset.scriptId || ""));
  });
}

function selectBase(scriptId) {
  const novel = state.novel;
  const script = (novel.scripts || []).find((item) => item.id === scriptId) || null;
  state.parentScriptId = script?.id || "";
  const source = script?.text || "";
  elements.originalText.value = source || excerpt(novel.sourceContent, 400);
  if (!elements.rewriteText.value.trim()) elements.rewriteText.value = source;
  updateCount();
  elements.baseHint.textContent = script
    ? `当前对照：${script.versionLabel || script.title}。只改这段开头/口播，保存为新版本，不覆盖原文，也不改全书。`
    : "还没有开头版本。对照左侧章节摘录写一段口播即可，不必粘贴或改写全书。";
  elements.scriptList.querySelectorAll("[data-script-id]").forEach((button) => {
    button.classList.toggle("is-active", (button.dataset.scriptId || "") === state.parentScriptId);
  });
}

function readStashedNovel() {
  try {
    const novel = JSON.parse(sessionStorage.getItem("lf-rewrite-novel") || "null");
    return novel?.id && novel.id === params.get("novel") ? novel : null;
  } catch {
    return null;
  }
}

async function saveRewrite(event) {
  event.preventDefault();
  const text = elements.rewriteText.value.trim();
  if (text.length < 20) return setStatus("改写文案至少需要 20 个字符。", "error");
  elements.saveButton.disabled = true;
  elements.saveButton.textContent = "保存中...";
  try {
    await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}/scripts`, {
      method: "POST",
      body: JSON.stringify({
        parentScriptId: state.parentScriptId,
        title: `${state.novel.title} ${elements.versionLabel.value.trim() || "改写"}`,
        versionLabel: elements.versionLabel.value.trim() || "人工改写",
        text
      })
    });
    elements.rewriteText.value = "";
    updateCount();
    setStatus("已保存为新开头版本，可在小说效果和改写记录里对照。", "success");
    const data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}`);
    state.novel = data.novel;
    renderWork();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = "保存为新开头版本";
  }
}

function updateCount() {
  elements.rewriteCount.textContent = `${formatNumber(elements.rewriteText.value.length)} / 4,000`;
}

function setStatus(message, tone = "") {
  elements.formStatus.textContent = message;
  elements.formStatus.className = tone ? `is-${tone}` : "";
}

async function api(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", headers: { "Content-Type": "application/json" }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败：${response.status}`);
  return body;
}

function excerpt(value, limit = 150) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text || "暂无内容";
}

function formatNumber(value) { return new Intl.NumberFormat("zh-CN").format(Number(value) || 0); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char])); }
