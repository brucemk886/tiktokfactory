const $ = (selector) => document.querySelector(selector);
const elements = {
  sourceTitle: $("#sourceTitle"), syncState: $("#syncState"), openFeishuLink: $("#openFeishuLink"), syncBtn: $("#syncBtn"),
  sheetMetric: $("#sheetMetric"), sheetRowsMetric: $("#sheetRowsMetric"), bookMetric: $("#bookMetric"), channelMetric: $("#channelMetric"),
  filteredMetric: $("#filteredMetric"), pageMetric: $("#pageMetric"), sheetSelect: $("#sheetSelect"), searchInput: $("#searchInput"),
  channelSelect: $("#channelSelect"), tagSelect: $("#tagSelect"), resetBtn: $("#resetBtn"), pageStatus: $("#pageStatus"),
  tableTitle: $("#tableTitle"), tableCaption: $("#tableCaption"), resultBadge: $("#resultBadge"), bookRows: $("#bookRows"), pagination: $("#pagination"),
  dialog: $("#bookDialog"), closeDialogBtn: $("#closeDialogBtn"), dialogChannel: $("#dialogChannel"), dialogTitle: $("#dialogTitle"),
  dialogBookId: $("#dialogBookId"), dialogTags: $("#dialogTags"), dialogSellingPoint: $("#dialogSellingPoint"), dialogReason: $("#dialogReason"),
  dialogIntro: $("#dialogIntro"), dialogSource: $("#dialogSource"), marketingPanel: $("#marketingPanel"),
  marketingModelState: $("#marketingModelState"), marketingTitle: $("#marketingTitle"), marketingCategory: $("#marketingCategory"),
  marketingLanguage: $("#marketingLanguage"), marketingAudience: $("#marketingAudience"), marketingSellingPoint: $("#marketingSellingPoint"),
  marketingSource: $("#marketingSource"), marketingCharCount: $("#marketingCharCount"), generateMarketingBtn: $("#generateMarketingBtn"),
  clearMarketingBtn: $("#clearMarketingBtn"), copyMarketingBtn: $("#copyMarketingBtn"), marketingStatus: $("#marketingStatus"),
  marketingResults: $("#marketingResults"), marketingSummary: $("#marketingSummary"), selectedMarketingList: $("#selectedMarketingList"),
  hookLibraryList: $("#hookLibraryList")
};

const state = { sheetId: "", query: "", channel: "", tag: "", page: 1, pageSize: 20, data: null, searchTimer: null, marketingResult: null };

elements.sheetSelect.addEventListener("change", () => { state.sheetId = elements.sheetSelect.value; resetFilters(false); loadLibrary(); });
elements.channelSelect.addEventListener("change", () => { state.channel = elements.channelSelect.value; state.page = 1; loadLibrary(); });
elements.tagSelect.addEventListener("change", () => { state.tag = elements.tagSelect.value; state.page = 1; loadLibrary(); });
elements.searchInput.addEventListener("input", () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => { state.query = elements.searchInput.value.trim(); state.page = 1; loadLibrary(); }, 320);
});
elements.resetBtn.addEventListener("click", () => { resetFilters(true); loadLibrary(); });
elements.syncBtn.addEventListener("click", syncCurrentSheet);
elements.closeDialogBtn.addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("click", (event) => { if (event.target === elements.dialog) elements.dialog.close(); });
elements.marketingSource.addEventListener("input", updateMarketingCharCount);
elements.generateMarketingBtn.addEventListener("click", generateMarketingAssets);
elements.clearMarketingBtn.addEventListener("click", clearMarketingForm);
elements.copyMarketingBtn.addEventListener("click", () => copyText(formatMarketingPackage(state.marketingResult)));

loadLibrary();
checkMarketingModel();

async function loadLibrary() {
  setBusy(true, "正在读取书单...");
  try {
    const params = new URLSearchParams({
      sheetId: state.sheetId,
      q: state.query,
      channel: state.channel,
      tag: state.tag,
      page: String(state.page),
      pageSize: String(state.pageSize)
    });
    const data = await api(`/api/novel-library?${params}`);
    state.data = data;
    state.sheetId = data.sheet.id;
    state.page = data.page;
    render(data);
    setBusy(false, `已读取 ${formatNumber(data.totalBooks)} 本小说，最近同步 ${formatTime(data.syncedAt)}`, "success");
  } catch (error) {
    elements.bookRows.innerHTML = `<tr><td class="empty-row" colspan="6">${escapeHtml(error.message)}</td></tr>`;
    setBusy(false, error.message, "error");
  }
}

