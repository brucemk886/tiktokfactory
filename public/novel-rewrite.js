import { requestAudioJob, waitForCloudJob } from "./audio-job.js";
import {
  bindVoiceStudio,
  loadVoiceControls,
  selectedAudioDir,
  selectedSpeechSpeed,
  selectedTtsProvider,
  selectedVoiceId,
  speakOpeningTitle
} from "./voice-studio.js";

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
  form: document.querySelector("#rewriteForm"),
  openingTitle: document.querySelector("#openingTitle"),
  rewriteText: document.querySelector("#rewriteText"),
  rewriteCount: document.querySelector("#rewriteCount"),
  saveButton: document.querySelector("#saveRewriteBtn"),
  formStatus: document.querySelector("#formStatus"),
  baseHint: document.querySelector("#baseHint"),
  aiRewritePanel: document.querySelector("#aiRewritePanel"),
  manualRewritePanel: document.querySelector("#manualRewritePanel"),
  variantHeading: document.querySelector("#variantHeading"),
  generateVariantsButton: document.querySelector("#generateVariantsBtn"),
  saveSelectedScriptsButton: document.querySelector("#saveSelectedScriptsBtn"),
  regenerateTitlesButton: document.querySelector("#regenerateTitlesBtn"),
  regenerateManualTitleButton: document.querySelector("#regenerateManualTitleBtn"),
  savedAudioLink: document.querySelector("#savedAudioLink"),
  variantPanel: document.querySelector("#variantPanel"),
  variantList: document.querySelector("#variantList"),
  variantStatus: document.querySelector("#variantStatus"),
  styleOptions: document.querySelector("#styleOptions"),
  styleCount: document.querySelector("#styleCount"),
  openingModel: document.querySelector("#openingModel"),
  openingReasoning: document.querySelector("#openingReasoning"),
  effectsLink: document.querySelector("#effectsLink"),
  audioLink: document.querySelector("#audioLink"),
  voicedScriptsPanel: document.querySelector("#voicedScriptsPanel"),
  voicedScripts: document.querySelector("#voicedScripts"),
  voicedScriptsHint: document.querySelector("#voicedScriptsHint"),
  ttsProvider: document.querySelector("#ttsProvider"),
  voiceLanguage: document.querySelector("#voiceLanguage"),
  voiceCategory: document.querySelector("#voiceCategory"),
  voiceGender: document.querySelector("#voiceGender"),
  voiceAge: document.querySelector("#voiceAge"),
  voiceSelect: document.querySelector("#voiceSelect"),
  voiceIdInput: document.querySelector("#voiceIdInput"),
  modelFixed: document.querySelector("#modelFixed"),
  speechSpeed: document.querySelector("#speechSpeed"),
  speechSpeedValue: document.querySelector("#speechSpeedValue"),
  reloadVoicesButton: document.querySelector("#reloadVoicesBtn"),
  previewVoiceButton: document.querySelector("#previewVoiceBtn"),
  voicePreview: document.querySelector("#voicePreview"),
  speakOpeningTitle: document.querySelector("#speakOpeningTitle"),
  audioDir: document.querySelector("#audioDir"),
  audioGroupSelect: document.querySelector("#audioGroupSelect"),
  audioGroupHint: document.querySelector("#audioGroupHint"),
  generatePendingVoiceButton: document.querySelector("#generatePendingVoiceBtn"),
  pendingVoiceRow: document.querySelector("#pendingVoiceRow"),
  pendingVoiceHint: document.querySelector("#pendingVoiceHint"),
  audioStatus: document.querySelector("#audioStatus")
};

const SMART_STYLE_ID = "smart-strongest";
const AUTO_STYLE_ID = "auto";
const DEFAULT_STYLE_IDS = [AUTO_STYLE_ID];
const STYLE_STORAGE_KEY = "lf-opening-styles-v2";
const STYLE_COPIES_STORAGE_KEY = "lf-opening-style-copies-v2";
const state = {
  novelId: params.get("novel") || "",
  novel: readStashedNovel(),
  novels: [],
  parentScriptId: "",
  sourceScriptId: "",
  sourceScriptTouched: false,
  lastScriptId: "",
  variants: [],
  styles: [],
  selectedStyles: readSavedStyles(),
  styleCopies: readSavedStyleCopies(),
  rewriteMode: "ai",
  openingModel: readSavedOpeningModel(),
  openingReasoning: readSavedOpeningReasoning(),
  openingJobId: "",
  restoringOpeningJob: false,
  transcriptWait: null,
  transcriptTimer: 0,
  voices: [],
  audioGroups: [],
  voiceId: "",
  ttsProvider: "kokoro",
  defaultMaleVoiceId: "am_adam",
  defaultFemaleVoiceId: "af_jessica"
};

const voiceCtx = {
  elements,
  state,
  get api() { return api; },
  setStatus: (message, tone) => setVoiceStatus(message, tone),
  getNovel: () => state.novel
};

