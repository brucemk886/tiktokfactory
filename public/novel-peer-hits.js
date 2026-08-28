const elements = {
  toggleImportButton: document.querySelector("#toggleImportBtn"),
  importPanel: document.querySelector("#importPanel"),
  importForm: document.querySelector("#importForm"),
  importPlatform: document.querySelector("#importPlatform"),
  importNovelTitle: document.querySelector("#importNovelTitle"),
  importNovelId: document.querySelector("#importNovelId"),
  importVideoUrl: document.querySelector("#importVideoUrl"),
  importPlayCount: document.querySelector("#importPlayCount"),
  importPublishedAt: document.querySelector("#importPublishedAt"),
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
  hitList: document.querySelector("#hitList"),
  pager: document.querySelector("#hitPager")
};

const state = {
  items: [],
  query: "",
  platform: "all",
  range: "all",
  bookId: "",
  factoryNovelId: "",
  selectedIds: new Set(),
  expandedIds: new Set(),
  importing: false,
  page: 1,
  pageSize: 20
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
  state.bookId = "";
  state.factoryNovelId = "";
  state.page = 1;
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
    state.bookId = "";
    state.factoryNovelId = "";
    state.page = 1;
    state.selectedIds.clear();
    document.querySelectorAll("[data-platform]").forEach((item) => item.classList.toggle("is-active", item === button));
    renderList();
  });
});
document.querySelectorAll("[data-range]").forEach((button) => {
  button.addEventListener("click", () => {
    if (state.range === button.dataset.range) return;
    state.range = button.dataset.range || "all";
    state.page = 1;
    state.selectedIds.clear();
    document.querySelectorAll("[data-range]").forEach((item) => item.classList.toggle("is-active", item === button));
    loadList();
  });
});

applyIncomingFilters();
loadList();

function applyIncomingFilters() {
  const params = new URLSearchParams(location.search);
  const platform = String(params.get("platform") || "").trim();
  const bookId = String(params.get("bookId") || "").trim();
  const novel = String(params.get("novel") || "").trim();
  const query = String(params.get("query") || bookId || "").trim();
  if (["GoodNovel", "MotoNovel", "NovelMaster"].includes(platform)) {
    state.platform = platform;
    document.querySelectorAll("[data-platform]").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.platform === platform);
    });
  }
  state.bookId = bookId;
  state.factoryNovelId = novel;
  if (query && elements.searchInput) {
    elements.searchInput.value = query;
    state.query = query;
  }
}

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
  const pageCount = Math.max(1, Math.ceil(items.length / state.pageSize));
  if (state.page > pageCount) state.page = pageCount;
  const pageItems = items.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
  const importedCount = items.filter((item) => item.importedToAudioBoard).length;
  const scoped = scopedItems();
  const overlapped = Math.max(0, scoped.length - collapseScaleRunHits(scoped).length);
  if (elements.listStatus) {
    elements.listStatus.textContent = state.items.length
      ? `${platformLabel(state.platform)} ${rangeLabel(state.range)} ${items.length} 条，第 ${state.page}/${pageCount} 页，播放量从高到低${overlapped ? `，同一音频重叠收起 ${overlapped} 条` : ""}${importedCount ? `，${importedCount} 条已写入音频页` : ""}${state.query || state.platform !== "all" ? `，全部 ${state.items.length} 条` : ""}`
      : emptyCopy();
    elements.listStatus.className = "list-status";
  }
  if (!elements.hitList) return;
  if (!items.length) {
    elements.hitList.innerHTML = `<tr><td colspan="11"><div class="empty-state">这个范围还没有同行视频。</div></td></tr>`;
    renderPager(0, 1);
    syncBatchBar();
    return;
  }
  elements.hitList.innerHTML = pageItems.map((item) => `
    <tr${item.importedToAudioBoard ? " class=\"is-imported\"" : ""}>
      <td class="cell-check">${selectCell(item)}</td>
      <td class="cell-date">${escapeHtml(formatDate(item.importedAt || item.updatedAt))}</td>
      <td class="cell-date">${escapeHtml(formatPublishedAt(item.publishedAt))}</td>
      <td class="cell-title">${novelTitleCell(item)}${scaleRunActions(item)}</td>
      <td class="cell-imported">${item.importedToAudioBoard ? "是" : "否"}</td>
      <td><span class="platform-chip">${escapeHtml(item.platform || "未设置")}</span></td>
      <td class="cell-mono">${escapeHtml(item.novelId || "未设置")}</td>
      <td class="cell-play">${escapeHtml(formatPlayCount(item.playCount))}</td>
      <td class="cell-video"><a href="${escapeAttr(item.videoUrl)}" target="_blank" rel="noreferrer" title="${escapeAttr(item.videoUrl)}">${escapeHtml(shortUrl(item.videoUrl))}</a></td>
      <td class="cell-audio">${item.audioId ? `<audio controls preload="none" src="/api/peer-hits/${encodeURIComponent(item.id)}/audio"></audio>` : "未导入"}</td>
      <td class="row-actions">
        <button class="edit-button delete-button" type="button" data-delete-id="${escapeAttr(item.id)}">删除</button>
      </td>
    </tr>
    ${scaleRunDetailRow(item)}
  `).join("");
  elements.hitList.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", () => deleteHit(button.dataset.deleteId));
  });
  elements.hitList.querySelectorAll("[data-expand-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.expandId;
      if (!id) return;
      if (state.expandedIds.has(id)) state.expandedIds.delete(id);
      else state.expandedIds.add(id);
      renderList();
    });
  });
  elements.hitList.querySelectorAll("[data-select-id]").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.selectedIds.add(input.dataset.selectId);
      else state.selectedIds.delete(input.dataset.selectId);
      syncBatchBar();
    });
  });
  renderPager(items.length, pageCount);
  syncBatchBar();
}

