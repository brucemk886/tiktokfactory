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

const state = {
  novelId: params.get("novel") || "",
  novel: readStashedNovel()
};

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
    startTranscriptWatch();
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

let transcriptWatchTimer = 0;

function startTranscriptWatch() {
  if (transcriptWatchTimer) return;
  transcriptWatchTimer = window.setInterval(() => {
    void tickTranscriptWatch();
  }, 8000);
  void tickTranscriptWatch();
}

function stopTranscriptWatch() {
  if (transcriptWatchTimer) window.clearInterval(transcriptWatchTimer);
  transcriptWatchTimer = 0;
}

function queueWatchNeeded(novel) {
  return (novel?.scripts || []).some(isQueuedTranscript);
}

async function tickTranscriptWatch() {
  if (!state.novelId) {
    stopTranscriptWatch();
    return;
  }
  try {
    await api("/api/novel-content/transcribe-queue", { method: "POST" });
    const data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}`);
    if (data.novel) {
      state.novel = data.novel;
      renderNovel(state.novel);
    }
  } catch {
    // Keep polling; the cloud queue may still be running.
  }
  if (!queueWatchNeeded(state.novel)) stopTranscriptWatch();
}

function scriptHasAudio(script) {
  return Boolean(String(script?.audioId || script?.audio?.id || "").trim());
}

function renderNovel(novel) {
  const scripts = novel.scripts || [];
  const audios = scripts.filter(scriptHasAudio);
  elements.pageTitle.textContent = novel.title;
  elements.pageLead.textContent = "这里看已经导入或改写出声的音频。配音和改写都在改写页。";
  elements.summary.hidden = false;
  elements.summary.innerHTML = [
    novel.platform,
    novel.category,
    `${audios.length} 条已配音开头`,
    `${formatNumber(novel.performance?.videoCount || 0)} 条视频`,
    `${formatNumber(novel.performance?.totalViews || 0)} 播放`
  ].filter(Boolean).map((value) => `<span>${escapeHtml(value)}</span>`).join("");
  renderVoiced(audios, novel);
}

function renderVoiced(audios, novel) {
  if (!audios.length) {
    if (elements.mixToolbar) elements.mixToolbar.hidden = true;
    elements.listStatus.textContent = "";
    elements.audioList.innerHTML = `<div class="empty-state"><strong>这本还没有已配音的开头</strong><span>先到改写页改写同行口播并出声，或从同行爆款导入音频。<a href="/novel-rewrite?novel=${encodeURIComponent(novel.id)}">去改写</a></span></div>`;
    return;
  }
  const enabledCount = audios.filter((script) => script.mixEnabled !== false).length;
  const queuedCount = audios.filter(isQueuedTranscript).length;
  if (elements.mixToolbar) elements.mixToolbar.hidden = false;
  elements.listStatus.textContent = queuedCount
    ? `共 ${audios.length} 条改写音频，当前 ${enabledCount} 条生效，${queuedCount} 条排队识别（一次一条）。`
    : `共 ${audios.length} 条改写音频，当前 ${enabledCount} 条生效。`;
  elements.audioList.innerHTML = audios.map((script) => audioCard(script)).join("");
  elements.audioList.querySelectorAll("[data-script-id]").forEach((input) => {
    input.addEventListener("change", () => {
      input.closest(".audio-card")?.classList.toggle("is-off", !input.checked);
    });
  });
  elements.audioList.querySelectorAll("[data-reupload-id]").forEach((button) => {
    button.addEventListener("click", () => reuploadPlayback(button.dataset.reuploadId, button));
  });
  elements.audioList.querySelectorAll("[data-delete-voiced-id]").forEach((button) => {
    button.addEventListener("click", () => deleteVoicedScript(button.dataset.deleteVoicedId, button));
  });
  bindVoicedPlayback(elements.audioList);
  bindRetuneControls(elements.audioList);
  bindDurationProbes(elements.audioList);
}

async function deleteVoicedScript(scriptId, button) {
  if (!scriptId || !state.novelId) return;
  const confirmed = window.confirm("确定删除这条已配音？音频页和混剪将不再用它。本机 F:\\音频目录 里的文件需要自己再删。");
  if (!confirmed) return;
  if (button) button.disabled = true;
  setMixStatus("正在删除这条已配音...");
  try {
    const data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}/scripts/${encodeURIComponent(scriptId)}`, {
      method: "DELETE"
    });
    state.novel = data.novel;
    renderNovel(state.novel);
    if (elements.mixToolbar?.hidden && elements.listStatus) {
      elements.listStatus.textContent = "已删除这条已配音。";
      elements.listStatus.className = "list-status is-ok";
    } else {
      setMixStatus("已删除这条已配音。", "ok");
    }
  } catch (error) {
    if (button) button.disabled = false;
    setMixStatus(error.message || "删除失败。", "error");
  }
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
      platform: state.novel?.platform || "",
      promotionCode: state.novel?.promotionCode || "",
      promotionCopy: state.novel?.promotionCopy || "",
      bookId: state.novel?.bookId || "",
      scriptIds,
      targetAudioDir: "__novel__"
    }, { api, onProgress: (job) => setMixStatus(job.message || "工人机正在保存到本机...") });
    const saved = Array.isArray(result.items) ? result.items.length : scriptIds.length;
    const folder = result.targetAudioDir || localNovelAudioDirHint();
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

