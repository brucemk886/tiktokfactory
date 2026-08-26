import { requestAudioJob, waitForCloudJob } from "./audio-job.js";

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
  voiceLanguage: document.querySelector("#voiceLanguage"),
  voiceCategory: document.querySelector("#voiceCategory"),
  voiceGender: document.querySelector("#voiceGender"),
  voiceAge: document.querySelector("#voiceAge"),
  voiceSelect: document.querySelector("#voiceSelect"),
  voiceIdInput: document.querySelector("#voiceIdInput"),
  audioDir: document.querySelector("#audioDir"),
  audioGroupSelect: document.querySelector("#audioGroupSelect"),
  audioGroupHint: document.querySelector("#audioGroupHint"),
  speechSpeed: document.querySelector("#speechSpeed"),
  speechSpeedValue: document.querySelector("#speechSpeedValue"),
  pickAudioDirButton: document.querySelector("#pickAudioDirBtn"),
  generateAudioButton: document.querySelector("#generateAudioBtn"),
  generateVariantsButton: document.querySelector("#generateVariantsBtn"),
  generateSelectedAudioButton: document.querySelector("#generateSelectedAudioBtn"),
  reloadVoicesButton: document.querySelector("#reloadVoicesBtn"),
  previewVoiceButton: document.querySelector("#previewVoiceBtn"),
  voicePreview: document.querySelector("#voicePreview"),
  audioStatus: document.querySelector("#audioStatus"),
  variantPanel: document.querySelector("#variantPanel"),
  variantList: document.querySelector("#variantList"),
  variantStatus: document.querySelector("#variantStatus"),
  styleOptions: document.querySelector("#styleOptions"),
  styleCount: document.querySelector("#styleCount"),
  openingModel: document.querySelector("#openingModel"),
  openingReasoning: document.querySelector("#openingReasoning"),
  effectsLink: document.querySelector("#effectsLink"),
  audioLink: document.querySelector("#audioLink"),
  generatedAudio: document.querySelector("#generatedAudio")
};

const SMART_STYLE_ID = "smart-strongest";
const DEFAULT_STYLE_IDS = [SMART_STYLE_ID];
const state = {
  novelId: params.get("novel") || "",
  novel: readStashedNovel(),
  novels: [],
  parentScriptId: "",
  lastScriptId: "",
  voices: [],
  audioGroups: [],
  variants: [],
  styles: [],
  selectedStyles: readSavedStyles(),
  styleCopies: readSavedStyleCopies(),
  rewriteMode: "ai",
  openingModel: readSavedOpeningModel(),
  openingReasoning: readSavedOpeningReasoning(),
  openingJobId: "",
  restoringOpeningJob: false
};

