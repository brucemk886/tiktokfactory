import { requestAudioJob } from "./audio-job.js";

const elements = {
  pageTitle: document.querySelector("#pageTitle"),
  pageLead: document.querySelector("#pageLead"),
  createButton: document.querySelector("#createBookBtn"),
  importButton: document.querySelector("#importFeishuBtn"),
  catalogView: document.querySelector("#catalogView"),
  editorView: document.querySelector("#editorView"),
  form: document.querySelector("#bookForm"),
  bookId: document.querySelector("#bookId"),
  title: document.querySelector("#bookTitle"),
  platform: document.querySelector("#bookPlatform"),
  category: document.querySelector("#bookCategory"),
  sourceBookId: document.querySelector("#bookSourceId"),
  promotionCode: document.querySelector("#bookPromotionCode"),
  sellingPoint: document.querySelector("#bookSellingPoint"),
  note: document.querySelector("#bookNote"),
  featured: document.querySelector("#bookFeatured"),
  promotionCopy: document.querySelector("#bookPromotionCopy"),
  chapters: document.querySelector("#bookChapters"),
  chapterCount: document.querySelector("#chapterCount"),
  editorTitle: document.querySelector("#editorTitle"),
  saveButton: document.querySelector("#saveBookBtn"),
  deleteButton: document.querySelector("#deleteBookBtn"),
  rewriteButton: document.querySelector("#rewriteBookBtn"),
  cancelButton: document.querySelector("#cancelEditBtn"),
  formStatus: document.querySelector("#formStatus"),
  search: document.querySelector("#searchInput"),
  listStatus: document.querySelector("#listStatus"),
  list: document.querySelector("#bookList"),
  pager: document.querySelector("#bookPager"),
  batchBar: document.querySelector("#batchBar"),
  selectVisible: document.querySelector("#selectVisibleBtn"),
  batchAudioButton: document.querySelector("#batchAudioBtn"),
  batchStatus: document.querySelector("#batchStatus")
};

const state = {
  novels: [],
  catalog: { platforms: [], totals: { novelCount: 0, featuredCount: 0, hitCount: 0 } },
  summary: { novelCount: 0, catalogCount: 0 },
  platform: "all",
  shelf: "library",
  page: 1,
  pageSize: 20,
  searchTimer: null,
  role: document.documentElement.dataset.role || "",
  deletingId: "",
  selectedIds: new Set(),
  batching: false
};

elements.form.addEventListener("submit", saveBook);
elements.cancelButton.addEventListener("click", showCatalog);
elements.createButton.addEventListener("click", () => openEditor());
elements.deleteButton.addEventListener("click", () => deleteBook(elements.bookId.value));
elements.rewriteButton?.addEventListener("click", goToRewrite);
elements.importButton.addEventListener("click", importFromFeishu);
elements.promotionCode.addEventListener("input", updatePromotionCopy);
elements.chapters.addEventListener("input", updateChapterCount);
elements.selectVisible?.addEventListener("change", () => {
  toggleVisibleSelection(elements.selectVisible.checked);
});
elements.batchAudioButton?.addEventListener("click", saveSelectedNovelAudios);
elements.search.addEventListener("input", () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(loadBooks, 250);
});
document.querySelectorAll("[data-platform]").forEach((button) => {
  button.addEventListener("click", () => {
    state.platform = button.dataset.platform;
    state.page = 1;
    document.querySelectorAll("[data-platform]").forEach((item) => item.classList.toggle("is-active", item === button));
    renderBooks();
  });
});
document.querySelectorAll("[data-shelf]").forEach((button) => {
  button.addEventListener("click", () => {
    state.shelf = button.dataset.shelf;
    state.page = 1;
    document.querySelectorAll("[data-shelf]").forEach((item) => item.classList.toggle("is-active", item === button));
    renderBooks();
  });
});

loadCurrentRole();
loadBooks();
updateChapterCount();
updatePromotionCopy();

