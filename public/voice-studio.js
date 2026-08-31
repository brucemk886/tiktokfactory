export function bindVoiceStudio(ctx) {
  const { elements } = ctx;
  elements.reloadVoicesButton?.addEventListener("click", () => loadVoiceControls(ctx, true));
  elements.ttsProvider?.addEventListener("change", async () => {
    stopVoicePreview(ctx);
    ctx.state.ttsProvider = selectedTtsProvider(ctx);
    ctx.state.voiceId = "";
    if (elements.voiceIdInput) elements.voiceIdInput.value = "";
    updateModelFixed(ctx);
    await persistVoiceSettings(ctx);
    await loadVoiceControls(ctx, true);
  });
  elements.previewVoiceButton?.addEventListener("click", () => previewSelectedVoice(ctx));
  elements.voiceLanguage?.addEventListener("change", () => renderVoiceOptions(ctx));
  elements.voiceCategory?.addEventListener("change", () => renderVoiceOptions(ctx));
  elements.voiceGender?.addEventListener("change", () => {
    applyGenderDefaultVoice(ctx);
    renderVoiceOptions(ctx);
    persistVoiceSettings(ctx);
  });
  elements.voiceAge?.addEventListener("change", () => renderVoiceOptions(ctx));
  elements.voiceSelect?.addEventListener("change", () => {
    stopVoicePreview(ctx);
    persistVoiceSettings(ctx);
  });
  elements.voiceIdInput?.addEventListener("change", () => {
    stopVoicePreview(ctx);
    persistVoiceSettings(ctx);
  });
  elements.speechSpeed?.addEventListener("input", () => updateSpeechSpeedLabel(ctx));
  elements.speechSpeed?.addEventListener("change", () => persistVoiceSettings(ctx));
  elements.audioGroupSelect?.addEventListener("change", () => {
    applyAudioGroupSelection(ctx);
    persistVoiceSettings(ctx);
  });
  elements.voicePreview?.addEventListener("ended", () => {
    if (elements.previewVoiceButton) elements.previewVoiceButton.textContent = "试听";
  });
  elements.voicePreview?.addEventListener("pause", () => {
    if (elements.voicePreview.ended || elements.voicePreview.currentTime === 0) {
      if (elements.previewVoiceButton) elements.previewVoiceButton.textContent = "试听";
    }
  });
}

export async function loadVoiceControls(ctx, force = false) {
  const { elements, api, setStatus } = ctx;
  try {
    if (force) setStatus?.(selectedTtsProvider(ctx) === "kokoro" ? "正在读取本机 Kokoro 音色..." : "正在重新读取 ElevenLabs 声音...");
    const settingsData = await api("/api/novel-content/seed-settings").catch(() => ({ settings: {} }));
    const settings = settingsData.settings || {};
    if (settings.ttsProvider) {
      ctx.state.ttsProvider = settings.ttsProvider === "elevenlabs" ? "elevenlabs" : "kokoro";
      if (elements.ttsProvider) elements.ttsProvider.value = ctx.state.ttsProvider;
    } else if (elements.ttsProvider?.value) {
      ctx.state.ttsProvider = selectedTtsProvider(ctx);
    }
    updateModelFixed(ctx);
    const voicesData = await api(`/api/elevenlabs/voices?provider=${encodeURIComponent(selectedTtsProvider(ctx))}`).catch((error) => ({
      error: voiceErrorText(error.message),
      voices: [],
      defaultVoiceId: ""
    }));
    ctx.state.voices = voicesData.voices || [];
    ctx.state.defaultMaleVoiceId = voicesData.defaultMaleVoiceId || "am_adam";
    ctx.state.defaultFemaleVoiceId = voicesData.defaultFemaleVoiceId || "af_jessica";
    const selected = selectedTtsProvider(ctx) === "kokoro"
      ? preferredKokoroVoice(ctx, settings.voiceId || ctx.state.voiceId, voicesData)
      : (settings.voiceId || voicesData.defaultVoiceId || ctx.state.voiceId || "");
    if (selected) ctx.state.voiceId = selected;
    fillFilterSelect(elements.voiceLanguage, voicesData.filters?.languages, "全部语言");
    fillFilterSelect(elements.voiceCategory, voicesData.filters?.categories, "全部类别");
    fillFilterSelect(elements.voiceGender, voicesData.filters?.genders, "全部性别");
    fillFilterSelect(elements.voiceAge, voicesData.filters?.ages, "全部年龄");
    if (voicesData.error && !ctx.state.voices.length) {
      if (elements.voiceSelect) elements.voiceSelect.innerHTML = `<option value="">${escapeHtml(voicesData.error)}</option>`;
      if (elements.voiceIdInput) elements.voiceIdInput.value = selected;
      setStatus?.(voicesData.error, "error");
    } else {
      renderVoiceOptions(ctx, selected);
      if (selected && !ctx.state.voices.some((voice) => voice.id === selected) && elements.voiceIdInput) {
        elements.voiceIdInput.value = selected;
      }
      if (selectedTtsProvider(ctx) === "kokoro" && selected && selected !== settings.voiceId) {
        persistVoiceSettings(ctx);
      }
      setStatus?.(voicesData.warning || (ctx.state.voices.length ? `已读取 ${ctx.state.voices.length} 个声音。` : ""), voicesData.warning && !ctx.state.voices.length ? "error" : "");
    }
    if (settings.targetAudioDir && elements.audioDir) {
      elements.audioDir.value = settings.targetAudioDir;
    }
    if (elements.speechSpeed && settings.speechSpeed) elements.speechSpeed.value = String(settings.speechSpeed);
    updateSpeechSpeedLabel(ctx);
    await loadAudioGroups(ctx);
  } catch (error) {
    setStatus?.(voiceErrorText(error.message), "error");
  }
}