elements.novelPicker.addEventListener("change", () => {
  const id = elements.novelPicker.value;
  if (id) location.assign(`/novel-rewrite?novel=${encodeURIComponent(id)}`);
});
elements.form.addEventListener("submit", saveRewrite);
elements.generateVariantsButton?.addEventListener("click", generateVariants);
elements.generateSelectedAudioButton?.addEventListener("click", generateSelectedVariantAudios);
elements.rewriteText?.addEventListener("input", updateCount);
document.querySelectorAll('input[name="rewriteMode"]').forEach((input) => {
  input.addEventListener("change", () => setRewriteMode(input.value));
});
elements.openingModel?.addEventListener("change", () => setOpeningModel(elements.openingModel.value));
elements.openingReasoning?.addEventListener("change", () => setOpeningReasoning(elements.openingReasoning.value));
elements.pickAudioDirButton?.addEventListener("click", pickAudioDirectory);
elements.audioGroupSelect?.addEventListener("change", () => {
  applyAudioGroupSelection();
  persistAudioSettings();
});
elements.reloadVoicesButton.addEventListener("click", () => loadAudioControls(true));
elements.previewVoiceButton.addEventListener("click", previewSelectedVoice);
elements.generateAudioButton.addEventListener("click", generateAudio);
elements.voiceLanguage.addEventListener("change", () => renderVoiceOptions());
elements.voiceCategory.addEventListener("change", () => renderVoiceOptions());
elements.voiceGender.addEventListener("change", () => renderVoiceOptions());
elements.voiceAge.addEventListener("change", () => renderVoiceOptions());
elements.voiceSelect.addEventListener("change", () => {
  stopVoicePreview();
  persistAudioSettings();
});
elements.voiceIdInput.addEventListener("change", () => {
  stopVoicePreview();
  persistAudioSettings();
});
elements.voicePreview.addEventListener("ended", () => {
  elements.previewVoiceButton.textContent = "试听";
});
elements.voicePreview.addEventListener("pause", () => {
  if (elements.voicePreview.ended || elements.voicePreview.currentTime === 0) elements.previewVoiceButton.textContent = "试听";
});
elements.audioDir.addEventListener("change", persistAudioSettings);
elements.speechSpeed?.addEventListener("input", updateSpeechSpeedLabel);
elements.speechSpeed?.addEventListener("change", persistAudioSettings);
updateCount();
setRewriteMode("ai");
setOpeningModel(state.openingModel);
setOpeningReasoning(state.openingReasoning);
updateGenerateButton();
loadStyles();
loadPage();
loadAudioControls();
loadAudioGroups();

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
    void restoreLatestOpeningJob();
  } catch (error) {
    if (state.novel) {
      renderWork();
      setStatus(error.message || "已先带入书单内容，完整数据稍后可刷新。", "error");
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
  const audioCount = (novel.scripts || []).filter(scriptHasAudio).length;
  elements.novelStats.textContent = `${formatNumber(audioCount)} 条已配音开头 · ${formatNumber(novel.performance?.videoCount || 0)} 条视频 · ${formatNumber(novel.performance?.totalViews || 0)} 播放`;
  elements.sourceExcerpt.textContent = excerpt(novel.sourceContent, 400);
  if (elements.effectsLink) elements.effectsLink.href = `/novel-effects?novel=${encodeURIComponent(novel.id)}`;
  if (elements.audioLink) elements.audioLink.href = `/novel-audio?novel=${encodeURIComponent(novel.id)}`;
  if (elements.baseHint) {
    elements.baseHint.textContent = "对照上面的免费章节生成。配好音的版本去「查看音频与记录」看，没配音的文案不会保存。";
  }
  state.parentScriptId = "";
  renderVariants();
}

function scriptHasAudio(script) {
  return Boolean(String(script?.audioId || script?.audio?.id || "").trim());
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
  state.openingReasoning = value === "medium" || value === "xhigh" ? value : "high";
  localStorage.setItem("lf-opening-reasoning", state.openingReasoning);
  if (elements.openingReasoning) elements.openingReasoning.value = state.openingReasoning;
}

function selectedOpeningReasoning() {
  return elements.openingReasoning?.value || state.openingReasoning || "high";
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
  const saved = localStorage.getItem("lf-opening-reasoning") || "";
  return saved === "medium" || saved === "xhigh" ? saved : "high";
}

function playGeneratedAudio(audioId) {
  if (!audioId) return;
  const src = `/api/audio-library/${encodeURIComponent(audioId)}/file`;
  if (elements.generatedAudio) {
    elements.generatedAudio.hidden = false;
    elements.generatedAudio.src = src;
  }
  const cardPlayer = elements.variantList?.querySelector(`audio.variant-audio[data-audio-id="${CSS.escape(audioId)}"]`);
  const player = cardPlayer || elements.generatedAudio;
  player?.play?.().catch(() => {});
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
  await generateAudio();
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
  elements.styleOptions.innerHTML = state.styles.map((style) => `
    <div class="style-option${style.recommended ? " is-recommended" : ""}${state.selectedStyles.includes(style.id) ? " is-on" : ""}" data-style-id="${escapeHtml(style.id)}">
      <input type="checkbox" value="${escapeHtml(style.id)}" ${state.selectedStyles.includes(style.id) ? "checked" : ""} />
      <strong>${escapeHtml(style.label)}${style.recommended ? '<span class="style-badge">推荐</span>' : ""}</strong>
      <input type="number" min="1" max="5" value="${styleCopyCount(style.id)}" aria-label="${escapeHtml(style.label)} 条数" />
      <em>${escapeHtml(style.hook)}</em>
      ${style.example ? `<small>例：${escapeHtml(style.example)}</small>` : ""}
    </div>`).join("");
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
    if (state.selectedStyles.includes(id)) return;
    state.selectedStyles = [...state.selectedStyles, id];
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
  const defaultCount = id === SMART_STYLE_ID ? 2 : 1;
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
    const parsed = JSON.parse(localStorage.getItem("lf-opening-style-copies") || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([id, value]) => [id, styleCopyCountFrom(value)]));
  } catch {
    return {};
  }
}