async function loadCurrentRole() {
  try {
    const data = await api("/api/auth/me");
    state.role = data.user?.role || "";
    if (state.novels.length) renderBooks();
    syncEditorActionButtons();
    syncBatchBar();
  } catch {
    state.role = document.documentElement.dataset.role || state.role;
  }
}

function canDeleteBooks() {
  return state.role === "admin" || document.documentElement.dataset.role === "admin";
}

function canBatchAudio() {
  return canDeleteBooks();
}

async function loadBooks({ resetPage = true } = {}) {
  elements.listStatus.className = "list-status";
  elements.listStatus.textContent = "正在读取小说书单...";
  try {
    const query = elements.search.value.trim();
    const data = await api(`/api/novel-content${query ? `?query=${encodeURIComponent(query)}` : ""}`);
    state.novels = data.novels || [];
    state.catalog = data.catalog || state.catalog;
    state.summary = data.summary || state.summary;
    if (resetPage) state.page = 1;
    renderBooks();
  } catch (error) {
    elements.list.innerHTML = "";
    elements.listStatus.textContent = error.message;
    elements.listStatus.className = "list-status is-error";
  }
}

function visibleNovels() {
  return state.novels.filter((novel) => {
    if (state.platform !== "all" && novel.platform !== state.platform) return false;
    if (state.shelf === "featured") return Boolean(novel.featured);
    return true;
  }).sort((a, b) => {
    const featuredDiff = Number(Boolean(b.featured)) - Number(Boolean(a.featured));
    if (featuredDiff) return featuredDiff;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
}

function renderBooks() {
  const novels = visibleNovels();
  const counts = currentCounts();
  const pageCount = Math.max(1, Math.ceil(novels.length / state.pageSize));
  state.page = Math.min(Math.max(1, state.page), pageCount);
  const start = (state.page - 1) * state.pageSize;
  const pageNovels = novels.slice(start, start + state.pageSize);
  const scope = state.platform === "all" ? "全部平台" : state.platform;
  const shelfLabel = state.shelf === "featured" ? "重点书单" : "全书库";
  const rangeLabel = novels.length
    ? `第 ${start + 1}-${start + pageNovels.length} 本`
    : "0 本";
  const catalogCount = Number(state.summary.catalogCount || 0);
  const catalogHint = catalogCount > Number(counts.novelCount || 0) ? ` · 总表 ${catalogCount} 本` : "";
  elements.listStatus.textContent = `${scope} · ${shelfLabel} ${novels.length} 本 · ${rangeLabel} · 在用 ${counts.novelCount} · 重点 ${counts.featuredCount} · 总音频 ${currentAudioCount()}${catalogHint}`;
  if (!novels.length) {
    elements.list.innerHTML = `<tr><td colspan="9"><div class="empty-state">${emptyCopy()}</div></td></tr>`;
    renderPager(0, 1);
    syncBatchBar();
    return;
  }
  elements.list.innerHTML = pageNovels.map((novel) => `
    <tr>
      ${canBatchAudio() ? `<td class="cell-check"><input type="checkbox" data-select-id="${escapeHtml(novel.id)}" ${state.selectedIds.has(novel.id) ? "checked" : ""} /></td>` : `<td class="cell-check"></td>`}
      <td class="cell-date">${escapeHtml(formatDate(novel.createdAt))}</td>
      <td class="cell-title">
        <strong>${escapeHtml(novel.title)}</strong>
        <p>${escapeHtml(excerpt(novel.sourceContent, 72))}</p>
      </td>
      <td><span class="platform-chip">${escapeHtml(novel.platform || "未设置")}</span></td>
      <td class="cell-mono">${escapeHtml(novel.bookId || "未设置")}</td>
      <td class="cell-mono">${escapeHtml(novel.promotionCode || "未设置")}</td>
      <td class="cell-mono cell-audio">${generatedAudioCount(novel)}</td>
      <td>${novel.featured ? `<span class="mark-chip is-featured">重点</span>` : "—"}</td>
      <td class="row-actions">
        <button class="edit-button" type="button" data-edit-id="${escapeHtml(novel.id)}">编辑</button>
        <a class="edit-button audio-link" href="/novel-audio?novel=${encodeURIComponent(novel.id)}" data-audio-id="${escapeHtml(novel.id)}">查看音频</a>
        <a class="edit-button rewrite-link" href="/novel-rewrite?novel=${encodeURIComponent(novel.id)}" data-rewrite-id="${escapeHtml(novel.id)}">改写</a>
        ${canDeleteBooks() ? `<button class="edit-button delete-button" type="button" data-delete-id="${escapeHtml(novel.id)}" ${state.deletingId === novel.id ? "disabled" : ""}>删除</button>` : ""}
      </td>
    </tr>`).join("");
  elements.list.querySelectorAll("[data-edit-id]").forEach((button) => {
    button.addEventListener("click", () => openEditor(button.dataset.editId));
  });
  elements.list.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", () => deleteBook(button.dataset.deleteId));
  });
  elements.list.querySelectorAll("[data-rewrite-id]").forEach((link) => {
    link.addEventListener("click", () => stashRewriteNovel(link.dataset.rewriteId));
  });
  elements.list.querySelectorAll("[data-audio-id]").forEach((link) => {
    link.addEventListener("click", () => stashRewriteNovel(link.dataset.audioId));
  });
  elements.list.querySelectorAll("[data-select-id]").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) state.selectedIds.add(input.dataset.selectId);
      else state.selectedIds.delete(input.dataset.selectId);
      syncBatchBar();
    });
  });
  renderPager(novels.length, pageCount);
  syncBatchBar();
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
  for (let page = 1; page <= pageCount; page++) {
    if (pageCount > 9 && page !== 1 && page !== pageCount && Math.abs(page - state.page) > 2) {
      if (buttons[buttons.length - 1] !== '<span>…</span>') buttons.push("<span>…</span>");
      continue;
    }
    buttons.push(`<button type="button" data-page="${page}" class="${page === state.page ? "is-active" : ""}">${page}</button>`);
  }
  buttons.push(`<button type="button" data-page="${state.page + 1}" ${state.page >= pageCount ? "disabled" : ""}>下一页</button>`);
  elements.pager.innerHTML = `<span>共 ${pageCount} 页</span>${buttons.join("")}`;
  elements.pager.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = Number(button.dataset.page);
      if (!Number.isFinite(next) || next < 1 || next > pageCount || next === state.page) return;
      state.page = next;
      renderBooks();
      elements.list.closest(".book-table-wrap")?.scrollIntoView({ block: "start" });
    });
  });
}