elements.novelPicker.addEventListener("change", () => {
  const id = elements.novelPicker.value;
  if (id) location.assign(`/novel-rewrite?novel=${encodeURIComponent(id)}`);
});
elements.form.addEventListener("submit", saveRewrite);
elements.generateVariantsButton?.addEventListener("click", generateVariants);
elements.saveSelectedScriptsButton?.addEventListener("click", saveSelectedVariants);
elements.regenerateTitlesButton?.addEventListener("click", () => regenerateOpeningTitles());
elements.regenerateManualTitleButton?.addEventListener("click", regenerateManualOpeningTitle);
elements.rewriteText?.addEventListener("input", updateCount);
document.querySelectorAll('input[name="rewriteMode"]').forEach((input) => {
  input.addEventListener("change", () => setRewriteMode(input.value));
});
elements.openingModel?.addEventListener("change", () => setOpeningModel(elements.openingModel.value));
elements.openingReasoning?.addEventListener("change", () => setOpeningReasoning(elements.openingReasoning.value));
updateCount();
setRewriteMode("ai");
setOpeningModel(state.openingModel);
setOpeningReasoning(state.openingReasoning);
updateGenerateButton();
bindVoiceStudio(voiceCtx);
elements.generatePendingVoiceButton?.addEventListener("click", generateLeftoverPendingAudios);
loadVoiceControls(voiceCtx);
loadStyles();
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
    const novel = (await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}`).catch(() => ({}))).novel
      || state.novels.find((item) => item.id === state.novelId);
    if (!novel) throw new Error("没有找到这本小说，请从书单重新点「改写」。");
    state.novel = novel;
    renderWork();
    void transcribeSelectedPeerScript();
    void restoreLatestOpeningJob();
  } catch (error) {
    if (state.novel) {
      renderWork();
      setStatus(error.message || "已先带入书单内容，完整数据稍后可刷新。", "error");
      void transcribeSelectedPeerScript();
      void restoreLatestOpeningJob();
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
  const scripts = novel.scripts || [];
  const audioCount = scripts.filter(scriptHasAudio).length;
  elements.novelStats.textContent = `${formatNumber(audioCount)} 条已配音 · ${formatNumber(novel.performance?.videoCount || 0)} 条视频 · ${formatNumber(novel.performance?.totalViews || 0)} 播放`;
  elements.sourceExcerpt.textContent = excerpt(novel.sourceContent, 400);
  if (elements.effectsLink) elements.effectsLink.href = `/novel-effects?novel=${encodeURIComponent(novel.id)}`;
  if (elements.audioLink) elements.audioLink.href = `/novel-audio?novel=${encodeURIComponent(novel.id)}`;
  if (elements.savedAudioLink) elements.savedAudioLink.href = `/novel-audio?novel=${encodeURIComponent(novel.id)}`;
  if (elements.baseHint) {
    elements.baseHint.textContent = "先勾选上面的同行爆款口播，再生成改写。不再直接改免费章节原文。勾选结果后保存并按上面的配音设置出声。";
  }
  syncSourceScriptId(novel.scripts || []);
  renderVoicedScripts();
  renderVariants();
  updatePendingVoiceRow();
}

function scriptHasAudio(script) {
  return Boolean(String(script?.audioId || script?.audio?.id || "").trim());
}

function isPlaceholderUploadedScript(text) {
  return /^uploaded audio for this novel opening\./i.test(String(text || "").trim());
}

function needsPeerTranscript(script) {
  if (script?.sourceType !== "peer-hit") return false;
  if (script.transcriptStatus === "running") return false;
  if (script.transcriptStatus === "ready") return false;
  return isPlaceholderUploadedScript(script.text)
    || script.transcriptStatus === "pending"
    || script.transcriptStatus === "failed"
    || !String(script.text || "").trim();
}

function voicedScriptLabel(script) {
  return ({
    "peer-hit": "同行爆款",
    "uploaded-audio": "上传音频",
    "manual-rewrite": "人工改写",
    "ai-style-rewrite": "风格改版",
    "novel-seed": "种子音频"
  })[script?.sourceType] || script?.versionLabel || "已配音";
}

function voicedScriptMeta(script) {
  const href = peerListenHref(script) || audioFileHref(script);
  const link = href
    ? `<a href="${escapeAttr(href)}" target="_blank" rel="noreferrer">${escapeHtml(shortAudioUrl(href))}</a>`
    : "<em>没有音频链接</em>";
  return `<div class="voiced-script-meta"><span>时长 ${escapeHtml(formatAudioDuration(script.audio?.duration))}</span>${link}</div>`;
}

function peerListenHref(script) {
  const videos = Array.isArray(script.peerVideos) && script.peerVideos.length
    ? script.peerVideos
    : (Array.isArray(script.scaleRun?.videos) ? script.scaleRun.videos : []);
  return videos.find((video) => video.videoUrl)?.videoUrl || "";
}

function audioFileHref(script) {
  const audioId = String(script?.audio?.id || script?.audioId || "").trim();
  return audioId ? `/api/audio-library/${encodeURIComponent(audioId)}/file` : "";
}

function shortAudioUrl(value) {
  return String(value || "").replace(/^https?:\/\/(www\.)?/i, "") || "音频链接";
}

function formatAudioDuration(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  if (!seconds) return "未知";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function hasVisibleTranscript(script) {
  return script?.transcriptStatus === "ready" && String(script?.text || "").trim();
}

function isReadyPeerRewriteScript(script) {
  if (script?.sourceType !== "peer-hit") return false;
  const status = String(script.transcriptStatus || "").trim();
  if (status === "pending" || status === "running" || status === "failed") return false;
  if (status && status !== "ready") return false;
  const text = String(script.text || "").trim();
  return text.length >= 80 && !isPlaceholderUploadedScript(text);
}

function readyPeerRewriteScripts(scripts = state.novel?.scripts || []) {
  return (Array.isArray(scripts) ? scripts : []).filter(isReadyPeerRewriteScript);
}

function selectedPeerRewriteScript() {
  return readyPeerRewriteScripts().find((script) => script.id === state.sourceScriptId) || null;
}

function syncSourceScriptId(scripts = state.novel?.scripts || []) {
  const ready = readyPeerRewriteScripts(scripts);
  if (ready.some((script) => script.id === state.sourceScriptId)) {
    state.parentScriptId = state.sourceScriptId;
    return;
  }
  if (state.sourceScriptTouched) {
    state.sourceScriptId = "";
    state.parentScriptId = "";
    return;
  }
  const focusId = params.get("script") || "";
  state.sourceScriptId = ready.find((script) => script.id === focusId)?.id || ready[0]?.id || "";
  state.parentScriptId = state.sourceScriptId;
}

function selectSourceScript(scriptId, { touched = true } = {}) {
  const next = String(scriptId || "").trim();
  if (touched) state.sourceScriptTouched = true;
  state.sourceScriptId = isReadyPeerRewriteScript((state.novel?.scripts || []).find((item) => item.id === next))
    ? next
    : "";
  state.parentScriptId = state.sourceScriptId;
  renderVoicedScripts();
}

function updateVoicedScriptsHint() {
  if (!elements.voicedScriptsHint) return;
  const selected = selectedPeerRewriteScript();
  const readyCount = readyPeerRewriteScripts().length;
  if (selected) {
    const label = selected.versionLabel || selected.openingTitle || selected.title || "同行爆款";
    elements.voicedScriptsHint.textContent = `当前对照：${label}。将按这条已识别口播改写，不再改免费章节原文。识别错了或时长不对，点「重新识别」。`;
    return;
  }
  if (!readyCount) {
    elements.voicedScriptsHint.textContent = "还没有已识别完成的同行爆款口播。等上面识别出正文并勾选后，才能对照改写。";
    return;
  }
  elements.voicedScriptsHint.textContent = "勾选一条已识别的同行爆款口播，再对照它生成改写。不再直接改免费章节原文。识别错了或时长不对，点「重新识别」。";
}

function renderVoicedScripts() {
  if (!elements.voicedScriptsPanel || !elements.voicedScripts) return;
  const focusId = params.get("script") || state.parentScriptId || "";
  const scripts = (state.novel?.scripts || []).filter((script) => {
    if (!scriptHasAudio(script)) return false;
    if (script.id === focusId || script.id === state.sourceScriptId) return true;
    return hasVisibleTranscript(script) || script.sourceType === "peer-hit";
  }).sort((left, right) => {
    if (left.id === state.sourceScriptId) return -1;
    if (right.id === state.sourceScriptId) return 1;
    if (left.id === focusId) return -1;
    if (right.id === focusId) return 1;
    if (left.sourceType === "peer-hit" && right.sourceType !== "peer-hit") return -1;
    if (right.sourceType === "peer-hit" && left.sourceType !== "peer-hit") return 1;
    return 0;
  });
  if (!scripts.length) {
    elements.voicedScriptsPanel.hidden = true;
    elements.voicedScripts.innerHTML = "";
    updateVoicedScriptsHint();
    return;
  }
  elements.voicedScriptsPanel.hidden = false;
  elements.voicedScripts.innerHTML = scripts.map((script) => {
    const selected = script.id === state.sourceScriptId;
    const selectable = isReadyPeerRewriteScript(script);
    const isPeer = script.sourceType === "peer-hit";
    const failed = script.transcriptStatus === "failed";
    const pending = isPeer && (script.transcriptStatus === "running" || needsPeerTranscript(script));
    const wait = pending ? transcriptWaitView(script) : null;
    const body = failed
      ? (script.transcriptError || "口播识别失败")
      : (pending ? wait.text : (script.text || "还没有文案"));
    const title = escapeHtml(script.versionLabel || voicedScriptLabel(script));
    const pick = isPeer
      ? `<label class="voiced-script-pick"><input type="checkbox" ${selectable ? "" : "disabled"} ${selected ? "checked" : ""} data-source-id="${escapeHtml(script.id)}" /> <strong>${title}</strong></label>`
      : `<strong>${title}</strong>`;
    return `<article class="voiced-script-card${selected ? " is-active" : ""}${selectable ? " is-pickable" : ""}" data-script-id="${escapeHtml(script.id)}">
      <header>
        ${pick}
        <small>${escapeHtml(script.openingTitle || script.title || "")}</small>
      </header>
      ${voicedScriptMeta(script)}
      <p class="${failed ? "is-error" : pending ? "is-pending" : ""}" ${pending ? "data-transcript-status" : ""}>${escapeHtml(body)}</p>
      ${pending ? `<div class="transcript-progress" aria-hidden="true"><span data-transcript-bar style="width:${wait.percent}%"></span></div>` : ""}
      ${isPeer && !pending ? `<div class="voiced-script-actions"><button class="quiet-action" type="button" data-retry-id="${escapeHtml(script.id)}">重新识别</button></div>` : ""}
    </article>`;
  }).join("");
  elements.voicedScripts.querySelectorAll("[data-retry-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      transcribePeerScript(button.dataset.retryId, button);
    });
  });
  elements.voicedScripts.querySelectorAll("[data-source-id]").forEach((checkbox) => {
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      selectSourceScript(checkbox.checked ? checkbox.dataset.sourceId : "");
    });
  });
  elements.voicedScripts.querySelectorAll(".voiced-script-card.is-pickable").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest("a, button, input, label")) return;
      selectSourceScript(card.dataset.scriptId);
    });
  });
  updateVoicedScriptsHint();
  elements.voicedScripts.querySelector(".voiced-script-card.is-active")?.scrollIntoView({ block: "nearest" });
}

async function transcribeSelectedPeerScript() {
  const scriptId = params.get("script") || state.parentScriptId || "";
  const script = (state.novel?.scripts || []).find((item) => item.id === scriptId);
  if (!script || (!needsPeerTranscript(script) && script.transcriptStatus !== "running")) return;
  startTranscriptWait(script);
  renderVoicedScripts();
    setStatus("已加入识别队列，最多同时 3 条。", "");
  try {
    await api("/api/novel-content/transcribe-queue", { method: "POST" });
  } catch {
    // Cron and the next poll will keep draining the queue.
  }
  await watchQueuedTranscript(scriptId);
}

async function watchQueuedTranscript(scriptId) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}`);
      if (data.novel) {
        state.novel = data.novel;
        const current = (state.novel.scripts || []).find((item) => item.id === scriptId);
        const ready = current?.transcriptStatus === "ready"
          && String(current.text || "").trim()
          && !isPlaceholderUploadedScript(current.text);
        if (ready) {
          stopTranscriptWait();
          if (!state.sourceScriptId && isReadyPeerRewriteScript(current)) {
            state.sourceScriptId = current.id;
            state.parentScriptId = current.id;
          } else {
            syncSourceScriptId(state.novel.scripts || []);
          }
          renderVoicedScripts();
          updateNovelStats();
          setStatus("已识别口播文案。", "success");
          return;
        }
        if (current?.transcriptStatus === "failed") {
          stopTranscriptWait();
          renderVoicedScripts();
          setStatus(current.transcriptError || "识别口播失败。", "error");
          return;
        }
        renderVoicedScripts();
      }
      await api("/api/novel-content/transcribe-queue", { method: "POST" }).catch(() => {});
    } catch {
      // Keep waiting; the cloud queue may still be running.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 8000));
  }
}

