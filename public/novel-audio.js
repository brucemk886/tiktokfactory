import { requestAudioJob, waitForAudioJob } from "./audio-job.js";

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
  pendingList: document.querySelector("#pendingList"),
  pendingToolbar: document.querySelector("#pendingToolbar"),
  generatePendingButton: document.querySelector("#generatePendingBtn"),
  pendingStatus: document.querySelector("#pendingStatus"),
  speakOpeningTitle: document.querySelector("#speakOpeningTitle"),
  voiceLanguage: document.querySelector("#voiceLanguage"),
  voiceCategory: document.querySelector("#voiceCategory"),
  voiceGender: document.querySelector("#voiceGender"),
  voiceAge: document.querySelector("#voiceAge"),
  voiceSelect: document.querySelector("#voiceSelect"),
  voiceIdInput: document.querySelector("#voiceIdInput"),
  audioDir: document.querySelector("#audioDir"),
  audioGroupSelect: document.querySelector("#audioGroupSelect"),
  audioGroupHint: document.querySelector("#audioGroupHint"),
  uploadAudioButton: document.querySelector("#uploadAudioBtn"),
  uploadAudioTopButton: document.querySelector("#uploadAudioTopBtn"),
  uploadAudioPanelButton: document.querySelector("#uploadAudioPanelBtn"),
  uploadAudioInput: document.querySelector("#uploadAudioInput"),
  uploadStatus: document.querySelector("#uploadStatus"),
  speechSpeed: document.querySelector("#speechSpeed"),
  speechSpeedValue: document.querySelector("#speechSpeedValue"),
  reloadVoicesButton: document.querySelector("#reloadVoicesBtn"),
  previewVoiceButton: document.querySelector("#previewVoiceBtn"),
  voicePreview: document.querySelector("#voicePreview"),
  audioStatus: document.querySelector("#audioStatus"),
  recordList: document.querySelector("#recordList"),
  recordEmpty: document.querySelector("#recordEmpty"),
  recordCount: document.querySelector("#recordCount"),
  recordStatus: document.querySelector("#recordStatus")
};

const state = {
  novelId: params.get("novel") || "",
  novel: readStashedNovel(),
  voices: [],
  audioGroups: [],
  voiceId: ""
};