function saveStyleCopies() {
  localStorage.setItem("lf-opening-style-copies", JSON.stringify(state.styleCopies));
}

function updateGenerateButton() {
  const count = selectedStyleIds().length;
  if (!elements.generateVariantsButton) return;
  elements.generateVariantsButton.textContent = count ? `生成 ${count} 个强钩子开头` : "生成强钩子开头";
  elements.generateVariantsButton.disabled = !count;
}

function readSavedStyles() {
  try {
    const saved = JSON.parse(localStorage.getItem("lf-opening-styles") || "[]");
    return Array.isArray(saved) ? saved.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveSelectedStyles() {
  localStorage.setItem("lf-opening-styles", JSON.stringify(state.selectedStyles));
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
  if (elements.generateSelectedAudioButton) elements.generateSelectedAudioButton.hidden = true;
}

async function generateVariants() {
  const styles = selectedStyleIds();
  if (!styles.length) return setStatus("请先勾选至少 1 种策略，再生成强钩子开头。", "error");
  const baseOpening = "";
  const startedAt = Date.now();
  elements.generateVariantsButton.disabled = true;
  elements.generateVariantsButton.textContent = `正在筛选 ${styles.length} 个强钩子...`;
  beginVariantGeneration(styles.length);
  elements.variantStatus.textContent = `正在提取事实、生成候选并筛选 ${styles.length} 个强钩子。${styles.length >= 4 ? "4 条以上强推理通常要 8–20 分钟" : "通常要几分钟"}，不是卡住了。`;
  try {
    let data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}/opening-variants`, {
      method: "POST",
      body: JSON.stringify({
        baseOpening,
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
    reasoningEffort,
    audioId: "",
    audioPath: ""
  }));
  elements.variantPanel.hidden = false;
  if (elements.generateSelectedAudioButton) elements.generateSelectedAudioButton.hidden = false;
  if (elements.variantHeading) elements.variantHeading.textContent = `${state.variants.length} 个强钩子开头`;
  elements.variantStatus.textContent = restored ? `已恢复上次生成的 ${state.variants.length} 个强钩子。` : `已生成 ${state.variants.length} 个强钩子。`;
  renderVariants();
  setStatus(`${restored ? "已找回" : "已用"} ${openingModelLabel(model, reasoningEffort)} 筛选出的 ${state.variants.length} 个强钩子，并带中文对照。勾选后可一键依次配音。`, "success");
}

function renderVariants() {
  if (!elements.variantPanel) return;
  if (!state.variants.length) {
    if (elements.generateSelectedAudioButton) elements.generateSelectedAudioButton.hidden = true;
    return;
  }
  elements.variantPanel.hidden = false;
  if (elements.generateSelectedAudioButton) elements.generateSelectedAudioButton.hidden = false;
  if (elements.variantHeading) elements.variantHeading.textContent = `${state.variants.length} 个强钩子结果`;
  const modelLabel = openingModelLabel(state.variants[0]?.model, state.variants[0]?.reasoningEffort);
  elements.variantStatus.textContent = `已用 ${modelLabel} 按策略筛选，并给出中文对照。勾选后点「一键生成勾选音频」，会按顺序配音。`;
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
        <input type="text" maxlength="80" data-opening-title value="${escapeHtml(variant.openingTitle || firstHookLine(variant.script))}" />
      </label>
      <p>${escapeHtml(variant.script)}</p>
      ${variant.scriptZh || variant.openingTitleZh ? `<div class="variant-zh">
        ${variant.openingTitleZh ? `<strong>${escapeHtml(variant.openingTitleZh)}</strong>` : ""}
        <p>${escapeHtml(variant.scriptZh || "")}</p>
      </div>` : ""}
      <small class="variant-meta">${formatNumber(wordCount(variant.script))} 词 · 预估 ${formatClock(estimateSpeechSeconds(wordCount(variant.script)))}</small>
      <button class="quiet-action" type="button" data-save-audio>${variant.status || "保存并生成音频"}</button>
      ${variant.audioId ? `<audio class="variant-audio" controls preload="metadata" data-audio-id="${escapeHtml(variant.audioId)}" src="/api/audio-library/${encodeURIComponent(variant.audioId)}/file?t=${Date.now()}"></audio>
      <div class="retune-row">
        <label>已生成变速 <em data-retune-label>1.00×</em>
          <input type="range" min="0.8" max="1.4" step="0.05" value="1" data-retune-range />
        </label>
        <button type="button" class="quiet-action" data-retune-id="${escapeHtml(variant.audioId)}">应用变速</button>
      </div>` : ""}
    </article>`).join("");
  elements.variantList.querySelectorAll(".variant-card").forEach((card) => {
    const variant = state.variants.find((item) => item.id === card.dataset.variantId);
    if (!variant) return;
    card.querySelector("input[type=checkbox]")?.addEventListener("change", (event) => {
      variant.selected = event.target.checked;
    });
    card.querySelector("[data-opening-title]")?.addEventListener("input", (event) => {
      variant.openingTitle = event.target.value;
    });
    card.querySelector("[data-save-audio]")?.addEventListener("click", () => saveVariantWithAudio(variant.id));
  });
  bindRetuneControls(elements.variantList);
}

async function saveVariantWithAudio(variantId) {
  const variant = state.variants.find((item) => item.id === variantId);
  if (!variant) return;
  if (variant.selected === false) return setStatus("先勾选这一条，再保存并生成音频。", "error");
  try {
    await generateVariantAudios([variant]);
    playGeneratedAudio(variant.audioId);
    setStatus(`${variant.styleLabel} 已保存，可直接在这条下面试听。`, "success");
  } catch (error) {
    variant.status = "失败，可重试";
    renderVariants();
    setStatus(error.message, "error");
    setAudioStatus(error.message, "error");
  }
}

async function generateSelectedVariantAudios() {
  const selected = state.variants.filter((item) => item.selected !== false);
  if (!selected.length) return setStatus("先勾选要配音的改版开头。", "error");
  if (elements.generateSelectedAudioButton) {
    elements.generateSelectedAudioButton.disabled = true;
    elements.generateSelectedAudioButton.textContent = `正在依次生成 ${selected.length} 条...`;
  }
  try {
    await generateVariantAudios(selected);
    setStatus(`已按顺序生成 ${selected.filter((item) => item.audioId).length} 条勾选音频。`, "success");
  } catch (error) {
    setStatus(error.message, "error");
    setAudioStatus(error.message, "error");
  } finally {
    if (elements.generateSelectedAudioButton) {
      elements.generateSelectedAudioButton.disabled = false;
      elements.generateSelectedAudioButton.textContent = "一键生成勾选音频";
    }
  }
}

async function generateVariantAudios(variants) {
  const voiceId = selectedVoiceId();
  const targetAudioDir = selectedAudioDir();
  if (!voiceId) setAudioStatus("未选手动声音，将用工人机默认 Voice ID。");
  const items = [];
  try {
    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[index];
      variant.status = variants.length > 1 ? `保存文案 ${index + 1}/${variants.length}` : "保存中...";
      renderVariants();
      const script = await saveCurrentScript(variant.script, {
        versionLabel: variant.styleLabel || "AI 改版",
        sourceType: "ai-style-rewrite",
        openingTitle: variant.openingTitle || firstHookLine(variant.script)
      });
      variant.scriptId = script.id;
      items.push({
        novelId: state.novelId,
        novelTitle: state.novel?.title || "",
        scriptId: script.id,
        title: `${state.novel.title} ${variant.styleLabel || "AI 改版"}`,
        script: variant.script,
        openingTitle: variant.openingTitle || firstHookLine(variant.script),
        voiceId,
        speechSpeed: selectedSpeechSpeed(),
        sourceType: "ai-style-rewrite"
      });
    }
    setAudioStatus(`正在按顺序生成 ${items.length} 条音频...`);
    const result = await requestAudioJob("/api/audio-library/sync-local", {
      novelId: state.novelId,
      novelTitle: state.novel?.title || "",
      targetAudioDir,
      voiceId,
      items
    }, { api, onProgress: (job) => setAudioStatus(job.message || "工人机正在依次配音...") });
    const saved = Array.isArray(result.items) ? result.items : [];
    for (const row of saved) {
      const variant = variants.find((item) => item.scriptId === row.scriptId);
      if (!variant) continue;
      variant.status = "已保存并配音";
      variant.audioId = row.audioId || row.id || "";
      variant.audioPath = row.targetAudioPath || "";
    }
    for (const variant of variants) {
      if (!variant.audioId) variant.status = "失败，可重试";
    }
    await refreshNovel();
    renderVariants();
    setAudioStatus(result.targetAudioDir ? `已保存到 ${result.targetAudioDir}，可在「查看音频与记录」里看。` : "已写入本机音频目录。", "success");
    if (!saved.length) throw new Error("工人机没有返回已生成的音频。");
  } finally {
    await pruneDraftScripts(variants.filter((item) => item.scriptId && !item.audioId).map((item) => item.scriptId));
  }
}

