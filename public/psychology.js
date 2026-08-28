const $ = (selector) => document.querySelector(selector);
let phones = [];
let settingsConfigured = false;
let previewTaskId = "";
let generationMode = "batch";
let batchTopics = [];
const selectedBatchTopicIds = new Set();

initAiPreviewControls();
attachDirectoryPickers();

$("#createBtn").addEventListener("click", createTask);
$("#saveSettingsBtn").addEventListener("click", () => saveSettings(true));
$("#refreshPhonesBtn").addEventListener("click", loadPhones);
$("#refreshTasksBtn").addEventListener("click", loadTasks);
$("#groupFilter").addEventListener("change", renderPhones);
$("#nameFilter").addEventListener("input", renderPhones);
$("#selectVisibleBtn").addEventListener("click", selectVisible);
$("#phoneList").addEventListener("change", updateSelectedCount);
$("#taskList").addEventListener("click", handleTaskAction);
$("#aspectRatio").addEventListener("change", handleAspectChange);

setDefaultSchedule();
loadSettings();
loadPhones();
loadTasks();
loadPreparedContent();
initTopicSelection();

function initAiPreviewControls() {
  const narrationActions = document.createElement("div");
  narrationActions.className = "ai-field-actions";
  narrationActions.innerHTML = '<button id="generateNarrationBtn" class="ai-generate-button" type="button">AI 生成解说文案</button><span id="narrationCost">生成后可直接修改</span>';
  $("#narration").parentElement.append(narrationActions);

  const promptActions = document.createElement("div");
  promptActions.className = "ai-field-actions";
  promptActions.innerHTML = '<button id="generateImagePromptBtn" class="ai-generate-button" type="button">AI 生成生图描述</button><span id="imagePromptCost">生成后可直接修改</span>';
  $("#imagePrompt").parentElement.append(promptActions);

  const previewSection = document.createElement("article");
  previewSection.className = "psy-section preview-section";
  previewSection.innerHTML = `
    <div class="preview-copy">
      <p class="eyebrow">PREVIEW</p>
      <h2>生成效果预览</h2>
      <p>固定生成 1 条本地视频，不选择账号、不提交 GeeLark。预览会使用当前勾选的第一个生图模型。</p>
      <div class="preview-actions">
        <button id="previewBtn" type="button">生成一条预览视频</button>
        <span id="previewStatus">尚未生成预览</span>
      </div>
    </div>
    <div class="preview-player-wrap">
      <video id="previewVideo" controls playsinline preload="metadata"></video>
      <div id="previewEmpty" class="preview-empty">生成完成后在这里播放</div>
    </div>`;
  document.querySelectorAll(".psy-section")[1].insertAdjacentElement("afterend", previewSection);

  $("#generateNarrationBtn").addEventListener("click", () => generateAiField("narration"));
  $("#generateImagePromptBtn").addEventListener("click", () => generateAiField("image-prompt"));
  $("#previewBtn").addEventListener("click", createPreview);
  updatePreviewAspect();
}

function updatePreviewAspect() {
  const player = $(".preview-player-wrap");
  const landscape = $("#aspectRatio").value === "16:9";
  if (player) player.classList.toggle("is-landscape", landscape);
  const title = $("#aspectPromptTitle");
  const hint = $("#aspectPromptHint");
  if (title) title.textContent = landscape ? "当前：横版 16:9" : "当前：竖版 9:16";
  if (hint) hint.textContent = landscape
    ? "AI 将生成 A/B/C/D 四图横排描述，视频使用 Remotion 横版模板。"
    : "AI 将生成四宫格竖版描述。";
  const prompt = $("#imagePrompt");
  if (prompt) {
    prompt.placeholder = landscape
      ? "AI 会生成无文字、A/B/C/D 四图横向排列的心理测试图片描述"
      : "AI 会生成无文字、四宫格心理测试图片描述";
  }
}