function stashRewriteNovel(id) {
  const novel = state.novels.find((item) => item.id === id);
  if (!novel) return;
  sessionStorage.setItem("lf-rewrite-novel", JSON.stringify({
    id: novel.id,
    title: novel.title,
    platform: novel.platform,
    category: novel.category,
    bookId: novel.bookId,
    promotionCode: novel.promotionCode,
    featured: novel.featured,
    sourceContent: novel.sourceContent,
    scripts: (novel.scripts || []).map((script) => ({
      id: script.id,
      title: script.title,
      text: script.text,
      versionLabel: script.versionLabel,
      parentScriptId: script.parentScriptId,
      audioId: script.audioId || script.audio?.id || "",
      audio: script.audio || null,
      sourceType: script.sourceType || "",
      createdAt: script.createdAt || "",
    }))
  }));
}

function currentCounts() {
  if (state.platform === "all") return state.catalog.totals || { novelCount: state.novels.length, featuredCount: 0, hitCount: 0, audioCount: 0 };
  return state.catalog.platforms?.find((item) => item.platform === state.platform) || { novelCount: 0, featuredCount: 0, hitCount: 0, audioCount: 0 };
}

function currentAudioCount() {
  const counted = currentCounts().audioCount;
  if (counted != null && Number.isFinite(Number(counted))) return Math.max(0, Math.floor(Number(counted)));
  const scoped = state.platform === "all"
    ? state.novels
    : state.novels.filter((novel) => novel.platform === state.platform);
  return scoped.reduce((sum, novel) => sum + generatedAudioCount(novel), 0);
}

