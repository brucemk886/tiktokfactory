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
  speechSpeed: document.querySelector("#speechSpeed"),
  speechSpeedValue: document.querySelector("#speechSpeedValue"),
  pickAudioDirButton: document.querySelector("#pickAudioDirBtn"),
  generateAudioButton: document.querySelector("#generateAudioBtn"),
  generateVariantsButton: document.querySelector("#generateVariantsBtn"),
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
  effectsLink: document.querySelector("#effectsLink"),
  audioLink: document.querySelector("#audioLink"),
  generatedAudio: document.querySelector("#generatedAudio")
};

const DEFAULT_STYLE_IDS = ["conflict-first", "betrayal-caught", "secret-reveal"];
const state = {
  novelId: params.get("novel") || "",
  novel: readStashedNovel(),
  novels: [],
  parentScriptId: "",
  lastScriptId: "",
  voices: [],
  variants: [],
  styles: [],
  selectedStyles: readSavedStyles(),
  styleCopies: readSavedStyleCopies(),
  rewriteMode: "ai",
  openingModel: readSavedOpeningModel()
};

elements.novelPicker.addEventListener("change", () => {
  const id = elements.novelPicker.value;
  if (id) location.assign(`/novel-rewrite?novel=${encodeURIComponent(id)}`);
});
elements.form.addEventListener("submit", saveRewrite);
elements.generateVariantsButton?.addEventListener("click", generateVariants);
elements.rewriteText?.addEventListener("input", updateCount);
document.querySelectorAll('input[name="rewriteMode"]').forEach((input) => {
  input.addEventListener("change", () => setRewriteMode(input.value));
});
elements.openingModel?.addEventListener("change", () => setOpeningModel(elements.openingModel.value));
elements.pickAudioDirButton.addEventListener("click", pickAudioDirectory);
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
updateGenerateButton();
loadStyles();
loadPage();
loadAudioControls();

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
  if (elements.effectsLink) elements.effectsLink.href = `/novel-effects?novel=${encodeURIComponent(novel.id)}`;
  if (elements.audioLink) elements.audioLink.href = `/novel-audio?novel=${encodeURIComponent(novel.id)}#records`;
  const scripts = novel.scripts || [];
  const defaultScript = scripts.find((item) => item.id === state.parentScriptId)
    || scripts.find((item) => !item.parentScriptId)
    || scripts[0]
    || null;
  renderScripts(scripts);
  selectBase(defaultScript?.id || "");
  renderVariants();
}

function renderScripts(scripts) {
  if (!scripts.length) {
    elements.scriptList.innerHTML = `<div class="empty-script">还没有开头版本。左边勾选风格生成，或改成人工写开头。</div>`;
    return;
  }
  elements.scriptList.innerHTML = [
    ...scripts.map((script) => `
      <button class="script-item${script.id === state.parentScriptId ? " is-active" : ""}" type="button" data-script-id="${escapeHtml(script.id)}">
        <strong>${escapeHtml(script.versionLabel || script.title || "未命名版本")}</strong>
        <small>${script.parentScriptId ? "改写版本" : "原版本"} · ${formatNumber(script.performance?.totalViews || 0)} 播放</small>
        ${script.openingTitle ? `<em class="hook-title">${escapeHtml(script.openingTitle)}</em>` : ""}
        <p>${escapeHtml(excerpt(script.text, 80))}</p>
        ${script.audio?.id ? `<audio class="variant-audio" controls preload="none" src="/api/audio-library/${encodeURIComponent(script.audio.id)}/file"></audio>` : ""}
      </button>`)
  ].join("");
  elements.scriptList.querySelectorAll("[data-script-id]").forEach((button) => {
    button.addEventListener("click", () => selectBase(button.dataset.scriptId || ""));
    button.querySelector("audio")?.addEventListener("click", (event) => event.stopPropagation());
  });
}

function selectBase(scriptId) {
  const novel = state.novel;
  const script = (novel.scripts || []).find((item) => item.id === scriptId) || null;
  state.parentScriptId = script?.id || "";
  if (elements.baseHint) elements.baseHint.textContent = script
    ? `当前对照版本：${script.versionLabel || script.title}。AI 和人工新写都另存为新版本，不覆盖这一条。`
    : "还没有开头版本。对照上面的免费章节，勾选风格生成，或改成人工写开头。";
  elements.scriptList.querySelectorAll("[data-script-id]").forEach((button) => {
    button.classList.toggle("is-active", (button.dataset.scriptId || "") === state.parentScriptId);
  });
}