function bindVoicedPlayback(root) {
  root?.querySelectorAll("audio[data-audio-id]").forEach((player) => {
    player.addEventListener("error", () => {
      const card = player.closest(".audio-card");
      if (!card || card.querySelector(".play-hint")) return;
      const hint = document.createElement("p");
      hint.className = "play-hint is-error";
      hint.textContent = "网页还没有这份试听。点「传到网页试听」，工人会把本机已有文件传到线上，不用重新配音。";
      player.after(hint);
    });
  });
}

async function reuploadPlayback(scriptId, button) {
  if (!scriptId || !state.novelId) return;
  const script = (state.novel?.scripts || []).find((item) => item.id === scriptId);
  if (!scriptHasAudio(script)) return setMixStatus("这条还没有音频可传到网页。", "error");
  if (button) {
    button.disabled = true;
    button.textContent = "正在上传...";
  }
  setMixStatus("正在把本机已有音频传到网页试听...");
  try {
    await requestAudioJob("/api/audio-library/sync-local", {
      novelId: state.novelId,
      novelTitle: state.novel?.title || "",
      platform: state.novel?.platform || "",
      promotionCode: state.novel?.promotionCode || "",
      promotionCopy: state.novel?.promotionCopy || "",
      bookId: state.novel?.bookId || "",
      scriptIds: [scriptId],
      targetAudioDir: "__novel__"
    }, { api, onProgress: (job) => setMixStatus(job.message || "工人机正在上传试听...") });
    const refreshed = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}`);
    state.novel = refreshed.novel;
    renderNovel(state.novel);
    setMixStatus("试听文件已传到网页，可以播放了。", "ok");
  } catch (error) {
    setMixStatus(error.message || "传到网页失败。", "error");
    if (button) {
      button.disabled = false;
      button.textContent = "传到网页试听";
    }
  }
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
  const isPeer = script.sourceType === "peer-hit";
  return `
    <article class="audio-card${script.mixEnabled === false ? " is-off" : ""}" data-voiced-id="${escapeHtml(script.id)}">
      <div class="audio-card-head">
        <div>
          <h2>${escapeHtml(script.versionLabel || script.title || "未命名版本")}</h2>
          <p>${escapeHtml(sourceLabel(script.sourceType))} · ${escapeHtml(formatDate(audio.createdAt || script.createdAt))} · ${formatSize(audio.size)}</p>
        </div>
        <div class="audio-card-actions">
          <div class="mix-block">
            <label class="mix-check">
              <input type="checkbox" data-script-id="${escapeHtml(script.id)}" ${script.mixEnabled === false ? "" : "checked"} />
              生效音频
            </label>
            <span class="audio-duration" data-duration-label>时长 ${formatDuration(audio.duration)}</span>
          </div>
          ${isPeer ? "" : `<button class="quiet-action" type="button" data-reupload-id="${escapeHtml(script.id)}">传到网页试听</button>`}
          <a class="quiet-action" href="/novel-rewrite?novel=${encodeURIComponent(state.novelId)}&script=${encodeURIComponent(script.id)}">去改写</a>
          <button class="quiet-action delete-script" type="button" data-delete-voiced-id="${escapeHtml(script.id)}">删除</button>
        </div>
      </div>
      ${isPeer
        ? (audioId && !Number(audio.duration)
          ? `<audio hidden preload="metadata" data-duration-script="${escapeHtml(script.id)}" src="/api/audio-library/${encodeURIComponent(audioId)}/file"></audio>`
          : "")
        : `<audio controls preload="metadata" data-audio-id="${escapeHtml(audioId)}" data-duration-script="${escapeHtml(script.id)}" src="/api/audio-library/${encodeURIComponent(audioId)}/file?t=${Date.now()}"></audio>`}
      <div class="retune-row">
        <label>已生成变速 <em data-retune-label>${formatSpeed(audio.playbackSpeed)}</em>
          <input type="range" min="0.8" max="1.4" step="0.05" value="${escapeHtml(String(currentSpeed(audio.playbackSpeed)))}" data-retune-range />
        </label>
        <button type="button" class="quiet-action" data-retune-id="${escapeHtml(audioId)}">应用变速</button>
        <small>按原始音频变速，不会越调越快。太慢可拉到 1.10×–1.25×。</small>
      </div>
      ${isPeer ? peerHitStats(script) : `<div class="metric-row">
        ${metric("播放", formatNumber(performance.totalViews))}
        ${metric("视频", formatNumber(performance.videoCount))}
        ${metric("账号", formatNumber(performance.accountCount))}
        ${metric("前3秒留存", formatPercent(performance.retentionAt3))}
        ${metric("完播率", formatPercent(performance.fullWatchRate))}
        ${metric("均看时长", formatSeconds(performance.averageTimeWatched))}
      </div>`}
      ${script.openingTitle ? `<p class="hook-title">${escapeHtml(script.openingTitle)}</p>` : ""}
      ${scriptTextBlock(script)}
    </article>`;
}

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><b>${value}</b></div>`;
}

