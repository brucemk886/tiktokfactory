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
let selectedSource = null;
let variantRequestVersion = 0;
let draftVersionId = crypto.randomUUID();

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
        <td><strong>${row.variantCount || 0} 个版本</strong><small class="copy-count-hint">已启用 ${row.enabledVariantCount || 0} 个</small></td>
        <td class="copy-cell-time">${displayTime(row.completed_at)}</td>
        <td class="copy-cell-source"><a href="${esc(row.source_url)}" target="_blank" rel="noopener noreferrer">打开原帖</a></td>
        <td class="copy-cell-actions"><button type="button" data-view-original="${row.id}">查看</button><button type="button" data-copy-original="${row.id}">复制</button><button type="button" data-rewrite-original="${row.id}">改写详情</button></td>
      </tr>`;
    }).join("") : '<tr><td colspan="8">暂无已提取的爆款文案。新导入的同行爆款提取完成后会自动显示在这里。</td></tr>';
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
  const id = button.dataset.viewOriginal || button.dataset.copyOriginal || button.dataset.rewriteOriginal;
  const row = originalItems.find(item => item.id === id);
  if (!row) return;
  if (button.dataset.rewriteOriginal) { openRewrites(row); return; }
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

function openRewrites(source = null) {
  selectedSource = source;
  draftVersionId = crypto.randomUUID();
  copyPage = 1;
  $("#copySearch").value = "";
  $("#copyJson").value = "";
  $("#copyFile").value = "";
  $("#copyStatus").textContent = "";
  $("#variantStatus").textContent = "";
  $("#variantForm").reset();
  $("#manualVariantPanel").open = false;
  $("#manualVariantPanel").hidden = !source;
  $("#rewriteTitle").textContent = source ? "改写详情" : "批量导入 / 全部改写";
  $("#rewriteContext").textContent = source ? typeLabel(source.media_type) + "爆款 · " + (source.content?.title || source.title) : "全部改写版本（含历史导入）。按来源编号关联的版本也会显示在对应爆款文案下。";
  $("#rewriteOriginal").hidden = !source;
  $("#rewriteOriginal").open = false;
  $("#rewriteOriginalText").textContent = source ? fullText(source) : "";
  $("#copyList").innerHTML = '<tr><td colspan="7">正在读取改写版本…</td></tr>';
  $("#copyPrev").disabled = true;
  $("#copyNext").disabled = true;
  $("#copyPage").textContent = "";
  reviewedItems = [];
  $("#rewriteDialog").showModal();
  loadCopies().catch(error => $("#copyStatus").textContent = error.message);
}
$("#originalTab").onclick = () => $("#originals").scrollIntoView({ behavior: "smooth" });
$("#reviewedTab").onclick = () => openRewrites();
$("#closeRewrites").onclick = () => $("#rewriteDialog").close();
$("#rewriteDialog").addEventListener("close", () => { variantRequestVersion++; });
if (location.hash === "#copies") openRewrites();

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
  sourceKey: selectedSource?.sourceKey || "attachment-001",
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
    const data = await api("/copies" + (selectedSource ? "?sourceId=" + encodeURIComponent(selectedSource.id) : ""), "POST", JSON.parse($("#copyJson").value));
    $("#copyStatus").textContent = `已导入 ${data.created} 篇，跳过 ${data.duplicates} 篇重复编号。`;
    copyPage = 1;
    await loadCopies();
    await loadOriginals();
  } catch (error) {
    $("#copyStatus").textContent = error.message;
  } finally {
    event.submitter.disabled = false;
  }
};

async function loadCopies() {
  const version = ++variantRequestVersion;
  const params = new URLSearchParams({ page: copyPage, q: $("#copySearch").value });
  if (selectedSource) params.set("sourceId", selectedSource.id);
  const data = await api("/copies?" + params);
  if (version !== variantRequestVersion) return;
  copyPage = data.page;
  reviewedItems = data.items;
  $("#copyList").innerHTML = data.items.length ? data.items.map(row => `<tr>
    <td><span class="copy-status${row.enabled ? "" : " is-off"}">${row.enabled ? "已启用" : "已停用"}</span></td>
    <td class="copy-cell-title copy-cell-text" title="${esc(row.title)}"><span>${esc(row.title)}</span></td>
    <td class="copy-cell-caption copy-cell-text" title="${esc(row.caption || "—")}"><span>${esc(row.caption || "—")}</span></td>
    <td class="copy-cell-text" title="${esc(row.source_key)}"><span>${esc(row.source_key)}</span></td>
    <td class="copy-cell-text" title="${esc(row.external_id)}"><span>${esc(row.external_id)}</span></td>
    <td>${row.pages.length} 页</td>
    <td class="copy-cell-actions"><button type="button" data-view-reviewed="${row.id}">查看</button><button type="button" data-toggle-copy="${row.id}" data-enabled="${row.enabled ? "0" : "1"}">${row.enabled ? "停用" : "启用"}</button></td>
  </tr>`).join("") : '<tr><td colspan="7">暂无改写版本。可新增版本，或展开“导入 Grokbot 文案”导入审核后的结果。</td></tr>';
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
    await loadOriginals();
  } catch (error) {
    $("#copyStatus").textContent = error.message;
    button.disabled = false;
  }
};
$("#copySearchForm").onsubmit = event => { event.preventDefault(); copyPage = 1; loadCopies().catch(error => $("#copyStatus").textContent = error.message); };
$("#copyPrev").onclick = () => { copyPage--; loadCopies().catch(error => $("#copyStatus").textContent = error.message); };
$("#copyNext").onclick = () => { copyPage++; loadCopies().catch(error => $("#copyStatus").textContent = error.message); };

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

$("#variantPages").innerHTML = Array.from({ length: 6 }, (_, i) => '<label>第 ' + (i + 1) + ' 页' + (i ? '（选填）' : '（首图，必填）') + '<textarea data-variant-page maxlength="1500" rows="3" ' + (i ? '' : 'required') + '></textarea></label>').join('');
$("#variantForm").onsubmit = async event => {
  event.preventDefault();
  if (!selectedSource || !$("#variantReviewed").checked) return;
  event.submitter.disabled = true;
  try {
    const pages = [...document.querySelectorAll('[data-variant-page]')].map(el => el.value.trim());
    while (pages.length && !pages.at(-1)) pages.pop();
    if (pages.some(page => !page)) throw new Error('请按顺序填写页面，中间不能留空。');
    const data = await api('/copies?sourceId=' + encodeURIComponent(selectedSource.id), 'POST', [{
      externalId: $("#variantName").value.trim().slice(0, 70) + '-' + draftVersionId,
      title: $("#variantTitle").value.trim(), caption: $("#variantCaption").value.trim(), pages
    }]);
    $("#variantStatus").textContent = '已保存并启用 ' + data.created + ' 个新版本。';
    $("#variantForm").reset();
    draftVersionId = crypto.randomUUID();
    copyPage = 1;
    await loadCopies();
    await loadOriginals();
  } catch (error) { $("#variantStatus").textContent = error.message; }
  finally { event.submitter.disabled = false; }
};
loadOriginals();