export function selectedTtsProvider(ctx) {
  const value = ctx.elements.ttsProvider?.value.trim() || ctx.state.ttsProvider || "kokoro";
  ctx.state.ttsProvider = value === "elevenlabs" ? "elevenlabs" : "kokoro";
  return ctx.state.ttsProvider;
}

export function selectedVoiceId(ctx) {
  const current = ctx.elements.voiceSelect?.value.trim() || ctx.elements.voiceIdInput?.value.trim() || ctx.state.voiceId || "";
  if (current) ctx.state.voiceId = current;
  return current;
}

export function selectedSpeechSpeed(ctx) {
  return Number(ctx.elements.speechSpeed?.value) || 1;
}

export function selectedAudioDir(ctx) {
  applyAudioGroupSelection(ctx);
  return ctx.elements.audioDir?.value.trim() || "__novel__";
}

export function speakOpeningTitle(ctx) {
  return ctx.elements.speakOpeningTitle?.checked === true;
}

export async function persistVoiceSettings(ctx) {
  try {
    await ctx.api("/api/novel-content/seed-settings", {
      method: "PUT",
      body: JSON.stringify({
        voiceId: selectedVoiceId(ctx),
        ttsProvider: selectedTtsProvider(ctx),
        targetAudioDir: selectedAudioDir(ctx),
        speechSpeed: selectedSpeechSpeed(ctx)
      })
    });
    if (selectedVoiceId(ctx)) ctx.setStatus?.("已记住为默认配音。", "ok");
  } catch (error) {
    ctx.setStatus?.(error.message, "error");
  }
}

function updateModelFixed(ctx) {
  if (!ctx.elements.modelFixed) return;
  if (selectedTtsProvider(ctx) === "elevenlabs") {
    ctx.elements.modelFixed.innerHTML = "配音引擎：<strong>Eleven Multilingual v2</strong><span>收费配音 · 混剪仍走 Scribe 识别字幕</span>";
    return;
  }
  ctx.elements.modelFixed.innerHTML = "配音引擎：<strong>Kokoro 82M 本地</strong><span>出声后写入字幕缓存，混剪不再识别</span>";
}

function updateSpeechSpeedLabel(ctx) {
  if (ctx.elements.speechSpeedValue) ctx.elements.speechSpeedValue.textContent = `${selectedSpeechSpeed(ctx).toFixed(2)}×`;
}