async function transcribePeerScript(scriptId, button) {
  if (!scriptId || !state.novelId) return;
  if (button) {
    button.disabled = true;
    button.textContent = "正在识别...";
  }
  const current = (state.novel?.scripts || []).find((item) => item.id === scriptId);
  if (current) current.transcriptStatus = "running";
  startTranscriptWait(current || { id: scriptId });
  renderVoicedScripts();
  try {
    const data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}/scripts/${encodeURIComponent(scriptId)}/transcribe`, { method: "POST" });
    if (data.novel) state.novel = data.novel;
    stopTranscriptWait();
    const fresh = (state.novel?.scripts || []).find((item) => item.id === scriptId);
    if (!state.sourceScriptId && isReadyPeerRewriteScript(fresh)) {
      state.sourceScriptId = fresh.id;
      state.parentScriptId = fresh.id;
    } else {
      syncSourceScriptId(state.novel?.scripts || []);
    }
    renderVoicedScripts();
    updateNovelStats();
    setStatus("已识别口播文案。", "success");
  } catch (error) {
    const queued = /最多同时|正在识别/.test(String(error.message || ""));
    if (queued) {
      if (current) {
        current.transcriptStatus = "pending";
        current.transcriptError = "";
      }
      setStatus("队列已满，这条会接着排，最多同时 3 条。", "");
      renderVoicedScripts();
      if (button) {
        button.disabled = false;
        button.textContent = "重新识别";
      }
      await watchQueuedTranscript(scriptId);
      return;
    }
    if (current) {
      current.transcriptStatus = "failed";
      current.transcriptError = error.message || "识别口播失败。";
    }
    stopTranscriptWait();
    renderVoicedScripts();
    setStatus(error.message || "识别口播失败。", "error");
    if (button) {
      button.disabled = false;
      button.textContent = "重新识别";
    }
  }
}

function estimateTranscriptSeconds(script) {
  const duration = Number(script?.audio?.duration || 0);
  if (duration > 0) return Math.min(180, Math.max(18, Math.round(duration * 0.5 + 15)));
  const size = Number(script?.audio?.size || 0);
  if (size > 1024) return Math.min(180, Math.max(18, Math.round(size / 24000 + 15)));
  return 40;
}

function transcriptWaitSnapshot(script) {
  const expected = state.transcriptWait?.scriptId === script?.id
    ? state.transcriptWait.expectedSeconds
    : estimateTranscriptSeconds(script);
  const startedAt = state.transcriptWait?.scriptId === script?.id
    ? state.transcriptWait.startedAt
    : Date.now();
  const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  const stuck = elapsed >= expected + 25;
  const percent = Math.min(92, Math.round((elapsed / Math.max(1, expected)) * 100));
  return { elapsed, expected, stuck, percent, text: transcriptWaitText(elapsed, expected, stuck) };
}

function transcriptWaitView(script) {
  return transcriptWaitSnapshot(script);
}

function transcriptWaitText(elapsed, expected, stuck) {
  if (stuck) {
    return `正在识别口播… 已等待 ${formatClock(elapsed)}。比平时慢，还没返回；超过 2 分钟多半卡住了，可刷新重试。`;
  }
  return `正在识别口播… 已等待 ${formatClock(elapsed)} / 大约 ${formatClock(expected)}`;
}

function startTranscriptWait(script) {
  stopTranscriptWait(false);
  state.transcriptWait = {
    scriptId: script?.id || "",
    startedAt: Date.now(),
    expectedSeconds: estimateTranscriptSeconds(script)
  };
  tickTranscriptWait();
  state.transcriptTimer = window.setInterval(tickTranscriptWait, 1000);
}

function stopTranscriptWait(clear = true) {
  if (state.transcriptTimer) window.clearInterval(state.transcriptTimer);
  state.transcriptTimer = 0;
  if (clear) state.transcriptWait = null;
}

function tickTranscriptWait() {
  const wait = state.transcriptWait;
  if (!wait) return;
  const view = transcriptWaitSnapshot({ id: wait.scriptId, audio: (state.novel?.scripts || []).find((item) => item.id === wait.scriptId)?.audio });
  const card = elements.voicedScripts?.querySelector(`.voiced-script-card[data-script-id="${cssEscape(wait.scriptId)}"]`);
  const line = card?.querySelector("[data-transcript-status]");
  const bar = card?.querySelector("[data-transcript-bar]");
  if (line) line.textContent = view.text;
  if (bar) bar.style.width = `${view.percent}%`;
  setStatus(view.stuck
    ? `识别已等 ${formatClock(view.elapsed)}，比平时慢。还在等结果，超过 2 分钟可刷新重试。`
    : `正在识别口播… 已等待 ${formatClock(view.elapsed)}，大约 ${formatClock(view.expected)} 出结果。`, view.stuck ? "error" : "");
}

function cssEscape(value) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(String(value || ""));
  return String(value || "").replace(/["\\]/g, "\\$&");
}

function setRewriteMode(mode) {
  state.rewriteMode = mode === "manual" ? "manual" : "ai";
  const isManual = state.rewriteMode === "manual";
  if (elements.aiRewritePanel) elements.aiRewritePanel.hidden = isManual;
  if (elements.manualRewritePanel) elements.manualRewritePanel.hidden = !isManual;
  if (elements.openingModel) elements.openingModel.hidden = isManual;
  if (elements.openingReasoning) elements.openingReasoning.hidden = isManual;
  document.querySelectorAll('input[name="rewriteMode"]').forEach((input) => {
    input.checked = input.value === state.rewriteMode;
    input.closest(".mode-option")?.classList.toggle("is-on", input.checked);
  });
  updateGenerateButton();
}

function setOpeningModel(model) {
  state.openingModel = model === "gpt-5.6-terra" ? "gpt-5.6-terra" : "gpt-5.6-sol";
  localStorage.setItem("lf-opening-model", state.openingModel);
  if (elements.openingModel) elements.openingModel.value = state.openingModel;
}

function selectedOpeningModel() {
  return elements.openingModel?.value || state.openingModel || "gpt-5.6-sol";
}

function setOpeningReasoning(value) {
  state.openingReasoning = value === "high" || value === "xhigh" ? value : "medium";
  localStorage.setItem("lf-opening-reasoning", state.openingReasoning);
  if (elements.openingReasoning) elements.openingReasoning.value = state.openingReasoning;
}

function selectedOpeningReasoning() {
  return elements.openingReasoning?.value || state.openingReasoning || "medium";
}

function openingReasoningLabel(value) {
  return value === "xhigh" ? "极强" : value === "medium" ? "标准" : "强";
}

function openingModelLabel(model, reasoning) {
  const name = model === "gpt-5.6-terra" ? "GPT-5.6 Terra" : "GPT-5.6 Sol";
  return `${name} · ${openingReasoningLabel(reasoning || selectedOpeningReasoning())}`;
}

function readSavedOpeningModel() {
  const saved = localStorage.getItem("lf-opening-model") || "";
  return saved === "gpt-5.6-terra" ? saved : "gpt-5.6-sol";
}

function readSavedOpeningReasoning() {
  if (localStorage.getItem("lf-opening-speed-v1") !== "1") {
    localStorage.setItem("lf-opening-speed-v1", "1");
    localStorage.setItem("lf-opening-reasoning", "medium");
    return "medium";
  }
  const saved = localStorage.getItem("lf-opening-reasoning") || "";
  return saved === "high" || saved === "xhigh" ? saved : "medium";
}

function audioPageHref() {
  return state.novelId ? `/novel-audio?novel=${encodeURIComponent(state.novelId)}` : "/novel-audio";
}

function showSavedAudioLink() {
  if (!elements.savedAudioLink) return;
  elements.savedAudioLink.href = audioPageHref();
  elements.savedAudioLink.hidden = false;
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
  if (state.rewriteMode !== "manual") return;
  if (!selectedPeerRewriteScript()) return setStatus("请先勾选上面已识别好的同行爆款口播，再保存改写。", "error");
  const text = elements.rewriteText.value.trim();
  if (text.length < 20) return setStatus("文案至少需要 20 个字符。", "error");
  if (elements.saveButton) {
    elements.saveButton.disabled = true;
    elements.saveButton.textContent = "正在保存并配音...";
  }
  try {
    const existing = (state.novel.scripts || []).find((item) => String(item.text || "").trim() === text);
    const script = existing || await saveCurrentScript(text);
    state.lastScriptId = script.id;
    await refreshNovel();
    const fresh = (state.novel.scripts || []).find((item) => item.id === script.id) || script;
    if (!scriptHasAudio(fresh)) {
      setStatus("已保存，正在按配音设置出声...", "success");
      await generateScriptAudios([fresh], (job) => setStatus(job.message || "工人机正在配音...", ""));
    }
    showSavedAudioLink();
    setStatus(`已保存并配音：${fresh.openingTitle || "这条开头"}`, "success");
    if (elements.saveButton) elements.saveButton.textContent = "已保存，可再改再存";
  } catch (error) {
    setStatus(error.message, "error");
    if (elements.saveButton) elements.saveButton.textContent = "保存并配音";
  } finally {
    if (elements.saveButton) elements.saveButton.disabled = false;
  }
}

function updateCount() {
  if (elements.rewriteCount && elements.rewriteText) {
    const text = elements.rewriteText.value;
    const words = wordCount(text);
    elements.rewriteCount.textContent = `${formatNumber(text.length)} 字 · ${formatNumber(words)} 词 · 预估 ${formatClock(estimateSpeechSeconds(words))}`;
  }
}

function setStatus(message, tone = "") {
  elements.formStatus.textContent = message;
  elements.formStatus.className = tone ? `is-${tone}` : "";
}

async function saveCurrentScript(text, extras = {}) {
  const data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}/scripts`, {
    method: "POST",
    body: JSON.stringify({
      parentScriptId: state.parentScriptId,
      title: `${state.novel.title} ${extras.versionLabel || "改写"}`,
      versionLabel: extras.versionLabel || "人工改写",
      sourceType: extras.sourceType || "manual-rewrite",
      openingTitle: extras.openingTitle || currentOpeningTitle(text),
      kept: true,
      speakOpeningTitle: extras.speakOpeningTitle ?? speakOpeningTitle(voiceCtx),
      text
    })
  });
  return data.script;
}