function scopedItems() {
  return state.platform === "all"
    ? state.items
    : state.items.filter((item) => item.platform === state.platform);
}

function visibleItems() {
  const needle = state.query.toLowerCase();
  const collapsed = collapseScaleRunHits(scopedItems());
  const items = needle
    ? collapsed.filter((item) => [
      item.novelTitle,
      item.novelId,
      item.platform,
      item.factoryNovelId,
      item.importedToAudioBoard ? "是 已写入音频页" : "否",
      item.scaleRun ? "能跑量 同一音频 多条视频" : "",
      formatPublishedAt(item.publishedAt),
      item.videoUrl,
      formatVideoData(item.videoData),
      ...(Array.isArray(item.scaleRun?.videos) ? item.scaleRun.videos.flatMap((video) => [
        video.videoUrl,
        formatPlayCount(video.playCount),
        formatPublishedAt(video.publishedAt, true)
      ]) : [])
    ].join(" ").toLowerCase().includes(needle))
    : collapsed;
  const filtered = (state.factoryNovelId || state.bookId)
    ? items.filter((item) => {
      if (state.factoryNovelId && String(item.factoryNovelId || "") === state.factoryNovelId) return true;
      if (state.bookId && String(item.novelId || "").trim() === state.bookId) return true;
      return false;
    })
    : items;
  return [...filtered].sort((left, right) => {
    const play = (Number(right.playCount) || 0) - (Number(left.playCount) || 0);
    if (play) return play;
    return (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0);
  });
}

function collapseScaleRunHits(hits = []) {
  const list = Array.isArray(hits) ? hits : [];
  const hiddenIds = new Set();
  const importedPrimaryIds = new Set();
  const seen = new Set();
  for (const hit of list) {
    const videos = Array.isArray(hit.scaleRun?.videos) ? hit.scaleRun.videos : [];
    if (videos.length < 2 || seen.has(hit.id)) continue;
    const members = videos.map((video) => list.find((item) => item.id === video.id)).filter(Boolean);
    for (const member of members) seen.add(member.id);
    if (members.length < 2) continue;
    const primary = [...members].sort((left, right) => (Number(right.playCount) || 0) - (Number(left.playCount) || 0))[0];
    for (const member of members) {
      if (member.id !== primary.id) hiddenIds.add(member.id);
    }
    if (members.some((item) => item.importedToAudioBoard)) importedPrimaryIds.add(primary.id);
  }
  return list.filter((hit) => !hiddenIds.has(hit.id)).map((hit) => (
    importedPrimaryIds.has(hit.id) && !hit.importedToAudioBoard
      ? { ...hit, importedToAudioBoard: true }
      : hit
  ));
}

