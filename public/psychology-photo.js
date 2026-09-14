const FINAL_STATES = new Set(["success", "fail"]);
const state = { accounts: [], groups: [], project: null, tasks: [], selected: [], coverKey: "", pollTimer: 0, busy: false };
let peerJobPhotos = [];
const $ = (selector) => document.querySelector(selector);

$("#refreshBtn")?.addEventListener("click", loadPage);
$("#generateBtn")?.addEventListener("click", generateImages);
$("#photoList")?.addEventListener("click", toggleGeneratedPhoto);
$("#selectedPhotos")?.addEventListener("click", changeSelectedPhoto);
$("#musicSoundId")?.addEventListener("input", syncMusicMode);
$("#publishBtn")?.addEventListener("click", publishPhotoPost);
loadPage();

async function loadPage() {
  showStatus("正在读取 Z-Image 记录和心理学项目账号…");
  try {
    const [ai, accounts] = await Promise.all([
      requestJson(`/api/kie-ai?t=${Date.now()}`),
      requestJson(`/api/official-tiktok/publish-accounts?module=psychology&media=photo&t=${Date.now()}`),
    ]);
    state.tasks = (ai.tasks || []).filter((task) => task.kind === "image" && task.model === "z-image");
    state.project = accounts.project || null;
    state.groups = accounts.groups || [];
    state.accounts = accounts.accounts || [];
    const peerJobId = new URLSearchParams(location.search).get('peerJob');
    if (peerJobId && !peerJobPhotos.length) {
      const { jobs } = await requestJson('/api/psychology-peer-hits/production?jobId=' + encodeURIComponent(peerJobId));
      const job = jobs.find(item => item.jobId === peerJobId && item.type === 'psychology-photo-story');
      if (!job) throw new Error('未找到这组同行爆款图文。');
      const plan = job.result?.plan || job.plan || {};
      peerJobPhotos = (job.result?.results || job.results || []).filter(item => item.imageModel === 'z-image' && /^https:\/\//i.test(item.imageUrl || '')).map((item, index) => ({ key: `${peerJobId}:${index}`, peerJobId, resultIndex: index, url: item.imageUrl, prompt: item.title, createdAt: job.createdAt }));
      state.selected = peerJobPhotos.map(photo => photo.key);
      state.coverKey = state.selected[0] || '';
      $('#photoTitle').value = plan.title || '';
      $('#publishCaption').value = plan.caption || '';
    }
    renderAll();
    watchPending();
    hideStatus();
  } catch (error) {
    showStatus(error.message || "页面数据读取失败");
  }
}

async function generateImages() {
  const prompt = $("#imagePrompt").value.trim();
  if (prompt.length < 2) return setGenerateMessage("请先填写画面描述。", true);
  const count = Math.max(1, Math.min(8, Number($("#imageCount").value) || 1));
  const button = $("#generateBtn");
  button.disabled = true;
  button.textContent = "正在提交…";
  setGenerateMessage(`正在提交 ${count} 个 Z-Image 任务…`);
  try {
    const results = await Promise.allSettled(Array.from({ length: count }, () => requestJson("/api/kie-ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "image", prompt, imageModel: "z-image", aspectRatio: $("#aspectRatio").value, noImageText: $("#noImageText").checked }),
    })));
    const created = results.flatMap((result) => result.status === "fulfilled" ? [result.value.task] : []);
    const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason?.message || String(result.reason)] : []);
    if (!created.length) throw new Error(failures[0] || "Z-Image 任务提交失败。");
    state.tasks = [...created, ...state.tasks];
    renderGeneratedPhotos();
    watchPending();
    setGenerateMessage(failures.length ? `已提交 ${created.length} 个任务，${failures.length} 个失败：${failures.join("；")}` : `已提交 ${created.length} 个任务，完成后会自动显示。`, failures.length > 0);
  } catch (error) {
    setGenerateMessage(error.message || "生成失败。", true);
  } finally {
    button.disabled = false;
    button.textContent = "生成图片";
  }
}