function handleAspectChange() {
  const prompt = $("#imagePrompt");
  const landscape = $("#aspectRatio").value === "16:9";
  const generatedAspect = prompt?.dataset.generatedAspect || "";
  const incompatible = landscape
    ? /(9:16|vertical|2\s*[x×]\s*2|top third|space near the top)/i.test(prompt?.value || "")
    : /(16:9|landscape|horizontal row|left to right|each quarter)/i.test(prompt?.value || "");
  if (prompt?.value.trim() && ((generatedAspect && generatedAspect !== $("#aspectRatio").value) || incompatible)) {
    prompt.value = "";
    delete prompt.dataset.generatedAspect;
    const cost = $("#imagePromptCost");
    if (cost) cost.textContent = `已切换为${landscape ? "横版" : "竖版"}，请重新生成描述`;
  }
  updatePreviewAspect();
}
async function generateAiField(mode) {
  const question = $("#question").value.trim();
  if (!question) {
    setStatus("请先填写心理测试题目。", true);
    return "";
  }
  const button = mode === "narration" ? $("#generateNarrationBtn") : $("#generateImagePromptBtn");
  const target = mode === "narration" ? $("#narration") : $("#imagePrompt");
  const cost = mode === "narration" ? $("#narrationCost") : $("#imagePromptCost");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "AI 生成中...";
  cost.textContent = "正在调用 Gemini 3.5 Flash";
  try {
    const response = await fetch("/api/kie-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "chat", prompt: psychologyPrompt(mode) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "AI 生成失败");
    target.value = mode === "narration" ? normalizeHookNarration(data.task?.resultText) : String(data.task?.resultText || "").trim();
    if (mode !== "narration") target.dataset.generatedAspect = $("#aspectRatio").value;
    if (!target.value) throw new Error("AI 没有返回可用内容");
    const credits = Number(data.task?.creditsConsumed || 0);
    cost.textContent = `Gemini 3.5 Flash · 本次 ${formatCredits(credits)} 积分 · 可继续修改`;
    setStatus(mode === "narration" ? "解说文案已生成，可以修改后再预览。" : "生图描述已生成，可以修改后再预览。");
    return target.value;
  } catch (error) {
    cost.textContent = error.message || "生成失败";
    setStatus(error.message || "AI 生成失败", true);
    throw error;
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function attachDirectoryPickers() {
  document.querySelectorAll("[data-pick-directory]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = document.getElementById(button.dataset.pickDirectory);
      if (!target) return;
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = "选择中...";
      try {
        const response = await fetch("/api/select-directory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initialPath: target.value.trim(), title: "选择背景音乐文件夹" })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "打开目录选择失败");
        if (data.path) target.value = data.path;
      } catch (error) {
        setStatus(error.message || "打开目录选择失败", true);
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
    });
  });
}

function normalizeHookNarration(value) {
  const source = String(value || "").replace(/^[\s"“”']+|[\s"“”']+$/g, "").replace(/\s+/g, " ").trim();
  if (!source) return "";
  const sentences = source.match(/[^.!?。！？]+[.!?。！？]?/g)?.map((item) => item.trim()).filter(Boolean) || [source];
  const concise = sentences.slice(0, 2).join(" ");
  const words = concise.split(/\s+/);
  if (words.length > 36) return `${words.slice(0, 36).join(" ").replace(/[,:;.!?]+$/g, "")}.`;
  return /[.!?。！？]$/.test(concise) ? concise : `${concise}.`;
}
function psychologyPrompt(mode) {
  const question = $("#question").value.trim();
  const answerGuide = $("#answerGuide").value.trim();
  const landscape = $("#aspectRatio").value === "16:9";
  const aspectRatio = landscape ? "16:9 landscape" : "9:16 vertical";
  if (mode === "narration") return [
    "Write a concise English voiceover for a TikTok visual psychology test.",
    `Question: ${question}`,
    answerGuide ? `Context only: ${answerGuide}` : "Ask the viewer to inspect the image and choose instinctively.",
    "Use exactly two short natural sentences and 16 to 30 words total.",
    "Sentence one must create curiosity and ask the viewer to choose what they noticed or preferred.",
    "Sentence two must use exactly one interaction CTA. Choose one naturally: tap the link in the bottom-left to take the test, take the full test on the profile, or comment A, B, C, or D.",
    "Do not explain the result, list choice meanings, greet the viewer, add headings, labels, quotation marks, or markdown.",
    "Return only the exact voiceover ready for text-to-speech."
  ].join("\n");
  return [
    `Create one production-ready English image-generation prompt for a visual psychology test in ${aspectRatio}.`,
    `Test topic: ${question}`,
    answerGuide ? `Choice guidance: ${answerGuide}` : "Design four visually distinct choices.",
    landscape
      ? "Arrange exactly four equal choices in one horizontal row from left to right. Keep each subject centered inside its own quarter of the canvas. Use a clean light neutral background and do not leave a large title area."
      : "Arrange exactly four choices in a clean balanced 2x2 composition and leave clear space near the top for a title.",
    "The four choices must be instantly understandable from imagery alone, visually balanced, premium, high contrast, and compositionally distinct.",
    "Do not render text, letters, numbers, labels, logos, watermarks, captions, UI, borders, or typography.",
    "Return only the image prompt."
  ].join("\n");
}
async function createPreview() {
  const question = $("#question").value.trim();
  const model = selectedModels()[0];
  if (!question) return setStatus("请先填写心理测试题目。", true);
  if (!model) return setStatus("请先选择一个生图模型。", true);
  const button = $("#previewBtn");
  button.disabled = true;
  $("#previewStatus").textContent = "正在准备预览内容...";
  try {
    if (!$("#narration").value.trim()) await generateAiField("narration");
    if (!$("#imagePrompt").value.trim()) await generateAiField("image-prompt");
    const configured = await saveSettings(false);
    if (!configured) throw new Error("请先在接口配置中保存 Kie、ElevenLabs 和 Voice ID。");
    const payload = {
      taskType: "psychology",
      name: `预览 · ${question.slice(0, 32)}`,
      generation: {
        question,
        hookTitle: $("#hookTitle").value.trim() || question,
        sourceImageUrl: "",
        fallbackImageUrl: $("#sourceImageUrl").value.trim(),
        answerGuide: $("#answerGuide").value.trim(),
        narration: $("#narration").value.trim(),
        imagePrompt: $("#imagePrompt").value.trim(),
        imageModels: [model],
        totalVideos: 1,
        aspectRatio: $("#aspectRatio").value,
        titlePosition: numberValue("#titlePosition", 14),
        titleFontSize: numberValue("#titleFontSize", 68),
        motion: $("#motion").value,
        backgroundMusicDir: $("#backgroundMusicDir").value.trim(),
        backgroundMusicVolume: numberValue("#backgroundMusicVolume", 0.10),
        elevenLabsVoiceId: $("#voiceId").value.trim(),
        elevenLabsModelId: $("#voiceModel").value
      },
      publish: { autoPublish: false, envIds: [], accounts: [], videoDesc: "", scheduleAt: 0, intervalMinutes: 0, batchPublishLimit: 1, dailyPublishLimit: 300 }
    };
    const response = await fetch("/api/auto-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "预览任务创建失败");
    previewTaskId = data.task.id;
    $("#previewStatus").textContent = "已加入本地生成队列...";
    setStatus("预览任务已创建，不会发布到 GeeLark。");
    loadTasks();
    await watchPreview(previewTaskId);
  } catch (error) {
    $("#previewStatus").textContent = error.message || "预览生成失败";
    setStatus(error.message || "预览生成失败", true);
  } finally {
    button.disabled = false;
  }
}

async function watchPreview(taskId) {
  while (previewTaskId === taskId) {
    const response = await fetch(`/api/auto-tasks/${encodeURIComponent(taskId)}?t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取预览进度失败");
    const task = data.task || {};
    const percent = Math.max(0, Math.min(100, Number(task.progress?.percent) || 0));
    $("#previewStatus").textContent = `${task.message || "生成中"} ${percent}%`;
    if (task.status === "done") {
      const video = (task.generatedVideos || [])[0];
      if (!video?.videoUrl) throw new Error("预览完成，但没有找到视频文件。");
      $("#previewVideo").src = video.videoUrl;
      $("#previewVideo").classList.add("is-ready");
      $("#previewEmpty").hidden = true;
      $("#previewStatus").textContent = "预览生成完成，可播放检查";
      previewTaskId = "";
      return;
    }
    if (["failed", "canceled", "needs_attention"].includes(task.status)) throw new Error(task.error || task.message || "预览生成失败");
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
}

function formatCredits(value) {
  return Number.isFinite(value) ? value.toFixed(value < 0.1 ? 4 : 2).replace(/0+$/, "").replace(/\.$/, "") : "--";
}


async function loadPreparedContent() {
  const params = new URLSearchParams(location.search);
  const topicId = params.get("topic");
  if (topicId) {
    selectedBatchTopicIds.add(String(topicId));
    setStatus("已从心理学题库选中题目，可直接生成。");
    /* 兼容旧链接：仍载入单题草稿，但页面生成统一以勾选题库为准。 */
    try {
      const response = await fetch(`/api/psychology-topics/${encodeURIComponent(topicId)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取题目失败");
      const topic = data.topic || {};
      const optionText = (topic.options || []).map((item) => `${item.label}. ${item.text}`).join("\n");
      $("#question").value = topic.question || "";
      $("#hookTitle").value = topic.hookTitle || topic.question || "";
      $("#sourceImageUrl").value = topic.imageUrl || "";
      $("#answerGuide").value = [optionText, topic.answerGuide || ""].filter(Boolean).join("\n\n");
      $("#taskName").value = `心理学测试 · ${String(topic.question || "").slice(0, 24)}`;
      setStatus("已从心理学题库载入题目，可以继续调整并生成。");
    } catch (error) {
      setStatus(error.message || "读取题目失败", true);
    }
  }

  if (params.get("draft") === "ai") {
    try {
      const draft = JSON.parse(sessionStorage.getItem("lf_psychology_ai_draft") || "null");
      if (!draft?.content) return;
      if (draft.mode === "narration") $("#narration").value = draft.content;
      else if (draft.mode === "image-prompt") $("#imagePrompt").value = draft.content;
      else $("#answerGuide").value = draft.content;
      sessionStorage.removeItem("lf_psychology_ai_draft");
      setStatus("已载入 AI 创作结果。");
    } catch {}
  }
}

async function loadSettings() {
  try {
    const response = await fetch("/api/psychology/settings", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取配置失败");
    settingsConfigured = Boolean(data.configured);
        $("#totalVideos").value = data.totalVideos || Number(localStorage.getItem("lf_psychology_total_videos")) || 1;
$("#voiceId").value = data.elevenLabsVoiceId || "";
    $("#voiceModel").value = data.elevenLabsModelId || "eleven_multilingual_v2";
    $("#titlePosition").value = data.titlePosition || 14;
    $("#titleFontSize").value = data.titleFontSize || 68;
    $("#motion").value = data.motion || "test-motion";
    $("#aspectRatio").value = data.aspectRatio === "9:16" ? "9:16" : "16:9";
    updatePreviewAspect();
    $("#backgroundMusicDir").value = data.backgroundMusicDir || "";
    $("#backgroundMusicVolume").value = data.backgroundMusicVolume ?? 0.10;
    document.querySelectorAll('[name="imageModel"]').forEach((input) => { input.checked = (data.imageModels || ["nano-banana"]).includes(input.value); });
    $("#settingsStatus").textContent = data.configured ? "Kie、ElevenLabs 和 Voice ID 已配置。" : "请补充缺少的接口配置并保存。";
  } catch (error) {
    $("#settingsStatus").textContent = error.message;
  }
}

async function saveSettings(showMessage = false) {
  const payload = {
    kieApiKey: $("#kieApiKey").value.trim(),
    elevenLabsApiKey: $("#elevenLabsApiKey").value.trim(),
    elevenLabsVoiceId: $("#voiceId").value.trim(),
    elevenLabsModelId: $("#voiceModel").value,
    imageModels: selectedModels(),
    totalVideos: numberValue("#totalVideos", 1),
    titlePosition: numberValue("#titlePosition", 14),
    titleFontSize: numberValue("#titleFontSize", 68),
    motion: $("#motion").value,
    aspectRatio: $("#aspectRatio").value,
    backgroundMusicDir: $("#backgroundMusicDir").value.trim(),
    backgroundMusicVolume: numberValue("#backgroundMusicVolume", 0.10)
  };
  const response = await fetch("/api/psychology/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "保存配置失败");
  settingsConfigured = Boolean(data.settings?.configured);
  localStorage.setItem("lf_psychology_total_videos", String(payload.totalVideos));
  $("#kieApiKey").value = "";
  $("#elevenLabsApiKey").value = "";
  if (showMessage) $("#settingsStatus").textContent = settingsConfigured ? "生成配置已保存，刷新页面后会自动恢复。" : "生成配置已保存，但接口配置仍缺少 API Key 或 Voice ID。";
  return settingsConfigured;
}

async function createTask() {
  if (selectedBatchTopicIds.size > 1) return createBatchTasks();
  const question = $("#question").value.trim();
  const models = selectedModels();
  if (!question) return setStatus("请先输入心理测试题目。", true);
  if (!models.length) return setStatus("至少选择一个生图模型。", true);
  const selected = Array.from(document.querySelectorAll(".phone-check:checked"));
  const autoPublish = $("#autoPublish").checked;
  if (autoPublish && !selected.length) return setStatus("自动发布至少需要选择一个 GeeLark 账号。", true);
  const scheduleAt = Math.floor(new Date($("#scheduleAt").value).getTime() / 1000);
  if (autoPublish && (!scheduleAt || scheduleAt < Math.floor(Date.now() / 1000) + 300)) return setStatus("起始发布时间至少要晚于当前时间 5 分钟。", true);

  $("#createBtn").disabled = true;
  setStatus("正在保存配置并创建任务...");
  try {
    const configured = await saveSettings(false);
    if (!configured) throw new Error("请展开接口配置，填写 ElevenLabs Voice ID；Kie 和 ElevenLabs 密钥需要处于已配置状态。");
    const accounts = selected.map((input) => {
      const phone = phones.find((item) => String(item.id) === input.value) || {};
      return { id: input.value, name: phone.serialName || "", serialNo: phone.serialNo || "", groupName: phone.groupName || "", remark: phone.remark || "" };
    });
    const payload = {
      taskType: "psychology",
      name: $("#taskName").value.trim() || `心理学测试 · ${question.slice(0, 24)}`,
      generation: {
        question,
        hookTitle: $("#hookTitle").value.trim() || question,
        sourceImageUrl: "",
        fallbackImageUrl: $("#sourceImageUrl").value.trim(),
        answerGuide: $("#answerGuide").value.trim(),
        narration: $("#narration").value.trim(),
        imagePrompt: $("#imagePrompt").value.trim(),
        imageModels: models,
        totalVideos: 1,
        aspectRatio: $("#aspectRatio").value,
        titlePosition: numberValue("#titlePosition", 14),
        titleFontSize: numberValue("#titleFontSize", 68),
        motion: $("#motion").value,
        backgroundMusicDir: $("#backgroundMusicDir").value.trim(),
        backgroundMusicVolume: numberValue("#backgroundMusicVolume", 0.10),
        elevenLabsVoiceId: $("#voiceId").value.trim(),
        elevenLabsModelId: $("#voiceModel").value
      },
      publish: {
        autoPublish,
        envIds: selected.map((input) => input.value),
        accounts,
        videoDesc: $("#videoDesc").value.trim(),
        scheduleAt,
        intervalMinutes: numberValue("#intervalMinutes", 15),
        batchPublishLimit: numberValue("#batchLimit", 300),
        dailyPublishLimit: 300
      }
    };
    const response = await fetch("/api/auto-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "创建任务失败");
    setStatus(`已加入队列：${data.task.name}`);
    loadTasks();
  } catch (error) {
    setStatus(error.message || "创建任务失败", true);
  } finally {
    $("#createBtn").disabled = false;
  }
}

function initTopicSelection() {
  const form = document.querySelector(".psy-form");
  const singleSection = form?.querySelector(".psy-section");
  if (!form || !singleSection) return;
  singleSection.id = "singleContentSection";
  const batch = document.createElement("article");
  batch.id = "batchContentSection";
  batch.className = "psy-section batch-content-section";
  batch.hidden = false;
  batch.innerHTML = `<div class="section-head"><span>01</span><div><h2>选择心理学题目</h2><p>勾选 1 道题目即生成单个视频；勾选多道题目即批量生成。每道题都会独立生成 AI 配音文案和生图描述。</p></div></div><div class="batch-topic-toolbar"><input id="batchTopicQuery" type="search" placeholder="搜索题库题目" /><button id="refreshBatchTopicsBtn" class="quiet" type="button">刷新题库</button></div><div class="batch-topic-summary"><strong id="batchTopicSelectedCount">已选 0 道题目</strong><span>题目来自心理学题库；每道题按下方模型和每题视频数独立生成。</span></div><div id="batchTopicList" class="batch-topic-list"><div class="empty">正在读取心理学题库...</div></div>`;
  singleSection.hidden = true;
  singleSection.insertAdjacentElement("afterend", batch);
  batch.insertAdjacentElement("afterend", singleSection);
  batch.querySelector(".batch-topic-summary").insertAdjacentHTML("afterend", `<label id="batchAutoGenerateWrap" class="batch-ai-auto"><input id="batchAutoGenerate" type="checkbox" checked /><span><strong>批量时自动生成解说词与生图描述</strong><small>每条视频都会独立调用 AI，生成不同的配音文案与图片描述。</small></span></label>`);
  document.querySelector(".preview-section")?.setAttribute("hidden", "");
  const headerActions = document.querySelector(".header-actions");
  const createButton = $("#createBtn");
  $("#refreshBatchTopicsBtn").insertAdjacentElement("afterend", createButton);
  batch.querySelector(".batch-topic-summary").append($("#statusText"));
  if (headerActions) headerActions.hidden = true;
  createButton.textContent = "生成选中题目";
  $("#statusText").textContent = "从题库勾选题目后生成";
  $("#batchTopicQuery").addEventListener("input", () => renderBatchTopics());
  $("#refreshBatchTopicsBtn").addEventListener("click", loadBatchTopics);
  $("#batchTopicList").addEventListener("change", (event) => { const input = event.target.closest("[data-topic-id]"); if (!input) return; input.checked ? selectedBatchTopicIds.add(input.dataset.topicId) : selectedBatchTopicIds.delete(input.dataset.topicId); updateBatchTopicSelection(); });
  const totalField = $("#totalVideos").closest(".field");
  const allocationHint = document.createElement("small");
  allocationHint.id = "allocationHint";
  allocationHint.className = "allocation-hint";
  totalField.append(allocationHint);
  $("#totalVideos").addEventListener("input", updateBatchTopicSelection);
  loadBatchTopics();
}

function setGenerationMode(mode) {
  generationMode = mode === "batch" ? "batch" : "single";
  const isBatch = generationMode === "batch";
  $("#singleContentSection").hidden = isBatch;
  $("#batchContentSection").hidden = !isBatch;
  document.querySelectorAll(".psy-mode-tabs [data-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.mode === generationMode));
  $("#createBtn").textContent = isBatch ? "批量加入生成队列" : "加入生成队列";
  $("#statusText").textContent = isBatch ? "选择题目后将逐题自动生成文案与图片" : "准备创建任务";
}

async function loadBatchTopics() {
  const list = $("#batchTopicList");
  if (!list) return;
  list.innerHTML = `<div class="empty">正在读取心理学题库...</div>`;
  try {
    const response = await fetch(`/api/psychology-topics?page=1&pageSize=200&t=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取心理学题库失败。");
    batchTopics = Array.isArray(data.items) ? data.items : [];
    renderBatchTopics();
  } catch (error) { list.innerHTML = `<div class="empty">${escapeHtml(error.message || "读取题库失败。")}</div>`; }
}

function renderBatchTopics() {
  const list = $("#batchTopicList");
  if (!list) return;
  const query = $("#batchTopicQuery").value.trim().toLowerCase();
  const visible = batchTopics.filter((topic) => !query || `${topic.question || ""} ${topic.hookTitle || ""} ${topic.answerGuide || ""}`.toLowerCase().includes(query));
  if (!visible.length) { list.innerHTML = `<div class="empty">没有匹配的题目，请先到“心理学题目”同步题库。</div>`; updateBatchTopicSelection(); return; }
  list.innerHTML = visible.map((topic) => { const options = (topic.options || []).map((item) => `${item.label || ""}. ${item.text || ""}`).join(" · "); return `<label class="batch-topic-card"><input type="checkbox" data-topic-id="${escapeHtml(topic.id)}" ${selectedBatchTopicIds.has(String(topic.id)) ? "checked" : ""} /><span><strong>${escapeHtml(topic.question || topic.hookTitle || "未命名题目")}</strong><small>${escapeHtml(options || topic.answerGuide || "生成时由 AI 补全四个视觉选项")}</small></span></label>`; }).join("");
  updateBatchTopicSelection();
}

function syncSingleTopicEditor(topic) {
  const section = $("#singleContentSection");
  if (!topic || !section || section.dataset.topicId === String(topic.id)) return;
  const question = String(topic.question || topic.hookTitle || "").trim();
  $("#question").value = question;
  $("#hookTitle").value = String(topic.hookTitle || question).trim();
  $("#sourceImageUrl").value = String(topic.imageUrl || "").trim();
  $("#answerGuide").value = topicAnswerGuide(topic);
  $("#taskName").value = `心理学测试 · ${question.slice(0, 24)}`;
  $("#narration").value = "";
  $("#imagePrompt").value = "";
  delete $("#imagePrompt").dataset.generatedAspect;
  section.dataset.topicId = String(topic.id);
}

function updateBatchTopicSelection() {
  const selectedTopics = batchTopics.filter((topic) => selectedBatchTopicIds.has(String(topic.id)));
  const selectedCount = selectedTopics.length;
  const total = Math.max(1, numberValue("#totalVideos", 1));
  const output = $("#batchTopicSelectedCount");
  const button = $("#createBtn");
  const hint = $("#allocationHint");
  const singleSection = $("#singleContentSection");
  const previewSection = document.querySelector(".preview-section");
  const autoGenerateWrap = $("#batchAutoGenerateWrap");

  if (!selectedCount) {
    if (singleSection) singleSection.hidden = true;
    if (previewSection) previewSection.hidden = true;
    if (autoGenerateWrap) autoGenerateWrap.hidden = true;
    if (output) output.textContent = "已选 0 道题目";
    if (button) button.textContent = "生成选中题目";
    if (hint) hint.textContent = "先勾选题库题目，再设置需要生成的视频总数。";
    return;
  }

  if (selectedCount === 1) {
    syncSingleTopicEditor(selectedTopics[0]);
    if (singleSection) singleSection.hidden = false;
    if (previewSection) previewSection.hidden = false;
    if (autoGenerateWrap) autoGenerateWrap.hidden = true;
    if (output) output.textContent = "已选 1 道题目 · 单次编辑模式";
    if (button) button.textContent = "生成 1 条视频";
    if (hint) hint.textContent = "单次模式可在下方先生成、查看并修改解说词和生图描述，再创建 1 条视频。";
    return;
  }

  if (singleSection) singleSection.hidden = true;
  if (previewSection) previewSection.hidden = true;
  if (autoGenerateWrap) autoGenerateWrap.hidden = false;
  const base = Math.floor(total / selectedCount);
  const remainder = total % selectedCount;
  if (output) output.textContent = `已选 ${selectedCount} 道题目 · 共生成 ${total} 条视频`;
  if (button) button.textContent = `生成 ${total} 条视频`;
  if (hint) hint.textContent = remainder ? `按题目顺序轮转：前 ${remainder} 道各生成 ${base + 1} 条，其余各生成 ${base} 条。` : `平均分配：每道题各生成 ${base} 条。`;
}

function topicAnswerGuide(topic) { const options = (topic.options || []).map((item) => `${item.label || ""}. ${item.text || ""}`).filter(Boolean).join("\n"); return [options, topic.answerGuide || ""].filter(Boolean).join("\n\n"); }

function buildPsychologyPublish(selected, autoPublish, scheduleAt) {
  const accounts = selected.map((input) => { const phone = phones.find((item) => String(item.id) === input.value) || {}; return { id: input.value, name: phone.serialName || "", serialNo: phone.serialNo || "", groupName: phone.groupName || "", remark: phone.remark || "" }; });
  return { autoPublish, envIds: selected.map((input) => input.value), accounts, videoDesc: $("#videoDesc").value.trim(), scheduleAt, intervalMinutes: numberValue("#intervalMinutes", 15), batchPublishLimit: numberValue("#batchLimit", 300), dailyPublishLimit: 300 };
}

async function createBatchTasks() {
  const topics = batchTopics.filter((topic) => selectedBatchTopicIds.has(String(topic.id)));
  const models = selectedModels();
  if (!topics.length) return setStatus("请至少勾选一道心理学题目。", true);
  if (!models.length) return setStatus("请至少选择一个生图模型。", true);
  if (!$("#batchAutoGenerate")?.checked) return setStatus("多选批量生成请开启“自动生成解说词与生图描述”。", true);
  const selected = Array.from(document.querySelectorAll(".phone-check:checked"));
  const autoPublish = $("#autoPublish").checked;
  if (autoPublish && !selected.length) return setStatus("自动发布至少需要选择一个 GeeLark 账号。", true);
  const baseScheduleAt = Math.floor(new Date($("#scheduleAt").value).getTime() / 1000);
  if (autoPublish && (!baseScheduleAt || baseScheduleAt < Math.floor(Date.now() / 1000) + 300)) return setStatus("起始发布时间至少要晚于当前时间 5 分钟。", true);
  $("#createBtn").disabled = true;
  try {
    setStatus("正在保存配置...");
    const configured = await saveSettings(false);
    if (!configured) throw new Error("请先保存 Kie、ElevenLabs 和 Voice ID 配置。");
    let created = 0;
    const totalVideos = Math.max(1, numberValue("#totalVideos", 1));
    for (let index = 0; index < totalVideos; index += 1) {
      const topic = topics[index % topics.length];
      const topicRound = Math.floor(index / topics.length) + 1;
      setStatus(`正在创建 ${index + 1}/${totalVideos}：${String(topic.question || "").slice(0, 28)}`);
      const payload = { taskType: "psychology", name: `心理学测试 · ${String(topic.question || "").slice(0, 24)} · ${topicRound}`, generation: { question: String(topic.question || "").trim(), hookTitle: String(topic.hookTitle || topic.question || "").trim(), sourceImageUrl: "", fallbackImageUrl: String(topic.imageUrl || "").trim(), answerGuide: topicAnswerGuide(topic), narration: "", imagePrompt: "", creativeVariant: index + 1, imageModels: models, totalVideos: 1, aspectRatio: $("#aspectRatio").value, titlePosition: numberValue("#titlePosition", 14), titleFontSize: numberValue("#titleFontSize", 68), motion: $("#motion").value, backgroundMusicDir: $("#backgroundMusicDir").value.trim(), backgroundMusicVolume: numberValue("#backgroundMusicVolume", 0.10), elevenLabsVoiceId: $("#voiceId").value.trim(), elevenLabsModelId: $("#voiceModel").value }, publish: buildPsychologyPublish(selected, autoPublish, baseScheduleAt + index * numberValue("#intervalMinutes", 15) * 60) };
      const response = await fetch("/api/auto-tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `第 ${index + 1} 条视频任务创建失败。`);
      created += 1;
    }
    setStatus(`已创建 ${created} 条心理学视频任务：每条都会独立生成不同的 AI 配音文案和生图描述。`);
    selectedBatchTopicIds.clear();
    renderBatchTopics();
    loadTasks();
  } catch (error) { setStatus(error.message || "批量创建任务失败。", true); } finally { $("#createBtn").disabled = false; }
}

async function loadPhones() {
  $("#phoneList").innerHTML = '<div class="empty">正在读取 GeeLark 账号...</div>';
  try {
    const response = await fetch(`/api/geelark/phones?t=${Date.now()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取账号失败");
    phones = data.phones || [];
    const groups = Array.from(new Set(phones.map((item) => item.groupName).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN"));
    const previous = $("#groupFilter").value;
    $("#groupFilter").innerHTML = '<option value="">全部分组</option>' + groups.map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join("");
    if (groups.includes(previous)) $("#groupFilter").value = previous;
    renderPhones();
  } catch (error) {
    $("#phoneList").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

function visiblePhones() {
  const group = $("#groupFilter").value;
  const query = $("#nameFilter").value.trim().toLowerCase();
  return phones.filter((phone) => {
    if (group && phone.groupName !== group) return false;
    return !query || [phone.serialName, phone.serialNo, phone.remark, phone.groupName].some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function renderPhones() {
  const selected = new Set(Array.from(document.querySelectorAll(".phone-check:checked")).map((input) => input.value));
  const list = visiblePhones();
  $("#phoneList").innerHTML = list.length ? list.map((phone) => `
    <label class="phone-card"><input class="phone-check" type="checkbox" value="${escapeHtml(phone.id)}" ${selected.has(String(phone.id)) ? "checked" : ""} />
      <span><strong>${escapeHtml(phone.serialName || phone.serialNo || phone.id)}</strong><small>${escapeHtml(phone.groupName || "未分组")}</small></span>
    </label>`).join("") : '<div class="empty">当前筛选没有账号。</div>';
  updateSelectedCount();
}

function selectVisible() {
  const inputs = Array.from(document.querySelectorAll(".phone-check"));
  const shouldCheck = inputs.some((input) => !input.checked);
  inputs.forEach((input) => { input.checked = shouldCheck; });
  updateSelectedCount();
}

function updateSelectedCount() {
  $("#selectedCount").textContent = `已选 ${document.querySelectorAll(".phone-check:checked").length} 个`;
}

async function loadTasks() {
  try {
    const response = await fetch(`/api/auto-tasks?t=${Date.now()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取任务失败");
    renderTasks((data.tasks || []).filter((task) => task.taskType === "psychology"));
  } catch (error) {
    $("#taskList").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

function renderTasks(tasks) {
  if (!tasks.length) return $("#taskList").innerHTML = '<div class="empty">暂时没有心理学任务。</div>';
  $("#taskList").innerHTML = tasks.map((task) => {
    const percent = Math.max(0, Math.min(100, Number(task.progress?.percent) || (task.status === "done" ? 100 : 0)));
    const links = (task.generatedVideos || []).slice(0, 6).map((video, index) => `<a href="${escapeHtml(video.videoUrl)}" target="_blank">视频 ${index + 1}</a>`).join("");
    const action = task.status === "failed" ? `<button data-action="resume" data-id="${escapeHtml(task.id)}">重新执行</button>` : ["queued", "running"].includes(task.status) ? `<button data-action="cancel" data-id="${escapeHtml(task.id)}">停止</button>` : "";
    return `<article class="task-card" data-status="${escapeHtml(task.status)}">
      <div class="task-top"><strong>${escapeHtml(task.name)}</strong><span>${statusLabel(task.status)}</span></div>
      <p>${escapeHtml(task.message || task.error || "等待执行")}</p>
      <div class="progress"><i style="width:${percent}%"></i></div>
      <div class="task-links">${links}${action}</div>
    </article>`;
  }).join("");
}

async function handleTaskAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  button.disabled = true;
  const action = button.dataset.action;
  const response = await fetch(`/api/auto-tasks/${encodeURIComponent(button.dataset.id)}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const data = await response.json();
  if (!response.ok) setStatus(data.error || "操作失败", true);
  loadTasks();
}

function selectedModels() {
  return Array.from(document.querySelectorAll('[name="imageModel"]:checked')).map((input) => input.value);
}

function setDefaultSchedule() {
  const date = new Date(Date.now() + 15 * 60 * 1000);
  date.setSeconds(0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $("#scheduleAt").value = local;
}

function setStatus(message, error = false) {
  $("#statusText").textContent = message;
  $("#statusText").style.color = error ? "#ff8b85" : "";
}

function numberValue(selector, fallback) {
  const value = Number($(selector).value);
  return Number.isFinite(value) ? value : fallback;
}

function statusLabel(status) {
  return ({ queued: "排队", running: "生成中", awaiting_review: "待发布", publishing: "发布中", done: "已完成", failed: "失败", canceled: "已停止", needs_attention: "待处理" })[status] || status;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