function pageItems() {
  const items = visibleItems();
  return items.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
}

function selectableItems() {
  return visibleItems().filter((item) => Boolean(item.audioId) && !item.importedToAudioBoard);
}

function selectablePageItems() {
  return pageItems().filter((item) => Boolean(item.audioId) && !item.importedToAudioBoard);
}

function selectCell(item) {
  if (item.importedToAudioBoard) return `<input type="checkbox" disabled title="已经写入音频页，不会再导入" />`;
  if (!item.audioId) return `<input type="checkbox" disabled title="这条还没有爆款音频" />`;
  return `<input type="checkbox" data-select-id="${escapeAttr(item.id)}" ${state.selectedIds.has(item.id) ? "checked" : ""} />`;
}

function toggleVisibleSelection(checked) {
  for (const item of selectablePageItems()) {
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
  const pageSelectable = selectablePageItems();
  const selected = selectable.filter((item) => state.selectedIds.has(item.id));
  const pageSelected = pageSelectable.filter((item) => state.selectedIds.has(item.id));
  const matched = selected.filter((item) => item.factoryNovelId);
  if (elements.selectVisible) {
    elements.selectVisible.checked = Boolean(pageSelectable.length) && pageSelected.length === pageSelectable.length;
    elements.selectVisible.indeterminate = pageSelected.length > 0 && pageSelected.length < pageSelectable.length;
    elements.selectVisible.disabled = state.importing || !pageSelectable.length;
  }
  if (elements.importToNovelsButton) elements.importToNovelsButton.disabled = state.importing || !selected.length;
  if (!elements.batchStatus || state.importing) return;
  if (!selected.length) {
    setBatchStatus("勾选有音频、还没写入音频页、且小说id和平台能对上书单的条目。已写入的不会再导入。可跨页勾选。");
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
  const ids = selectableItems().map((item) => item.id).filter((id) => state.selectedIds.has(id));
  if (!ids.length) return setBatchStatus("先勾选有音频的同行爆款。", "error");
  const total = ids.length;
  const chunkSize = 20;
  state.importing = true;
  if (elements.importToNovelsButton) elements.importToNovelsButton.disabled = true;
  let finished = 0;
  const messages = [];
  try {
    for (let offset = 0; offset < ids.length; offset += chunkSize) {
      const chunk = ids.slice(offset, offset + chunkSize);
      setImportProgress(finished, total, "正在写入音频页...");
      const data = await api("/api/peer-hits/import-to-novels", {
        method: "POST",
        body: JSON.stringify({ ids: chunk })
      });
      if (data.message) messages.push(data.message);
      finished = Math.min(offset + chunk.length, total);
      setImportProgress(finished, total, "已写入音频页");
    }
    state.selectedIds.clear();
    await loadList();
    const summary = messages[messages.length - 1] || `已导入 ${finished} 条到书单音频页`;
    setBatchStatus(`${summary}。进度 ${finished}/${total}。要拷到本机，去小说音频页下载。`, "ok");
  } catch (error) {
    setBatchStatus(`进度 ${finished}/${total}。${error.message || "写入音频页失败。"}`, "error");
  } finally {
    state.importing = false;
    if (elements.importToNovelsButton) {
      elements.importToNovelsButton.textContent = "一键导入小说音频";
      elements.importToNovelsButton.disabled = !selectableItems().some((item) => state.selectedIds.has(item.id));
    }
    if (elements.selectVisible) {
      elements.selectVisible.disabled = !selectablePageItems().length;
      elements.selectVisible.checked = false;
      elements.selectVisible.indeterminate = false;
    }
  }
}

function setImportProgress(done, total, detail = "") {
  const label = `${done}/${total}`;
  if (elements.importToNovelsButton) elements.importToNovelsButton.textContent = label;
  setBatchStatus(detail ? `导入中 ${label}：${detail}` : `导入中 ${label}`);
}

function renderPager(total, pageCount) {
  if (!elements.pager) return;
  if (total <= state.pageSize) {
    elements.pager.hidden = true;
    elements.pager.innerHTML = "";
    return;
  }
  elements.pager.hidden = false;
  const buttons = [];
  buttons.push(`<button type="button" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>上一页</button>`);
  for (let page = 1; page <= pageCount; page += 1) {
    if (pageCount > 9 && page !== 1 && page !== pageCount && Math.abs(page - state.page) > 2) {
      if (buttons[buttons.length - 1] !== "<span>…</span>") buttons.push("<span>…</span>");
      continue;
    }
    buttons.push(`<button type="button" data-page="${page}" class="${page === state.page ? "is-active" : ""}">${page}</button>`);
  }
  buttons.push(`<button type="button" data-page="${state.page + 1}" ${state.page >= pageCount ? "disabled" : ""}>下一页</button>`);
  elements.pager.innerHTML = `<span>每页 20 条 · 共 ${pageCount} 页</span>${buttons.join("")}`;
  elements.pager.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = Number(button.dataset.page);
      if (!Number.isFinite(next) || next < 1 || next > pageCount || next === state.page) return;
      state.page = next;
      renderList();
      elements.hitList?.closest(".book-table-wrap")?.scrollIntoView({ block: "start" });
    });
  });
}