elements.saveMixAudiosButton?.addEventListener("click", saveMixAudios);
elements.generatePendingButton?.addEventListener("click", () => generatePendingAudios());
elements.speakOpeningTitle?.addEventListener("change", () => {
  localStorage.setItem("lf-speak-opening-title", elements.speakOpeningTitle.checked ? "1" : "0");
  elements.pendingList?.querySelectorAll("[data-speak-title]").forEach((input) => {
    input.checked = elements.speakOpeningTitle.checked;
  });
});
elements.reloadVoicesButton?.addEventListener("click", () => loadAudioControls(true));
elements.previewVoiceButton?.addEventListener("click", previewSelectedVoice);
elements.voiceLanguage?.addEventListener("change", () => renderVoiceOptions());
elements.voiceCategory?.addEventListener("change", () => renderVoiceOptions());
elements.voiceGender?.addEventListener("change", () => renderVoiceOptions());
elements.voiceAge?.addEventListener("change", () => renderVoiceOptions());
elements.voiceSelect?.addEventListener("change", () => {
  stopVoicePreview();
  persistAudioSettings();
});
elements.voiceIdInput?.addEventListener("change", () => {
  stopVoicePreview();
  persistAudioSettings();
});
elements.audioGroupSelect?.addEventListener("change", () => {
  applyAudioGroupSelection();
  persistAudioSettings();
});
elements.uploadAudioButton?.addEventListener("click", () => startAudioUpload());
elements.uploadAudioTopButton?.addEventListener("click", () => startAudioUpload());
elements.uploadAudioPanelButton?.addEventListener("click", () => startAudioUpload());
elements.uploadAudioInput?.addEventListener("change", () => {
  const files = Array.from(elements.uploadAudioInput.files || []);
  elements.uploadAudioInput.value = "";
  uploadExistingAudios(files);
});
elements.speechSpeed?.addEventListener("input", updateSpeechSpeedLabel);
elements.speechSpeed?.addEventListener("change", persistAudioSettings);
elements.voicePreview?.addEventListener("ended", () => {
  if (elements.previewVoiceButton) elements.previewVoiceButton.textContent = "试听";
});
elements.voicePreview?.addEventListener("pause", () => {
  if (elements.voicePreview.ended || elements.voicePreview.currentTime === 0) {
    if (elements.previewVoiceButton) elements.previewVoiceButton.textContent = "试听";
  }
});
if (elements.speakOpeningTitle) elements.speakOpeningTitle.checked = false;
loadPage();
loadAudioControls();
loadAudioGroups();

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
  if (location.hash === "#upload") {
    document.querySelector(".upload-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function scriptHasAudio(script) {
  return Boolean(String(script?.audioId || script?.audio?.id || "").trim());
}

function renderNovel(novel) {
  const scripts = novel.scripts || [];
  const pending = scripts.filter((script) => !scriptHasAudio(script));
  const audios = scripts.filter(scriptHasAudio);
  elements.pageTitle.textContent = novel.title;
  elements.pageLead.textContent = "改写页保存的文案在这里配音。也可以直接上传已经做好的 mp3。没点保存的预览不会出现。";
  elements.summary.hidden = false;
  elements.summary.innerHTML = [
    novel.platform,
    novel.category,
    `${pending.length} 条待配音`,
    `${audios.length} 条已配音开头`,
    `${formatNumber(novel.performance?.videoCount || 0)} 条视频`,
    `${formatNumber(novel.performance?.totalViews || 0)} 播放`
  ].filter(Boolean).map((value) => `<span>${escapeHtml(value)}</span>`).join("");
  renderPending(pending, novel);
  renderVoiced(audios, novel);
}

function renderPending(pending, novel) {
  if (elements.pendingToolbar) elements.pendingToolbar.hidden = !pending.length;
  if (!pending.length) {
    elements.pendingList.innerHTML = `<div class="empty-state"><strong>还没有待配音文案</strong><span>先到改写页生成并保存开头。<a href="/novel-rewrite?novel=${encodeURIComponent(novel.id)}">去改写</a></span></div>`;
    return;
  }
  const speakDefault = elements.speakOpeningTitle?.checked === true;
  elements.pendingList.innerHTML = pending.map((script) => `
    <article class="audio-card pending-card" data-script-id="${escapeHtml(script.id)}">
      <div class="pending-head">
        <div>
          <h2>${escapeHtml(script.versionLabel || script.title || "未命名版本")}</h2>
          <p>${escapeHtml(sourceLabel(script.sourceType))} · ${escapeHtml(formatDate(script.createdAt))} · 待配音</p>
        </div>
        <div class="pending-actions">
          <label class="mix-check">
            <input type="checkbox" data-pending-id="${escapeHtml(script.id)}" checked />
            选中配音
          </label>
          <button class="quiet-action" type="button" data-generate-id="${escapeHtml(script.id)}">生成音频</button>
          <button class="quiet-action" type="button" data-upload-script="${escapeHtml(script.id)}">上传音频</button>
          <button class="quiet-action delete-script" type="button" data-delete-id="${escapeHtml(script.id)}">删除文案</button>
          <button class="quiet-action" type="button" data-edit-id="${escapeHtml(script.id)}">修改文案</button>
          <button class="quiet-action" type="button" data-copy-id="${escapeHtml(script.id)}">一键复制文案</button>
          <button class="quiet-action" type="button" data-save-id="${escapeHtml(script.id)}" hidden>保存文案</button>
          <button class="quiet-action" type="button" data-cancel-id="${escapeHtml(script.id)}" hidden>取消</button>
        </div>
      </div>
      <div class="pending-title-block">
        <span class="hook-title">开头标题</span>
        <div class="pending-title-row">
          <input class="pending-title" type="text" maxlength="80" data-opening-title value="${escapeHtml(script.openingTitle || "")}" readonly />
          <label class="speak-title-check">
            <input type="checkbox" data-speak-title ${speakDefault ? "checked" : ""} />
            标题也配音
          </label>
        </div>
      </div>
      <textarea class="script-full pending-script" data-script-text readonly>${escapeHtml(script.text || "")}</textarea>
    </article>`).join("");
  elements.pendingList.querySelectorAll("[data-generate-id]").forEach((button) => {
    button.addEventListener("click", () => generatePendingAudios([button.dataset.generateId]));
  });
  elements.pendingList.querySelectorAll("[data-upload-script]").forEach((button) => {
    button.addEventListener("click", () => pickAndUploadAudios([button.dataset.uploadScript]));
  });
  elements.pendingList.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", () => deletePendingScript(button.dataset.deleteId));
  });
  elements.pendingList.querySelectorAll("[data-edit-id]").forEach((button) => {
    button.addEventListener("click", () => beginPendingEdit(button.dataset.editId));
  });
  elements.pendingList.querySelectorAll("[data-save-id]").forEach((button) => {
    button.addEventListener("click", () => savePendingScript(button.dataset.saveId));
  });
  elements.pendingList.querySelectorAll("[data-cancel-id]").forEach((button) => {
    button.addEventListener("click", () => cancelPendingEdit(button.dataset.cancelId));
  });
  elements.pendingList.querySelectorAll("[data-copy-id]").forEach((button) => {
    button.addEventListener("click", () => copyPendingScript(button.dataset.copyId, button));
  });
}

