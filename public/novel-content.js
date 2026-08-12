const el = Object.fromEntries([
  "refreshBtn","summaryStrip","pageStatus","searchForm","searchInput","novelsTab","scriptsTab","unassignedTab","novelList","novelDetail",
  "showCreateBtn","cancelCreateBtn","createNovelForm","scriptCatalog","unassignedList","unassignedBadge","selectAll","selectedCount","createTaskBtn","voiceId","retryAudioBtn"
].map((id) => [id, document.getElementById(id)]));

let state = { summary: {}, novels: [], unassignedScripts: [] };
let selectedNovelId = "";
let pendingMarketing = null;
el.voiceId.value = localStorage.getItem("elevenlabs-voice-id") || "";

document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => showTab(button.dataset.tab)));
el.refreshBtn.addEventListener("click", loadContent);
el.searchForm.addEventListener("submit", (event) => { event.preventDefault(); loadContent(); });
el.showCreateBtn.addEventListener("click", () => { el.createNovelForm.hidden = false; el.novelDetail.hidden = true; });
el.cancelCreateBtn.addEventListener("click", () => { el.createNovelForm.hidden = true; el.novelDetail.hidden = false; });
el.createNovelForm.addEventListener("submit", createNovel);
el.selectAll.addEventListener("change", () => { document.querySelectorAll("#scriptsTab .audio-check").forEach((box) => { box.checked = el.selectAll.checked; }); updateSelection(); });
el.createTaskBtn.addEventListener("click", prepareTask);
el.retryAudioBtn.addEventListener("click", generatePendingAudio);

const initialTab = new URLSearchParams(location.search).get("tab") || "novels";
showTab(initialTab);
await loadContent();
await autoGenerateFromQuery();

async function loadContent() {
  setStatus("正在读取小说、文案、音频与对应视频数据...");
  try {
    const query = el.searchInput.value.trim();
    state = await api(`/api/novel-content${query ? `?query=${encodeURIComponent(query)}` : ""}`);
    if (!state.novels.some((item) => item.id === selectedNovelId)) selectedNovelId = state.novels[0]?.id || "";
    render();
    setStatus(`已读取 ${state.summary.novelCount || 0} 本小说、${state.summary.scriptCount || 0} 个文案版本。`, "success");
  } catch (error) { setStatus(error.message, "error"); }
}

function render() {
  const s = state.summary || {};
  el.summaryStrip.innerHTML = [
    ["小说", s.novelCount], ["文案版本", s.scriptCount], ["已有音频", s.audioCount], ["对应视频", s.videoCount], ["待归类", s.unassignedScriptCount]
  ].map(([label,value]) => `<div class="summary-item"><span>${label}</span><strong>${formatNumber(value)}</strong></div>`).join("");
  el.unassignedBadge.textContent = formatNumber(s.unassignedScriptCount);
  el.novelList.innerHTML = state.novels.length ? state.novels.map((novel) => `<button type="button" data-novel-id="${esc(novel.id)}" class="${novel.id === selectedNovelId ? "is-active" : ""}"><strong>${esc(novel.title)}</strong><small>${esc(novel.category || "未分类")} · ${novel.scripts.length} 个文案 · ${novel.performance.videoCount} 条视频</small></button>`).join("") : `<div class="empty">还没有小说，请先新增。</div>`;
  el.novelList.querySelectorAll("[data-novel-id]").forEach((button) => button.addEventListener("click", () => { selectedNovelId = button.dataset.novelId; render(); }));
  renderNovelDetail();
  const allScripts = state.novels.flatMap((novel) => novel.scripts.map((script) => ({ ...script, novelTitle: novel.title })));
  el.scriptCatalog.innerHTML = allScripts.length ? allScripts.map((script) => scriptCard(script, true)).join("") : `<div class="empty">还没有文案。</div>`;
  el.unassignedList.innerHTML = state.unassignedScripts.length ? state.unassignedScripts.map((script) => scriptCard(script, false)).join("") : `<div class="empty">没有待归类文案。</div>`;
  wireCards(); updateSelection();
}

function renderNovelDetail() {
  const novel = state.novels.find((item) => item.id === selectedNovelId);
  if (!novel) { el.novelDetail.innerHTML = `<div class="empty">选择一本小说查看内容关系。</div>`; return; }
  const p = novel.performance || {};
  el.novelDetail.hidden = false;
  el.createNovelForm.hidden = true;
  el.novelDetail.innerHTML = `<div class="novel-title-row"><div><span class="eyebrow">NOVEL SOURCE</span><h2>${esc(novel.title)}</h2><div class="novel-meta">${esc(novel.category || "未分类")} · 更新 ${formatTime(novel.updatedAt)}</div></div><div><button class="primary-btn generate-scripts-btn" data-novel-id="${esc(novel.id)}" type="button">AI 生成 5 个文案版本</button><div class="muted" style="margin-top:7px">原文不会被覆盖</div></div></div>
    ${metrics(p)}
    <details class="source-content"><summary>查看小说原文（${formatNumber(novel.sourceContent.length)} 字）</summary><pre>${esc(novel.sourceContent)}</pre></details>
    <div class="script-stack">${novel.scripts.length ? novel.scripts.map((script) => scriptCard({ ...script, novelTitle: novel.title }, true)).join("") : `<div class="empty">这本小说还没有生成文案。</div>`}</div>`;
}

