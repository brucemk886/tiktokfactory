const MODULE_FROM_PATH = {
  "/novel-publish": { module: "novel-promotion", label: "小说推文", kicker: "NOVEL PUBLISH" },
  "/mid-video-publish": { module: "mid-video", label: "中视频", kicker: "MID VIDEO PUBLISH" },
  "/psychology-publish": { module: "psychology", label: "心理学", kicker: "PSYCHOLOGY PUBLISH" },
};

const page = MODULE_FROM_PATH[location.pathname.replace(/\/$/, "") || "/"] || { module: "", label: "项目", kicker: "MODULE PUBLISH" };
const state = { module: page.module, accounts: [], groups: [], project: null, videos: [] };
const $ = (selector) => document.querySelector(selector);

document.title = `${page.label} · 视频发布`;
$("#pageKicker").textContent = page.kicker;
$("#pageTitle").textContent = `${page.label} · 视频发布`;
$("#refreshBtn")?.addEventListener("click", load);
$("#publishBtn")?.addEventListener("click", publishSelected);
load();

async function load() {
  showStatus("正在读取本项目已分配的账号…");
  try {
    const [accountsRes, videosRes] = await Promise.all([
      fetch(`/api/official-tiktok/publish-accounts?module=${encodeURIComponent(state.module)}&t=${Date.now()}`, { cache: "no-store" }),
      fetch(`/api/factory/recent-videos?t=${Date.now()}`, { cache: "no-store" }),
    ]);
    const accountsData = await accountsRes.json();
    const videosData = await videosRes.json().catch(() => ({ videos: [] }));
    if (!accountsRes.ok) throw new Error(accountsData.error || "读取账号失败");
    state.project = accountsData.project || null;
    state.groups = accountsData.groups || [];
    state.accounts = accountsData.accounts || [];
    state.videos = videosData.videos || [];
    render();
    hideStatus();
  } catch (error) {
    showStatus(error.message || "读取失败");
  }
}

function render() {
  const projectName = state.project?.name || page.label;
  $("#pageCopy").textContent = state.groups.length
    ? `${projectName} 下已分配 ${state.groups.map((item) => item.name).join("、")}，只发布到这些分组里的账号。`
    : "还没有分配本项目的账号分组。请让管理员在账户管理里勾选分组。";
  $("#groupPanel").innerHTML = state.groups.length
    ? `<div class="section-title"><div><p>GROUPS</p><h2>${escapeHtml(projectName)}</h2></div></div>
      <div class="group-chips">${state.groups.map((group) => `<span class="group-chip">${escapeHtml(group.name)} · ${group.accountCount || 0} 个账号</span>`).join("")}</div>`
    : `<div class="empty">这个项目下还没有分配给你的分组。</div>`;
  $("#accountCount").textContent = `${state.accounts.length} 个账号`;
  $("#accountList").innerHTML = state.accounts.length
    ? state.accounts.map((account) => {
      const id = account.connectionId || account.id || "";
      const name = account.displayName || account.label || account.username || id;
      const username = account.username ? `@${account.username}` : id;
      return `<label class="check-row"><input class="publish-account" type="checkbox" value="${escapeAttr(id)}"><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(username)} · ${escapeHtml(account.groupName || "未分组")}</small></span></label>`;
    }).join("")
    : `<div class="empty">${state.groups.length ? "分组里还没有可发布的官方账号。" : "请先分配账号分组。"}</div>`;
  $("#videoCount").textContent = `${state.videos.length} 条成片`;
  $("#videoList").innerHTML = state.videos.length
    ? state.videos.map((video) => `<label class="check-row"><input class="publish-video" type="checkbox" value="${escapeAttr(video.fileName)}"><span><strong>${escapeHtml(video.fileName)}</strong><small>${escapeHtml(video.title || "")} · ${formatTime(video.createdAt)}</small></span></label>`).join("")
    : `<div class="empty">先在本模块模板里出片，成片会出现在这里，再勾选账号发布。</div>`;
}

async function publishSelected() {
  const connectionIds = Array.from(document.querySelectorAll(".publish-account:checked")).map((input) => input.value).filter(Boolean);
  const videos = Array.from(document.querySelectorAll(".publish-video:checked")).map((input) => ({ fileName: input.value }));
  if (!connectionIds.length) return setResult("请先勾选本项目已分配的账号。");
  if (!videos.length) return setResult("请先勾选要发布的成片。");
  const scheduleAt = $("#publishTime").value ? Math.floor(new Date($("#publishTime").value).getTime() / 1000) : 0;
  $("#publishBtn").disabled = true;
  setResult(`正在提交 ${videos.length} 条视频到 ${connectionIds.length} 个账号…`);
  try {
    const response = await fetch("/api/official-tiktok/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module: state.module,
        videos,
        connectionIds,
        videoDesc: $("#publishDesc").value || "",
        scheduleAt,
        intervalMinutes: Number($("#publishInterval").value || 0),
        name: `${page.label} 视频发布`,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "发布失败");
    setResult(data.message || `已下发发布任务 ${data.jobId || ""}。工人机会按分配的账号上传。`);
  } catch (error) {
    setResult(error.message || "发布失败");
  } finally {
    $("#publishBtn").disabled = false;
  }
}

function setResult(message) {
  $("#publishResult").textContent = message;
}

function showStatus(message) {
  const node = $("#pageStatus");
  if (!node) return;
  node.textContent = message;
  node.classList.add("is-visible");
}

function hideStatus() {
  $("#pageStatus")?.classList.remove("is-visible");
}

function formatTime(value) {
  const timestamp = Number(value || 0);
  return timestamp ? new Date(timestamp).toLocaleString("zh-CN", { hour12: false }) : "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
}

function escapeAttr(value) {
  return escapeHtml(value);
}