function renderVoiced(audios, novel) {
  if (!audios.length) {
    if (elements.mixToolbar) elements.mixToolbar.hidden = true;
    elements.listStatus.textContent = "";
    elements.audioList.innerHTML = `<div class="empty-state"><strong>这本还没有已配音的开头</strong><span>先把上面的待配音文案生成音频。</span></div>`;
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
  elements.audioList.querySelectorAll("[data-reupload-id]").forEach((button) => {
    button.addEventListener("click", () => reuploadPlayback(button.dataset.reuploadId, button));
  });
  elements.audioList.querySelectorAll("[data-delete-voiced-id]").forEach((button) => {
    button.addEventListener("click", () => deleteVoicedScript(button.dataset.deleteVoicedId, button));
  });
  bindVoicedPlayback(elements.audioList);
  bindRetuneControls(elements.audioList);
}

function readPendingSelection(onlyIds) {
  const wanted = Array.isArray(onlyIds) && onlyIds.length ? new Set(onlyIds) : null;
  return Array.from(elements.pendingList.querySelectorAll(".pending-card")).flatMap((card) => {
    const id = card.dataset.scriptId;
    const checked = card.querySelector("[data-pending-id]")?.checked !== false;
    if (wanted ? !wanted.has(id) : !checked) return [];
    const script = (state.novel.scripts || []).find((item) => item.id === id);
    if (!script) return [];
    return [{
      card,
      script,
      text: card.querySelector("[data-script-text]")?.value.trim() || script.text || "",
      openingTitle: card.querySelector("[data-opening-title]")?.value.trim() || script.openingTitle || "",
      speakOpeningTitle: card.querySelector("[data-speak-title]")?.checked === true
    }];
  });
}

async function generatePendingAudios(onlyIds) {
  const selected = readPendingSelection(onlyIds);
  if (!selected.length) return setPendingStatus("先勾选要配音的文案。", "error");
  const voiceId = selectedVoiceId();
  const targetAudioDir = selectedAudioDir();
  if (!voiceId) {
    setPendingStatus("请先在上面「默认声音」里选一个 ElevenLabs 声音，或手动填写 Voice ID。", "error");
    setAudioStatus("还没选声音，不能生成音频。", "error");
    return;
  }
  if (elements.generatePendingButton) {
    elements.generatePendingButton.disabled = true;
    elements.generatePendingButton.textContent = `正在生成 ${selected.length} 条...`;
  }
  setPendingStatus(`正在按顺序生成 ${selected.length} 条音频...`);
  try {
    for (const item of selected) {
      const dirty = item.text !== String(item.script.text || "").trim()
        || item.openingTitle !== String(item.script.openingTitle || "").trim();
      if (dirty) await savePendingScript(item.script.id, { silent: true });
    }
    const result = await requestAudioJob("/api/audio-library/sync-local", {
      novelId: state.novelId,
      novelTitle: state.novel?.title || "",
      targetAudioDir,
      voiceId,
      speechSpeed: selectedSpeechSpeed(),
      items: selected.map((item) => ({
        novelId: state.novelId,
        novelTitle: state.novel?.title || "",
        scriptId: item.script.id,
        title: `${state.novel.title} ${item.script.versionLabel || "改写"}`,
        script: item.text || item.script.text,
        openingTitle: item.openingTitle,
        speakOpeningTitle: item.speakOpeningTitle,
        voiceId,
        speechSpeed: selectedSpeechSpeed(),
        sourceType: item.script.sourceType || "ai-style-rewrite"
      }))
    }, { api, onProgress: (job) => setPendingStatus(job.message || "工人机正在依次配音...") });
    const saved = Array.isArray(result.items) ? result.items.length : 0;
    const refreshed = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}`);
    state.novel = refreshed.novel;
    renderNovel(state.novel);
    setPendingStatus(saved ? `已生成 ${saved} 条音频，可直接在网页试听。` : "工人机没有返回已生成的音频。", saved ? "ok" : "error");
    setAudioStatus(result.targetAudioDir ? `本机也写到了 ${result.targetAudioDir}` : "已写入本机音频目录。", saved ? "ok" : "");
  } catch (error) {
    setPendingStatus(error.message || "生成音频失败。", "error");
    setAudioStatus(error.message || "生成音频失败。", "error");
  } finally {
    if (elements.generatePendingButton) {
      elements.generatePendingButton.disabled = false;
      elements.generatePendingButton.textContent = "一键生成勾选音频";
    }
  }
}

function pendingCard(scriptId) {
  return elements.pendingList?.querySelector(`.pending-card[data-script-id="${CSS.escape(scriptId)}"]`);
}

function setPendingEditMode(card, editing) {
  if (!card) return;
  card.classList.toggle("is-editing", editing);
  const textarea = card.querySelector("[data-script-text]");
  const title = card.querySelector("[data-opening-title]");
  if (textarea) textarea.readOnly = !editing;
  if (title) title.readOnly = !editing;
  const edit = card.querySelector("[data-edit-id]");
  const save = card.querySelector("[data-save-id]");
  const cancel = card.querySelector("[data-cancel-id]");
  if (edit) edit.hidden = editing;
  if (save) save.hidden = !editing;
  if (cancel) cancel.hidden = !editing;
  if (editing) textarea?.focus();
}

function beginPendingEdit(scriptId) {
  const card = pendingCard(scriptId);
  if (!card) return;
  const textarea = card.querySelector("[data-script-text]");
  const title = card.querySelector("[data-opening-title]");
  if (textarea) textarea.dataset.originalText = textarea.value;
  if (title) title.dataset.originalTitle = title.value;
  setPendingEditMode(card, true);
}

function cancelPendingEdit(scriptId) {
  const card = pendingCard(scriptId);
  if (!card) return;
  const textarea = card.querySelector("[data-script-text]");
  const title = card.querySelector("[data-opening-title]");
  if (textarea && Object.hasOwn(textarea.dataset, "originalText")) textarea.value = textarea.dataset.originalText;
  if (title && Object.hasOwn(title.dataset, "originalTitle")) title.value = title.dataset.originalTitle;
  setPendingEditMode(card, false);
}

async function savePendingScript(scriptId, { silent = false } = {}) {
  const card = pendingCard(scriptId);
  if (!card) return;
  const text = card.querySelector("[data-script-text]")?.value.trim() || "";
  const openingTitle = card.querySelector("[data-opening-title]")?.value.trim() || "";
  const speakOpeningTitle = card.querySelector("[data-speak-title]")?.checked === true;
  if (text.length < 20) {
    if (!silent) setPendingStatus("改写文案至少需要 20 个字符。", "error");
    throw new Error("改写文案至少需要 20 个字符。");
  }
  if (!silent) setPendingStatus("正在保存文案...");
  try {
    const data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}/scripts/${encodeURIComponent(scriptId)}`, {
      method: "PATCH",
      body: JSON.stringify({ text, openingTitle, speakOpeningTitle, kept: true })
    });
    if (data.novel) state.novel = data.novel;
    else if (data.script && Array.isArray(state.novel?.scripts)) {
      state.novel.scripts = state.novel.scripts.map((item) => item.id === data.script.id ? { ...item, ...data.script } : item);
    }
    setPendingEditMode(card, false);
    if (!silent) {
      renderNovel(state.novel);
      setPendingStatus("文案已保存。", "ok");
    }
  } catch (error) {
    if (!silent) setPendingStatus(error.message || "保存文案失败。", "error");
    throw error;
  }
}