function watchPending() {
  clearInterval(state.pollTimer);
  const activeIds = state.tasks.filter((task) => !FINAL_STATES.has(task.status)).map((task) => task.id);
  updateGenerationState();
  if (!activeIds.length) return;
  state.pollTimer = window.setInterval(async () => {
    const refreshed = await Promise.all(activeIds.map((id) => requestJson(`/api/kie-ai?id=${encodeURIComponent(id)}`).then((data) => data.task).catch(() => null)));
    state.tasks = state.tasks.map((task) => refreshed.find((item) => item?.id === task.id) || task);
    renderGeneratedPhotos();
    updateGenerationState();
    if (state.tasks.every((task) => FINAL_STATES.has(task.status) || !activeIds.includes(task.id))) clearInterval(state.pollTimer);
  }, 4000);
}

function generatedPhotos() {
  return [...peerJobPhotos, ...state.tasks.flatMap((task) => (task.status === "success" ? (task.resultUrls || []).map((url, index) => ({ key: `${task.id}:${index}`, generationId: task.id, resultIndex: index, url, prompt: task.prompt, createdAt: task.createdAt })) : []))];
}

function renderAll() {
  renderGeneratedPhotos();
  renderSelectedPhotos();
  renderAccounts();
}

function renderGeneratedPhotos() {
  const photos = generatedPhotos();
  const selected = new Set(state.selected);
  $("#photoList").innerHTML = photos.length ? photos.map((photo) => `<button class="generated-photo-card${selected.has(photo.key) ? " is-selected" : ""}" type="button" data-photo-key="${escapeAttr(photo.key)}"><img src="${escapeAttr(photo.url)}" alt="Z-Image 生成结果" loading="lazy"><span title="${escapeAttr(photo.prompt)}">${escapeHtml(shorten(photo.prompt, 56))}</span></button>`).join("") : '<div class="generated-photo-empty">还没有可用图片。先在上方输入描述并生成。</div>';
  updateGenerationState();
}

function toggleGeneratedPhoto(event) {
  const card = event.target.closest("[data-photo-key]");
  if (!card) return;
  const key = card.dataset.photoKey;
  const index = state.selected.indexOf(key);
  if (index >= 0) state.selected.splice(index, 1);
  else if (state.selected.length < 35) state.selected.push(key);
  else return setPublishResult("每条图片帖子最多 35 张图片。");
  if (!state.coverKey || !state.selected.includes(state.coverKey)) state.coverKey = state.selected[0] || "";
  renderGeneratedPhotos();
  renderSelectedPhotos();
}

function renderSelectedPhotos() {
  const lookup = new Map(generatedPhotos().map((photo) => [photo.key, photo]));
  state.selected = state.selected.filter((key) => lookup.has(key));
  if (!state.selected.includes(state.coverKey)) state.coverKey = state.selected[0] || "";
  $("#photoCount").textContent = `已选 ${state.selected.length} / 35 张`;
  $("#selectedPhotos").innerHTML = state.selected.map((key, index) => {
    const photo = lookup.get(key);
    return `<article class="selected-photo-row" data-selected-key="${escapeAttr(key)}"><img src="${escapeAttr(photo.url)}" alt="图集第 ${index + 1} 张"><strong>${index + 1}. ${escapeHtml(shorten(photo.prompt, 72))}</strong><div class="selected-photo-actions"><button type="button" data-action="left" ${index === 0 ? "disabled" : ""}>←</button><button type="button" data-action="right" ${index === state.selected.length - 1 ? "disabled" : ""}>→</button><button class="${key === state.coverKey ? "is-cover" : ""}" type="button" data-action="cover">${key === state.coverKey ? "封面" : "设为封面"}</button><button type="button" data-action="remove">删除</button></div></article>`;
  }).join("");
}

function changeSelectedPhoto(event) {
  const button = event.target.closest("[data-action]");
  const row = event.target.closest("[data-selected-key]");
  if (!button || !row) return;
  const key = row.dataset.selectedKey;
  const index = state.selected.indexOf(key);
  const action = button.dataset.action;
  if (action === "remove") state.selected.splice(index, 1);
  else if (action === "cover") state.coverKey = key;
  else {
    const next = action === "left" ? index - 1 : index + 1;
    if (next < 0 || next >= state.selected.length) return;
    [state.selected[index], state.selected[next]] = [state.selected[next], state.selected[index]];
  }
  if (!state.selected.includes(state.coverKey)) state.coverKey = state.selected[0] || "";
  renderGeneratedPhotos();
  renderSelectedPhotos();
}

