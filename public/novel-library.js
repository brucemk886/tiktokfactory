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
  cancelButton: document.querySelector("#cancelEditBtn"),
  formStatus: document.querySelector("#formStatus"),
  search: document.querySelector("#searchInput"),
  listStatus: document.querySelector("#listStatus"),
  list: document.querySelector("#bookList")
};

const state = {
  novels: [],
  catalog: { platforms: [], totals: { novelCount: 0, featuredCount: 0, hitCount: 0 } },
  platform: "all",
  shelf: "library",
  searchTimer: null
};

elements.form.addEventListener("submit", saveBook);
elements.cancelButton.addEventListener("click", showCatalog);
elements.createButton.addEventListener("click", () => openEditor());
elements.importButton.addEventListener("click", importFromFeishu);
elements.promotionCode.addEventListener("input", updatePromotionCopy);
elements.chapters.addEventListener("input", updateChapterCount);
elements.search.addEventListener("input", () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(loadBooks, 250);
});
document.querySelectorAll("[data-platform]").forEach((button) => {
  button.addEventListener("click", () => {
    state.platform = button.dataset.platform;
    document.querySelectorAll("[data-platform]").forEach((item) => item.classList.toggle("is-active", item === button));
    renderBooks();
  });
});
document.querySelectorAll("[data-shelf]").forEach((button) => {
  button.addEventListener("click", () => {
    state.shelf = button.dataset.shelf;
    document.querySelectorAll("[data-shelf]").forEach((item) => item.classList.toggle("is-active", item === button));
    renderBooks();
  });
});

loadBooks();
updateChapterCount();
updatePromotionCopy();

async function loadBooks() {
  elements.listStatus.className = "list-status";
  elements.listStatus.textContent = "正在读取小说书单...";
  try {
    const query = elements.search.value.trim();
    const data = await api(`/api/novel-content${query ? `?query=${encodeURIComponent(query)}` : ""}`);
    state.novels = data.novels || [];
    state.catalog = data.catalog || state.catalog;
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
  }).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function renderBooks() {
  const novels = visibleNovels();
  const counts = currentCounts();
  const scope = state.platform === "all" ? "全部平台" : state.platform;
  const shelfLabel = state.shelf === "featured" ? "重点书单" : "全书库";
  elements.listStatus.textContent = `${scope} · ${shelfLabel} ${novels.length} 本 · 全书库 ${counts.novelCount} · 重点 ${counts.featuredCount}`;
  if (!novels.length) {
    elements.list.innerHTML = `<tr><td colspan="8"><div class="empty-state">${emptyCopy()}</div></td></tr>`;
    return;
  }
  elements.list.innerHTML = novels.map((novel) => `
    <tr>
      <td class="cell-date">${escapeHtml(formatDate(novel.createdAt))}</td>
      <td class="cell-title">
        <strong>${escapeHtml(novel.title)}</strong>
        <p>${escapeHtml(excerpt(novel.sourceContent, 72))}</p>
      </td>
      <td><span class="platform-chip">${escapeHtml(novel.platform || "未设置")}</span></td>
      <td>${novel.category ? `<span class="channel-chip">${escapeHtml(novel.category)}</span>` : "—"}</td>
      <td class="cell-mono">${escapeHtml(novel.bookId || "未设置")}</td>
      <td class="cell-mono">${escapeHtml(novel.promotionCode || "未设置")}</td>
      <td>${novel.featured ? `<span class="mark-chip is-featured">重点</span>` : "—"}</td>
      <td class="row-actions">
        <button class="edit-button" type="button" data-edit-id="${escapeHtml(novel.id)}">编辑</button>
        <a class="edit-button audio-link" href="/novel-audio?novel=${encodeURIComponent(novel.id)}" data-audio-id="${escapeHtml(novel.id)}">查看音频</a>
        <a class="edit-button rewrite-link" href="/novel-rewrite?novel=${encodeURIComponent(novel.id)}" data-rewrite-id="${escapeHtml(novel.id)}">改写</a>
      </td>
    </tr>`).join("");
  elements.list.querySelectorAll("[data-edit-id]").forEach((button) => {
    button.addEventListener("click", () => openEditor(button.dataset.editId));
  });
  elements.list.querySelectorAll("[data-rewrite-id]").forEach((link) => {
    link.addEventListener("click", () => stashRewriteNovel(link.dataset.rewriteId));
  });
  elements.list.querySelectorAll("[data-audio-id]").forEach((link) => {
    link.addEventListener("click", () => stashRewriteNovel(link.dataset.audioId));
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
  if (state.platform === "all") return state.catalog.totals || { novelCount: state.novels.length, featuredCount: 0, hitCount: 0 };
  return state.catalog.platforms?.find((item) => item.platform === state.platform) || { novelCount: 0, featuredCount: 0, hitCount: 0 };
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
  elements.catalogView.hidden = true;
  elements.editorView.hidden = false;
  elements.createButton.hidden = true;
  elements.importButton.hidden = true;
  elements.title.focus();
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
  elements.editorView.hidden = true;
  elements.catalogView.hidden = false;
  elements.createButton.hidden = false;
  elements.importButton.hidden = false;
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

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatNumber(value) { return new Intl.NumberFormat("zh-CN").format(Number(value) || 0); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char])); }