async function syncCurrentSheet() {
  elements.syncBtn.disabled = true;
  elements.syncBtn.textContent = "正在同步...";
  setBusy(true, "正在从飞书读取当前工作表...");
  try {
    await api("/api/novel-library/sync", { method: "POST", body: JSON.stringify({ sheetId: state.sheetId }) });
    await loadLibrary();
  } catch (error) {
    setBusy(false, error.message, "error");
  } finally {
    elements.syncBtn.disabled = false;
    elements.syncBtn.textContent = "同步当前书单";
  }
}

function render(data) {
  elements.sourceTitle.textContent = data.sourceTitle;
  elements.syncState.textContent = `同步于 ${formatTime(data.syncedAt)}`;
  elements.openFeishuLink.href = data.sourceUrl || "#";
  elements.openFeishuLink.hidden = !data.sourceUrl;
  renderSheetOptions(data.sheets, data.sheet.id);
  renderFilterOptions(data.channels, data.tags);

  elements.sheetMetric.textContent = data.sheet.title;
  elements.sheetRowsMetric.textContent = `${formatNumber(data.sheet.rowCount)} 行表格容量`;
  elements.bookMetric.textContent = formatNumber(data.totalBooks);
  const female = data.books.filter((book) => book.channel.includes("女")).length;
  const male = data.books.filter((book) => book.channel.includes("男")).length;
  elements.channelMetric.textContent = data.channelTotals ? `${data.channelTotals.female} / ${data.channelTotals.male}` : `${female} / ${male}`;
  elements.filteredMetric.textContent = formatNumber(data.filteredBooks);
  elements.pageMetric.textContent = `第 ${data.page} / ${data.totalPages} 页`;
  elements.tableTitle.textContent = data.sheet.title;
  elements.tableCaption.textContent = `飞书原始顺序 · 第 ${data.page} 页`;
  elements.resultBadge.textContent = `${formatNumber(data.filteredBooks)} 条`;

  elements.bookRows.innerHTML = data.books.length ? data.books.map((book, index) => `
    <tr>
      <td>${escapeHtml(book.date || "--")}</td>
      <td><span class="book-title" title="${escapeHtml(book.title)}">${escapeHtml(book.title || "未命名")}</span><span class="book-id">ID ${escapeHtml(book.bookId || "--")}</span></td>
      <td><span class="channel-chip ${book.channel.includes("男") ? "is-male" : ""}">${escapeHtml(book.channel || "未分类")}</span></td>
      <td>${book.tags.length ? `<div class="tag-list">${book.tags.slice(0, 6).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : `<div class="cell-clamp">${escapeHtml(book.sellingPoint || "--")}</div>`}</td>
      <td><div class="cell-clamp">${escapeHtml(book.reason || book.note || "--")}</div></td>
      <td><div class="row-actions"><button class="detail-btn" type="button" data-book-index="${index}" title="查看详情">查看</button><button class="marketing-btn" type="button" data-marketing-index="${index}" title="生成营销素材">营销</button></div></td>
    </tr>`).join("") : `<tr><td class="empty-row" colspan="6">当前筛选条件下没有书目</td></tr>`;
  elements.bookRows.querySelectorAll("[data-book-index]").forEach((button) => button.addEventListener("click", () => openBook(data.books[Number(button.dataset.bookIndex)])));
  elements.bookRows.querySelectorAll("[data-marketing-index]").forEach((button) => button.addEventListener("click", () => fillMarketingForm(data.books[Number(button.dataset.marketingIndex)])));
  renderPagination(data.page, data.totalPages);
}

function renderSheetOptions(sheets, selectedId) {
  const current = elements.sheetSelect.value;
  elements.sheetSelect.innerHTML = sheets.map((sheet) => `<option value="${escapeHtml(sheet.id)}" ${sheet.id === selectedId ? "selected" : ""}>${escapeHtml(sheet.title)}${sheet.hidden ? "（隐藏）" : ""}</option>`).join("");
  if (current && sheets.some((sheet) => sheet.id === current)) elements.sheetSelect.value = selectedId;
}

function renderFilterOptions(channels, tags) {
  elements.channelSelect.innerHTML = `<option value="">全部频道</option>${channels.map((channel) => `<option value="${escapeHtml(channel)}">${escapeHtml(channel)}</option>`).join("")}`;
  elements.channelSelect.value = state.channel;
  elements.tagSelect.innerHTML = `<option value="">全部标签</option>${tags.map((tag) => `<option value="${escapeHtml(tag.value)}">${escapeHtml(tag.value)}（${tag.count}）</option>`).join("")}`;
  elements.tagSelect.value = state.tag;
}

function renderPagination(page, totalPages) {
  if (totalPages <= 1) { elements.pagination.innerHTML = ""; return; }
  const pages = paginationWindow(page, totalPages);
  elements.pagination.innerHTML = `<button data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>上一页</button>${pages.map((value) => value === "…" ? `<span>…</span>` : `<button class="${value === page ? "is-active" : ""}" data-page="${value}">${value}</button>`).join("")}<button data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>下一页</button>`;
  elements.pagination.querySelectorAll("button[data-page]").forEach((button) => button.addEventListener("click", () => { state.page = Number(button.dataset.page); loadLibrary(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
}

function openBook(book) {
  elements.dialogChannel.textContent = book.channel || "未分类";
  elements.dialogChannel.classList.toggle("is-male", book.channel.includes("男"));
  elements.dialogTitle.textContent = book.title || "未命名小说";
  elements.dialogBookId.textContent = `书籍 ID：${book.bookId || "--"}`;
  elements.dialogTags.textContent = book.tags.join(" · ") || "--";
  elements.dialogSellingPoint.textContent = book.sellingPoint || "--";
  elements.dialogReason.textContent = book.reason || book.note || "--";
  elements.dialogIntro.textContent = book.intro || "--";
  elements.dialogSource.textContent = `${book.sheetTitle} · 第 ${book.rowNumber} 行`;
  elements.dialog.showModal();
}

function fillMarketingForm(book) {
  elements.marketingTitle.value = book.title || "";
  elements.marketingCategory.value = inferMarketingCategory(book);
  elements.marketingSellingPoint.value = book.sellingPoint || book.reason || "";
  elements.marketingSource.value = [
    `Title: ${book.title || "Untitled"}`,
    book.tags?.length ? `Tags: ${book.tags.join(", ")}` : "",
    book.sellingPoint ? `Selling point: ${book.sellingPoint}` : "",
    book.reason ? `Recommendation: ${book.reason}` : "",
    book.intro ? `Story: ${book.intro}` : ""
  ].filter(Boolean).join("\n\n");
  updateMarketingCharCount();
  setMarketingStatus(`已载入《${book.title || "未命名小说"}》`, "success");
  elements.marketingPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  elements.marketingSource.focus({ preventScroll: true });
}

function inferMarketingCategory(book) {
  const text = [book.title, book.channel, book.sellingPoint, book.reason, ...(book.tags || [])].join(" ");
  if (/恐怖|悬疑|惊悚|灵异|失踪/.test(text)) return "恐怖悬疑";
  if (/复仇|打脸|逆袭|因果|报复/.test(text)) return "复仇与因果";
  if (/婚姻|出轨|背叛|丈夫|妻子|婆婆/.test(text)) return "婚姻背叛";
  if (/爱情|浪漫|甜宠|恋爱|前任/.test(text)) return "浪漫小说";
  return "情感反转故事";
}

async function checkMarketingModel() {
  try {
    const data = await api("/api/codex/status");
    elements.marketingModelState.textContent = data.marketingModel || "GPT-5.6 Sol";
    elements.marketingModelState.closest(".model-status")?.classList.toggle("is-busy", Boolean(data.running));
  } catch {
    elements.marketingModelState.textContent = "Codex 未连接";
    elements.marketingModelState.closest(".model-status")?.classList.add("is-error");
  }
}

async function generateMarketingAssets() {
  const payload = {
    title: elements.marketingTitle.value.trim(),
    category: elements.marketingCategory.value,
    language: elements.marketingLanguage.value,
    audience: elements.marketingAudience.value.trim(),
    sellingPoint: elements.marketingSellingPoint.value.trim(),
    sourceText: elements.marketingSource.value.trim()
  };
  if (payload.sourceText.length < 80) return setMarketingStatus("故事内容至少需要80个字符", "error");

  setMarketingBusy(true);
  setMarketingStatus("GPT-5.6 Sol 正在生成并筛选营销素材...", "busy");
  try {
    const result = await api("/api/novel-marketing/generate", { method: "POST", body: JSON.stringify(payload) });
    state.marketingResult = result;
    renderMarketingResults(result);
    setMarketingStatus(`生成完成 · ${(Number(result.durationMs) / 1000 || 0).toFixed(1)} 秒`, "success");
  } catch (error) {
    setMarketingStatus(error.message, "error");
  } finally {
    setMarketingBusy(false);
    checkMarketingModel();
  }
}

function renderMarketingResults(result) {
  const marketing = result?.marketing || {};
  elements.marketingResults.hidden = false;
  elements.copyMarketingBtn.hidden = false;
  elements.marketingSummary.innerHTML = `
    <article><span>内容定位</span><strong>${escapeHtml(marketing.positioning || "--")}</strong></article>
    <article><span>核心冲突</span><strong>${escapeHtml(marketing.coreConflict || "--")}</strong></article>
    <article><span>目标受众</span><strong>${escapeHtml(marketing.audience || "--")}</strong></article>`;
  elements.selectedMarketingList.innerHTML = (marketing.selected || []).map((item) => `
    <article class="marketing-result-card">
      <header><span class="rank-badge">TOP ${escapeHtml(item.rank)}</span><strong>${escapeHtml(item.angle)}</strong><div class="card-actions"><button type="button" data-copy-rank="${escapeHtml(item.rank)}">复制文案</button><button type="button" data-generate-audio-rank="${escapeHtml(item.rank)}">生成音频</button></div></header>
      <h3>${escapeHtml(item.title)}</h3>
      <p class="audio-ready-script">${escapeHtml(item.script)}</p>
      <footer><span>${(item.hashtags || []).map((tag) => escapeHtml(tag.startsWith("#") ? tag : `#${tag}`)).join(" ")}</span><small>${escapeHtml(item.whyItWins)}</small></footer>
    </article>`).join("");
  elements.selectedMarketingList.querySelectorAll("[data-copy-rank]").forEach((button) => button.addEventListener("click", () => {
    const item = marketing.selected.find((entry) => String(entry.rank) === button.dataset.copyRank);
    copyText(formatSelectedMarketing(item), button);
  }));
  elements.selectedMarketingList.querySelectorAll("[data-generate-audio-rank]").forEach((button) => button.addEventListener("click", () => {
    const rank = button.dataset.generateAudioRank;
    if (!result?.id || !rank) return;
    window.location.href = `/audio-library?marketingId=${encodeURIComponent(result.id)}&rank=${encodeURIComponent(rank)}&autostart=1`;
  }));
  elements.hookLibraryList.innerHTML = (marketing.hooks || []).map((hook) => `
    <article><b>${escapeHtml(hook.id)}</b><div><strong>${escapeHtml(hook.angle)}</strong><p>${escapeHtml(hook.hook)}</p><small>${escapeHtml(hook.emotion)} · ${escapeHtml(hook.curiosityGap)}</small></div><button type="button" data-hook-id="${escapeHtml(hook.id)}" title="复制钩子">复制</button></article>`).join("");
  elements.hookLibraryList.querySelectorAll("[data-hook-id]").forEach((button) => button.addEventListener("click", () => {
    const hook = marketing.hooks.find((entry) => String(entry.id) === button.dataset.hookId);
    copyText(hook?.hook || "", button);
  }));
  elements.marketingResults.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearMarketingForm() {
  elements.marketingTitle.value = "";
  elements.marketingSellingPoint.value = "";
  elements.marketingSource.value = "";
  elements.marketingResults.hidden = true;
  elements.copyMarketingBtn.hidden = true;
  state.marketingResult = null;
  updateMarketingCharCount();
  setMarketingStatus("等待输入故事内容");
}

function updateMarketingCharCount() {
  elements.marketingCharCount.textContent = `${formatNumber(elements.marketingSource.value.length)} / 120,000`;
}

function setMarketingBusy(busy) {
  elements.generateMarketingBtn.disabled = busy;
  elements.clearMarketingBtn.disabled = busy;
  elements.generateMarketingBtn.textContent = busy ? "生成中..." : "生成营销素材";
  elements.marketingPanel.classList.toggle("is-generating", busy);
}

function setMarketingStatus(message, tone = "") {
  elements.marketingStatus.textContent = message;
  elements.marketingStatus.className = tone ? `is-${tone}` : "";
}

function formatSelectedMarketing(item) {
  if (!item) return "";
  return String(item.script || "").trim();
}

function formatMarketingPackage(result) {
  const marketing = result?.marketing;
  if (!marketing) return "";
  return (marketing.selected || []).map((item) => formatSelectedMarketing(item)).filter(Boolean).join("\n\n---\n\n");
}

async function copyText(text, button) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const original = button.textContent;
      button.textContent = "已复制";
      setTimeout(() => { button.textContent = original; }, 1200);
    } else {
      setMarketingStatus("营销素材已复制", "success");
    }
  } catch {
    setMarketingStatus("复制失败，请手动选择文本", "error");
  }
}

function resetFilters(resetSearch) {
  state.channel = ""; state.tag = ""; state.page = 1;
  if (resetSearch) { state.query = ""; elements.searchInput.value = ""; }
  elements.channelSelect.value = ""; elements.tagSelect.value = "";
}

function setBusy(busy, message, tone = "") {
  elements.pageStatus.textContent = message;
  elements.pageStatus.className = `library-status${tone ? ` is-${tone}` : ""}`;
  if (busy) elements.syncState.textContent = "读取中";
}

function paginationWindow(page, total) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const values = [1];
  if (page > 4) values.push("…");
  for (let value = Math.max(2, page - 1); value <= Math.min(total - 1, page + 1); value++) values.push(value);
  if (page < total - 3) values.push("…");
  values.push(total);
  return values;
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败：${response.status}`);
  return body;
}

function formatNumber(value) { return new Intl.NumberFormat("zh-CN").format(Number(value) || 0); }
function formatTime(value) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未同步"; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