function readImportForm() {
  const likes = elements.importLikes?.value.trim() || "";
  const comments = elements.importComments?.value.trim() || "";
  const shares = elements.importShares?.value.trim() || "";
  const videoData = {};
  if (likes) videoData.点赞 = likes;
  if (comments) videoData.评论 = comments;
  if (shares) videoData.分享 = shares;
  const publishedAt = parseLocalDateTime(elements.importPublishedAt?.value);
  if (publishedAt) videoData.发布时间 = publishedAt;
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
    elements.importPublishedAt,
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

function scaleRunActions(item) {
  const scaleRun = item.scaleRun;
  const count = Number(scaleRun?.videoCount) || 0;
  if (count < 2) return "";
  const others = count - 1;
  const open = state.expandedIds.has(item.id);
  return `<span class="scale-run-actions">
    <small class="scale-run-chip" title="这个脚本能跑量，同一个音频 ${count} 条视频都能跑起来">能跑量 · 同一音频 ${count} 条视频</small>
    <button class="scale-run-toggle" type="button" data-expand-id="${escapeAttr(item.id)}" aria-expanded="${open ? "true" : "false"}">${open ? "收起" : `看另外 ${others} 条`}</button>
  </span>`;
}

function scaleRunDetailRow(item) {
  if (!state.expandedIds.has(item.id)) return "";
  const videos = Array.isArray(item.scaleRun?.videos) ? item.scaleRun.videos : [];
  if (!videos.length) {
    return `<tr class="scale-run-detail"><td colspan="11"><p class="scale-run-empty">刷新页面后再看另外几条的播放量和发布时间。</p></td></tr>`;
  }
  return `<tr class="scale-run-detail"><td colspan="11"><ul class="scale-run-videos">${videos.map((video) => {
    const current = video.id === item.id;
    const href = video.videoUrl ? escapeAttr(video.videoUrl) : "";
    return `<li class="scale-run-video${current ? " is-current" : ""}">
      <strong>${current ? "本条" : "另一条"} · ${escapeHtml(formatPlayCount(video.playCount))}</strong>
      <span>发布 ${escapeHtml(formatPublishedAt(video.publishedAt, true))}</span>
      ${href ? `<a href="${href}" target="_blank" rel="noreferrer">${escapeHtml(shortUrl(video.videoUrl))}</a>` : ""}
    </li>`;
  }).join("")}</ul></td></tr>`;
}

function novelTitleCell(item) {
  const title = item.novelTitle || "未设置小说名称";
  return item.factoryNovelId
    ? `<strong title="${escapeAttr(title)}"><a href="/novel-audio?novel=${encodeURIComponent(item.factoryNovelId)}" title="${escapeAttr(title)}">${escapeHtml(title)}</a></strong>`
    : `<strong title="${escapeAttr(title)}">${escapeHtml(title)}</strong>`;
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

function formatPublishedAt(value, withTime = false) {
  const date = new Date(Number(value) || 0);
  if (Number.isNaN(date.getTime()) || !Number(value)) return "未记录";
  const day = `${date.getMonth() + 1}月${date.getDate()}日`;
  if (!withTime) return day;
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day} ${hours}:${minutes}`;
}

function parseLocalDateTime(value) {
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return 0;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])).getTime();
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