async function importFromFeishu() {
  if (!confirm("将导入飞书「重点书单」和「历史爆款」里已有的字段。线上已经存在的书会跳过，搜索词留空给你自己填。")) return;
  elements.importButton.disabled = true;
  elements.importButton.textContent = "导入中...";
  elements.listStatus.className = "list-status";
  elements.listStatus.textContent = "正在从飞书导入重点书单和历史爆款...";
  try {
    const result = await api("/api/novel-content/feishu/import", {
      method: "POST",
      body: JSON.stringify({})
    });
    await loadBooks();
    elements.listStatus.className = "list-status";
    elements.listStatus.textContent = `飞书已新建 ${result.created || 0} 本，跳过已有 ${result.skipped || 0} 本。`;
  } catch (error) {
    elements.listStatus.textContent = error.message;
    elements.listStatus.className = "list-status is-error";
  } finally {
    elements.importButton.disabled = false;
    elements.importButton.textContent = "飞书导入";
  }
}

function emptyCopy() {
  if (state.shelf === "featured") return "这个范围还没有重点书单。新增或编辑小说时勾选「加入该平台重点书单」。";
  return "还没有符合条件的小说，点击右上角新增一本。";
}

async function saveBook(event) {
  event.preventDefault();
  const id = elements.bookId.value;
  const payload = {
    title: elements.title.value.trim(),
    platform: elements.platform.value.trim(),
    category: elements.category.value.trim(),
    bookId: elements.sourceBookId.value.trim(),
    promotionCode: elements.promotionCode.value.trim(),
    promotionCopy: promotionCopyFromCode(elements.promotionCode.value),
    sellingPoint: elements.sellingPoint.value.trim(),
    note: elements.note.value.trim(),
    featured: elements.featured.checked,
    sourceContent: elements.chapters.value.trim()
  };
  if (!payload.title) return setFormStatus("请填写小说名称。", "error");
  if (!payload.platform) return setFormStatus("请选择小说平台。", "error");
  if (payload.sourceContent.length < 20) return setFormStatus("免费章节至少需要 20 个字符。", "error");
  elements.saveButton.disabled = true;
  elements.saveButton.textContent = "保存中...";
  try {
    await api(id ? `/api/novel-content/novels/${encodeURIComponent(id)}` : "/api/novel-content/novels", {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(payload)
    });
    showCatalog();
    await loadBooks();
  } catch (error) {
    setFormStatus(error.message, "error");
  } finally {
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = elements.bookId.value ? "保存修改" : "保存小说";
  }
}

async function openEditor(id = "") {
  let novel = id ? state.novels.find((item) => item.id === id) : null;
  if (id && !novel) return;
  if (id) {
    try {
      const data = await api(`/api/novel-content/novels/${encodeURIComponent(id)}`);
      novel = data.novel || novel;
    } catch (error) {
      elements.listStatus.textContent = error.message;
      elements.listStatus.className = "list-status is-error";
      return;
    }
  }
  elements.form.reset();
  elements.bookId.value = novel?.id || "";
  elements.title.value = novel?.title || "";
  elements.platform.value = novel?.platform || "";
  elements.category.value = novel?.category || "";
  elements.sourceBookId.value = novel?.bookId || "";
  elements.promotionCode.value = novel?.promotionCode || "";
  elements.sellingPoint.value = novel?.sellingPoint || "";
  elements.note.value = novel?.note || "";
  elements.chapters.value = novel?.sourceContent || "";
  elements.featured.checked = Boolean(novel?.featured);
  elements.editorTitle.textContent = novel ? "编辑小说" : "新增小说";
  elements.saveButton.textContent = novel ? "保存修改" : "保存小说";
  elements.pageTitle.textContent = novel ? "编辑小说" : "新增小说";
  elements.pageLead.textContent = novel
    ? "修改书单信息。重点可在这里勾选。播放和爆款在数据概览查看。"
    : "填写小说后保存，会回到书单列表。重点是创建时勾选的标记。";
  setFormStatus("");
  updateChapterCount();
  updatePromotionCopy();
  syncEditorActionButtons();
  elements.catalogView.hidden = true;
  elements.editorView.hidden = false;
  elements.createButton.hidden = true;
  elements.importButton.hidden = true;
  if (elements.batchBar) elements.batchBar.hidden = true;
  elements.title.focus();
}