async function copyPendingScript(scriptId, button) {
  const card = pendingCard(scriptId);
  const text = card?.querySelector("[data-script-text]")?.value.trim()
    || (state.novel?.scripts || []).find((item) => item.id === scriptId)?.text
    || "";
  if (!text) return setPendingStatus("这条还没有文案可复制。", "error");
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const textarea = card?.querySelector("[data-script-text]");
      textarea?.removeAttribute("readonly");
      textarea?.select();
      document.execCommand("copy");
      textarea?.setAttribute("readonly", "");
    }
    if (button) {
      const label = button.textContent;
      button.textContent = "已复制";
      setTimeout(() => {
        if (button.textContent === "已复制") button.textContent = label;
      }, 1600);
    }
    setPendingStatus("已复制整段文案。", "ok");
  } catch (error) {
    setPendingStatus(error.message || "复制失败，请手动选中文案。", "error");
  }
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

async function deletePendingScript(scriptId) {
  if (!scriptId) return;
  setPendingStatus("正在删除这条未配音文案...");
  try {
    const data = await api(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}/prune-drafts`, {
      method: "POST",
      body: JSON.stringify({ scriptIds: [scriptId] })
    });
    state.novel = data.novel;
    renderNovel(state.novel);
    setPendingStatus("已删除这条文案。", "ok");
  } catch (error) {
    setPendingStatus(error.message || "删除失败。", "error");
  }
}

function setPendingStatus(message, tone = "") {
  if (!elements.pendingStatus) return;
  elements.pendingStatus.textContent = message;
  elements.pendingStatus.className = tone === "ok" ? "is-ok" : tone === "error" ? "is-error" : "";
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
  return `
    <article class="audio-card${script.mixEnabled === false ? " is-off" : ""}" data-voiced-id="${escapeHtml(script.id)}">
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
          <button class="quiet-action" type="button" data-reupload-id="${escapeHtml(script.id)}">传到网页试听</button>
          <a class="quiet-action" href="/novel-rewrite?novel=${encodeURIComponent(state.novelId)}">去改写</a>
          <button class="quiet-action delete-script" type="button" data-delete-voiced-id="${escapeHtml(script.id)}">删除</button>
        </div>
      </div>
      <audio controls preload="metadata" data-audio-id="${escapeHtml(audioId)}" src="/api/audio-library/${encodeURIComponent(audioId)}/file?t=${Date.now()}"></audio>
      <div class="retune-row">
        <label>已生成变速 <em data-retune-label>${formatSpeed(audio.playbackSpeed)}</em>
          <input type="range" min="0.8" max="1.4" step="0.05" value="${escapeHtml(String(currentSpeed(audio.playbackSpeed)))}" data-retune-range />
        </label>
        <button type="button" class="quiet-action" data-retune-id="${escapeHtml(audioId)}">应用变速</button>
        <small>按原始音频变速，不会越调越快。太慢可拉到 1.10×–1.25×。</small>
      </div>
      ${script.sourceType === "peer-hit" ? peerHitStats(script) : `<div class="metric-row">
        ${metric("播放", formatNumber(performance.totalViews))}
        ${metric("视频", formatNumber(performance.videoCount))}
        ${metric("账号", formatNumber(performance.accountCount))}
        ${metric("前3秒留存", formatPercent(performance.retentionAt3))}
        ${metric("完播率", formatPercent(performance.fullWatchRate))}
        ${metric("均看时长", formatSeconds(performance.averageTimeWatched))}
      </div>`}
      ${script.openingTitle ? `<p class="hook-title">${escapeHtml(script.openingTitle)}</p>` : ""}
      <p class="script-full">${escapeHtml(script.text || "")}</p>
    </article>`;
}

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><b>${value}</b></div>`;
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

async function loadAudioControls(force = false) {
  try {
    if (force) setAudioStatus("正在重新读取 ElevenLabs 声音...");
    const [settingsData, voicesData] = await Promise.all([
      api("/api/novel-content/seed-settings").catch(() => ({ settings: {} })),
      api("/api/elevenlabs/voices").catch((error) => ({ error: voiceErrorText(error.message), voices: [], defaultVoiceId: "" }))
    ]);
    const settings = settingsData.settings || {};
    state.voices = voicesData.voices || [];
    const selected = settings.voiceId || voicesData.defaultVoiceId || state.voiceId || "";
    if (selected) state.voiceId = selected;
    fillFilterSelect(elements.voiceLanguage, voicesData.filters?.languages, "全部语言");
    fillFilterSelect(elements.voiceCategory, voicesData.filters?.categories, "全部类别");
    fillFilterSelect(elements.voiceGender, voicesData.filters?.genders, "全部性别");
    fillFilterSelect(elements.voiceAge, voicesData.filters?.ages, "全部年龄");
    if (voicesData.error && !state.voices.length) {
      if (elements.voiceSelect) elements.voiceSelect.innerHTML = `<option value="">${escapeHtml(voicesData.error)}</option>`;
      if (elements.voiceIdInput) elements.voiceIdInput.value = selected;
      setAudioStatus(voicesData.error, "error");
    } else {
      renderVoiceOptions(selected);
      if (selected && !state.voices.some((voice) => voice.id === selected) && elements.voiceIdInput) {
        elements.voiceIdInput.value = selected;
      }
      setAudioStatus(voicesData.warning || (state.voices.length ? `已读取 ${state.voices.length} 个声音。` : ""), voicesData.warning && !state.voices.length ? "error" : "");
    }
    if (settings.targetAudioDir && elements.audioDir) {
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
    const current = elements.audioDir?.value.trim() || "";
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
  if (elements.audioDir) elements.audioDir.value = value;
}

function selectedAudioDir() {
  applyAudioGroupSelection();
  return elements.audioDir?.value.trim() || "";
}

function selectedVoiceId() {
  const current = elements.voiceSelect?.value.trim() || elements.voiceIdInput?.value.trim() || state.voiceId || "";
  if (current) state.voiceId = current;
  return current;
}

function selectedSpeechSpeed() {
  return Number(elements.speechSpeed?.value) || 1;
}

function updateSpeechSpeedLabel() {
  if (elements.speechSpeedValue) elements.speechSpeedValue.textContent = `${selectedSpeechSpeed().toFixed(2)}×`;
}

function fillFilterSelect(select, options, emptyLabel) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = [`<option value="">${emptyLabel}</option>`, ...(options || []).map((item) =>
    `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`
  )].join("");
  if (current && [...select.options].some((option) => option.value === current)) select.value = current;
}

function filteredVoices() {
  const language = elements.voiceLanguage?.value.trim() || "";
  const category = elements.voiceCategory?.value.trim() || "";
  const gender = elements.voiceGender?.value.trim() || "";
  const age = elements.voiceAge?.value.trim() || "";
  return state.voices.filter((voice) => {
    if (language && !(voice.languages || []).includes(language)) return false;
    if (category && voice.category !== category) return false;
    if (gender && voice.gender !== gender) return false;
    if (age && voice.age !== age) return false;
    return true;
  });
}

function renderVoiceOptions(preferredId = "") {
  if (!elements.voiceSelect) return;
  const selected = preferredId || selectedVoiceId();
  const voices = filteredVoices();
  elements.voiceSelect.innerHTML = [`<option value="">${voices.length ? "请选择声音" : "当前筛选没有声音"}</option>`, ...voices.map((voice) => {
    const meta = [voice.languageLabels?.[0], voice.genderLabel, voice.ageLabel, voice.categoryLabel].filter(Boolean).join(" · ");
    return `<option value="${escapeHtml(voice.id)}" data-preview-url="${escapeHtml(voice.previewUrl || "")}">${escapeHtml(voice.name)}${meta ? ` · ${escapeHtml(meta)}` : ""}</option>`;
  })].join("");
  if (selected && voices.some((voice) => voice.id === selected)) {
    elements.voiceSelect.value = selected;
    state.voiceId = selected;
  } else if (selected) {
    const kept = state.voices.find((voice) => voice.id === selected);
    const label = kept ? `${kept.name}（当前筛选已隐藏）` : `已选 Voice ID ${selected.slice(0, 8)}…`;
    elements.voiceSelect.insertAdjacentHTML("afterbegin", `<option value="${escapeHtml(selected)}">${escapeHtml(label)}</option>`);
    elements.voiceSelect.value = selected;
    state.voiceId = selected;
  } else if (voices.length === 1) {
    elements.voiceSelect.value = voices[0].id;
    state.voiceId = voices[0].id;
  }
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
    if (selectedVoiceId()) setAudioStatus("已记住为默认配音。", "ok");
  } catch (error) {
    setAudioStatus(error.message, "error");
  }
}

function selectedPreviewUrl() {
  return elements.voiceSelect?.selectedOptions[0]?.dataset.previewUrl || "";
}

function stopVoicePreview() {
  const audio = elements.voicePreview;
  if (!audio) return;
  if (!audio.paused) audio.pause();
  audio.currentTime = 0;
  if (elements.previewVoiceButton) elements.previewVoiceButton.textContent = "试听";
}

async function previewSelectedVoice() {
  const voiceId = selectedVoiceId();
  if (!voiceId) return setAudioStatus("请先选择声音，或填写 Voice ID。", "error");
  const audio = elements.voicePreview;
  if (!audio) return;
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

function startAudioUpload(scriptIds) {
  if (!elements.uploadAudioInput) return;
  elements.uploadAudioInput.dataset.scriptIds = Array.isArray(scriptIds) ? scriptIds.join(",") : "";
  elements.uploadAudioInput.click();
}

function pickAndUploadAudios(scriptIds) {
  startAudioUpload(scriptIds);
}

function setUploadButtonsBusy(busy) {
  for (const button of [elements.uploadAudioButton, elements.uploadAudioTopButton, elements.uploadAudioPanelButton]) {
    if (!button) continue;
    button.disabled = busy;
    if (button === elements.uploadAudioPanelButton) button.textContent = busy ? "正在上传..." : "选择 mp3 上传";
    else button.textContent = busy ? "正在上传..." : "上传音频";
  }
}

async function uploadExistingAudios(fileList, onlyScriptIds) {
  const files = Array.from(fileList || []).filter((file) => /\.mp3$/i.test(file.name || "") || /audio\/mpeg|audio\/mp3/i.test(file.type || ""));
  if (!files.length) return setAudioStatus("请选择 mp3 文件。", "error");
  if (!state.novelId) return setAudioStatus("请先打开一本小说。", "error");
  setUploadButtonsBusy(true);
  setAudioStatus(`正在上传 ${files.length} 条已有音频...`);
  try {
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    const scriptIds = Array.isArray(onlyScriptIds) && onlyScriptIds.length
      ? onlyScriptIds
      : String(elements.uploadAudioInput?.dataset.scriptIds || "").split(",").map((id) => id.trim()).filter(Boolean);
    scriptIds.forEach((id) => form.append("scriptIds", id));
    form.append("targetAudioDir", selectedAudioDir() || "__novel__");
    form.append("novelTitle", state.novel?.title || "");
    const data = await apiUpload(`/api/novel-content/novels/${encodeURIComponent(state.novelId)}/import-audio`, form);
    if (elements.uploadAudioInput) elements.uploadAudioInput.dataset.scriptIds = "";
    state.novel = data.novel;
    renderNovel(state.novel);
    setAudioStatus(data.message || `已上传 ${data.count || files.length} 条，可直接试听。`, "ok");
    if (data.jobId) {
      waitForAudioJob(data.jobId, {
        api,
        onProgress: (job) => setAudioStatus(job.message || "工人机正在写到本机目录...")
      }).then((result) => {
        setAudioStatus(result?.targetAudioDir ? `已上传到网页，本机也写到了 ${result.targetAudioDir}` : "已上传到网页。", "ok");
      }).catch((error) => {
        setAudioStatus(error.message || "网页已可试听，本机目录稍后写入。", "error");
      });
    }
  } catch (error) {
    setAudioStatus(error.message || "上传音频失败。", "error");
  } finally {
    setUploadButtonsBusy(false);
  }
}

async function apiUpload(url, form) {
  const response = await fetch(url, { method: "POST", body: form, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败：${response.status}`);
  return body;
}

function setAudioStatus(message, tone = "") {
  const className = tone === "ok" ? "list-status is-ok" : tone === "error" ? "list-status is-error" : "list-status";
  if (elements.audioStatus) {
    elements.audioStatus.textContent = message;
    elements.audioStatus.className = className;
  }
  if (elements.uploadStatus) {
    elements.uploadStatus.textContent = message;
    elements.uploadStatus.className = className;
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
function escapeAttr(value) { return escapeHtml(value).replace(/"/g, "&quot;"); }

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
