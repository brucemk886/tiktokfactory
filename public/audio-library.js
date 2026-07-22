const elements = {
  refreshBtn: document.querySelector("#refreshBtn"), pageStatus: document.querySelector("#pageStatus"), audioCount: document.querySelector("#audioCount"),
  voiceId: document.querySelector("#voiceId"), retryAudioBtn: document.querySelector("#retryAudioBtn"), selectAll: document.querySelector("#selectAll"),
  audioList: document.querySelector("#audioList"), createRedditTaskBtn: document.querySelector("#createRedditTaskBtn"),
  selectedAudioCount: document.querySelector("#selectedAudioCount"), batchStatus: document.querySelector("#batchStatus")
};
let items = [];
let pendingMarketing = null;

elements.voiceId.value = localStorage.getItem("elevenlabs-voice-id") || "";
elements.refreshBtn.addEventListener("click", loadLibrary);
elements.selectAll.addEventListener("change", () => {
  document.querySelectorAll(".audio-check").forEach((input) => { input.checked = elements.selectAll.checked; });
  updateSelectedCount();
});
elements.createRedditTaskBtn.addEventListener("click", prepareRedditTask);
elements.retryAudioBtn.addEventListener("click", generatePendingAudio);

await loadLibrary();
await autoGenerateFromQuery();

async function loadLibrary() {
  try {
    const data = await api("/api/audio-library");
    items = data.items || [];
    renderItems();
    setPageStatus(`已读取 ${items.length} 条音频。`, "success");
  } catch (error) {
    setPageStatus(error.message, "error");
  }
}

async function autoGenerateFromQuery() {
  const params = new URLSearchParams(location.search);
  if (params.get("autostart") !== "1") return;
  pendingMarketing = { marketingId: params.get("marketingId"), rank: Number(params.get("rank")) };
  await generatePendingAudio();
}

async function generatePendingAudio() {
  if (!pendingMarketing) return;
  elements.retryAudioBtn.hidden = true;
  setPageStatus("正在调用 ElevenLabs 生成音频，请不要重复点击...");
  try {
    const data = await api("/api/audio-library/generate", {
      method: "POST",
      body: JSON.stringify({ ...pendingMarketing, voiceId: elements.voiceId.value.trim() })
    });
    if (elements.voiceId.value.trim()) localStorage.setItem("elevenlabs-voice-id", elements.voiceId.value.trim());
    history.replaceState({}, "", "/audio-library");
    pendingMarketing = null;
    await loadLibrary();
    const generatedId = data.item.id;
    const checkbox = document.querySelector(`.audio-check[value="${CSS.escape(generatedId)}"]`);
    if (checkbox) checkbox.checked = true;
    updateSelectedCount();
    setPageStatus(data.item.cacheHit ? "已载入之前生成的同一条音频，没有重复消耗额度。" : "音频生成完成并已保存。", "success");
  } catch (error) {
    setPageStatus(error.message, "error");
    elements.retryAudioBtn.hidden = false;
    if (/Voice ID/.test(error.message)) elements.voiceId.focus();
  }
}

function renderItems() {
  elements.audioCount.textContent = `${items.length} 条`;
  elements.selectAll.checked = false;
  elements.audioList.innerHTML = items.length ? items.map((item) => `
    <article class="audio-row">
      <input class="audio-check" type="checkbox" value="${escapeHtml(item.id)}" />
      <div><h3 title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h3><p>${formatDuration(item.duration)} · ${formatSize(item.size)} · ${escapeHtml(item.modelId)}</p></div>
      <audio controls preload="none" src="/api/audio-library/${encodeURIComponent(item.id)}/file"></audio>
      <time>${formatTime(item.createdAt)}</time>
    </article>`).join("") : '<div class="empty-audio">还没有音频。从小说营销工作台生成第一条配音。</div>';
  document.querySelectorAll(".audio-check").forEach((input) => input.addEventListener("change", updateSelectedCount));
  updateSelectedCount();
}

function updateSelectedCount() {
  const count = document.querySelectorAll(".audio-check:checked").length;
  elements.selectedAudioCount.textContent = String(count);
  elements.batchStatus.textContent = count ? `已选择 ${count} 条音频，可以创建 Reddit 自动任务。` : "等待选择音频。";
  elements.selectAll.checked = Boolean(items.length) && count === items.length;
}

async function prepareRedditTask() {
  const ids = Array.from(document.querySelectorAll(".audio-check:checked")).map((input) => input.value);
  if (!ids.length) return setBatchStatus("请先勾选音频。");
  elements.createRedditTaskBtn.disabled = true;
  setBatchStatus("正在准备 Reddit 任务音频目录...");
  try {
    const batch = await api("/api/audio-library/prepare-task", { method: "POST", body: JSON.stringify({ ids }) });
    const params = new URLSearchParams({ source: "audio-library", audioDir: batch.audioDir, count: String(batch.count), batchId: batch.batchId });
    location.href = `/tasks?${params}`;
  } catch (error) {
    setBatchStatus(error.message || "准备自动任务失败。");
    elements.createRedditTaskBtn.disabled = false;
  }
}

function setPageStatus(message, tone = "") { elements.pageStatus.textContent = message; elements.pageStatus.className = `audio-status${tone ? ` is-${tone}` : ""}`; }
function setBatchStatus(message) { elements.batchStatus.textContent = message; }
async function api(url, options = {}) { const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || `请求失败：${response.status}`); return body; }
function formatDuration(value) { const seconds = Math.max(0, Math.round(Number(value) || 0)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function formatSize(value) { const size = Number(value) || 0; return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(size / 1024)} KB`; }
function formatTime(value) { return value ? new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "--"; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
