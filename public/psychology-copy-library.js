const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
const typeLabel = type => type === "video" ? "视频" : "图文";
const displayTime = value => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—";

let copyPage = 1;
let originalPage = 1;
let originalItems = [];
let reviewedItems = [];
let requestVersion = 0;
let previewText = "";

async function api(path, method = "GET", body) {
  const response = await fetch("/api/psychology-creative" + path, {
    method,
    cache: "no-store",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function exportRow(row) {
  const content = row.content || {};
  return {
    sourceKey: row.sourceKey,
    mediaType: row.media_type,
    title: content.title || row.title,
    caption: content.caption || "",
    pages: (content.pages || []).map(page => page.text),
    transcript: content.transcript || "",
    onScreenText: content.onScreenText || [],
    sourceUrl: row.source_url
  };
}

function fullText(row) {
  const content = row.content || {};
  return [
    "标题：" + (content.title || row.title),
    "发布文案：" + (content.caption || "（无）"),
    row.media_type === "photo"
      ? (content.pages || []).map(page => "第" + page.index + "张\n" + (page.text || "（无可识别文字）")).join("\n\n")
      : "口播：\n" + (content.transcript || "（无可识别口播）") + "\n\n画面文字：\n" + ((content.onScreenText || []).join("\n") || "（无可识别文字）"),
    content.notes ? "识别说明：" + content.notes : ""
  ].filter(Boolean).join("\n\n");
}

function extractedPreview(row) {
  const content = row.content || {};
  if (row.media_type === "video") return content.transcript || (content.onScreenText || []).join(" · ") || "—";
  return (content.pages || []).map(page => page.text).filter(Boolean).join(" · ") || "—";
}

function reviewedFullText(row) {
  return [
    "标题：" + (row.title || "未命名文案"),
    "发布文案：" + (row.caption || "（无）"),
    row.pages.map((page, index) => "第" + (index + 1) + "页：\n" + page).join("\n\n")
  ].join("\n\n");
}

function openPreview({ kind, title, meta, text, sourceUrl = "" }) {
  previewText = text;
  $("#previewKind").textContent = kind;
  $("#previewKind").classList.toggle("is-video", kind === "视频");
  $("#previewTitle").textContent = title || "未命名文案";
  $("#previewMeta").textContent = meta;
  $("#previewText").textContent = text;
  $("#previewSource").hidden = !sourceUrl;
  $("#previewSource").href = sourceUrl || "#";
  $("#copyPreviewDialog").showModal();
}

async function loadOriginals() {
  const version = ++requestVersion;
  $("#originalMessage").textContent = "正在读取…";
  try {
    const params = new URLSearchParams({
      page: originalPage,
      mediaType: $("#originalMedia").value,
      q: $("#originalQuery").value
    });
    const response = await fetch("/api/psychology-copy-library?" + params, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取失败");
    if (version !== requestVersion) return;
    originalPage = data.page;
    originalItems = data.items;
    const counts = { video: 0, photo: 0 };
    for (const row of data.counts) counts[row.media_type] += row.n;
    $("#originalSummary").textContent = `共 ${data.total} 篇 · 已提取视频 ${counts.video} 篇 · 图文 ${counts.photo} 篇`;
    $("#originalRows").innerHTML = data.items.length ? data.items.map(row => {
      const content = row.content || {};
      const title = content.title || row.title || "未命名内容";
      const caption = content.caption || "—";
      const extracted = extractedPreview(row);
      return `<tr>
        <td><span class="copy-kind${row.media_type === "video" ? " is-video" : ""}">${typeLabel(row.media_type)}</span></td>
        <td class="copy-cell-title copy-cell-text" title="${esc(title)}"><span>${esc(title)}</span></td>
        <td class="copy-cell-caption copy-cell-text" title="${esc(caption)}"><span>${esc(caption)}</span></td>
        <td class="copy-cell-extract copy-cell-text" title="${esc(extracted)}"><span>${esc(extracted)}</span></td>
        <td class="copy-cell-time">${displayTime(row.completed_at)}</td>
        <td class="copy-cell-source"><a href="${esc(row.source_url)}" target="_blank" rel="noopener noreferrer">打开原帖</a></td>
        <td class="copy-cell-actions"><button type="button" data-view-original="${row.id}">查看</button><button type="button" data-copy-original="${row.id}">复制</button></td>
      </tr>`;
    }).join("") : '<tr><td colspan="7">暂无已提取的同行原文。新导入的同行爆款提取完成后会自动显示在这里。</td></tr>';
    $("#originalPage").textContent = `第 ${data.page} / ${data.pages} 页 · 每页 20 篇`;
    $("#originalPrev").disabled = data.page <= 1;
    $("#originalNext").disabled = data.page >= data.pages;
    $("#originalMessage").textContent = "";
  } catch (error) {
    if (version === requestVersion) $("#originalMessage").textContent = error.message;
  }
}

$("#originalSearchForm").onsubmit = event => { event.preventDefault(); originalPage = 1; loadOriginals(); };
$("#originalMedia").onchange = () => { originalPage = 1; loadOriginals(); };
$("#originalRefresh").onclick = loadOriginals;
$("#originalPrev").onclick = () => { originalPage--; loadOriginals(); };
$("#originalNext").onclick = () => { originalPage++; loadOriginals(); };
$("#exportOriginalPage").onclick = () => download("psychology-originals-" + originalPage + ".json", originalItems.map(exportRow));
$("#originalRows").onclick = async event => {
  const button = event.target.closest("button");
  if (!button) return;
  const id = button.dataset.viewOriginal || button.dataset.copyOriginal;
  const row = originalItems.find(item => item.id === id);
  if (!row) return;
  if (button.dataset.viewOriginal) {
    openPreview({
      kind: typeLabel(row.media_type),
      title: row.content?.title || row.title,
      meta: "提取完成于 " + displayTime(row.completed_at),
      text: fullText(row),
      sourceUrl: row.source_url
    });
    return;
  }
  try {
    await navigator.clipboard.writeText(fullText(row));
    $("#originalMessage").textContent = "已复制完整文案。";
  } catch {
    $("#originalMessage").textContent = "自动复制失败，请打开查看后手动复制。";
  }
};

function tab(reviewed) {
  $("#originals").hidden = reviewed;
  $("#copies").hidden = !reviewed;
  $("#originalTab").setAttribute("aria-pressed", String(!reviewed));
  $("#reviewedTab").setAttribute("aria-pressed", String(reviewed));
}
$("#originalTab").onclick = () => tab(false);
$("#reviewedTab").onclick = () => tab(true);
tab(location.hash === "#copies");

function download(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("#downloadExample").onclick = () => download("grok-photo-copy-example.json", [{
  externalId: "attachment-001-v1",
  sourceKey: "attachment-001",
  title: "When closeness feels overwhelming",
  caption: "A reflection on asking for space and staying connected.",
  pages: ["When closeness feels overwhelming", "You can need space and still care about someone.", "Try saying: I need a quiet evening. Can we talk tomorrow?"]
}]);
$("#copyFile").onchange = async () => {
  const file = $("#copyFile").files[0];
  if (!file) return;
  if (file.size > 1500000) {
    $("#copyStatus").textContent = "文件超过 1.5MB，请拆分导入。";
    return;
  }
  $("#copyJson").value = await file.text();
};
$("#importForm").onsubmit = async event => {
  event.preventDefault();
  event.submitter.disabled = true;
  try {
    const data = await api("/copies", "POST", JSON.parse($("#copyJson").value));
    $("#copyStatus").textContent = `已导入 ${data.created} 篇，跳过 ${data.duplicates} 篇重复编号。`;
    copyPage = 1;
    await loadCopies();
  } catch (error) {
    $("#copyStatus").textContent = error.message;
  } finally {
    event.submitter.disabled = false;
  }
};

async function loadCopies() {
  const data = await api("/copies?" + new URLSearchParams({ page: copyPage, q: $("#copySearch").value }));
  reviewedItems = data.items;
  $("#copyList").innerHTML = data.items.length ? data.items.map(row => `<tr>
    <td><span class="copy-status${row.enabled ? "" : " is-off"}">${row.enabled ? "已启用" : "已停用"}</span></td>
    <td class="copy-cell-title copy-cell-text" title="${esc(row.title)}"><span>${esc(row.title)}</span></td>
    <td class="copy-cell-caption copy-cell-text" title="${esc(row.caption || "—")}"><span>${esc(row.caption || "—")}</span></td>
    <td class="copy-cell-text" title="${esc(row.source_key)}"><span>${esc(row.source_key)}</span></td>
    <td class="copy-cell-text" title="${esc(row.external_id)}"><span>${esc(row.external_id)}</span></td>
    <td>${row.pages.length} 页</td>
    <td class="copy-cell-actions"><button type="button" data-view-reviewed="${row.id}">查看</button><button type="button" data-toggle-copy="${row.id}" data-enabled="${row.enabled ? "0" : "1"}">${row.enabled ? "停用" : "启用"}</button></td>
  </tr>`).join("") : '<tr><td colspan="7">尚无文案。可展开“导入 Grokbot 文案”添加已审核的改写结果。</td></tr>';
  $("#copyPage").textContent = `共 ${data.total} 篇 · 第 ${copyPage} 页`;
  $("#copyPrev").disabled = copyPage === 1;
  $("#copyNext").disabled = copyPage * 20 >= data.total;
}

$("#copyList").onclick = async event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.viewReviewed) {
    const row = reviewedItems.find(item => String(item.id) === button.dataset.viewReviewed);
    if (row) openPreview({
      kind: "图文改写",
      title: row.title,
      meta: `来源 ${row.source_key} · 版本 ${row.external_id} · ${row.pages.length} 页`,
      text: reviewedFullText(row)
    });
    return;
  }
  if (!button.dataset.toggleCopy) return;
  button.disabled = true;
  try {
    await api("/copies/" + button.dataset.toggleCopy, "PATCH", { enabled: button.dataset.enabled === "1" });
    await loadCopies();
  } catch (error) {
    $("#copyStatus").textContent = error.message;
    button.disabled = false;
  }
};
$("#copySearchForm").onsubmit = event => { event.preventDefault(); copyPage = 1; loadCopies().catch(error => $("#copyStatus").textContent = error.message); };
$("#copyPrev").onclick = () => { copyPage--; loadCopies(); };
$("#copyNext").onclick = () => { copyPage++; loadCopies(); };

$("#closePreview").onclick = () => $("#copyPreviewDialog").close();
$("#copyPreviewDialog").addEventListener("click", event => {
  if (event.target === $("#copyPreviewDialog")) $("#copyPreviewDialog").close();
});
$("#copyPreviewText").onclick = async () => {
  try {
    await navigator.clipboard.writeText(previewText);
    $("#copyPreviewText").textContent = "已复制";
    setTimeout(() => { $("#copyPreviewText").textContent = "复制全文"; }, 1200);
  } catch {
    $("#copyPreviewText").textContent = "请手动复制";
  }
};

loadOriginals();
loadCopies().catch(error => $("#copyStatus").textContent = error.message);
