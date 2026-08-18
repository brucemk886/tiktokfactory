import { requestAudioJob } from "./audio-job.js";

const params = new URLSearchParams(location.search);
const elements = {
  pageTitle: document.querySelector("#pageTitle"),
  pageLead: document.querySelector("#pageLead"),
  rewriteLink: document.querySelector("#rewriteLink"),
  summary: document.querySelector("#summary"),
  listStatus: document.querySelector("#listStatus"),
  mixToolbar: document.querySelector("#mixToolbar"),
  saveMixAudiosButton: document.querySelector("#saveMixAudiosBtn"),
  mixStatus: document.querySelector("#mixStatus"),
  audioList: document.querySelector("#audioList"),
  recordList: document.querySelector("#recordList"),
  recordEmpty: document.querySelector("#recordEmpty"),
  recordCount: document.querySelector("#recordCount"),
  recordStatus: document.querySelector("#recordStatus")
};

const state = { novelId: params.get("novel") || "", novel: readStashedNovel() };

elements.saveMixAudiosButton?.addEventListener("click", saveMixAudios);
loadPage();

async function loadPage() {
  if (!state.novelId) {
    elements.listStatus.textContent = "请从小说书单点「查看音频」。";
    elements.listStatus.className = "list-status is-error";
    return;
  }
  elements.rewriteLink.href = `/novel-rewrite?novel=${encodeURIComponent(state.novelId)}`;
  if (state.novel) renderNovel(state.novel);
  loadRecords();
  try {
    const data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}`);
    state.novel = data.novel;
    renderNovel(state.novel);
  } catch (error) {
    if (state.novel) {
      renderNovel(state.novel);
      elements.listStatus.textContent = error.message;
      elements.listStatus.className = "list-status is-error";
      return;
    }
    elements.listStatus.textContent = error.message || "读取小说音频失败。";
    elements.listStatus.className = "list-status is-error";
  }
}

function renderNovel(novel) {
  const audios = (novel.scripts || []).filter((script) => String(script.text || "").trim() || script.audio?.id || script.audioId);
  elements.pageTitle.textContent = novel.title;
  elements.pageLead.textContent = "勾选生效音频，点「保存生效音频到本机」。混剪只抽这些，工人机会按书名建文件夹并保存。";
  elements.summary.hidden = false;
  elements.summary.innerHTML = [
    novel.platform,
    novel.category,
    `${audios.length} 条改写音频`,
    `${formatNumber(novel.performance?.videoCount || 0)} 条视频`,
    `${formatNumber(novel.performance?.totalViews || 0)} 播放`
  ].filter(Boolean).map((value) => `<span>${escapeHtml(value)}</span>`).join("");
  if (!audios.length) {
    if (elements.mixToolbar) elements.mixToolbar.hidden = true;
    elements.listStatus.textContent = "";
    elements.audioList.innerHTML = `<div class="empty-state"><strong>这本还没有改写音频</strong><span>先到改写页写开头并生成音频。<a href="/novel-rewrite?novel=${encodeURIComponent(novel.id)}">去改写</a></span></div>`;
    return;
  }
  const enabledCount = audios.filter((script) => script.mixEnabled !== false).length;
  if (elements.mixToolbar) elements.mixToolbar.hidden = false;
  elements.listStatus.textContent = `共 ${audios.length} 条改写音频，当前 ${enabledCount} 条生效。`;
  elements.audioList.innerHTML = audios.map((script) => audioCard(script)).join("");
  elements.audioList.querySelectorAll("[data-script-id]").forEach((input) => {
    input.addEventListener("change", () => {
      input.closest(".audio-card")?.classList.toggle("is-off", !input.checked);
    });
  });
  bindRetuneControls(elements.audioList);
}

async function saveMixAudios() {
  if (!state.novelId || !elements.saveMixAudiosButton) return;
  const scriptIds = Array.from(elements.audioList.querySelectorAll("[data-script-id]:checked")).map((input) => input.dataset.scriptId);
  if (!scriptIds.length) return setMixStatus("先勾选要保存到本机的生效音频。", "error");
  elements.saveMixAudiosButton.disabled = true;
  setMixStatus("正在保存生效音频并下发到本机...");
  try {
    const data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}/mix-audios`, {
      method: "PUT",
      body: JSON.stringify({ scriptIds })
    });
    state.novel = data.novel;
    const result = await requestAudioJob("/api/audio-library/sync-local", {
      novelId: state.novelId,
      novelTitle: state.novel?.title || "",
      scriptIds,
      targetAudioDir: "__novel__"
    }, { api, onProgress: (job) => setMixStatus(job.message || "工人机正在保存到本机...") });
    const saved = Array.isArray(result.items) ? result.items.length : scriptIds.length;
    const folder = result.targetAudioDir || `F:\\音频目录\\${state.novel?.title || "小说名"}`;
    const refreshed = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}`);
    state.novel = refreshed.novel;
    renderNovel(state.novel);
    setMixStatus(`已保存 ${saved} 条生效音频到 ${folder}。`, "ok");
  } catch (error) {
    setMixStatus(error.message || "保存到本机失败。", "error");
  } finally {
    elements.saveMixAudiosButton.disabled = false;
  }
}

function setMixStatus(message, tone = "") {
  if (!elements.mixStatus) return;
  elements.mixStatus.textContent = message;
  elements.mixStatus.className = tone === "ok" ? "is-ok" : tone === "error" ? "is-error" : "";
}

async function loadRecords() {
  if (!elements.recordStatus) return;
  elements.recordStatus.textContent = "正在读取这本小说的改写记录…";
  try {
    const data = await api(`/api/rewrite-records?novel=${encodeURIComponent(state.novelId)}`);
    renderRecords(Array.isArray(data.records) ? data.records : []);
  } catch (error) {
    elements.recordStatus.textContent = error.message || "读取改写记录失败。";
    renderRecords([]);
  }
}

function renderRecords(records) {
  if (!elements.recordList) return;
  elements.recordCount.textContent = `${records.length} 条记录`;
  elements.recordStatus.textContent = records.length ? `已读取 ${records.length} 条改写记录。` : "";
  elements.recordEmpty.hidden = records.length > 0;
  elements.recordList.replaceChildren(...records.map(createRecordCard));
}

function createRecordCard(record) {
  const card = document.createElement("article");
  card.className = `rewrite-card${/fail|error|失败/i.test(`${record.status || ""} ${record.error || ""}`) ? " is-failed" : ""}`;
  card.innerHTML = `
    <header class="record-head">
      <div>
        <div class="tag-row">
          <span class="tag accent">${escapeHtml(recordStatusLabel(record.status))}</span>
          <span class="tag">${record.origin === "manual" ? "书单改写" : "官方自运营"}</span>
          <span class="tag">${escapeHtml(record.planDate || formatDateTime(record.updatedAt))}</span>
        </div>
        <h2>${escapeHtml(record.title || "未命名改写")}</h2>
      </div>
    </header>
    <section class="diagnosis-grid">
      <div class="diagnosis-box"><h3>诊断结论</h3><p>${escapeHtml(record.diagnosis || record.error || "暂无诊断说明")}</p></div>
      <div class="diagnosis-box"><h3>数据证据</h3><p>${escapeHtml(record.evidenceSummary || "暂无证据摘要")}</p></div>
    </section>
    <section class="script-grid">
      <section class="script-panel"><h3>原始文案</h3><p class="script-content">${escapeHtml(record.originalScript || "未保存原始文案")}</p></section>
      <section class="script-panel rewritten"><h3>改写版本</h3><p class="script-content">${escapeHtml(record.rewrittenScript || "尚未生成改写文案")}</p></section>
    </section>`;
  return card;
}

function recordStatusLabel(value) {
  const status = String(value || "").toLowerCase();
  if (/fail|error/.test(status)) return "生成失败";
  if (/generated|audio/.test(status)) return "音频已生成";
  return "已改写";
}

function formatDateTime(value) {
  const time = Number(value || 0);
  return time ? new Date(time).toLocaleString("zh-CN", { hour12: false }) : "时间未记录";
}

function audioCard(script) {
  const audio = script.audio || {};
  const audioId = audio.id || script.audioId;
  const performance = script.performance || {};
  return `
    <article class="audio-card${script.mixEnabled === false ? " is-off" : ""}">
      <div class="audio-card-head">
        <div>
          <h2>${escapeHtml(script.versionLabel || script.title || "未命名版本")}</h2>
          <p>${escapeHtml(sourceLabel(script.sourceType))} · ${escapeHtml(formatDate(audio.createdAt || script.createdAt))} · ${formatDuration(audio.duration)} · ${formatSize(audio.size)}</p>
        </div>
        <div class="audio-card-actions">
          <label class="mix-check">
            <input type="checkbox" data-script-id="${escapeHtml(script.id)}" ${script.mixEnabled === false ? "" : "checked"} />
            生效音频
          </label>
          <a class="quiet-action" href="/novel-rewrite?novel=${encodeURIComponent(state.novelId)}">改写此版本</a>
        </div>
      </div>
      ${audioId ? `<audio controls preload="none" src="/api/audio-library/${encodeURIComponent(audioId)}/file?t=${Date.now()}"></audio>
      <div class="retune-row">
        <label>已生成变速 <em data-retune-label>${formatSpeed(audio.playbackSpeed)}</em>
          <input type="range" min="0.8" max="1.4" step="0.05" value="${escapeHtml(String(currentSpeed(audio.playbackSpeed)))}" data-retune-range />
        </label>
        <button type="button" class="quiet-action" data-retune-id="${escapeHtml(audioId)}">应用变速</button>
        <small>按原始音频变速，不会越调越快。太慢可拉到 1.10×–1.25×。</small>
      </div>` : "<p>还没有本机音频。勾选生效后点「保存生效音频到本机」，没有文件夹会自动创建。</p>"}
      <div class="metric-row">
        ${metric("播放", formatNumber(performance.totalViews))}
        ${metric("视频", formatNumber(performance.videoCount))}
        ${metric("账号", formatNumber(performance.accountCount))}
        ${metric("前3秒留存", formatPercent(performance.retentionAt3))}
        ${metric("完播率", formatPercent(performance.fullWatchRate))}
        ${metric("均看时长", formatSeconds(performance.averageTimeWatched))}
      </div>
      ${script.openingTitle ? `<p class="hook-title">${escapeHtml(script.openingTitle)}</p>` : ""}
      <p class="script-full">${escapeHtml(script.text || "")}</p>
    </article>`;
}

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><b>${value}</b></div>`;
}