function syncEditorDeleteButton() {
  if (!elements.deleteButton) return;
  elements.deleteButton.hidden = !elements.bookId.value || !canDeleteBooks();
  elements.deleteButton.disabled = Boolean(state.deletingId);
}

function syncEditorRewriteButton() {
  if (!elements.rewriteButton) return;
  elements.rewriteButton.hidden = !elements.bookId.value;
}

function syncEditorActionButtons() {
  syncEditorDeleteButton();
  syncEditorRewriteButton();
}

function goToRewrite() {
  const id = String(elements.bookId.value || "").trim();
  if (!id) return;
  stashRewriteNovel(id);
  location.assign(`/novel-rewrite?novel=${encodeURIComponent(id)}`);
}

async function deleteBook(id) {
  const novelId = String(id || "").trim();
  const novel = state.novels.find((item) => item.id === novelId);
  if (!novelId || !canDeleteBooks() || state.deletingId) return;
  const title = novel?.title || "这本小说";
  if (!confirm(`确定删除「${title}」？书单和这本书的改写文案会一起删掉，已生成的音频和发布记录会保留。`)) return;
  state.deletingId = novelId;
  syncEditorActionButtons();
  elements.listStatus.className = "list-status";
  elements.listStatus.textContent = `正在删除「${title}」...`;
  try {
    await api(`/api/novel-content/novels/${encodeURIComponent(novelId)}`, { method: "DELETE" });
    if (elements.bookId.value === novelId) showCatalog();
    await loadBooks({ resetPage: false });
    elements.listStatus.className = "list-status";
    elements.listStatus.textContent = `已删除「${title}」。`;
  } catch (error) {
    elements.listStatus.textContent = error.message;
    elements.listStatus.className = "list-status is-error";
    if (!elements.catalogView.hidden) renderBooks();
    else setFormStatus(error.message, "error");
  } finally {
    state.deletingId = "";
    syncEditorActionButtons();
  }
}

function showCatalog() {
  elements.form.reset();
  elements.bookId.value = "";
  elements.featured.checked = false;
  elements.editorTitle.textContent = "新增小说";
  elements.saveButton.textContent = "保存小说";
  elements.pageTitle.textContent = "小说书单";
  elements.pageLead.textContent = "按平台查看全书库和重点书单。重点在创建或编辑时勾选。播放和爆款在数据概览查看。";
  setFormStatus("");
  updateChapterCount();
  updatePromotionCopy();
  syncEditorActionButtons();
  elements.editorView.hidden = true;
  elements.catalogView.hidden = false;
  elements.createButton.hidden = false;
  elements.importButton.hidden = false;
  syncBatchBar();
}

function promotionCopyFromCode(code = "") {
  return `Search 『${String(code || "").trim()}』 on Novel Master APP to get the following`;
}

function updatePromotionCopy() {
  elements.promotionCopy.textContent = promotionCopyFromCode(elements.promotionCode.value);
}

function updateChapterCount() {
  elements.chapterCount.textContent = `${formatNumber(elements.chapters.value.length)} / 200,000`;
}

function toggleVisibleSelection(checked) {
  for (const novel of visibleNovels()) {
    if (checked) state.selectedIds.add(novel.id);
    else state.selectedIds.delete(novel.id);
  }
  renderBooks();
}

function selectedNovelIds() {
  return [...state.selectedIds].filter((id) => state.novels.some((novel) => novel.id === id));
}