function fillFilterSelect(select, options, emptyLabel) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = [`<option value="">${emptyLabel}</option>`, ...(options || []).map((item) =>
    `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`
  )].join("");
  if (current && [...select.options].some((option) => option.value === current)) select.value = current;
}

function preferredKokoroVoice(ctx, saved, voicesData = {}) {
  const male = voicesData.defaultMaleVoiceId || ctx.state.defaultMaleVoiceId || "am_adam";
  const female = voicesData.defaultFemaleVoiceId || ctx.state.defaultFemaleVoiceId || "af_jessica";
  const gender = ctx.elements.voiceGender?.value.trim() || "";
  const id = String(saved || "").trim();
  const current = ctx.state.voices.find((voice) => voice.id === id);
  if (current && id !== "am_michael") {
    if (gender && current.gender !== gender) return gender === "female" ? female : male;
    return id;
  }
  return gender === "female" ? female : male;
}

function applyGenderDefaultVoice(ctx) {
  if (selectedTtsProvider(ctx) !== "kokoro") return;
  ctx.state.voiceId = preferredKokoroVoice(ctx, selectedVoiceId(ctx));
}

function filteredVoices(ctx) {
  const language = ctx.elements.voiceLanguage?.value.trim() || "";
  const category = ctx.elements.voiceCategory?.value.trim() || "";
  const gender = ctx.elements.voiceGender?.value.trim() || "";
  const age = ctx.elements.voiceAge?.value.trim() || "";
  return ctx.state.voices.filter((voice) => {
    if (language && !(voice.languages || []).includes(language)) return false;
    if (category && voice.category !== category) return false;
    if (gender && voice.gender !== gender) return false;
    if (age && voice.age !== age) return false;
    return true;
  });
}

function renderVoiceOptions(ctx, preferredId = "") {
  const select = ctx.elements.voiceSelect;
  if (!select) return;
  const selected = preferredId || selectedVoiceId(ctx);
  const voices = filteredVoices(ctx);
  select.innerHTML = [`<option value="">${voices.length ? "请选择声音" : "当前筛选没有声音"}</option>`, ...voices.map((voice) => {
    const meta = [voice.languageLabels?.[0], voice.genderLabel, voice.ageLabel, voice.categoryLabel].filter(Boolean).join(" · ");
    return `<option value="${escapeHtml(voice.id)}" data-preview-url="${escapeHtml(voice.previewUrl || "")}">${escapeHtml(voice.name)}${meta ? ` · ${escapeHtml(meta)}` : ""}</option>`;
  })].join("");
  if (selected && voices.some((voice) => voice.id === selected)) {
    select.value = selected;
    ctx.state.voiceId = selected;
  } else if (selected) {
    const kept = ctx.state.voices.find((voice) => voice.id === selected);
    const label = kept ? `${kept.name}（当前筛选已隐藏）` : `已选 Voice ID ${selected.slice(0, 8)}…`;
    select.insertAdjacentHTML("afterbegin", `<option value="${escapeHtml(selected)}">${escapeHtml(label)}</option>`);
    select.value = selected;
    ctx.state.voiceId = selected;
  } else if (voices.length === 1) {
    select.value = voices[0].id;
    ctx.state.voiceId = voices[0].id;
  }
}

function platformFolderName(platform = "") {
  const raw = String(platform || "").replace(/\s+/g, "");
  if (/^goodnovel$/i.test(raw)) return "GoodNovel";
  if (/^motonovel$/i.test(raw)) return "MotoNovel";
  if (/^novelmaster$/i.test(raw)) return "NovelMaster";
  return "未分平台";
}

function localNovelAudioDirHint(novel) {
  const platform = platformFolderName(novel?.platform);
  const book = String(novel?.title || "小说名").trim() || "小说名";
  return `F:\\音频目录\\${platform}\\${book}`;
}

function writeTargetAudioGroups(groups = []) {
  const list = Array.isArray(groups) ? groups : [];
  const typed = list.some((group) => group.kind);
  if (!typed) return list.filter((group) => !group.rootOnly);
  return list.filter((group) => group.kind === "book" || group.kind === "legacy");
}

function formatWriteAudioGroupLabel(group) {
  const platform = group.platform && group.kind === "book" ? `${group.platform} / ` : "";
  return `${platform}${group.name || group.id}（${Number(group.totalAssets) || 0} 条）`;
}

