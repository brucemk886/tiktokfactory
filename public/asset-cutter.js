const $ = (selector) => document.querySelector(selector);

const startCutBtn = $("#startCutBtn");
const stopCutBtn = $("#stopCutBtn");
const groupName = $("#groupName");
const inputDir = $("#inputDir");
const includeSubfolders = $("#includeSubfolders");
const outputDir = $("#outputDir");
const minSeconds = $("#minSeconds");
const maxSeconds = $("#maxSeconds");
const sourceLimitSeconds = $("#sourceLimitSeconds");
const quality = $("#quality");
const statusEl = $("#status");
const progressBox = $("#progressBox");
const progressText = $("#progressText");
const progressStage = $("#progressStage");
const progressFill = $("#progressFill");
const classifySourceDir = $("#classifySourceDir");
const classifySaveDir = $("#classifySaveDir");
const classifyOneLevel = $("#classifyOneLevel");
const classifyVideo = $("#classifyVideo");
const classifyAudio = $("#classifyAudio");
const classifyOther = $("#classifyOther");
const startClassifyBtn = $("#startClassifyBtn");
const stopClassifyBtn = $("#stopClassifyBtn");

let currentJobId = "";
let pollTimer = null;
let classifyJobId = "";
let classifyPollTimer = null;

startCutBtn.addEventListener("click", startCut);
stopCutBtn.addEventListener("click", stopCut);
startClassifyBtn?.addEventListener("click", startClassify);
stopClassifyBtn?.addEventListener("click", stopClassify);
attachDirectoryPickers();

function attachDirectoryPickers() {
  document.querySelectorAll("[data-pick-directory]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = document.getElementById(button.dataset.pickDirectory);
      if (!target) return;
      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = "选择中...";
      try {
        const response = await fetch("/api/select-directory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            initialPath: target.value.trim() || directoryFallback(target.id),
            title: target.id.includes("Save") || target.id === "outputDir" ? "选择保存文件夹" : "选择来源文件夹"
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "打开文件夹选择器失败。");
        if (data.path) {
          target.value = data.path;
          target.dispatchEvent(new Event("input", { bubbles: true }));
          target.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } catch (error) {
        setStatus(error.message || "打开文件夹选择器失败。");
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
    });
  });
}

function directoryFallback(id) {
  if (id === "classifySaveDir") return classifySourceDir?.value.trim() || inputDir.value.trim();
  if (id === "classifySourceDir") return classifySaveDir?.value.trim() || inputDir.value.trim();
  return inputDir.value.trim();
}

