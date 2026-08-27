const elements = {
  toggleImportButton: document.querySelector("#toggleImportBtn"),
  importPanel: document.querySelector("#importPanel"),
  importForm: document.querySelector("#importForm"),
  importNovelTitle: document.querySelector("#importNovelTitle"),
  importNovelId: document.querySelector("#importNovelId"),
  importVideoUrl: document.querySelector("#importVideoUrl"),
  importPlayCount: document.querySelector("#importPlayCount"),
  importLikes: document.querySelector("#importLikes"),
  importComments: document.querySelector("#importComments"),
  importShares: document.querySelector("#importShares"),
  importAudio: document.querySelector("#importAudio"),
  importButton: document.querySelector("#importBtn"),
  importStatus: document.querySelector("#importStatus"),
  listStatus: document.querySelector("#listStatus"),
  searchInput: document.querySelector("#searchInput"),
  hitList: document.querySelector("#hitList")
};

const state = {
  items: [],
  query: ""
};

elements.toggleImportButton?.addEventListener("click", () => {
  if (!elements.importPanel) return;
  elements.importPanel.hidden = !elements.importPanel.hidden;
  elements.toggleImportButton.textContent = elements.importPanel.hidden ? "导入同行爆款" : "收起导入";
  if (!elements.importPanel.hidden) elements.importVideoUrl?.focus();
});

elements.importForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  importHits();
});
elements.searchInput?.addEventListener("input", () => {
  state.query = elements.searchInput.value.trim();
  renderList();
});

loadList();

async function loadList() {
  if (elements.listStatus) elements.listStatus.textContent = "正在读取同行爆款...";
  try {
    const data = await api("/api/peer-hits");
    state.items = Array.isArray(data.items) ? data.items : [];
    renderList();
  } catch (error) {
    if (elements.listStatus) {
      elements.listStatus.textContent = error.message || "读取同行爆款失败。";
      elements.listStatus.className = "list-status is-error";
    }
  }
}

function renderList() {
  const items = visibleItems();
  if (elements.listStatus) {
    elements.listStatus.textContent = state.items.length
      ? `共 ${state.items.length} 条同行视频${state.query ? `，当前显示 ${items.length} 条` : ""}`
      : "还没有同行爆款。点右上角「导入同行爆款」，填入视频链接、播放量，也可以一起导入音频。";
    elements.listStatus.className = "list-status";
  }
  if (!elements.hitList) return;
  if (!items.length) {
    elements.hitList.innerHTML = `<tr><td colspan="8"><div class="empty-state">这个范围还没有同行视频。</div></td></tr>`;
    return;
  }
  elements.hitList.innerHTML = items.map((item) => `
    <tr>
      <td class="cell-date">${escapeHtml(formatDate(item.importedAt || item.updatedAt))}</td>
      <td class="cell-title">${novelTitleCell(item)}</td>
      <td class="cell-mono">${escapeHtml(item.novelId || "未设置")}</td>
      <td class="cell-play">${escapeHtml(formatPlayCount(item.playCount))}</td>
      <td class="cell-video"><a href="${escapeAttr(item.videoUrl)}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(item.videoUrl))}</a></td>
      <td class="cell-audio">${item.audioId ? `<audio controls preload="none" src="/api/peer-hits/${encodeURIComponent(item.id)}/audio"></audio>` : "未导入"}</td>
      <td class="cell-data">${escapeHtml(formatVideoData(item.videoData))}</td>
      <td class="row-actions">
        <button class="edit-button delete-button" type="button" data-delete-id="${escapeAttr(item.id)}">删除</button>
      </td>
    </tr>
  `).join("");
  elements.hitList.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", () => deleteHit(button.dataset.deleteId));
  });
}

function visibleItems() {
  const needle = state.query.toLowerCase();
  if (!needle) return state.items;
  return state.items.filter((item) => [
    item.novelTitle,
    item.novelId,
    item.videoUrl,
    formatVideoData(item.videoData)
  ].join(" ").toLowerCase().includes(needle));
}

