import { waitForAudioJob } from "./audio-job.js";

const elements = {
  toggleImportButton: document.querySelector("#toggleImportBtn"),
  importPanel: document.querySelector("#importPanel"),
  importForm: document.querySelector("#importForm"),
  importPlatform: document.querySelector("#importPlatform"),
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
  selectVisible: document.querySelector("#selectVisibleBtn"),
  importToNovelsButton: document.querySelector("#importToNovelsBtn"),
  batchStatus: document.querySelector("#batchStatus"),
  hitList: document.querySelector("#hitList")
};

const state = {
  items: [],
  query: "",
  platform: "all",
  range: "all",
  selectedIds: new Set(),
  importing: false
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
elements.selectVisible?.addEventListener("change", () => {
  toggleVisibleSelection(elements.selectVisible.checked);
});
elements.importToNovelsButton?.addEventListener("click", importToNovels);
document.querySelectorAll("[data-platform]").forEach((button) => {
  button.addEventListener("click", () => {
    if (state.platform === button.dataset.platform) return;
    state.platform = button.dataset.platform || "all";
    state.selectedIds.clear();
    document.querySelectorAll("[data-platform]").forEach((item) => item.classList.toggle("is-active", item === button));
    renderList();
  });
});
document.querySelectorAll("[data-range]").forEach((button) => {
  button.addEventListener("click", () => {
    if (state.range === button.dataset.range) return;
    state.range = button.dataset.range || "all";
    state.selectedIds.clear();
    document.querySelectorAll("[data-range]").forEach((item) => item.classList.toggle("is-active", item === button));
    loadList();
  });
});

loadList();

async function loadList() {
  if (elements.listStatus) elements.listStatus.textContent = "正在读取同行爆款...";
  try {
    const params = new URLSearchParams();
    if (state.range && state.range !== "all") params.set("range", state.range);
    const since = rangeSince(state.range);
    if (since) params.set("since", String(since));
    const data = await api(`/api/peer-hits${params.toString() ? `?${params}` : ""}`);
    state.items = Array.isArray(data.items) ? data.items : [];
    pruneSelection();
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
  const importedCount = items.filter((item) => item.importedToAudioBoard).length;
  if (elements.listStatus) {
    elements.listStatus.textContent = state.items.length
      ? `${platformLabel(state.platform)} ${rangeLabel(state.range)} ${items.length} 条，播放量从高到低${importedCount ? `，${importedCount} 条已写入音频页` : ""}${state.query || state.platform !== "all" ? `，全部 ${state.items.length} 条` : ""}`
      : emptyCopy();
    elements.listStatus.className = "list-status";
  }
  if (!elements.hitList) return;
  if (!items.length) {
    elements.hitList.innerHTML = `<tr><td colspan="10"><div class="empty-state">这个范围还没有同行视频。</div></td></tr>`;
    syncBatchBar();
    return;
  }
  elements.hitList.innerHTML = items.map((item) => `
    <tr${item.importedToAudioBoard ? " class=\"is-imported\"" : ""}>
      <td class="cell-check">${selectCell(item)}</td>
      <td class="cell-date">${escapeHtml(formatDate(item.importedAt || item.updatedAt))}</td>
      <td class="cell-title">${novelTitleCell(item)}</td>
      <td><span class="platform-chip">${escapeHtml(item.platform || "未设置")}</span></td>
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
  elements.hitList.querySelectorAll("[data-select-id]").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.selectedIds.add(input.dataset.selectId);
      else state.selectedIds.delete(input.dataset.selectId);
      syncBatchBar();
    });
  });
  syncBatchBar();
}

function visibleItems() {
  const needle = state.query.toLowerCase();
  const scoped = state.platform === "all"
    ? state.items
    : state.items.filter((item) => item.platform === state.platform);
  const items = needle
    ? scoped.filter((item) => [
      item.novelTitle,
      item.novelId,
      item.platform,
      item.factoryNovelId,
      item.importedToAudioBoard ? "已写入音频页" : "",
      item.videoUrl,
      formatVideoData(item.videoData)
    ].join(" ").toLowerCase().includes(needle))
    : scoped;
  return [...items].sort((left, right) => {
    const play = (Number(right.playCount) || 0) - (Number(left.playCount) || 0);
    if (play) return play;
    return (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0);
  });
}

function selectableItems() {
  return visibleItems().filter((item) => Boolean(item.audioId) && !item.importedToAudioBoard);
}

function selectCell(item) {
  if (item.importedToAudioBoard) return `<input type="checkbox" disabled title="已经写入音频页，不会再导入" />`;
  if (!item.audioId) return `<input type="checkbox" disabled title="这条还没有爆款音频" />`;
  return `<input type="checkbox" data-select-id="${escapeAttr(item.id)}" ${state.selectedIds.has(item.id) ? "checked" : ""} />`;
}

function toggleVisibleSelection(checked) {
  for (const item of selectableItems()) {
    if (checked) state.selectedIds.add(item.id);
    else state.selectedIds.delete(item.id);
  }
  renderList();
}

function pruneSelection() {
  const known = new Set(state.items.filter((item) => item.audioId && !item.importedToAudioBoard).map((item) => item.id));
  for (const id of [...state.selectedIds]) {
    if (!known.has(id)) state.selectedIds.delete(id);
  }
}

function syncBatchBar() {
  const selectable = selectableItems();
  const selected = selectable.filter((item) => state.selectedIds.has(item.id));
  const matched = selected.filter((item) => item.factoryNovelId);
  if (elements.selectVisible) {
    elements.selectVisible.checked = Boolean(selectable.length) && selected.length === selectable.length;
    elements.selectVisible.indeterminate = selected.length > 0 && selected.length < selectable.length;
    elements.selectVisible.disabled = state.importing || !selectable.length;
  }
  if (elements.importToNovelsButton) elements.importToNovelsButton.disabled = state.importing || !selected.length;
  if (!elements.batchStatus || state.importing) return;
  if (!selected.length) {
    setBatchStatus("勾选有音频、还没写入音频页、且小说id和平台能对上书单的条目。已写入的不会再导入。一次最多 20 条。");
    return;
  }
  const extra = selected.length - matched.length;
  setBatchStatus(extra
    ? `已勾选 ${selected.length} 条，其中 ${matched.length} 条能对上书单，${extra} 条会跳过。`
    : `已勾选 ${selected.length} 条，小说id和平台都能对上书单。`);
}

async function importHits() {
  const payload = readImportForm();
  if (!payload.platform) return setImportStatus("请选择平台。", "error");
  if (!payload.videoUrl) return setImportStatus("请填写视频链接。", "error");
  const audio = elements.importAudio?.files?.[0];
  if (audio && !/\.mp3$/i.test(audio.name || "") && !/audio\/mpeg|audio\/mp3/i.test(audio.type || "")) {
    return setImportStatus("音频只接受 mp3。", "error");
  }
  if (elements.importButton) {
    elements.importButton.disabled = true;
    elements.importButton.textContent = "正在写入...";
  }
  setImportStatus("正在写入同行爆款...");
  try {
    const data = await api("/api/peer-hits/import", {
      method: "POST",
      body: JSON.stringify({
        platform: payload.platform,
        videoUrl: payload.videoUrl,
        playCount: payload.playCount,
        novelTitle: payload.novelTitle,
        novelId: payload.novelId,
        videoData: payload.videoData
      })
    });
    const hit = Array.isArray(data.items) ? data.items[0] : null;
    let message = data.message || "已写入。";
    if (audio && hit?.id) {
      setImportStatus("条目已写入，正在上传音频...");
      try {
        const uploaded = await api(`/api/peer-hits/${encodeURIComponent(hit.id)}/audio`, {
          method: "POST",
          body: appendAudioForm(audio)
        });
        message = uploaded.message ? `${message}，${uploaded.message}` : `${message}，已导入音频`;
      } catch (error) {
        message = `${message}，音频没传上去。刷新后看这条，再写入一次同一视频即可补音频。${error.message ? `（${error.message}）` : ""}`;
        await refreshListQuietly();
        clearImportForm();
        return setImportStatus(message, "error");
      }
    }
    await refreshListQuietly();
    clearImportForm();
    setImportStatus(message, "ok");
  } catch (error) {
    setImportStatus(error.message || "导入失败。", "error");
  } finally {
    if (elements.importButton) {
      elements.importButton.disabled = false;
      elements.importButton.textContent = "写入列表";
    }
  }
}

async function importToNovels() {
  const ids = selectableItems().map((item) => item.id).filter((id) => state.selectedIds.has(id)).slice(0, 20);
  if (!ids.length) return setBatchStatus("先勾选有音频的同行爆款。", "error");
  state.importing = true;
  if (elements.importToNovelsButton) {
    elements.importToNovelsButton.disabled = true;
    elements.importToNovelsButton.textContent = "正在导入...";
  }
  setBatchStatus("正在按小说id和平台写入书单音频页...");
  try {
    const data = await api("/api/peer-hits/import-to-novels", {
      method: "POST",
      body: JSON.stringify({ ids })
    });
    state.selectedIds.clear();
    await loadList();
    const jobs = Array.isArray(data.jobs) ? data.jobs.filter((job) => job?.jobId) : [];
    if (!jobs.length) {
      setBatchStatus(data.message || "没有可导入的爆款音频。", data.imported ? "ok" : "error");
      return;
    }
    const dirs = [];
    for (const job of jobs) {
      const result = await waitForAudioJob(job.jobId, {
        api,
        onProgress: (progress) => setBatchStatus(progress.message || `工人正在写入 ${job.novelTitle || "本机音频目录"}...`)
      });
      if (result?.targetAudioDir) dirs.push(`${job.novelTitle || "小说"} → ${result.targetAudioDir}`);
    }
    setBatchStatus(
      dirs.length
        ? `${data.message || "已导入到音频页"}。本机已写入：${dirs.join("；")}`
        : (data.message || "已导入到音频页。"),
      "ok"
    );
  } catch (error) {
    setBatchStatus(error.message || "网页已导入，本机目录稍后写入。请确认本机工厂已启动。", "error");
  } finally {
    state.importing = false;
    if (elements.importToNovelsButton) {
      elements.importToNovelsButton.textContent = "一键导入小说音频";
      elements.importToNovelsButton.disabled = !selectableItems().some((item) => state.selectedIds.has(item.id));
    }
    if (elements.selectVisible) {
      elements.selectVisible.disabled = !selectableItems().length;
      elements.selectVisible.checked = false;
      elements.selectVisible.indeterminate = false;
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
    platform: elements.importPlatform?.value.trim() || "",
    novelTitle: elements.importNovelTitle?.value.trim() || "",
    novelId: elements.importNovelId?.value.trim() || "",
    videoData
  };
}

function clearImportForm() {
  for (const input of [
    elements.importPlatform,
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
    state.selectedIds.delete(id);
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
  const hint = item.importedToAudioBoard
    ? "已写入音频页"
    : item.factoryNovelId
      ? "已对上书单"
      : item.novelId
        ? "小说id和平台还对不上书单"
        : "没有小说id";
  const heading = item.factoryNovelId
    ? `<strong><a href="/novel-audio?novel=${encodeURIComponent(item.factoryNovelId)}">${escapeHtml(title)}</a></strong>`
    : `<strong>${escapeHtml(title)}</strong>`;
  const mark = item.importedToAudioBoard ? `<span class="import-chip">已写入音频页</span>` : "";
  return `${heading}${mark}<p>${escapeHtml(hint)}</p>`;
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

function rangeSince(range) {
  const now = Date.now();
  if (range === "today") {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }
  if (range === "7d") return now - 7 * 86_400_000;
  if (range === "30d") return now - 30 * 86_400_000;
  return 0;
}

function platformLabel(platform) {
  return ({
    GoodNovel: "GoodNovel",
    MotoNovel: "MotoNovel",
    NovelMaster: "NovelMaster",
    all: "全部平台"
  })[platform] || "全部平台";
}

function rangeLabel(range) {
  return ({
    today: "今天",
    "7d": "近7天",
    "30d": "近30天",
    all: "全部"
  })[range] || "全部";
}

function emptyCopy() {
  if (!state.items.length) {
    return state.range === "all"
      ? "还没有同行爆款。点右上角「导入同行爆款」，选好平台，填入视频链接、播放量，也可以一起导入音频。"
      : `${rangeLabel(state.range)}还没有同行视频。`;
  }
  return `${platformLabel(state.platform)}${state.range === "all" ? "" : ` ${rangeLabel(state.range)}`}还没有同行视频。`;
}

function setImportStatus(message, tone = "") {
  if (!elements.importStatus) return;
  elements.importStatus.textContent = message;
  elements.importStatus.className = tone === "ok" ? "is-ok" : tone === "error" ? "is-error" : "";
}

function setBatchStatus(message, tone = "") {
  if (!elements.batchStatus) return;
  elements.batchStatus.textContent = message;
  elements.batchStatus.className = tone === "ok" ? "is-ok" : tone === "error" ? "is-error" : "";
}

function appendAudioForm(audio) {
  const form = new FormData();
  form.append("audio", audio);
  return form;
}

async function refreshListQuietly() {
  try {
    await loadList();
  } catch {
    if (elements.listStatus) {
      elements.listStatus.textContent = "条目可能已写入，刷新页面再看列表。";
      elements.listStatus.className = "list-status is-error";
    }
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : undefined,
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (!body.error && (response.status === 502 || response.status === 503 || response.status === 504)) {
      throw new Error("工厂忙不过来，多半是音频太大。先刷新列表，条目往往已经写进去了。");
    }
    throw new Error(body.error || `请求失败：${response.status}`);
  }
  return body;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}
