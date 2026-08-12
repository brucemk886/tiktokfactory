const elements = {
  form: document.querySelector("#bookForm"),
  bookId: document.querySelector("#bookId"),
  title: document.querySelector("#bookTitle"),
  platform: document.querySelector("#bookPlatform"),
  promotionCode: document.querySelector("#bookPromotionCode"),
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

const state = { novels: [], searchTimer: null };

elements.form.addEventListener("submit", saveBook);
elements.cancelButton.addEventListener("click", resetEditor);
elements.chapters.addEventListener("input", updateChapterCount);
elements.search.addEventListener("input", () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(loadBooks, 250);
});

loadBooks();
updateChapterCount();

async function loadBooks() {
  elements.listStatus.className = "list-status";
  elements.listStatus.textContent = "正在读取小说书单...";
  try {
    const query = elements.search.value.trim();
    const data = await api(`/api/novel-content${query ? `?query=${encodeURIComponent(query)}` : ""}`);
    state.novels = data.novels || [];
    renderBooks(state.novels);
    elements.listStatus.textContent = `共 ${state.novels.length} 本小说`;
  } catch (error) {
    elements.list.innerHTML = "";
    elements.listStatus.textContent = error.message;
    elements.listStatus.className = "list-status is-error";
  }
}

function renderBooks(novels) {
  if (!novels.length) {
    elements.list.innerHTML = `<div class="empty-state">还没有符合条件的小说，从左侧新增第一本。</div>`;
    return;
  }
  elements.list.innerHTML = novels.map((novel) => `
    <article class="book-row">
      <div class="book-main">
        <span class="platform-chip">${escapeHtml(novel.platform || "未设置平台")}</span>
        <h3>${escapeHtml(novel.title)}</h3>
        <p>${escapeHtml(excerpt(novel.sourceContent))}</p>
      </div>
      <dl>
        <div><dt>推广码</dt><dd>${escapeHtml(novel.promotionCode || "未设置")}</dd></div>
        <div><dt>免费章节</dt><dd>${formatNumber((novel.sourceContent || "").length)} 字</dd></div>
        <div><dt>关联文案</dt><dd>${formatNumber(novel.scripts?.length || 0)} 条</dd></div>
      </dl>
      <button class="edit-button" type="button" data-edit-id="${escapeHtml(novel.id)}">编辑</button>
    </article>`).join("");
  elements.list.querySelectorAll("[data-edit-id]").forEach((button) => {
    button.addEventListener("click", () => editBook(button.dataset.editId));
  });
}

async function saveBook(event) {
  event.preventDefault();
  const id = elements.bookId.value;
  const payload = {
    title: elements.title.value.trim(),
    platform: elements.platform.value.trim(),
    promotionCode: elements.promotionCode.value.trim(),
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
    resetEditor();
    setFormStatus(id ? "小说已更新。" : "小说已保存。", "success");
    await loadBooks();
  } catch (error) {
    setFormStatus(error.message, "error");
  } finally {
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = elements.bookId.value ? "保存修改" : "保存小说";
  }
}

function editBook(id) {
  const novel = state.novels.find((item) => item.id === id);
  if (!novel) return;
  elements.bookId.value = novel.id;
  elements.title.value = novel.title || "";
  elements.platform.value = novel.platform || "";
  elements.promotionCode.value = novel.promotionCode || "";
  elements.chapters.value = novel.sourceContent || "";
  elements.editorTitle.textContent = "编辑小说";
  elements.saveButton.textContent = "保存修改";
  elements.cancelButton.hidden = false;
  updateChapterCount();
  elements.form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetEditor() {
  elements.form.reset();
  elements.bookId.value = "";
  elements.editorTitle.textContent = "新增小说";
  elements.saveButton.textContent = "保存小说";
  elements.cancelButton.hidden = true;
  updateChapterCount();
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

function excerpt(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 150 ? `${text.slice(0, 150)}...` : text || "暂无免费章节";
}

function formatNumber(value) { return new Intl.NumberFormat("zh-CN").format(Number(value) || 0); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char])); }