async function importHits() {
  const payload = readImportForm();
  if (!payload.videoUrl) return setImportStatus("请填写视频链接。", "error");
  const audio = elements.importAudio?.files?.[0];
  if (audio && !/\.mp3$/i.test(audio.name || "") && !/audio\/mpeg|audio\/mp3/i.test(audio.type || "")) {
    return setImportStatus("音频只接受 mp3。", "error");
  }
  if (elements.importButton) {
    elements.importButton.disabled = true;
    elements.importButton.textContent = "正在写入...";
  }
  setImportStatus(audio ? "正在导入同行爆款和音频..." : "正在导入同行爆款...");
  try {
    const form = new FormData();
    form.append("videoUrl", payload.videoUrl);
    form.append("playCount", payload.playCount);
    form.append("novelTitle", payload.novelTitle);
    form.append("novelId", payload.novelId);
    form.append("likes", payload.videoData.点赞 || "");
    form.append("comments", payload.videoData.评论 || "");
    form.append("shares", payload.videoData.分享 || "");
    if (audio) form.append("audio", audio);
    const data = await api("/api/peer-hits/import", { method: "POST", body: form });
    const listed = await api("/api/peer-hits");
    state.items = Array.isArray(listed.items) ? listed.items : [];
    renderList();
    clearImportForm();
    setImportStatus(data.message || "已写入。", "ok");
  } catch (error) {
    setImportStatus(error.message || "导入失败。", "error");
  } finally {
    if (elements.importButton) {
      elements.importButton.disabled = false;
      elements.importButton.textContent = "写入列表";
    }
  }
}

function readImportForm() {
  const likes = elements.importLikes?.value.trim() || "";
  const comments = elements.importComments?.value.trim() || "";
  const shares = elements.importShares?.value.trim() || "";
  const videoData = {};
  if (likes) videoData.点赞 = likes;
  if (comments) videoData.评论 = comments;
  if (shares) videoData.分享 = shares;
  return {
    videoUrl: elements.importVideoUrl?.value.trim() || "",
    playCount: elements.importPlayCount?.value.trim() || "",
    novelTitle: elements.importNovelTitle?.value.trim() || "",
    novelId: elements.importNovelId?.value.trim() || "",
    videoData
  };
}

function clearImportForm() {
  for (const input of [
    elements.importNovelTitle,
    elements.importNovelId,
    elements.importVideoUrl,
    elements.importPlayCount,
    elements.importLikes,
    elements.importComments,
    elements.importShares,
    elements.importAudio
  ]) {
    if (input) input.value = "";
  }
}

async function deleteHit(id) {
  if (!id || !window.confirm("删除这条同行视频？")) return;
  try {
    await api(`/api/peer-hits/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.items = state.items.filter((item) => item.id !== id);
    renderList();
  } catch (error) {
    if (elements.listStatus) {
      elements.listStatus.textContent = error.message || "删除失败。";
      elements.listStatus.className = "list-status is-error";
    }
  }
}

function novelTitleCell(item) {
  const title = item.novelTitle || "未设置小说名称";
  if (item.factoryNovelId) {
    return `<strong><a href="/novel-audio?novel=${encodeURIComponent(item.factoryNovelId)}">${escapeHtml(title)}</a></strong>`;
  }
  return `<strong>${escapeHtml(title)}</strong>`;
}

function formatVideoData(data) {
  if (!data || typeof data !== "object") return "—";
  const pairs = [
    ["点赞", data.点赞 ?? data.likes ?? data.likeCount],
    ["评论", data.评论 ?? data.comments ?? data.commentCount],
    ["分享", data.分享 ?? data.shares ?? data.shareCount],
    ["收藏", data.收藏 ?? data.saves ?? data.collectCount]
  ].filter(([, value]) => value != null && String(value).trim() !== "");
  if (pairs.length) return pairs.map(([label, value]) => `${label} ${value}`).join(" · ");
  const leftover = Object.entries(data).filter(([, value]) => value != null && String(value).trim() !== "").slice(0, 4);
  return leftover.length ? leftover.map(([key, value]) => `${key} ${value}`).join(" · ") : "—";
}

function formatPlayCount(value) {
  const count = Number(value) || 0;
  if (count >= 10_000) {
    const wan = count / 10_000;
    return `${wan.toFixed(wan >= 10 ? 0 : 1).replace(/\.0$/, "")}万`;
  }
  return new Intl.NumberFormat("zh-CN").format(count);
}

function formatDate(value) {
  const date = new Date(Number(value) || 0);
  if (Number.isNaN(date.getTime()) || !Number(value)) return "未记录";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function shortUrl(value) {
  return String(value || "").replace(/^https?:\/\/(www\.)?/i, "");
}

function setImportStatus(message, tone = "") {
  if (!elements.importStatus) return;
  elements.importStatus.textContent = message;
  elements.importStatus.className = tone === "ok" ? "is-ok" : tone === "error" ? "is-error" : "";
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败：${response.status}`);
  return body;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}