function sourceLabel(value) {
  return ({
    "manual-rewrite": "人工改写",
    "ai-marketing": "营销生成",
    "ai-style-rewrite": "风格改版",
    "novel-seed": "种子音频",
    "ai-operation-rewrite": "AI 数据改写",
    "audio-library": "音频库"
  })[value] || "改写音频";
}

function readStashedNovel() {
  try {
    const novel = JSON.parse(sessionStorage.getItem("lf-rewrite-novel") || "null");
    return novel?.id && novel.id === params.get("novel") ? novel : null;
  } catch {
    return null;
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败：${response.status}`);
  return body;
}

function formatDate(value) {
  if (!value) return "未记录日期";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未记录日期";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatDuration(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  if (!seconds) return "时长未知";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatSize(value) {
  const size = Number(value) || 0;
  if (size < 1024) return size ? `${size} B` : "大小未知";
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatPercent(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value) * 100)}%` : "—";
}

function formatSeconds(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)} 秒` : "—";
}

function formatNumber(value) { return new Intl.NumberFormat("zh-CN").format(Number(value) || 0); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char])); }

function currentSpeed(value) {
  const speed = Number(value);
  return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

function formatSpeed(value) {
  return `${currentSpeed(value).toFixed(2)}×`;
}

function bindRetuneControls(root) {
  if (!root) return;
  root.querySelectorAll("[data-retune-range]").forEach((input) => {
    const label = input.closest(".retune-row")?.querySelector("[data-retune-label]");
    input.addEventListener("input", () => {
      if (label) label.textContent = formatSpeed(input.value);
    });
  });
  root.querySelectorAll("[data-retune-id]").forEach((button) => {
    button.addEventListener("click", () => retuneAudio(button));
  });
}

async function retuneAudio(button) {
  const row = button.closest(".retune-row");
  const audioId = button.dataset.retuneId;
  const speed = Number(row?.querySelector("[data-retune-range]")?.value || 1);
  if (!audioId) return;
  button.disabled = true;
  button.textContent = "变速中...";
  try {
    await api(`/api/audio-library/${encodeURIComponent(audioId)}/retune`, {
      method: "POST",
      body: JSON.stringify({ speed })
    });
    await loadPage();
  } catch (error) {
    button.disabled = false;
    button.textContent = "应用变速";
    elements.listStatus.textContent = error.message || "音频变速失败。";
    elements.listStatus.className = "list-status is-error";
  }
}