async function startCut() {
  const payload = {
    mode: "cut",
    groupName: groupName.value.trim(),
    inputDir: inputDir.value.trim(),
    includeSubfolders: includeSubfolders.checked,
    outputDir: outputDir.value.trim(),
    minSeconds: Number(minSeconds.value) || 60,
    maxSeconds: Number(maxSeconds.value) || 90,
    sourceLimitSeconds: Number(sourceLimitSeconds.value) || 0,
    quality: quality.value,
    width: 1080,
    height: 1920,
    fps: 30
  };
  if (!payload.groupName) return setStatus("请输入素材组名称。");
  if (!payload.inputDir) return setStatus("请输入长视频输入目录。");
  if (!payload.outputDir) return setStatus("请输入切割后保存目录。");

  startCutBtn.disabled = true;
  stopCutBtn.hidden = false;
  showProgress(1, "正在提交切割任务...");
  try {
    const response = await fetch("/api/asset-groups/preprocess/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    currentJobId = data.jobId;
    pollProgress();
  } catch (error) {
    finishUi();
    hideProgress();
    setStatus(error.message || "Task failed.");
  }
}

async function startClassify() {
  const selectedTypes = [];
  if (classifyVideo.checked) selectedTypes.push("video");
  if (classifyAudio.checked) selectedTypes.push("audio");
  if (classifyOther.checked) selectedTypes.push("other");
  const payload = {
    sourceDir: classifySourceDir.value.trim(),
    saveDir: classifySaveDir.value.trim(),
    includeOneLevelSubfolders: classifyOneLevel.checked,
    types: selectedTypes,
    action: document.querySelector('[name="classifyAction"]:checked')?.value || "copy"
  };
  if (!payload.sourceDir) return setStatus("请选择来源文件夹。");
  if (!payload.saveDir) return setStatus("请选择保存文件夹。");
  if (!payload.types.length) return setStatus("请至少选择一种素材类型。");

  startClassifyBtn.disabled = true;
  stopClassifyBtn.hidden = false;
  showProgress(1, "正在提交分类任务...");
  try {
    const response = await fetch("/api/folder-classify/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "提交分类任务失败。");
    classifyJobId = data.jobId;
    pollClassifyProgress();
  } catch (error) {
    finishClassifyUi();
    hideProgress();
    setStatus(error.message || "分类任务失败。");
  }
}

async function stopClassify() {
  if (!classifyJobId) return;
  stopClassifyBtn.disabled = true;
  setStatus("正在停止分类任务...");
  try {
    await fetch(`/api/folder-classify/cancel/${encodeURIComponent(classifyJobId)}`, { method: "POST" });
  } catch {
    // Ignore; polling will settle.
  }
  clearClassifyPoll();
  finishClassifyUi();
}

function pollClassifyProgress() {
  clearClassifyPoll();
  const tick = async () => {
    if (!classifyJobId) return;
    try {
      const response = await fetch(`/api/folder-classify/progress/${encodeURIComponent(classifyJobId)}?t=${Date.now()}`);
      const job = await response.json();
      if (!response.ok) throw new Error(job.error || "Failed to read classify progress.");
      showProgress(Number(job.percent) || 1, job.message || "Classifying...");
      if (job.status === "done" || job.status === "failed" || job.status === "canceled") {
        setStatus(job.message || "Classify task ended.");
        if (job.status === "done") showProgress(100, "Done");
        clearClassifyPoll();
        finishClassifyUi();
        return;
      }
    } catch (error) {
      setStatus(error.message || "Classify task failed.");
    }
    classifyPollTimer = window.setTimeout(tick, 1000);
  };
  tick();
}

async function stopCut() {
  if (!currentJobId) return;
  stopCutBtn.disabled = true;
  setStatus("正在停止切割任务...");
  try {
    await fetch(`/api/asset-groups/preprocess/cancel/${encodeURIComponent(currentJobId)}`, { method: "POST" });
  } catch {
    // Ignore; polling will settle.
  }
  clearPoll();
  finishUi();
}

function pollProgress() {
  clearPoll();
  const tick = async () => {
    if (!currentJobId) return;
    try {
      const response = await fetch(`/api/asset-groups/preprocess/progress/${encodeURIComponent(currentJobId)}?t=${Date.now()}`);
      const job = await response.json();
      if (!response.ok) throw new Error(job.error || "读取切割进度失败。");
      showProgress(Number(job.percent) || 1, job.message || "切割中...");
      if (job.status === "done" || job.status === "failed" || job.status === "canceled") {
        setStatus(job.message || "任务结束。");
        if (job.status === "done") showProgress(100, "完成");
        clearPoll();
        finishUi();
        return;
      }
    } catch (error) {
      setStatus(error.message || "Task failed.");
    }
    pollTimer = window.setTimeout(tick, 1500);
  };
  tick();
}

function finishUi() {
  currentJobId = "";
  startCutBtn.disabled = false;
  stopCutBtn.hidden = true;
  stopCutBtn.disabled = false;
}

function clearPoll() {
  if (pollTimer) window.clearTimeout(pollTimer);
  pollTimer = null;
}

function finishClassifyUi() {
  classifyJobId = "";
  startClassifyBtn.disabled = false;
  stopClassifyBtn.hidden = true;
  stopClassifyBtn.disabled = false;
}

function clearClassifyPoll() {
  if (classifyPollTimer) window.clearTimeout(classifyPollTimer);
  classifyPollTimer = null;
}

function showProgress(percent, stage) {
  const safePercent = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  progressBox.hidden = false;
  progressText.textContent = `${safePercent}%`;
  progressStage.textContent = stage;
  progressFill.style.width = `${safePercent}%`;
  setStatus(stage);
}

function hideProgress() {
  progressBox.hidden = true;
  progressFill.style.width = "0%";
}

function setStatus(message) {
  statusEl.textContent = message;
}