async function loadStyles() {
  try {
    const data = await api(`/api/novel-content/opening-styles?v=${Date.now()}`);
    state.styles = Array.isArray(data.styles) ? data.styles : [];
  } catch {
    state.styles = [];
  }
  const validIds = new Set(state.styles.map((style) => style.id));
  state.selectedStyles = state.selectedStyles.filter((id) => validIds.has(id));
  if (!state.selectedStyles.length) state.selectedStyles = [...DEFAULT_STYLE_IDS];
  renderStyleOptions();
}

function renderStyleOptions() {
  if (!elements.styleOptions) return;
  if (!state.styles.length) {
    elements.styleOptions.innerHTML = `<p class="hint">风格列表还没加载，请刷新后再选。</p>`;
    return;
  }
  elements.styleOptions.innerHTML = state.styles.map((style) => {
    const hook = style.id === AUTO_STYLE_ID
      ? "先通读勾选的同行爆款口播，从铁证砸脸、身份炸弹、现场失控、绝境反杀里选口播真正撑得住、最容易停滑的模板。第一句必须来自该模板对应的口播明示事实。口播没有戒指、婚礼、DNA 或隐藏身份就不要硬套。"
      : style.hook;
    return `
    <div class="style-option${style.recommended ? " is-recommended" : ""}${state.selectedStyles.includes(style.id) ? " is-on" : ""}" data-style-id="${escapeHtml(style.id)}">
      <input type="checkbox" value="${escapeHtml(style.id)}" ${state.selectedStyles.includes(style.id) ? "checked" : ""} />
      <strong>${escapeHtml(style.label)}${style.recommended ? '<span class="style-badge">推荐</span>' : ""}</strong>
      <input type="number" min="1" max="5" value="${styleCopyCount(style.id)}" aria-label="${escapeHtml(style.label)} 条数" />
      <em>${escapeHtml(hook)}</em>
      ${style.example ? `<small>例：${escapeHtml(style.example)}</small>` : ""}
    </div>`;
  }).join("");
  elements.styleOptions.querySelectorAll(".style-option").forEach((card) => {
    const id = card.dataset.styleId;
    const checkbox = card.querySelector("input[type=checkbox]");
    const copies = card.querySelector("input[type=number]");
    card.addEventListener("click", (event) => {
      if (event.target === copies) return;
      checkbox.checked = !checkbox.checked;
      toggleStyle(id, checkbox.checked);
    });
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => toggleStyle(id, checkbox.checked));
    copies.addEventListener("click", (event) => event.stopPropagation());
    copies.addEventListener("input", () => setStyleCopyCount(id, copies.value));
    copies.addEventListener("change", () => {
      copies.value = String(styleCopyCount(id));
    });
  });
  updateStyleCount();
}