function renderAccounts() {
  $("#groupPanel").innerHTML = state.groups.map((group) => `<span class="group-chip">${escapeHtml(group.name)} · ${group.accountCount || 0} 个账号</span>`).join("");
  $("#accountCount").textContent = `${state.accounts.length} 个账号`;
  $("#accountList").innerHTML = state.accounts.length ? state.accounts.map((account, index) => {
    const id = account.connectionId || account.id || "";
    const name = account.displayName || account.label || account.username || id;
    return `<label class="check-row"><input class="publish-account" name="publishAccount" type="radio" value="${escapeAttr(id)}" ${index === 0 ? "checked" : ""}><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(account.username ? `@${account.username}` : id)} · ${escapeHtml(account.groupName || "未分组")}</small></span></label>`;
  }).join("") : '<div class="empty">心理学项目分组里还没有可发布的官方账号。</div>';
}

function syncMusicMode() {
  if (/^\d{1,30}$/.test($("#musicSoundId").value.trim())) $("#autoAddMusic").checked = false;
}

async function publishPhotoPost() {
  if (state.busy) return;
  const connectionId = document.querySelector(".publish-account:checked")?.value || "";
  if (!state.selected.length) return setPublishResult("请先选择 1–35 张生成图片。");
  if (!connectionId) return setPublishResult("请先选择发布账号。");
  const musicSoundId = $("#musicSoundId").value.trim();
  if (musicSoundId && !/^\d{1,30}$/.test(musicSoundId)) return setPublishResult("音乐 ID 只能包含数字。");
  const lookup = new Map(generatedPhotos().map((photo) => [photo.key, photo]));
  const selections = state.selected.map((key) => lookup.get(key)).filter(Boolean);
  const scheduleAt = $("#publishTime").value ? new Date($("#publishTime").value).getTime() : 0;
  state.busy = true;
  $("#publishBtn").disabled = true;
  try {
    const assets = [];
    for (let index = 0; index < selections.length; index += 1) {
      const photo = selections[index];
      setPublishResult(`正在导入第 ${index + 1} / ${selections.length} 张 Z-Image 图片…`);
      assets.push(await requestJson("/api/official-tiktok/photo-assets/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generationId: photo.generationId, peerJobId: photo.peerJobId, resultIndex: photo.resultIndex }),
      }));
    }
    setPublishResult("图片已导入，正在创建 TikTok 图文发布任务…");
    const data = await requestJson("/api/official-tiktok/photo-publish", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: crypto.randomUUID(), module: "psychology", connectionId, assets,
        title: $("#photoTitle").value.trim(), caption: $("#publishCaption").value,
        privacyLevel: $("#privacyLevel").value, disableComment: !$("#allowComments").checked,
        autoAddMusic: !musicSoundId && $("#autoAddMusic").checked, ...(musicSoundId ? { musicSoundId } : {}),
        photoCoverIndex: Math.max(0, state.selected.indexOf(state.coverKey)), scheduleAt,
      }),
    });
    setPublishResult(data.message || `图片帖子已提交，批次 ${data.batchId || ""}`);
  } catch (error) {
    setPublishResult(error.message || "图文发布失败，请重试。");
  } finally {
    state.busy = false;
    $("#publishBtn").disabled = false;
  }
}

function updateGenerationState() {
  const active = state.tasks.filter((task) => !FINAL_STATES.has(task.status)).length;
  const complete = generatedPhotos().length;
  $("#generationState").textContent = active ? `${active} 个任务生成中 · ${complete} 张可用` : `${complete} 张可用`;
}
async function requestJson(url, options = {}) { const response = await fetch(url, { ...options, cache: "no-store" }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || `请求失败：HTTP ${response.status}`); return data; }
function setGenerateMessage(message, error = false) { $("#generateMessage").textContent = message; $("#generateMessage").classList.toggle("error", error); }
function setPublishResult(message) { $("#publishResult").textContent = message; }
function showStatus(message) { const node = $("#pageStatus"); node.textContent = message; node.classList.add("is-visible"); }
function hideStatus() { $("#pageStatus")?.classList.remove("is-visible"); }
function shorten(value, limit) { const text = String(value || "").replace(/\s+/g, " ").trim(); return text.length > limit ? `${text.slice(0, limit)}…` : text; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]); }
function escapeAttr(value) { return escapeHtml(value); }