function isPlaceholderUploadedScript(text) {
  return /^uploaded audio for this novel opening\./i.test(String(text || "").trim());
}

function isImportedSpeechSource(script) {
  return script?.sourceType === "peer-hit" || script?.sourceType === "uploaded-audio";
}

function isQueuedTranscript(script) {
  if (!isImportedSpeechSource(script)) return false;
  if (script.transcriptStatus === "ready" || script.transcriptStatus === "failed") return false;
  return script.transcriptStatus === "running"
    || script.transcriptStatus === "pending"
    || isPlaceholderUploadedScript(script.text)
    || !String(script.text || "").trim();
}

function scriptTextBlock(script) {
  if (!isImportedSpeechSource(script)) {
    return script.text ? `<p class="script-full">${escapeHtml(script.text)}</p>` : "";
  }
  if (script.transcriptStatus === "failed") {
    return `<p class="script-full is-error">${escapeHtml(script.transcriptError || "口播识别失败")}</p>`;
  }
  if (script.transcriptStatus === "ready" && String(script.text || "").trim() && !isPlaceholderUploadedScript(script.text)) {
    return `<p class="script-full">${escapeHtml(script.text)}</p>`;
  }
  if (isQueuedTranscript(script)) {
    const text = script.transcriptStatus === "running"
      ? "正在识别口播文案…"
      : "已排队识别，一次只跑一条。";
    return `<p class="script-full is-pending">${text}</p>`;
  }
  return `<p class="script-full">${escapeHtml(script.text || "")}</p>`;
}

function peerHitStats(script) {
  const videos = Array.isArray(script.peerVideos) && script.peerVideos.length
    ? script.peerVideos
    : (Array.isArray(script.scaleRun?.videos) ? script.scaleRun.videos : []);
  if (!videos.length) return "";
  return `<div class="peer-hit-stats">${videos.map((video) => {
    const href = video.videoUrl ? escapeAttr(video.videoUrl) : "";
    return `<div class="peer-hit-stat">
      <span>播放量</span>
      <strong>${escapeHtml(formatNumber(video.playCount))}</strong>
      ${href ? `<a href="${href}" target="_blank" rel="noreferrer">${escapeHtml(shortVideoUrl(video.videoUrl))}</a>` : "<em>没有视频链接</em>"}
    </div>`;
  }).join("")}</div>`;
}

function shortVideoUrl(value) {
  return String(value || "").replace(/^https?:\/\/(www\.)?/i, "");
}

function sourceLabel(value) {
  return ({
    "manual-rewrite": "人工改写",
    "ai-marketing": "营销生成",
    "ai-style-rewrite": "风格改版",
    "novel-seed": "种子音频",
    "ai-operation-rewrite": "AI 数据改写",
    "audio-library": "音频库",
    "uploaded-audio": "上传音频",
    "peer-hit": "同行爆款"
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

function platformFolderName(platform = "") {
  const raw = String(platform || "").replace(/\s+/g, "");
  if (/^goodnovel$/i.test(raw)) return "GoodNovel";
  if (/^motonovel$/i.test(raw)) return "MotoNovel";
  if (/^novelmaster$/i.test(raw)) return "NovelMaster";
  return "未分平台";
}

function localNovelAudioDirHint(novel = state.novel) {
  const platform = platformFolderName(novel?.platform);
  const book = String(novel?.title || "小说名").trim() || "小说名";
  return `F:\\音频目录\\${platform}\\${book}`;
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
  if (!seconds) return "未知";
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
function escapeAttr(value) { return escapeHtml(value).replace(/"/g, "&quot;"); }

function currentSpeed(value) {
  const speed = Number(value);
  return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

function formatSpeed(value) {
  return `${currentSpeed(value).toFixed(2)}×`;
}

function bindDurationProbes(root) {
  if (!root) return;
  root.querySelectorAll("audio[data-duration-script]").forEach((el) => {
    const apply = () => {
      const seconds = Number(el.duration);
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      const label = el.closest(".audio-card")?.querySelector("[data-duration-label]");
      if (label) label.textContent = `时长 ${formatDuration(seconds)}`;
      const script = (state.novel?.scripts || []).find((item) => item.id === el.dataset.durationScript);
      if (script?.audio) script.audio.duration = Math.round(seconds * 10) / 10;
      if (el.dataset.durationSaved === "1" || !state.novelId || !el.dataset.durationScript) return;
      el.dataset.durationSaved = "1";
      void api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}/scripts/${encodeURIComponent(el.dataset.durationScript)}`, {
        method: "PATCH",
        body: JSON.stringify({ duration: seconds })
      }).catch(() => {});
    };
    el.addEventListener("loadedmetadata", apply);
    if (el.readyState >= 1) apply();
  });
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