function toggleStyle(id, checked) {
  if (checked) {
    if (id === AUTO_STYLE_ID) {
      state.selectedStyles = [AUTO_STYLE_ID];
    } else {
      state.selectedStyles = [...state.selectedStyles.filter((item) => item !== AUTO_STYLE_ID && item !== id), id];
    }
  } else {
    state.selectedStyles = state.selectedStyles.filter((item) => item !== id);
  }
  saveSelectedStyles();
  renderStyleOptions();
}

function updateStyleCount() {
  if (elements.styleCount) elements.styleCount.textContent = `已选 ${state.selectedStyles.length} / 共 ${state.styles.length || 5} 种`;
  updateGenerateButton();
}

function selectedStyleIds() {
  return state.selectedStyles
    .filter((id) => state.styles.some((style) => style.id === id))
    .flatMap((id) => Array.from({ length: styleCopyCount(id) }, () => id))
    .slice(0, 10);
}

function styleCopyCount(id) {
  const defaultCount = id === AUTO_STYLE_ID || id === SMART_STYLE_ID ? 2 : 1;
  const value = Math.floor(Number(Object.hasOwn(state.styleCopies, id) ? state.styleCopies[id] : defaultCount) || defaultCount);
  return Math.max(1, Math.min(5, value));
}

function setStyleCopyCount(id, raw) {
  state.styleCopies = { ...state.styleCopies, [id]: styleCopyCountFrom(raw) };
  saveStyleCopies();
  updateGenerateButton();
}

function styleCopyCountFrom(raw) {
  return Math.max(1, Math.min(5, Math.floor(Number(raw) || 1)));
}

function readSavedStyleCopies() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STYLE_COPIES_STORAGE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([id, value]) => [id, styleCopyCountFrom(value)]));
  } catch {
    return {};
  }
}

