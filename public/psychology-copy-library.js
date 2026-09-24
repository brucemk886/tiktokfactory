const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
const typeLabel = type => type === "video" ? "视频" : "图文";
const displayTime = value => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—";

let copyPage = 1;
let originalItems = [];
let reviewedItems = [];
let previewText = "";
let selectedSource = null;
let variantRequestVersion = 0;
let draftVersionId = crypto.randomUUID();
let variantSource = null;
let variantSaving = false;

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

function reviewedFullText(row) {
  return [
    "标题：" + (row.title || "未命名文案"),
    "发布文案：" + (row.caption || "（无）"),
    row.pages.map((page, index) => "第" + (index + 1) + "段：\n" + page).join("\n\n")
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

function loadOriginals(){document.dispatchEvent(new CustomEvent('peer-list-refresh-request'));}
document.addEventListener('peer-list-loaded',event=>{originalItems=event.detail?.items||[];});
$("#hitRows").addEventListener("click", async event => {
  const button = event.target.closest("button");
  if (!button) return;
  if(button.dataset.retryCopy){
    button.disabled=true;
    try{const response=await fetch('/api/psychology-copy-library/'+encodeURIComponent(button.dataset.retryCopy)+'/retry',{method:'POST'});const data=await response.json();if(!response.ok)throw new Error(data.error||'重试失败');loadOriginals();}catch(error){$('#listStatus').textContent=error.message;button.disabled=false;}
    return;
  }
  const id = button.dataset.viewOriginal || button.dataset.createVariant || button.dataset.rewriteOriginal;
  const row = originalItems.find(item => item.id === id);
  if (!row) return;
  if (button.dataset.createVariant) { openVariant(row); return; }
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
});

function openRewrites(source = null) {
  selectedSource = source;
  copyPage = 1;
  $("#copySearch").value = "";
  $("#copyStatus").textContent = "";
  $("#rewriteTitle").textContent = "改写详情";
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
function openVariant(source) {
  if (variantSaving) return;
  variantSource = source;
  draftVersionId = crypto.randomUUID();
  $("#variantForm").reset();
  $("#variantStatus").textContent = "";
  $("#variantContext").textContent = typeLabel(source.media_type) + "爆款 · " + (source.content?.title || source.title);
  $("#variantDialog").showModal();
}
$("#closeVariant").onclick = () => { if (!variantSaving) $("#variantDialog").close(); };
$("#variantDialog").addEventListener("cancel", event => { if (variantSaving) event.preventDefault(); });
$("#bulkImportButton").onclick = () => {
  $("#copyJson").value = "";
  $("#copyFile").value = "";
  $("#bulkImportStatus").textContent = "";
  $("#bulkImportDialog").showModal();
};
$("#closeBulkImport").onclick = () => $("#bulkImportDialog").close();
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
  sourceKey: "attachment-001",
  title: "When closeness feels overwhelming",
  caption: "A reflection on asking for space and staying connected.",
  pages: ["When closeness feels overwhelming", "You can need space and still care about someone.", "Try saying: I need a quiet evening. Can we talk tomorrow?"]
}]);
$("#copyFile").onchange = async () => {
  const file = $("#copyFile").files[0];
  if (!file) return;
  if (file.size > 1500000) {
    $("#bulkImportStatus").textContent = "文件超过 1.5MB，请拆分导入。";
    return;
  }
  $("#copyJson").value = await file.text();
};
$("#importForm").onsubmit = async event => {
  event.preventDefault();
  event.submitter.disabled = true;
  try {
    const data = await api("/copies", "POST", JSON.parse($("#copyJson").value));
    $("#bulkImportStatus").textContent = `已导入 ${data.created} 篇，跳过 ${data.duplicates} 篇重复编号。`;
    await loadOriginals();
  } catch (error) {
    $("#bulkImportStatus").textContent = error.message;
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
    <td class="copy-cell-actions"><button type="button" data-view-reviewed="${row.id}">查看</button><button type="button" data-toggle-copy="${row.id}" data-enabled="${row.enabled ? "0" : "1"}">${row.enabled ? "停用" : "启用"}</button><button type="button" class="danger-link" data-delete-copy="${row.id}">删除</button></td>
  </tr>`).join("") : '<tr><td colspan="7">暂无改写版本。请返回文案列表，点击该文案的“新增改写”。</td></tr>';
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
      kind: "文案改写",
      title: row.title,
      meta: `来源 ${row.source_key} · 版本 ${row.external_id} · ${row.pages.length} 页`,
      text: reviewedFullText(row)
    });
    return;
  }
  const removing = button.dataset.deleteCopy;
  if (!button.dataset.toggleCopy && !removing) return;
  if (removing) {
    const row = reviewedItems.find(item => String(item.id) === removing);
    if (!confirm("删除改写版本「" + (row?.title || "未命名") + "」？删除后不会再被抽取，Grokbot 重新导入同一版本也会跳过。已发布的作品和数据不受影响。")) return;
  }
  button.disabled = true;
  try {
    if (removing) await api("/copies/" + removing, "DELETE");
    else await api("/copies/" + button.dataset.toggleCopy, "PATCH", { enabled: button.dataset.enabled === "1" });
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

$("#variantPages").innerHTML = Array.from({ length: 6 }, (_, i) => '<label>第 ' + (i + 1) + ' 段 / 页' + (i ? '（选填）' : '（首图，必填）') + '<textarea data-variant-page maxlength="1500" rows="3" ' + (i ? '' : 'required') + '></textarea></label>').join('');
$("#variantForm").onsubmit = async event => {
  event.preventDefault();
  if (variantSaving || !variantSource || !$("#variantReviewed").checked) return;
  const source = variantSource;
  variantSaving = true;
  $("#closeVariant").disabled = true;
  event.submitter.disabled = true;
  try {
    const pages = [...document.querySelectorAll('[data-variant-page]')].map(el => el.value.trim());
    while (pages.length && !pages.at(-1)) pages.pop();
    if (pages.some(page => !page)) throw new Error('请按顺序填写页面，中间不能留空。');
    const data = await api('/copies?sourceId=' + encodeURIComponent(source.id), 'POST', [{
      externalId: $("#variantName").value.trim().slice(0, 70) + '-' + draftVersionId,
      title: $("#variantTitle").value.trim(), caption: $("#variantCaption").value.trim(), pages
    }]);
    $("#variantStatus").textContent = '已保存并启用 ' + data.created + ' 个新版本。';
    $("#variantForm").reset();
    draftVersionId = crypto.randomUUID();
    if ($("#rewriteDialog").open && selectedSource?.id === source.id) { copyPage = 1; await loadCopies(); }
    await loadOriginals();
  } catch (error) { $("#variantStatus").textContent = error.message; }
  finally { variantSaving = false; $("#closeVariant").disabled = false; event.submitter.disabled = false; }
};
loadOriginals();