function scriptCard(script, assigned) {
  const p = script.performance || {};
  const parentLabel = script.parentScriptId ? "派生改写" : "基础文案";
  return `<article class="script-card" data-script-id="${esc(script.id)}">
    <div class="script-top"><div><div class="script-tags"><span>${esc(script.versionLabel || "未命名版本")}</span><span>${parentLabel}</span>${script.novelTitle ? `<span>${esc(script.novelTitle)}</span>` : ""}</div><h3>${esc(script.title || "未命名文案")}</h3><small class="muted">文案 ID：${esc(script.id)}${script.hookVariantId ? ` · 开头版本：${esc(script.hookVariantId)}` : ""}</small></div>
    <div class="script-metrics"><div><strong>${formatNumber(p.videoCount)}</strong><small>视频</small></div><div><strong>${formatNumber(p.accountCount)}</strong><small>测试账号</small></div><div><strong>${formatNumber(p.totalViews)}</strong><small>总播放</small></div><div><strong>${formatNumber(p.averageViews)}</strong><small>均播</small></div><div><strong>${formatNumber(p.comments)}</strong><small>评论</small></div></div></div>
    <div class="script-audio">${script.audio ? `<label><input class="audio-check" type="checkbox" value="${esc(script.audio.id)}" /> 选择音频</label><audio controls preload="none" src="/api/audio-library/${encodeURIComponent(script.audio.id)}/file"></audio>` : `<span class="muted">尚未生成音频</span>${script.marketingId && script.marketingRank ? `<button class="generate-audio-btn" data-marketing-id="${esc(script.marketingId)}" data-rank="${script.marketingRank}" type="button">生成对应音频</button>` : ""}`}</div>
    <details class="script-copy"><summary>查看文案全文（${formatNumber(script.text.length)} 字）</summary><pre>${esc(script.text)}</pre></details>
    ${assigned ? videoTable(script.videos) : assignControls(script)}
  </article>`;
}

function assignControls(script) {
  return `<div class="assign-row"><select class="novel-select"><option value="">选择所属小说</option>${state.novels.map((novel) => `<option value="${esc(novel.id)}">${esc(novel.title)}</option>`).join("")}</select><input class="version-label" placeholder="版本名称，例如：原始文案" value="${esc(script.versionLabel || "")}" /><button class="assign-btn" type="button">归入小说</button></div>`;
}

function videoTable(videos = []) {
  if (!videos.length) return `<div class="muted" style="margin-top:12px">尚未匹配到使用该文案/音频发布的视频。</div>`;
  return `<details class="video-details"><summary>查看对应的 ${videos.length} 条视频</summary><table class="video-table"><thead><tr><th>视频 ID</th><th>账号</th><th>播放</th><th>点赞</th><th>评论</th><th>发布时间</th></tr></thead><tbody>${videos.map((video) => `<tr><td>${esc(video.videoId || "--")}</td><td>${esc(video.username || "--")}</td><td>${formatNumber(video.views)}</td><td>${formatNumber(video.likes)}</td><td>${formatNumber(video.comments)}</td><td>${formatTimestamp(video.publishedAt)}</td></tr>`).join("")}</tbody></table></details>`;
}

function metrics(p) { return `<div class="novel-performance">${[["文案版本",p.videoCount === undefined ? 0 : ""],["发布视频",p.videoCount],["测试账号",p.accountCount],["总播放",p.totalViews],["平均播放",p.averageViews],["最高播放",p.maxViews]].map(([label,value], index) => `<div class="metric"><span>${label}</span><strong>${index === 0 ? formatNumber(state.novels.find((item)=>item.id===selectedNovelId)?.scripts.length) : formatNumber(value)}</strong></div>`).join("")}</div>`; }