async function pruneDraftScripts(scriptIds = []) {
  if (!state.novelId) return;
  try {
    const data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}/prune-drafts`, {
      method: "POST",
      body: JSON.stringify(scriptIds.length ? { scriptIds } : { graceMs: 20 * 60 * 1000 })
    });
    if (data.novel) state.novel = data.novel;
    updateNovelStats();
  } catch {
    // 配音失败时清草稿，失败也不挡主流程。
  }
}

async function refreshNovel() {
  const data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}`);
  state.novel = data.novel;
  updateNovelStats();
}

function updateNovelStats() {
  if (!elements.novelStats || !state.novel) return;
  const audioCount = (state.novel.scripts || []).filter(scriptHasAudio).length;
  elements.novelStats.textContent = `${formatNumber(audioCount)} 条已配音开头 · ${formatNumber(state.novel.performance?.videoCount || 0)} 条视频 · ${formatNumber(state.novel.performance?.totalViews || 0)} 播放`;
}

async function loadAudioControls(force = false) {
  try {
    if (force) {
      elements.voiceSelect.innerHTML = `<option value="">正在读取声音...</option>`;
      setAudioStatus("正在重新读取 ElevenLabs 声音...");
    }
    const [settingsData, voicesData] = await Promise.all([
      api("/api/novel-content/seed-settings").catch(() => ({ settings: {} })),
      api("/api/elevenlabs/voices").catch((error) => ({ error: voiceErrorText(error.message), voices: [], defaultVoiceId: "" }))
    ]);
    const settings = settingsData.settings || {};
    state.voices = voicesData.voices || [];
    const selected = settings.voiceId || voicesData.defaultVoiceId || "";
    fillFilterSelect(elements.voiceLanguage, voicesData.filters?.languages, "全部语言");
    fillFilterSelect(elements.voiceCategory, voicesData.filters?.categories, "全部类别");
    fillFilterSelect(elements.voiceGender, voicesData.filters?.genders, "全部性别");
    fillFilterSelect(elements.voiceAge, voicesData.filters?.ages, "全部年龄");
    if (voicesData.error && !state.voices.length) {
      elements.voiceSelect.innerHTML = `<option value="">${escapeHtml(voicesData.error)}</option>`;
      elements.voiceIdInput.value = selected;
      setAudioStatus(voicesData.error, "error");
    } else {
      renderVoiceOptions(selected);
      if (selected && !state.voices.some((voice) => voice.id === selected)) elements.voiceIdInput.value = selected;
      if (voicesData.warning) setAudioStatus(voicesData.warning, state.voices.length ? "" : "error");
      else setAudioStatus(force || state.voices.length ? `已读取 ${state.voices.length} 个声音，模型固定为 Eleven Multilingual v2。` : "");
    }
    if (settings.targetAudioDir) {
      elements.audioDir.value = settings.targetAudioDir;
      if (state.audioGroups.length) applyAudioGroupSelection();
    }
    if (elements.speechSpeed && settings.speechSpeed) elements.speechSpeed.value = String(settings.speechSpeed);
    updateSpeechSpeedLabel();
  } catch (error) {
    setAudioStatus(voiceErrorText(error.message), "error");
  }
}