function saveStyleCopies() {
  localStorage.setItem(STYLE_COPIES_STORAGE_KEY, JSON.stringify(state.styleCopies));
}

function updateGenerateButton() {
  const count = selectedStyleIds().length;
  if (!elements.generateVariantsButton) return;
  elements.generateVariantsButton.textContent = count ? `生成 ${count} 个强钩子开头` : "生成强钩子开头";
  elements.generateVariantsButton.disabled = !count;
}

function readSavedStyles() {
  try {
    const saved = JSON.parse(localStorage.getItem(STYLE_STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveSelectedStyles() {
  localStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(state.selectedStyles));
}

function formatWait(ms) {
  const seconds = Math.max(0, Math.floor(Number(ms) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes} 分 ${String(rest).padStart(2, "0")} 秒` : `${rest} 秒`;
}

function beginVariantGeneration(count) {
  state.variants = [];
  if (elements.variantList) elements.variantList.innerHTML = "";
  if (elements.variantPanel) elements.variantPanel.hidden = false;
  if (elements.variantHeading) elements.variantHeading.textContent = `${count} 个强钩子开头`;
  if (elements.saveSelectedScriptsButton) elements.saveSelectedScriptsButton.hidden = true;
}

async function generateVariants() {
  const styles = selectedStyleIds();
  if (!styles.length) return setStatus("请先勾选至少 1 种策略，再生成强钩子开头。", "error");
  const source = selectedPeerRewriteScript();
  if (!source) return setStatus("请先勾选上面已识别好的同行爆款口播，再生成改写。", "error");
  const startedAt = Date.now();
  elements.generateVariantsButton.disabled = true;
  elements.generateVariantsButton.textContent = `正在筛选 ${styles.length} 个强钩子...`;
  beginVariantGeneration(styles.length);
  elements.variantStatus.textContent = `正在对照勾选的同行口播生成 ${styles.length} 个钩子。${styles.length >= 4 ? "一次 4 条以上会慢很多，建议先出 2 条。" : "标准推理通常 2–6 分钟。"}`;
  try {
    let data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}/opening-variants`, {
      method: "POST",
      body: JSON.stringify({
        sourceScriptId: source.id,
        styles,
        model: selectedOpeningModel(),
        reasoningEffort: selectedOpeningReasoning()
      })
    });
    if (data.jobId && !Array.isArray(data.variants)) {
      state.openingJobId = data.jobId;
      elements.variantStatus.textContent = `${data.message || "已交给本机工人生成。"} 已等待 ${formatWait(Date.now() - startedAt)}。`;
      data = await waitForCloudJob(data.jobId, {
        api,
        attempts: 900,
        onProgress: (job) => {
          elements.variantStatus.textContent = `${job.message || `工人机正在筛选 ${styles.length} 个强钩子开头...`} 已等待 ${formatWait(Date.now() - startedAt)}。`;
        }
      });
    }
    applyOpeningVariantResult(data);
  } catch (error) {
    elements.variantStatus.textContent = error.message || "生成改版开头失败。";
    setStatus(error.message, "error");
  } finally {
    updateGenerateButton();
  }
}

function titleRewriteItems(variants) {
  return variants.map((variant) => ({
    id: variant.id,
    style: variant.style || "",
    styleLabel: variant.styleLabel || "",
    openingTitle: variant.openingTitle || firstHookLine(variant.script),
    script: variant.script
  }));
}

function applyRewrittenTitles(titles) {
  const byId = new Map((Array.isArray(titles) ? titles : []).map((item) => [item.id, item]));
  let changed = 0;
  for (const variant of state.variants) {
    const next = byId.get(variant.id);
    if (!next?.openingTitle) continue;
    variant.openingTitle = next.openingTitle;
    variant.openingTitleZh = next.openingTitleZh || variant.openingTitleZh;
    variant.titleStatus = "已重写标题";
    changed += 1;
  }
  renderVariants();
  return changed;
}

async function requestOpeningTitles(items) {
  let data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}/opening-titles`, {
    method: "POST",
    body: JSON.stringify({
      items,
      model: selectedOpeningModel(),
      language: "English"
    })
  });
  if (data.jobId && !Array.isArray(data.titles)) {
    data = await waitForCloudJob(data.jobId, {
      api,
      attempts: 180,
      onProgress: (job) => {
        setStatus(job.message || "工人机正在单独重写开头标题...", "");
      }
    });
  }
  if (!Array.isArray(data.titles) || !data.titles.length) {
    throw new Error("没有取回新的开头标题。");
  }
  return data.titles;
}

async function regenerateOpeningTitles(targetVariants) {
  const variants = Array.isArray(targetVariants) && targetVariants.length
    ? targetVariants
    : state.variants.filter((item) => item.selected !== false);
  if (!variants.length) return setStatus("先勾选要重写标题的开头。", "error");
  const items = titleRewriteItems(variants);
  variants.forEach((variant) => {
    variant.titleStatus = "标题生成中...";
  });
  renderVariants();
  if (elements.regenerateTitlesButton) {
    elements.regenerateTitlesButton.disabled = true;
    elements.regenerateTitlesButton.textContent = `正在重写 ${items.length} 个标题...`;
  }
  try {
    const titles = await requestOpeningTitles(items);
    const changed = applyRewrittenTitles(titles);
    setStatus(`已单独重写 ${changed} 个开头标题，正文没动。`, "success");
  } catch (error) {
    variants.forEach((variant) => {
      variant.titleStatus = "标题失败，可重试";
    });
    renderVariants();
    setStatus(error.message || "重写开头标题失败。", "error");
  } finally {
    if (elements.regenerateTitlesButton) {
      elements.regenerateTitlesButton.disabled = false;
      elements.regenerateTitlesButton.textContent = "重新生成勾选标题";
    }
  }
}

async function regenerateManualOpeningTitle() {
  const text = elements.rewriteText?.value.trim() || "";
  if (text.length < 40) return setStatus("先写口播正文，再单独重新生成开头标题。", "error");
  if (elements.regenerateManualTitleButton) {
    elements.regenerateManualTitleButton.disabled = true;
    elements.regenerateManualTitleButton.textContent = "正在重写...";
  }
  try {
    const titles = await requestOpeningTitles([{
      id: "manual-title",
      openingTitle: currentOpeningTitle(text),
      script: text
    }]);
    const next = titles[0];
    if (elements.openingTitle) elements.openingTitle.value = next.openingTitle;
    setStatus(`开头标题已换成：${next.openingTitle}`, "success");
  } catch (error) {
    setStatus(error.message || "重写开头标题失败。", "error");
  } finally {
    if (elements.regenerateManualTitleButton) {
      elements.regenerateManualTitleButton.disabled = false;
      elements.regenerateManualTitleButton.textContent = "重新生成";
    }
  }
}

async function restoreLatestOpeningJob() {
  if (!state.novelId || state.restoringOpeningJob) return;
  state.restoringOpeningJob = true;
  try {
    const data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}/opening-variants`);
    const job = data.job;
    if (!job?.jobId || (job.jobId === state.openingJobId && state.variants.length)) return;
    if (!["queued", "running"].includes(String(job.status || ""))) return;
    state.openingJobId = job.jobId;
    const startedAt = Number(job.createdAt) || Date.now();
    const count = Array.isArray(job.payload?.styles) ? job.payload.styles.length : selectedStyleIds().length;
    beginVariantGeneration(count || 2);
    elements.variantStatus.textContent = `${job.message || "正在恢复尚未完成的开头任务..."} 已等待 ${formatWait(Date.now() - startedAt)}。`;
    const result = await waitForCloudJob(job.jobId, {
      api,
      attempts: 900,
      onProgress: (progress) => {
        elements.variantStatus.textContent = `${progress.message || "工人机正在生成强钩子开头..."} 已等待 ${formatWait(Date.now() - startedAt)}。`;
      }
    });
    if (Array.isArray(result.variants)) applyOpeningVariantResult(result);
  } catch (error) {
    if (elements.variantPanel && !elements.variantPanel.hidden) {
      elements.variantStatus.textContent = error.message || "恢复未完成的开头任务失败。";
    }
  } finally {
    state.restoringOpeningJob = false;
    updateGenerateButton();
  }
}