function syncBatchBar() {
  if (!elements.batchBar) return;
  const show = canBatchAudio() && !elements.catalogView.hidden;
  elements.batchBar.hidden = !show;
  if (!show) return;
  const visible = visibleNovels();
  const selected = selectedNovelIds();
  if (elements.selectVisible) {
    elements.selectVisible.checked = Boolean(visible.length) && visible.every((novel) => state.selectedIds.has(novel.id));
  }
  const audioCount = selectedAudioCount();
  if (elements.batchAudioButton) {
    elements.batchAudioButton.disabled = state.batching || !selected.length;
    elements.batchAudioButton.textContent = selected.length
      ? `保存勾选的 ${audioCount} 条音频`
      : "保存勾选小说音频";
  }
  if (elements.batchStatus && !state.batching) {
    elements.batchStatus.textContent = selected.length
      ? `已勾 ${selected.length} 本，共 ${audioCount} 条音频。点一下保存到本机 F:\\音频目录\\书名\\。本机工人不要关。`
      : "先勾书，再保存这些书的已生成音频到本机。本机工人不要关。";
    elements.batchStatus.className = "";
  }
}

function setBatchStatus(message, tone = "") {
  if (!elements.batchStatus) return;
  elements.batchStatus.textContent = message;
  elements.batchStatus.className = tone ? `is-${tone}` : "";
}

function selectedNovels() {
  const selected = new Set(selectedNovelIds());
  return state.novels.filter((novel) => selected.has(novel.id));
}

function selectedAudioCount() {
  return selectedNovels().reduce((sum, novel) => sum + generatedAudioCount(novel), 0);
}

function selectedAudioScriptIds(novels = selectedNovels()) {
  const ids = [];
  for (const novel of novels) {
    for (const script of novel.scripts || []) {
      if (script.audioId || script.audio?.id) ids.push(script.id);
    }
  }
  return ids;
}

async function saveSelectedNovelAudios() {
  const novelIds = selectedNovelIds();
  if (!novelIds.length) return setBatchStatus("先勾选要保存音频的小说。", "error");
  const expected = selectedAudioCount();
  let scriptIds = selectedAudioScriptIds();
  if (scriptIds.length < expected) {
    setBatchStatus("正在核对勾选书的音频...", "");
    scriptIds = [];
    for (const novelId of novelIds) {
      const data = await api(`/api/novel-content/novels/${encodeURIComponent(novelId)}`);
      for (const script of data.novel?.scripts || []) {
        if (script.audioId || script.audio?.id) scriptIds.push(script.id);
      }
    }
  }
  if (!scriptIds.length) return setBatchStatus("勾选的书还没有已生成音频。", "error");
  if (!confirm(`将把 ${novelIds.length} 本共 ${scriptIds.length} 条音频保存到本机 F:\\音频目录\\书名\\。本机工人不要关。继续？`)) return;
  state.batching = true;
  if (elements.batchAudioButton) elements.batchAudioButton.disabled = true;
  setBatchStatus("正在下发给工人...", "");
  try {
    const result = await requestAudioJob("/api/audio-library/sync-local", {
      scriptIds,
      targetAudioDir: "__novel__"
    }, { api, onProgress: (job) => setBatchStatus(job.message || "工人机正在保存到本机...") });
    const saved = Array.isArray(result.items) ? result.items.length : scriptIds.length;
    setBatchStatus(`已保存 ${saved} 条到本机。`, "ok");
  } catch (error) {
    setBatchStatus(error.message || "保存到本机失败。", "error");
  } finally {
    state.batching = false;
    syncBatchBar();
  }
}

function setFormStatus(message, tone = "") {
  elements.formStatus.textContent = message;
  elements.formStatus.className = tone ? `is-${tone}` : "";
}

async function api(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", headers: { "Content-Type": "application/json" }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败：${response.status}`);
  return body;
}

function excerpt(value, limit = 150) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text || "暂无免费章节";
}

function generatedAudioCount(novel) {
  const counted = Number(novel?.audioCount);
  if (Number.isFinite(counted)) return Math.max(0, Math.floor(counted));
  return (Array.isArray(novel?.scripts) ? novel.scripts : []).filter((script) => {
    return Boolean(String(script?.audioId || script?.audio?.id || "").trim());
  }).length;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatNumber(value) { return new Intl.NumberFormat("zh-CN").format(Number(value) || 0); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char])); }