function setRewriteMode(mode) {
  state.rewriteMode = mode === "manual" ? "manual" : "ai";
  const isManual = state.rewriteMode === "manual";
  if (elements.aiRewritePanel) elements.aiRewritePanel.hidden = isManual;
  if (elements.manualRewritePanel) elements.manualRewritePanel.hidden = !isManual;
  if (elements.openingModel) elements.openingModel.hidden = isManual;
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

function openingModelLabel(model) {
  return model === "gpt-5.6-terra" ? "GPT-5.6 Terra" : "GPT-5.6 Sol";
}

function readSavedOpeningModel() {
  const saved = localStorage.getItem("lf-opening-model") || "";
  return saved === "gpt-5.6-terra" ? saved : "gpt-5.6-sol";
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
  const text = elements.rewriteText.value.trim();
  if (text.length < 20) return setStatus("开头文案至少需要 20 个字符。", "error");
  elements.saveButton.disabled = true;
  elements.saveButton.textContent = "保存中...";
  try {
    await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}/scripts`, {
      method: "POST",
      body: JSON.stringify({
        parentScriptId: state.parentScriptId,
        title: `${state.novel.title} 人工改写`,
        versionLabel: "人工改写",
        openingTitle: currentOpeningTitle(text),
        text
      })
    });
    elements.rewriteText.value = "";
    updateCount();
    setStatus("已保存为新开头版本，可在这本小说页和数据概览里对照。", "success");
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
    const data = await api("/api/novel-content/opening-styles");
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
    <div class="style-option${state.selectedStyles.includes(style.id) ? " is-on" : ""}" data-style-id="${escapeHtml(style.id)}">
      <input type="checkbox" value="${escapeHtml(style.id)}" ${state.selectedStyles.includes(style.id) ? "checked" : ""} />
      <strong>${escapeHtml(style.label)}</strong>
      <input type="number" min="1" max="5" value="${styleCopyCount(style.id)}" aria-label="${escapeHtml(style.label)} 条数" />
      <em>${escapeHtml(style.hook)}</em>
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
  if (elements.styleCount) elements.styleCount.textContent = `已选 ${state.selectedStyles.length}`;
  updateGenerateButton();
}

function selectedStyleIds() {
  return state.selectedStyles
    .filter((id) => state.styles.some((style) => style.id === id))
    .flatMap((id) => Array.from({ length: styleCopyCount(id) }, () => id))
    .slice(0, 10);
}

function styleCopyCount(id) {
  const value = Math.floor(Number(state.styleCopies[id]) || 1);
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
  elements.generateVariantsButton.textContent = count ? `生成 ${count} 个改版开头` : "生成改版开头";
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

async function generateVariants() {
  const styles = selectedStyleIds();
  if (!styles.length) return setStatus("请先勾选至少 1 种风格，再生成改版开头。", "error");
  const selected = (state.novel.scripts || []).find((item) => item.id === state.parentScriptId);
  const baseOpening = selected?.text || "";
  elements.generateVariantsButton.disabled = true;
  elements.generateVariantsButton.textContent = `正在生成 ${styles.length} 个改版...`;
  elements.variantPanel.hidden = false;
  if (elements.variantHeading) elements.variantHeading.textContent = `${styles.length} 个改版开头`;
  elements.variantStatus.textContent = `正在生成 ${styles.length} 个改版开头，请稍候。`;
  try {
    const data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}/opening-variants`, {
      method: "POST",
      body: JSON.stringify({ baseOpening, styles, model: selectedOpeningModel() })
    });
    const model = data.model || selectedOpeningModel();
    state.variants = (data.variants || []).map((item, index) => ({
      ...item,
      id: item.id || `variant-${index + 1}`,
      selected: true,
      status: "",
      model,
      audioId: "",
      audioPath: ""
    }));
    renderVariants();
    setStatus(`已用 ${openingModelLabel(model)} 生成 ${state.variants.length} 个开头，可勾选后单条保存并配音。`, "success");
  } catch (error) {
    elements.variantStatus.textContent = error.message || "生成改版开头失败。";
    setStatus(error.message, "error");
  } finally {
    updateGenerateButton();
  }
}

function renderVariants() {
  if (!elements.variantPanel) return;
  if (!state.variants.length) {
    elements.variantPanel.hidden = true;
    return;
  }
  elements.variantPanel.hidden = false;
  if (elements.variantHeading) elements.variantHeading.textContent = `${state.variants.length} 个不同风格改版`;
  const modelLabel = openingModelLabel(state.variants[0]?.model);
  elements.variantStatus.textContent = `已用 ${modelLabel} 按你选的风格分别改写。勾选后点「保存并生成音频」，可直接在这条下面试听。`;
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
      <small class="variant-meta">${formatNumber(wordCount(variant.script))} 词 · 预估 ${formatClock(estimateSpeechSeconds(wordCount(variant.script)))}</small>
      <button class="quiet-action" type="button" data-save-audio>${variant.status || "保存并生成音频"}</button>
      ${variant.audioId ? `<audio class="variant-audio" controls preload="metadata" data-audio-id="${escapeHtml(variant.audioId)}" src="/api/audio-library/${encodeURIComponent(variant.audioId)}/file"></audio>` : ""}
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
}

