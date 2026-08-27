const elements = {
  toggleImportButton: document.querySelector("#toggleImportBtn"),
  importPanel: document.querySelector("#importPanel"),
  importInput: document.querySelector("#importInput"),
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
  elements.toggleImportButton.textContent = elements.importPanel.hidden ? "导入视频" : "收起导入";
  if (!elements.importPanel.hidden) elements.importInput?.focus();
});

elements.importButton?.addEventListener("click", importHits);
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
      : "还没有同行爆款。点右上角导入，或让 GrokBot 提交视频链接、播放量、视频数据和小说信息。";
    elements.listStatus.className = "list-status";
  }
  if (!elements.hitList) return;
  if (!items.length) {
    elements.hitList.innerHTML = `<tr><td colspan="7"><div class="empty-state">这个范围还没有同行视频。</div></td></tr>`;
    return;
  }
  elements.hitList.innerHTML = items.map((item) => `
    <tr>
      <td class="cell-date">${escapeHtml(formatDate(item.importedAt || item.updatedAt))}</td>
      <td class="cell-title">${novelTitleCell(item)}</td>
      <td class="cell-mono">${escapeHtml(item.novelId || "未设置")}</td>
      <td class="cell-play">${escapeHtml(formatPlayCount(item.playCount))}</td>
      <td class="cell-video"><a href="${escapeAttr(item.videoUrl)}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(item.videoUrl))}</a></td>
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
  let payload;
  try {
    payload = parseImportText(elements.importInput?.value || "");
  } catch (error) {
    return setImportStatus(error.message.includes("JSON") ? error.message : "JSON 格式不对。", "error");
  }
  if (elements.importButton) {
    elements.importButton.disabled = true;
    elements.importButton.textContent = "正在写入...";
  }
  setImportStatus("正在导入同行视频...");
  try {
    const data = await api("/api/peer-hits/import", { method: "POST", body: JSON.stringify(payload) });
    const listed = await api("/api/peer-hits");
    state.items = Array.isArray(listed.items) ? listed.items : [];
    renderList();
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

function parseImportText(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("先粘贴 JSON。");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("JSON 格式不对。");
  }
  if (Array.isArray(data) || (data && typeof data === "object")) return data;
  throw new Error("JSON 必须是一条对象或一个数组。");
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
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
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