function wireCards() {
  document.querySelectorAll(".audio-check").forEach((box) => box.addEventListener("change", updateSelection));
  document.querySelectorAll(".assign-btn").forEach((button) => button.addEventListener("click", async () => {
    const card = button.closest(".script-card"); const novelId = card.querySelector(".novel-select").value; const versionLabel = card.querySelector(".version-label").value;
    if (!novelId) return setStatus("请先选择所属小说。", "error");
    try { await api(`/api/novel-content/scripts/${encodeURIComponent(card.dataset.scriptId)}/assign`, { method:"POST", body:JSON.stringify({ novelId, versionLabel }) }); await loadContent(); }
    catch (error) { setStatus(error.message, "error"); }
  }));
  document.querySelectorAll(".generate-audio-btn").forEach((button) => button.addEventListener("click", async () => {
    pendingMarketing = { marketingId: button.dataset.marketingId, rank: Number(button.dataset.rank) };
    await generatePendingAudio();
  }));
  document.querySelectorAll(".generate-scripts-btn").forEach((button) => button.addEventListener("click", () => generateScripts(button.dataset.novelId)));
}

async function generateScripts(novelId) {
  const novel = state.novels.find((item) => item.id === novelId);
  if (!novel) return;
  setStatus(`正在根据《${novel.title}》原文生成 5 个可测试文案版本，请稍候...`);
  document.querySelectorAll(".generate-scripts-btn").forEach((button) => { button.disabled = true; });
  try {
    await api("/api/novel-marketing/generate", {
      method: "POST",
      body: JSON.stringify({
        title: novel.title,
        category: novel.category,
        language: "English",
        audience: "TikTok short-form story viewers",
        sellingPoint: "Create distinct testable openings while preserving the original story facts.",
        sourceText: novel.sourceContent
      })
    });
    await loadContent();
    setStatus("5 个文案版本已生成并归入当前小说，可分别生成音频后测试。", "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    document.querySelectorAll(".generate-scripts-btn").forEach((button) => { button.disabled = false; });
  }
}

async function createNovel(event) {
  event.preventDefault(); const data = Object.fromEntries(new FormData(el.createNovelForm));
  try { const result = await api("/api/novel-content/novels", { method:"POST", body:JSON.stringify(data) }); selectedNovelId = result.novel.id; el.createNovelForm.reset(); await loadContent(); }
  catch (error) { setStatus(error.message, "error"); }
}

function showTab(tab) {
  const valid = ["novels","scripts","unassigned"].includes(tab) ? tab : "novels";
  document.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.tab === valid));
  el.novelsTab.hidden = valid !== "novels"; el.scriptsTab.hidden = valid !== "scripts"; el.unassignedTab.hidden = valid !== "unassigned";
}

function updateSelection() { const count = document.querySelectorAll("#scriptsTab .audio-check:checked").length; el.selectedCount.textContent = `${count} 条已选`; }
async function prepareTask() { const ids = Array.from(new Set(Array.from(document.querySelectorAll("#scriptsTab .audio-check:checked")).map((box) => box.value))); if (!ids.length) return setStatus("请先选择音频。", "error"); try { const batch = await api("/api/audio-library/prepare-task", { method:"POST", body:JSON.stringify({ ids }) }); location.href = `/tasks?${new URLSearchParams({ source:"audio-library", audioDir:batch.audioDir, count:String(batch.count), batchId:batch.batchId })}`; } catch(error){setStatus(error.message,"error");} }
async function autoGenerateFromQuery(){const params=new URLSearchParams(location.search);if(params.get("autostart")!=="1")return;pendingMarketing={marketingId:params.get("marketingId"),rank:Number(params.get("rank"))};showTab("scripts");await generatePendingAudio();}
async function generatePendingAudio(){if(!pendingMarketing)return;setStatus("正在调用 ElevenLabs 生成音频...");try{const data=await api("/api/audio-library/generate",{method:"POST",body:JSON.stringify({...pendingMarketing,voiceId:el.voiceId.value.trim()})});if(el.voiceId.value.trim())localStorage.setItem("elevenlabs-voice-id",el.voiceId.value.trim());pendingMarketing=null;history.replaceState({},"","/novel-content?tab=scripts");await loadContent();setStatus(data.item.cacheHit?"已载入之前生成的相同音频。":"音频生成完成并已挂到对应文案。","success");}catch(error){el.retryAudioBtn.hidden=false;setStatus(error.message,"error");}}

function setStatus(message,tone=""){el.pageStatus.textContent=message;el.pageStatus.className=`page-status${tone?` is-${tone}`:""}`;}
async function api(url,options={}){const response=await fetch(url,{headers:{"Content-Type":"application/json"},...options});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||`请求失败：${response.status}`);return body;}
function formatNumber(value){return new Intl.NumberFormat("zh-CN").format(Number(value)||0)}function formatTime(value){return value?new Date(value).toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}):"--"}function formatTimestamp(value){return value?new Date(Number(value)*(Number(value)<1e12?1000:1)).toLocaleString("zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}):"--"}function esc(value){return String(value??"").replace(/[&<>'"]/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]))}