function voiceErrorText(message) {
  const text = String(message || "").trim();
  if (/not found/i.test(text)) return "声音列表接口还没加载，请重启本地服务后刷新本页。";
  return text || "读取 ElevenLabs 声音失败。";
}

async function loadAudioGroups() {
  const select = elements.audioGroupSelect;
  if (!select) return;
  try {
    const data = await api(`/api/audio-groups?t=${Date.now()}`);
    state.audioGroups = Array.isArray(data.groups) ? data.groups : [];
    const current = elements.audioDir.value.trim();
    select.innerHTML = [
      `<option value="__novel__">按小说名称自动建文件夹</option>`,
      ...state.audioGroups.map((group) => `<option value="${escapeAttr(group.path)}">${escapeHtml(group.name || group.id)}（${Number(group.totalAssets) || 0} 条）</option>`)
    ].join("");
    const matched = state.audioGroups.find((group) => group.path === current);
    select.value = matched ? matched.path : "__novel__";
    applyAudioGroupSelection();
    if (elements.audioGroupHint) {
      const book = state.novel?.title || "小说名";
      elements.audioGroupHint.textContent = `默认写到 F:\\音频目录\\${book}。线上点生成后，工人机会自动建文件夹。`;
    }
  } catch {
    if (elements.audioGroupHint) elements.audioGroupHint.textContent = "读取本机音频目录失败时，会按小说名在 F:\\音频目录 下自动建文件夹。";
  }
}

