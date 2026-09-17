const FINAL_STATES = new Set(["success", "fail"]);
const state = { accounts: [], groups: [], project: null, tasks: [], currentTaskIds: [], pollTimer: 0, busy: false };
let peerJobPhotos = [];
const $ = (selector) => document.querySelector(selector);

$("#refreshBtn")?.addEventListener("click", loadPage);
$("#generateBtn")?.addEventListener("click", generateImages);
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
      $('#photoTitle').value = plan.title || '';
      $('#publishCaption').value = plan.caption || '';
    }
    renderAll();
    watchPending();
    hideStatus();
  } catch (error) {
    renderGeneratedPhotos();
    showStatus(error.message || "页面数据读取失败");
  }
}

async function generateImages() {
  const prompt = $("#imagePrompt").value.trim();
  if (prompt.length < 2) return setGenerateMessage("请先填写画面描述。", true);
  const count = Math.max(1, Math.min(6, Number($("#imageCount").value) || 1));
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
    peerJobPhotos = [];
    state.currentTaskIds = created.map((task) => task.id);
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

function publicationPhotos() {
  if (peerJobPhotos.length) return peerJobPhotos.slice(0, 6);
  if (state.currentTaskIds.length) {
    const current = new Set(state.currentTaskIds);
    return generatedPhotos().filter((photo) => current.has(photo.generationId)).slice(0, 6);
  }
  return generatedPhotos().slice(0, 6);
}

function renderAll() {
  renderGeneratedPhotos();
  renderAccounts();
}

function renderGeneratedPhotos() {
  const photos = publicationPhotos();
  $("#photoList").innerHTML = photos.length ? photos.map((photo, index) => `<article class="generated-photo-card"><img src="${escapeAttr(photo.url)}" alt="图集第 ${index + 1} 张" loading="lazy"><span>${index + 1}${index === 0 ? " · 默认封面" : ""}</span></article>`).join("") : '<div class="generated-photo-empty">还没有可用图片。生成完成后会按顺序自动加入图集，第一张作为封面。</div>';
  updateGenerationState();
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
  const selections = publicationPhotos();
  if (!selections.length) return setPublishResult("请先生成 1–6 张图片。");
  if (state.currentTaskIds.some((id) => !FINAL_STATES.has(state.tasks.find((task) => task.id === id)?.status))) return setPublishResult("本批图片仍在生成，请等待全部完成后发布。");
  if (!connectionId) return setPublishResult("请先选择发布账号。");
  const musicSoundId = $("#musicSoundId").value.trim();
  if (musicSoundId && !/^\d{1,30}$/.test(musicSoundId)) return setPublishResult("音乐 ID 只能包含数字。");
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
        photoCoverIndex: 0, scheduleAt,
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
  const complete = publicationPhotos().length;
  $("#generationState").textContent = active ? `${active} 个任务生成中 · ${complete} 张可用` : `${complete} 张可用`;
}
async function requestJson(url, options = {}) { const response = await fetch(url, { ...options, cache: "no-store" }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || `请求失败：HTTP ${response.status}`); return data; }
function setGenerateMessage(message, error = false) { $("#generateMessage").textContent = message; $("#generateMessage").classList.toggle("error", error); }
function setPublishResult(message) { $("#publishResult").textContent = message; }
function showStatus(message) { const node = $("#pageStatus"); node.textContent = message; node.classList.add("is-visible"); }
function hideStatus() { $("#pageStatus")?.classList.remove("is-visible"); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]); }
function escapeAttr(value) { return escapeHtml(value); }