async function loadAudioGroups(ctx) {
  const select = ctx.elements.audioGroupSelect;
  if (!select) return;
  try {
    const data = await ctx.api(`/api/audio-groups?t=${Date.now()}`);
    ctx.state.audioGroups = Array.isArray(data.groups) ? data.groups : [];
    const current = ctx.elements.audioDir?.value.trim() || "";
    const folders = writeTargetAudioGroups(ctx.state.audioGroups);
    select.innerHTML = [
      `<option value="__novel__">按平台和书名自动建文件夹</option>`,
      ...folders.map((group) => `<option value="${escapeAttr(group.path)}">${escapeHtml(formatWriteAudioGroupLabel(group))}</option>`)
    ].join("");
    const matched = folders.find((group) => group.path === current);
    select.value = matched ? matched.path : "__novel__";
    applyAudioGroupSelection(ctx);
    if (ctx.elements.audioGroupHint) {
      ctx.elements.audioGroupHint.textContent = `默认写到 ${localNovelAudioDirHint(ctx.getNovel?.())}。线上点配音后，工人机会自动建文件夹。`;
    }
  } catch {
    if (ctx.elements.audioGroupHint) ctx.elements.audioGroupHint.textContent = "读取本机音频目录失败时，会按平台和书名在 F:\\音频目录 下自动建文件夹。";
  }
}

function applyAudioGroupSelection(ctx) {
  const value = ctx.elements.audioGroupSelect?.value || "__novel__";
  if (ctx.elements.audioDir) ctx.elements.audioDir.value = value;
}

function selectedPreviewUrl(ctx) {
  return ctx.elements.voiceSelect?.selectedOptions[0]?.dataset.previewUrl || "";
}

function previewAudioSrc(ctx, voiceId) {
  const listed = selectedPreviewUrl(ctx);
  if (listed) return listed;
  if (selectedTtsProvider(ctx) === "kokoro" || /^[ab][mf]_/.test(voiceId)) {
    return `/kokoro-previews/${encodeURIComponent(voiceId)}.mp3`;
  }
  return `/api/elevenlabs/voices/${encodeURIComponent(voiceId)}/preview`;
}

function previewErrorText(ctx, error) {
  const text = String(error?.message || "").trim();
  if (/no supported source|NotSupportedError|NotAllowedError|failed to load/i.test(text)) {
    return selectedTtsProvider(ctx) === "kokoro"
      ? "这条 Kokoro 试听还没准备好。可以换一个音色，或直接生成一条听效果。"
      : "试听文件打不开，请换一个声音再试。";
  }
  return text || "试听失败。";
}

function stopVoicePreview(ctx) {
  const audio = ctx.elements.voicePreview;
  if (!audio) return;
  if (!audio.paused) audio.pause();
  audio.currentTime = 0;
  if (ctx.elements.previewVoiceButton) ctx.elements.previewVoiceButton.textContent = "试听";
}

async function previewSelectedVoice(ctx) {
  const voiceId = selectedVoiceId(ctx);
  if (!voiceId) return ctx.setStatus?.("请先选择声音，或填写 Voice ID。", "error");
  const audio = ctx.elements.voicePreview;
  if (!audio) return;
  if (!audio.paused) {
    stopVoicePreview(ctx);
    return;
  }
  ctx.elements.previewVoiceButton.disabled = true;
  ctx.elements.previewVoiceButton.textContent = "试听中...";
  try {
    audio.src = previewAudioSrc(ctx, voiceId);
    await audio.play();
    ctx.elements.previewVoiceButton.textContent = "停止";
    ctx.setStatus?.("正在试听所选声音。");
  } catch (error) {
    stopVoicePreview(ctx);
    ctx.setStatus?.(previewErrorText(ctx, error), "error");
  } finally {
    ctx.elements.previewVoiceButton.disabled = false;
  }
}

function voiceErrorText(message) {
  const text = String(message || "").trim();
  if (/not found/i.test(text)) return "声音列表接口还没加载，请重启本地服务后刷新本页。";
  return text || "读取声音失败。";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