function applyAudioGroupSelection() {
  const value = elements.audioGroupSelect?.value || "__novel__";
  if (elements.audioDir) elements.audioDir.value = value === "__novel__" || value === "__today__" ? value : value;
}

function selectedAudioDir() {
  applyAudioGroupSelection();
  return elements.audioDir?.value.trim() || "";
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

async function persistAudioSettings() {
  try {
    await api("/api/novel-content/seed-settings", {
      method: "PUT",
      body: JSON.stringify({
        voiceId: selectedVoiceId(),
        targetAudioDir: selectedAudioDir(),
        speechSpeed: selectedSpeechSpeed()
      })
    });
    if (selectedVoiceId()) setAudioStatus("已记住为默认配音，新书种子和机器自动改写会用这个声音。", "success");
  } catch (error) {
    setAudioStatus(error.message, "error");
  }
}

async function pickAudioDirectory() {
  try {
    const data = await api("/api/select-directory", {
      method: "POST",
      body: JSON.stringify({ title: "选择音频库目录", initialPath: elements.audioDir.value.trim() })
    });
    if (!data.canceled && data.path) {
      elements.audioDir.value = data.path;
      await persistAudioSettings();
    }
  } catch (error) {
    setAudioStatus(error.message, "error");
  }
}

async function generateAudio() {
  if (state.rewriteMode !== "manual") return setAudioStatus("AI 开头请在生成结果里点「保存并生成音频」。自己写开头请先切到「人工写开头」。", "error");
  const text = elements.rewriteText.value.trim();
  if (text.length < 20) return setAudioStatus("文案至少需要 20 个字符。", "error");
  const voiceId = selectedVoiceId();
  const targetAudioDir = selectedAudioDir();
  if (!voiceId) setAudioStatus("未选手动声音，将用工人机默认 Voice ID。");
  elements.generateAudioButton.disabled = true;
  elements.generateAudioButton.textContent = "正在交给工人机...";
  if (elements.saveButton) {
    elements.saveButton.disabled = true;
    elements.saveButton.textContent = "正在交给工人机...";
  }
  let existing = null;
  let script = null;
  try {
    existing = (state.novel.scripts || []).find((item) => String(item.text || "").trim() === text);
    script = existing || await saveCurrentScript(text);
    state.lastScriptId = script.id;
    const result = await requestAudioJob("/api/audio-library/generate-script", {
      novelId: state.novelId,
      novelTitle: state.novel?.title || "",
      scriptId: script.id,
      title: `${state.novel.title} ${script.versionLabel || "人工改写"}`,
      script: text,
      openingTitle: currentOpeningTitle(text),
      voiceId,
      targetAudioDir,
      speechSpeed: selectedSpeechSpeed(),
      sourceType: "manual-rewrite"
    }, { api, onProgress: (job) => setAudioStatus(job.message || "工人机正在生成音频...") });
    const item = result.item || result.items?.[0] || {};
    await refreshNovel();
    elements.rewriteText.value = text;
    playGeneratedAudio(item.id || item.audioId);
    updateCount();
    setAudioStatus(item.targetAudioPath ? `已生成并保存到 ${item.targetAudioPath}` : "已交给工人机写入本机音频目录。", "success");
    setStatus(`已配音保存。去「查看音频与记录」看版本。`, "success");
    if (elements.saveButton) elements.saveButton.textContent = "保存并生成音频";
  } catch (error) {
    setAudioStatus(error.message, "error");
    if (!existing?.audioId && !existing?.audio?.id && script?.id) await pruneDraftScripts([script.id]);
  } finally {
    elements.generateAudioButton.disabled = false;
    elements.generateAudioButton.textContent = "生成音频并保存";
    if (elements.saveButton) {
      elements.saveButton.disabled = false;
      elements.saveButton.textContent = "保存并生成音频";
    }
  }
}

function fillFilterSelect(select, options, emptyLabel) {
  const current = select.value;
  select.innerHTML = [`<option value="">${emptyLabel}</option>`, ...(options || []).map((item) =>
    `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`
  )].join("");
  if (current && [...select.options].some((option) => option.value === current)) select.value = current;
}

function filteredVoices() {
  const language = elements.voiceLanguage.value.trim();
  const category = elements.voiceCategory.value.trim();
  const gender = elements.voiceGender.value.trim();
  const age = elements.voiceAge.value.trim();
  return state.voices.filter((voice) => {
    if (language && !(voice.languages || []).includes(language)) return false;
    if (category && voice.category !== category) return false;
    if (gender && voice.gender !== gender) return false;
    if (age && voice.age !== age) return false;
    return true;
  });
}

function renderVoiceOptions(preferredId = "") {
  const selected = preferredId || selectedVoiceId();
  const voices = filteredVoices();
  elements.voiceSelect.innerHTML = [`<option value="">${voices.length ? "请选择声音" : "当前筛选没有声音"}</option>`, ...voices.map((voice) => {
    const meta = [voice.languageLabels?.[0], voice.genderLabel, voice.ageLabel, voice.categoryLabel].filter(Boolean).join(" · ");
    return `<option value="${escapeHtml(voice.id)}" data-preview-url="${escapeHtml(voice.previewUrl || "")}">${escapeHtml(voice.name)}${meta ? ` · ${escapeHtml(meta)}` : ""}</option>`;
  })].join("");
  if (selected && voices.some((voice) => voice.id === selected)) elements.voiceSelect.value = selected;
  else if (voices.length === 1) elements.voiceSelect.value = voices[0].id;
}

function selectedSpeechSpeed() {
  return Number(elements.speechSpeed?.value) || 1;
}

function updateSpeechSpeedLabel() {
  if (elements.speechSpeedValue) elements.speechSpeedValue.textContent = `${selectedSpeechSpeed().toFixed(2)}×`;
  updateCount();
  elements.variantList?.querySelectorAll(".variant-card").forEach((card) => {
    const variant = state.variants.find((item) => item.id === card.dataset.variantId);
    const meta = card.querySelector(".variant-meta");
    if (variant && meta) meta.textContent = `${formatNumber(wordCount(variant.script))} 词 · 预估 ${formatClock(estimateSpeechSeconds(wordCount(variant.script)))}`;
  });
}

function wordCount(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function estimateSpeechSeconds(words, speed = selectedSpeechSpeed()) {
  const wpm = 150 * (Number(speed) || 1);
  return words > 0 ? Math.round(words / wpm * 60) : 0;
}

function formatClock(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function selectedVoiceId() {
  return elements.voiceSelect.value.trim() || elements.voiceIdInput.value.trim();
}

function selectedPreviewUrl() {
  return elements.voiceSelect.selectedOptions[0]?.dataset.previewUrl || "";
}

function stopVoicePreview() {
  const audio = elements.voicePreview;
  if (!audio.paused) audio.pause();
  audio.currentTime = 0;
  elements.previewVoiceButton.textContent = "试听";
}

async function previewSelectedVoice() {
  const voiceId = selectedVoiceId();
  if (!voiceId) return setAudioStatus("请先选择声音，或填写 Voice ID。", "error");
  const audio = elements.voicePreview;
  if (!audio.paused) {
    stopVoicePreview();
    return;
  }
  elements.previewVoiceButton.disabled = true;
  elements.previewVoiceButton.textContent = "试听中...";
  try {
    audio.src = selectedPreviewUrl() || `/api/elevenlabs/voices/${encodeURIComponent(voiceId)}/preview`;
    await audio.play();
    elements.previewVoiceButton.textContent = "停止";
    setAudioStatus("正在试听所选声音。");
  } catch (error) {
    stopVoicePreview();
    setAudioStatus(error.message || "试听失败。", "error");
  } finally {
    elements.previewVoiceButton.disabled = false;
  }
}

function setAudioStatus(message, tone = "") {
  elements.audioStatus.textContent = message;
  elements.audioStatus.className = tone ? `is-${tone}` : "";
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

function bindRetuneControls(root) {
  if (!root) return;
  root.querySelectorAll("[data-retune-range]").forEach((input) => {
    const label = input.closest(".retune-row")?.querySelector("[data-retune-label]");
    input.addEventListener("input", () => {
      if (label) label.textContent = `${Number(input.value).toFixed(2)}×`;
    });
  });
  root.querySelectorAll("[data-retune-id]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
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
        const data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}`);
        state.novel = data.novel;
        renderWork();
        setAudioStatus(`已把这条音频调到 ${speed.toFixed(2)}×，可直接试听。`, "success");
      } catch (error) {
        button.disabled = false;
        button.textContent = "应用变速";
        setAudioStatus(error.message || "音频变速失败。", "error");
      }
    });
  });
}