async function saveVariantWithAudio(variantId) {
  const variant = state.variants.find((item) => item.id === variantId);
  if (!variant) return;
  if (variant.selected === false) return setStatus("先勾选这一条，再保存并生成音频。", "error");
  const voiceId = selectedVoiceId();
  const targetAudioDir = elements.audioDir.value.trim();
  if (!voiceId) return setAudioStatus("请先在右边选择 ElevenLabs 声音。", "error");
  if (!targetAudioDir) return setAudioStatus("请先在右边选择音频库目录。", "error");
  variant.status = "保存中...";
  renderVariants();
  try {
    const script = await saveCurrentScript(variant.script, {
      versionLabel: variant.styleLabel || "AI 改版",
      sourceType: "ai-style-rewrite",
      openingTitle: variant.openingTitle || firstHookLine(variant.script)
    });
    const result = await api("/api/audio-library/generate-script", {
      method: "POST",
      body: JSON.stringify({
        novelId: state.novelId,
        scriptId: script.id,
        title: `${state.novel.title} ${variant.styleLabel || "AI 改版"}`,
        script: variant.script,
        voiceId,
        targetAudioDir,
        speechSpeed: selectedSpeechSpeed(),
        sourceType: "ai-style-rewrite"
      })
    });
    variant.status = "已保存并配音";
    variant.audioId = result.item?.id || "";
    variant.audioPath = result.item?.targetAudioPath || "";
    const data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}`);
    state.novel = data.novel;
    renderScripts(state.novel.scripts || []);
    renderVariants();
    playGeneratedAudio(variant.audioId);
    setStatus(`${variant.styleLabel} 已保存，可直接在这条下面试听。`, "success");
    setAudioStatus(variant.audioPath ? `已生成并保存到 ${variant.audioPath}` : "已生成并写入音频库。", "success");
  } catch (error) {
    variant.status = "失败，可重试";
    renderVariants();
    setStatus(error.message, "error");
    setAudioStatus(error.message, "error");
  }
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
      if (voicesData.warning) setAudioStatus(voicesData.warning, "error");
      else setAudioStatus(force ? `已读取 ${state.voices.length} 个声音，模型固定为 Eleven Multilingual v2。` : "");
    }
    if (!force || !elements.audioDir.value.trim()) elements.audioDir.value = settings.targetAudioDir || elements.audioDir.value;
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

async function persistAudioSettings() {
  try {
    await api("/api/novel-content/seed-settings", {
      method: "PUT",
      body: JSON.stringify({
        voiceId: selectedVoiceId(),
        targetAudioDir: elements.audioDir.value.trim(),
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
  const targetAudioDir = elements.audioDir.value.trim();
  if (!voiceId) return setAudioStatus("请先选择 ElevenLabs 声音，或手动填写 Voice ID。", "error");
  if (!targetAudioDir) return setAudioStatus("请先选择音频库目录。", "error");
  elements.generateAudioButton.disabled = true;
  elements.generateAudioButton.textContent = "正在生成音频...";
  try {
    const existing = (state.novel.scripts || []).find((script) => String(script.text || "").trim() === text);
    const script = existing || await saveCurrentScript(text);
    state.lastScriptId = script.id;
    const result = await api("/api/audio-library/generate-script", {
      method: "POST",
      body: JSON.stringify({
        novelId: state.novelId,
        scriptId: script.id,
        title: `${state.novel.title} ${script.versionLabel || "人工改写"}`,
        script: text,
        voiceId,
        targetAudioDir,
        speechSpeed: selectedSpeechSpeed(),
        sourceType: "manual-rewrite"
      })
    });
    const data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}`);
    state.novel = data.novel;
    renderWork();
    selectBase(script.id);
    elements.rewriteText.value = text;
    playGeneratedAudio(result.item?.id);
    updateCount();
    setAudioStatus(result.item?.targetAudioPath ? `已生成并保存到 ${result.item.targetAudioPath}` : "已生成并写入音频库。", "success");
    setStatus("文案已保存，音频已写入指定目录。", "success");
  } catch (error) {
    setAudioStatus(error.message, "error");
  } finally {
    elements.generateAudioButton.disabled = false;
    elements.generateAudioButton.textContent = "生成音频并保存";
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