function applyOpeningVariantResult(data, { restored = false } = {}) {
  if (!Array.isArray(data.variants) || !data.variants.length) {
    throw new Error("任务已完成，但没有取回生成结果。请刷新页面重试，不要重复生成。");
  }
  const model = data.model || selectedOpeningModel();
  const reasoningEffort = data.reasoningEffort || selectedOpeningReasoning();
  state.variants = data.variants.map((item, index) => ({
    ...item,
    id: item.id || `variant-${index + 1}`,
    selected: true,
    status: "",
    model,
    reasoningEffort
  }));
  elements.variantPanel.hidden = false;
  if (elements.saveSelectedScriptsButton) elements.saveSelectedScriptsButton.hidden = false;
  if (elements.variantHeading) elements.variantHeading.textContent = `${state.variants.length} 个强钩子开头`;
  elements.variantStatus.textContent = restored ? `已恢复上次生成的 ${state.variants.length} 个强钩子。` : `已生成 ${state.variants.length} 个强钩子。`;
  renderVariants();
  setStatus(`${restored ? "已找回" : "已用"} ${openingModelLabel(model, reasoningEffort)} 筛选出的 ${state.variants.length} 个强钩子，并带中文对照。勾选后保存并配音。`, "success");
}

function renderVariants() {
  if (!elements.variantPanel) return;
  if (!state.variants.length) {
    if (elements.saveSelectedScriptsButton) elements.saveSelectedScriptsButton.hidden = true;
    if (elements.regenerateTitlesButton) elements.regenerateTitlesButton.hidden = true;
    return;
  }
  elements.variantPanel.hidden = false;
  if (elements.saveSelectedScriptsButton) elements.saveSelectedScriptsButton.hidden = false;
  if (elements.regenerateTitlesButton) elements.regenerateTitlesButton.hidden = false;
  if (elements.variantHeading) elements.variantHeading.textContent = `${state.variants.length} 个强钩子结果`;
  const modelLabel = openingModelLabel(state.variants[0]?.model, state.variants[0]?.reasoningEffort);
  elements.variantStatus.textContent = `已用 ${modelLabel} 按策略筛选，并给出中文对照。勾选后保存并按上面的配音设置出声。`;
  elements.variantList.innerHTML = state.variants.map((variant) => `
    <article class="variant-card" data-variant-id="${escapeHtml(variant.id)}">
      <div class="variant-head">
        <label class="variant-check">
          <input type="checkbox" ${variant.selected === false ? "" : "checked"} />
          <span>${escapeHtml(variant.styleLabel || variant.style || "改版开头")}</span>
        </label>
        <small>${escapeHtml(variant.title || "")}</small>
      </div>
      <label class="variant-hook">
        <span>开头标题</span>
        <div class="variant-title-row">
          <input type="text" maxlength="80" data-opening-title value="${escapeHtml(variant.openingTitle || firstHookLine(variant.script))}" />
          <button class="quiet-action" type="button" data-regen-title>${variant.titleStatus || "重新生成"}</button>
        </div>
      </label>
      <p>${escapeHtml(variant.script)}</p>
      ${variant.scriptZh || variant.openingTitleZh ? `<div class="variant-zh">
        ${variant.openingTitleZh ? `<strong>${escapeHtml(variant.openingTitleZh)}</strong>` : ""}
        <p>${escapeHtml(variant.scriptZh || "")}</p>
      </div>` : ""}
      <small class="variant-meta">${formatNumber(wordCount(variant.script))} 词 · 预估 ${formatClock(estimateSpeechSeconds(wordCount(variant.script)))}</small>
      <button class="quiet-action" type="button" data-save-script>${variant.status || "保存并配音"}</button>
    </article>`).join("");
  elements.variantList.querySelectorAll(".variant-card").forEach((card) => {
    const variant = state.variants.find((item) => item.id === card.dataset.variantId);
    if (!variant) return;
    card.querySelector(".variant-check input")?.addEventListener("change", (event) => {
      variant.selected = event.target.checked;
    });
    card.querySelector("[data-opening-title]")?.addEventListener("input", (event) => {
      variant.openingTitle = event.target.value;
    });
    card.querySelector("[data-regen-title]")?.addEventListener("click", () => regenerateOpeningTitles([variant]));
    card.querySelector("[data-save-script]")?.addEventListener("click", () => saveVariants([variant]));
  });
}

async function saveSelectedVariants() {
  const selected = state.variants.filter((item) => item.selected !== false);
  if (!selected.length) return setStatus("先勾选要保存的开头。", "error");
  await saveVariants(selected);
}

async function saveVariants(variants) {
  if (elements.saveSelectedScriptsButton) {
    elements.saveSelectedScriptsButton.disabled = true;
    elements.saveSelectedScriptsButton.textContent = `正在保存 ${variants.length} 条...`;
  }
  try {
    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[index];
      if (variant.scriptId) {
        variant.status = "已保存";
        continue;
      }
      variant.status = variants.length > 1 ? `保存中 ${index + 1}/${variants.length}` : "保存中...";
      renderVariants();
      const script = await saveCurrentScript(variant.script, {
        versionLabel: variant.styleLabel || "AI 改版",
        sourceType: "ai-style-rewrite",
        openingTitle: variant.openingTitle || firstHookLine(variant.script)
      });
      variant.scriptId = script.id;
      variant.status = "已保存";
    }
    await refreshNovel();
    const toVoice = variants
      .map((variant) => (state.novel.scripts || []).find((item) => item.id === variant.scriptId))
      .filter((script) => script && !scriptHasAudio(script));
    if (toVoice.length) {
      setStatus(`已保存，正在为 ${toVoice.length} 条配音...`, "success");
      await generateScriptAudios(toVoice, (job) => setStatus(job.message || "工人机正在配音...", ""));
      variants.forEach((variant) => {
        if (variant.scriptId) variant.status = "已配音";
      });
    }
    renderVariants();
    showSavedAudioLink();
    const saved = variants.filter((item) => item.scriptId).length;
    setStatus(toVoice.length ? `已保存并配音 ${saved} 条。` : `已保存 ${saved} 条。`, "success");
  } catch (error) {
    variants.forEach((variant) => {
      if (!variant.scriptId) variant.status = "失败，可重试";
    });
    renderVariants();
    setStatus(error.message, "error");
  } finally {
    if (elements.saveSelectedScriptsButton) {
      elements.saveSelectedScriptsButton.disabled = false;
      elements.saveSelectedScriptsButton.textContent = "保存勾选并配音";
    }
  }
}

async function refreshNovel() {
  const data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}`);
  state.novel = data.novel;
  updateNovelStats();
  syncSourceScriptId(state.novel.scripts || []);
  renderVoicedScripts();
  updatePendingVoiceRow();
}

function updateNovelStats() {
  if (!elements.novelStats || !state.novel) return;
  const scripts = state.novel.scripts || [];
  const audioCount = scripts.filter(scriptHasAudio).length;
  elements.novelStats.textContent = `${formatNumber(audioCount)} 条已配音 · ${formatNumber(state.novel.performance?.videoCount || 0)} 条视频 · ${formatNumber(state.novel.performance?.totalViews || 0)} 播放`;
}

function pendingRewriteScripts() {
  return (state.novel?.scripts || []).filter((script) => {
    if (scriptHasAudio(script)) return false;
    const source = String(script.sourceType || "");
    return source !== "peer-hit" && source !== "uploaded-audio";
  });
}

function updatePendingVoiceRow() {
  const pending = pendingRewriteScripts();
  if (!elements.pendingVoiceRow) return;
  elements.pendingVoiceRow.hidden = !pending.length;
  if (elements.pendingVoiceHint) {
    elements.pendingVoiceHint.textContent = pending.length
      ? `这本书还有 ${pending.length} 条改写还没出音频。`
      : "";
  }
}

function setVoiceStatus(message, tone = "") {
  if (!elements.audioStatus) return;
  elements.audioStatus.textContent = message || "";
  elements.audioStatus.className = tone === "ok" || tone === "success"
    ? "list-status is-ok"
    : tone === "error" ? "list-status is-error" : "list-status";
}

async function generateScriptAudios(scripts, onProgress) {
  const items = (scripts || []).filter((script) => script?.id && !scriptHasAudio(script) && String(script.text || "").trim().length >= 20);
  if (!items.length) return { saved: 0 };
  const voiceId = selectedVoiceId(voiceCtx);
  if (!voiceId) throw new Error("请先在配音设置里选一个音色。");
  const result = await requestAudioJob("/api/audio-library/sync-local", {
    novelId: state.novelId,
    novelTitle: state.novel?.title || "",
    targetAudioDir: selectedAudioDir(voiceCtx),
    voiceId,
    ttsProvider: selectedTtsProvider(voiceCtx),
    speechSpeed: selectedSpeechSpeed(voiceCtx),
    items: items.map((script) => ({
      novelId: state.novelId,
      novelTitle: state.novel?.title || "",
      platform: state.novel?.platform || "",
      promotionCode: state.novel?.promotionCode || "",
      promotionCopy: state.novel?.promotionCopy || "",
      bookId: state.novel?.bookId || "",
      scriptId: script.id,
      title: `${state.novel.title} ${script.versionLabel || "改写"}`,
      script: script.text,
      openingTitle: script.openingTitle || "",
      speakOpeningTitle: speakOpeningTitle(voiceCtx),
      voiceId,
      ttsProvider: selectedTtsProvider(voiceCtx),
      speechSpeed: selectedSpeechSpeed(voiceCtx),
      sourceType: script.sourceType || "ai-style-rewrite"
    }))
  }, { api, onProgress });
  await refreshNovel();
  return { saved: Array.isArray(result.items) ? result.items.length : items.length, result };
}

async function generateLeftoverPendingAudios() {
  const pending = pendingRewriteScripts();
  if (!pending.length) return setVoiceStatus("没有未出音频的改写。");
  if (elements.generatePendingVoiceButton) {
    elements.generatePendingVoiceButton.disabled = true;
    elements.generatePendingVoiceButton.textContent = `正在配音 ${pending.length} 条...`;
  }
  try {
    const { saved } = await generateScriptAudios(pending, (job) => setVoiceStatus(job.message || "工人机正在配音..."));
    setVoiceStatus(saved ? `已为 ${saved} 条改写配音。` : "工人机没有返回已生成的音频。", saved ? "ok" : "error");
  } catch (error) {
    setVoiceStatus(error.message || "配音失败。", "error");
  } finally {
    if (elements.generatePendingVoiceButton) {
      elements.generatePendingVoiceButton.disabled = false;
      elements.generatePendingVoiceButton.textContent = "为未出音频的改写配音";
    }
  }
}

function wordCount(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function estimateSpeechSeconds(words, speed = 1) {
  const wpm = 150 * (Number(speed) || 1);
  return words > 0 ? Math.round(words / wpm * 60) : 0;
}

function formatClock(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

async function api(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", headers: { "Content-Type": "application/json" }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败：${response.status}`);
  return body;
}

function currentOpeningTitle(text = "") {
  return String(elements.openingTitle?.value || "").trim() || firstHookLine(text || elements.rewriteText?.value);
}

function firstHookLine(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const match = text.match(/^(.{8,72}?[.!?。！？])(?:\s|$)/);
  return (match?.[1] || text).slice(0, 72);
}

function excerpt(value, limit = 150) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text || "暂无内容";
}

function formatNumber(value) { return new Intl.NumberFormat("zh-CN").format(Number(value) || 0); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char])); }

