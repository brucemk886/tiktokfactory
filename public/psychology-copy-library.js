const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
const typeLabel = type => type === "video" ? "视频" : "图文";
const displayTime = value => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "—";

let copyPage = 1;
let copiesLoading = false;
let copyTotalPages = 1;
let originalItems = [];
let reviewedItems = [];
let previewText = "";
let selectedSource = null;
let variantRequestVersion = 0;
let draftVersionId = crypto.randomUUID();
let variantSource = null;
let variantSaving = false;
let variantGenerating = false;
let draftRewriteModel = "";

async function api(path, method = "GET", body, options = {}) {
  const response = await fetch("/api/psychology-creative" + path, {
    ...options,
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

function openPreview({ kind, title, meta, text, sourceUrl = "" }) {
  previewText = meta + "\n\n" + text;
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
  if (button.dataset.rewriteOriginal) { openRewrites(row,button.dataset.reviewFilter||"all"); return; }
  if (button.dataset.viewOriginal) {
    openPreview({
      kind: typeLabel(row.media_type),
      title: row.content?.title || row.title,
      meta: "文案 ID：" + row.id + "\n来源编号（sourceKey）：" + (row.sourceKey || row.id) + "\n提取完成于 " + displayTime(row.completed_at),
      text: fullText(row),
      sourceUrl: row.source_url
    });
    return;
  }
});

function openRewrites(source = null, status = "all") {
  $("#copyReviewFilter").value = status;
  selectedSource = source;
  copyPage = 1;
  $("#copySearch").value = "";
  $("#copyStatus").textContent = "";
  $("#rewriteTitle").textContent = "改写详情";
  $("#rewriteContext").textContent = source ? typeLabel(source.media_type) + "爆款 · " + (source.content?.title || source.title) : "全部改写版本（含历史导入）。按来源编号关联的版本也会显示在对应爆款文案下。";
  $("#rewriteOriginal").hidden = !source;
  $("#rewriteOriginal").open = false;
  $("#rewriteOriginalText").textContent = source ? fullText(source) : "";
  $("#copyList").innerHTML = '<tr><td colspan="9">正在读取改写版本…</td></tr>';
  $("#copyPrev").disabled = true;
  $("#copyNext").disabled = true;
  $("#copyPage").textContent = "";
  reviewedItems = [];
  $("#rewriteDialog").showModal();
  loadCopies().catch(error => $("#copyStatus").textContent = error.message);
}
function openVariant(source) {
  if (variantSaving || variantGenerating) return;
  variantSource = source;
  draftRewriteModel = "";
  draftVersionId = crypto.randomUUID();
  $("#variantForm").reset();
  $("#variantStatus").textContent = "";
  $("#variantContext").textContent = typeLabel(source.media_type) + "爆款 · " + (source.content?.title || source.title);
  $("#variantDialog").showModal();
}
$("#closeVariant").onclick = () => { if (!variantSaving && !variantGenerating) $("#variantDialog").close(); };
$("#variantDialog").addEventListener("cancel", event => { if (variantSaving || variantGenerating) event.preventDefault(); });
$("#generateVariant").onclick = async () => {
  if(variantSaving||variantGenerating||!variantSource)return;
  const fields=[$('#variantName'),$('#variantTitle'),$('#variantCaption'),...document.querySelectorAll('[data-variant-page]')];
  if(fields.some(field=>field.value.trim())&&!confirm('AI 生成会替换当前表单的草稿内容，是否继续？'))return;
  const source=variantSource;
  variantGenerating=true;$('#generateVariant').disabled=true;$('#generateVariant').textContent='生成中…';$('#closeVariant').disabled=true;$('#variantFields').disabled=true;
  $('#variantStatus').textContent='正在用 '+($('#variantModel').selectedOptions?.[0]?.textContent||$('#variantModel').value||'AI')+' 根据原文生成改写草稿…';
  try{
    const {draft,model}=await api('/copies/generate?sourceId='+encodeURIComponent(source.id)+'&model='+encodeURIComponent($('#variantModel').value),'POST');
    draftRewriteModel=model||'';
    $('#variantName').value=draft.name;$('#variantTitle').value=draft.title;$('#variantCaption').value=draft.caption;
    [...document.querySelectorAll('[data-variant-page]')].forEach((field,i)=>field.value=draft.pages[i]||'');
    $('#variantReviewed').checked=false;draftVersionId=crypto.randomUUID();
    $('#variantStatus').textContent='已生成草稿，请检查文案并勾选审核后保存。';
  }catch(error){$('#variantStatus').textContent=error.message;}
  finally{variantGenerating=false;$('#generateVariant').disabled=false;$('#generateVariant').textContent='AI 生成';$('#closeVariant').disabled=false;$('#variantFields').disabled=false;}
};
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

async function loadCopies(requestedPage = copyPage) {
  const version = ++variantRequestVersion;
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);
  copiesLoading=true;$("#copyPrev").disabled=true;$("#copyNext").disabled=true;
  $("#copyPage").textContent=`正在加载第 ${requestedPage} 页…`;
  try {
  const params = new URLSearchParams({ page: requestedPage, q: $("#copySearch").value, status: $("#copyReviewFilter").value||'all' });
  if (selectedSource) params.set("sourceId", selectedSource.id);
  const data = await api("/copies?" + params,"GET",undefined,{signal:controller.signal});
  if (version !== variantRequestVersion) return;
  copyPage = data.page;
  copyTotalPages = data.pages||Math.max(1,Math.ceil(data.total/20));
  reviewedItems = data.items;
  $("#copyList").innerHTML = data.items.length ? data.items.map(row => `<tr>
    <td><span class="copy-status${row.enabled ? "" : " is-off"}">${row.review_status==='pending'?"未通过质检":row.enabled ? (row.reviewed_at?"已启用 · 人工通过":"已启用") : "已停用"}</span></td>
    <td class="copy-cell-title copy-cell-text" title="${esc(row.title)}"><span>${esc(row.title)}</span></td>
    <td class="copy-cell-caption copy-cell-text" title="${esc(row.caption || "—")}"><span>${esc(row.caption || "—")}</span></td>
    <td class="copy-cell-text" title="${esc(row.source_key)}"><span>${esc(row.source_key)}</span></td>
    <td class="copy-cell-text" title="${esc(row.external_id)}"><span>${esc(row.external_id)}</span></td>
    <td>${esc(row.rewriteModelLabel || '模型未知')}</td>
    <td title="${esc(row.score_reason || '')}">${row.quality_score == null ? '未评分' : esc(row.quality_score) + ' 分'}</td>
    <td>${row.pages.length} 页${row.review_status==='pending'?'<p>'+esc(row.review_reason)+'</p>':''}</td>
    <td class="copy-cell-actions"><button type="button" data-view-reviewed="${row.id}">查看</button>${row.review_status==='pending'?'<button type="button" data-review-copy="'+row.id+'">通过</button>':'<button type="button" data-toggle-copy="'+row.id+'" data-enabled="'+(row.enabled?'0':'1')+'">'+(row.enabled?'停用':'启用')+'</button>'}<button type="button" class="danger-link" data-delete-copy="${row.id}">删除</button></td>
  </tr>`).join("") : '<tr><td colspan="9">没有符合当前筛选的改写版本。可切换“全部版本”查看。</td></tr>';
  $("#copyPage").textContent = `共 ${data.total} 个版本 · 第 ${copyPage} / ${data.pages||Math.max(1,Math.ceil(data.total/20))} 页`;
  $("#copyPrev").disabled = copyPage === 1;
  $("#copyNext").disabled = copyPage * 20 >= data.total;
  } catch(error) {if(version===variantRequestVersion){$("#copyPage").textContent='加载失败，请重新查询';$("#copyPrev").disabled=copyPage<=1;$("#copyNext").disabled=copyPage>=copyTotalPages;}if(error.name==='AbortError')throw new Error('加载超时，请重新查询。');throw error;}
  finally{clearTimeout(timeout);if(version===variantRequestVersion)copiesLoading=false;}
}

$("#copyList").onclick = async event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.viewReviewed) {
    const row = reviewedItems.find(item => String(item.id) === button.dataset.viewReviewed);
    if (row) {if(row.review_status==='pending')openQualityReview(row);else openComparison(row);}
    return;
  }
  if(button.dataset.reviewCopy){const row=reviewedItems.find(r=>r.id===button.dataset.reviewCopy);if(row)openQualityReview(row);return;}
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
$("#copyReviewFilter").onchange = () => { copyPage=1;loadCopies().catch(error => $("#copyStatus").textContent=error.message); };
$("#copyPrev").onclick = () => { if(copiesLoading||$("#copyPrev").disabled)return; loadCopies(copyPage-1).catch(error => $("#copyStatus").textContent = error.message); };
$("#copyNext").onclick = () => { if(copiesLoading||$("#copyNext").disabled)return; loadCopies(copyPage+1).catch(error => $("#copyStatus").textContent = error.message); };

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
  if (variantSaving || variantGenerating || !variantSource || !$("#variantReviewed").checked) return;
  const source = variantSource;
  variantSaving = true;
  $("#generateVariant").disabled = true;
  $("#closeVariant").disabled = true;
  event.submitter.disabled = true;
  try {
    const pages = [...document.querySelectorAll('[data-variant-page]')].map(el => el.value.trim());
    while (pages.length && !pages.at(-1)) pages.pop();
    if (pages.some(page => !page)) throw new Error('请按顺序填写页面，中间不能留空。');
    const data = await api('/copies?sourceId=' + encodeURIComponent(source.id), 'POST', [{
      externalId: $("#variantName").value.trim().slice(0, 70) + '-' + draftVersionId,
      title: $("#variantTitle").value.trim(), caption: $("#variantCaption").value.trim(), pages, rewriteModel:draftRewriteModel
    }]);
    $("#variantStatus").textContent = '已保存并启用 ' + data.created + ' 个新版本。';
    $("#variantForm").reset();
    draftVersionId = crypto.randomUUID();
    draftRewriteModel = "";
    if ($("#rewriteDialog").open && selectedSource?.id === source.id) { copyPage = 1; await loadCopies(); }
    await loadOriginals();
  } catch (error) { $("#variantStatus").textContent = error.message; }
  finally { variantSaving = false; $("#generateVariant").disabled = false; $("#closeVariant").disabled = false; event.submitter.disabled = false; }
};
loadOriginals();

let comparisonVersion = 0;
let comparisonSelection = null;
function comparisonMarkup(data) {
  const clean = value => String(value || '').replace(/(^|\s)[#＃][\p{L}\p{N}_]+/gu, '$1').trim();
  const prepare = rows => {
    const title = clean(rows.find(row => row.kind === 'title')?.text);
    return rows.map(row => ({ ...row, text: clean(row.text), zh: row.zh ? clean(row.zh) : '' }))
      .filter(row => /[\p{L}\p{N}]/u.test(row.text) && !(row.kind === 'caption' && row.text === title));
  };
  const originals = new Map(prepare(data.original).map(row => [row.id, row]));
  const rows = prepare(data.rewrite);
  const key = ref => (ref.kind || 'body') + ':' + ref.text.replace(/\s+/g, ' ');
  const owner = new Map();
  // Keep genuine semantic references, but show each original only once. A matching
  // page/sentence takes priority over an earlier cross-page reference.
  for (const row of rows) for (const id of row.originalIds || []) {
    const ref = originals.get(id);
    if (!ref) continue;
    const previous = owner.get(key(ref));
    if (!previous || (row.label === ref.label && previous.label !== ref.label)) owner.set(key(ref), row);
  }
  const textBlock = row => '<p class="comparison-text">' + esc(row.text) + '</p><div class="comparison-translation"><span>中文翻译</span><p>' + esc(row.zh || (data.status === 'done' ? '—' : '等待翻译…')) + '</p></div>';
  return rows.map(row => {
    const allRefs = [...new Map((row.originalIds || []).map(id => originals.get(id)).filter(Boolean).map(ref => [key(ref), ref])).values()];
    const refs = allRefs.filter(ref => owner.get(key(ref)) === row);
    const elsewhere = [...new Set(allRefs.filter(ref => owner.get(key(ref)) !== row).map(ref => owner.get(key(ref))?.label).filter(Boolean))];
    const empty = elsewhere.length ? '对应原文已在“' + elsewhere.join('”、“') + '”展示' : !data.sourceFound ? '未找到已提取的来源原文' : row.kind !== 'body' ? '原文未填写此字段' : data.status !== 'done' ? '正在匹配对应原句…' : '新增内容 / 未匹配到对应原句';
    return '<article class="comparison-card"><h3>' + esc(row.label) + '</h3><div class="comparison-columns"><section><h4>对应原文</h4>' + (refs.length ? refs.map(textBlock).join('') : '<p class="comparison-empty">' + esc(empty) + '</p>') + '</section><section><h4>改写文案</h4>' + textBlock(row) + '</section></div></article>';
  }).join('');
}
async function loadComparison() {
  const selection = comparisonSelection;
  if (!selection) return;
  const version = ++comparisonVersion;
  const active = () => version === comparisonVersion && $("#comparisonDialog").open;
  $("#retryComparison").hidden = true;
  $("#comparisonStatus").textContent = '正在读取原文与改写…';
  const path = '/copies/' + encodeURIComponent(selection.id) + '/comparison' + (selection.sourceId ? '?sourceId=' + encodeURIComponent(selection.sourceId) : '');
  try {
    let data = await api(path);
    if (!active()) return;
    $("#comparisonContent").innerHTML = comparisonMarkup(data);
    if (data.status !== 'done') {
      $("#comparisonStatus").textContent = '正在生成中文翻译与逐句对应，首次查看可能需要稍等；完成后自动缓存。';
      data = await api(path, 'POST');
      const deadline = Date.now() + 155000;
      while (data.status !== 'done' && active() && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 2500));
        if (!active()) return;
        data = await api(path);
      }
    }
    if (!active()) return;
    if (data.status !== 'done') throw new Error('翻译仍在处理中，请稍后重试。');
    $("#comparisonContent").innerHTML = comparisonMarkup(data);
    $("#comparisonStatus").textContent = (data.provider === 'grokbot' ? '已读取 Grokbot 写入的翻译与对应关系。' : '中文翻译与对应关系已缓存。') + (!data.sourceFound ? ' 该版本尚未关联可用原文。' : '');
  } catch (error) {
    if (!active()) return;
    $("#comparisonStatus").textContent = error.message;
    $("#retryComparison").hidden = false;
  }
}
function openComparison(row) {
  comparisonSelection = { id: row.id, sourceId: selectedSource?.id || '' };
  $("#comparisonMeta").textContent = row.title + " · " + (row.rewriteModelLabel || "模型未知") + (row.quality_score == null ? ' · 未评分' : ' · Grokbot 评分 ' + row.quality_score + '/100') + (row.score_reason ? ' · ' + row.score_reason : '');
  $("#comparisonContent").innerHTML = '';
  $("#comparisonDialog").showModal();
  loadComparison();
}
$("#retryComparison").onclick = loadComparison;
$("#closeComparison").onclick = () => $("#comparisonDialog").close();
$("#comparisonDialog").addEventListener('close', () => { comparisonVersion++; });

function qualityReviewMarkup(row, source) {
 const content=source?.content||{};
 const block=(text,empty='（未填写）')=>text?'<p class="comparison-text">'+esc(text)+'</p>':'<p class="comparison-empty">'+esc(empty)+'</p>';
 const card=(label,left,right)=>'<article class="comparison-card"><h3>'+esc(label)+'</h3><div class="comparison-columns"><section><h4>来源原文</h4>'+left+'</section><section><h4>待审核改写</h4>'+right+'</section></div></article>';
 const original=text=>source?block(text):block('','未找到对应来源原文');
 const title=row.title==='未通过质检的模型返回'?'':row.title;
 let markup=card('标题',original(content.title||source?.title),block(title,'模型未返回可用标题'));
 markup+=card('发布文案',original(content.caption),block(row.caption));
 const pages=Array.isArray(row.pages)?row.pages:[];
 const originalPages=Array.isArray(content.pages)?content.pages:[];
 const usable=text=>typeof text==='string'&&/[\p{L}\p{N}]/u.test(text.replace(/(^|\s)[#＃][\p{L}\p{N}_]+/gu,'$1'));
 const body=(list)=>list.map((text,i)=>usable(text)?'<h4>第 '+(i+1)+' 段</h4>'+block(text):'').join('');
 if(source?.media_type==='video'){
  markup+=card('正文',original([content.transcript,...(content.onScreenText||[])].filter(Boolean).join('\n\n')),body(pages)||block('','模型未返回可用正文，请展开模型原始返回查看。'));
 }else{
  for(let i=0;i<Math.max(originalPages.length,pages.length);i++){
   const left=originalPages[i]?.text||'',right=pages[i]||'';
   if(!usable(left)&&!usable(right))continue;
   markup+=card('第 '+(i+1)+' 页',original(left),block(right,'该页没有对应改写内容'));
  }
 }
 if(!pages.some(usable))markup+=card('模型返回',block('','模型返回未形成有效正文，请参照上方原文人工检查。'),'<pre class="quality-review-raw">'+esc(row.raw_response||'（无原始返回）')+'</pre>');
 return markup;
}
let qualityReviewSource=null,qualityReviewVersions=[];
let qualityReviewSelection=null,qualityReviewSaving=false;
async function openQualityReview(row, versions=[]){
 if(qualityReviewSaving)return;
 qualityReviewSelection=row;
 qualityReviewVersions=versions;
 $('#qualityReviewVersionField').hidden=versions.length<2;
 $('#qualityReviewVersion').innerHTML=versions.map((item,i)=>'<option value="'+i+'">版本 '+(i+1)+' · '+esc(item.title||'未命名')+'</option>').join('');
 $('#qualityReviewVersion').value=String(Math.max(0,versions.findIndex(item=>item.id===row.id)));
 qualityReviewSource=selectedSource||originalItems.find(source=>source.sourceKey===row.source_key)||null;
 $('#qualityReviewComparison').innerHTML=qualityReviewMarkup(row,qualityReviewSource);
 $('#qualityReviewEditor').open=!(row.pages?.length&&row.title&&row.title!=='未通过质检的模型返回');
 $('#qualityReviewMeta').textContent=row.title+' · '+(row.rewriteModelLabel||'模型未知');
 $('#qualityReviewReason').textContent='未通过原因：'+row.review_reason;
 $('#qualityReviewRaw').textContent=row.raw_response||JSON.stringify({title:row.title,caption:row.caption,pages:row.pages},null,2);
 $('#qualityReviewName').value=row.title==='未通过质检的模型返回'?'':row.title;
 $('#qualityReviewCaption').value=row.caption||'';
 $('#qualityReviewPages').value=JSON.stringify(row.pages||[],null,2);
 $('#qualityReviewStatus').textContent='';$('#qualityReviewDialog').showModal();
 if(row.recoverableVersions){
  qualityReviewSaving=true;$('#qualityReviewFields').disabled=true;$('#closeQualityReview').disabled=true;
  $('#qualityReviewStatus').textContent='正在恢复模型返回并拆分 '+row.recoverableVersions+' 个版本…';
  try{
   const data=await api('/copies/'+encodeURIComponent(row.id)+'/recover','POST');
   qualityReviewSaving=false;
   await openQualityReview(data.items[0],data.items);
   $('#qualityReviewStatus').textContent='已拆分 '+data.items.length+' 个待审核版本，可切换版本逐页查看并分别通过。';
   await loadCopies();await loadOriginals();
  }catch(error){$('#qualityReviewStatus').textContent=error.message;}
  finally{qualityReviewSaving=false;$('#qualityReviewFields').disabled=false;$('#closeQualityReview').disabled=false;}
 }
}
$('#qualityReviewVersion').onchange=()=>{
 if(qualityReviewSaving)return;
 const row=qualityReviewVersions[Number($('#qualityReviewVersion').value)];
 if(row)openQualityReview(row,qualityReviewVersions);
};
$('#closeQualityReview').onclick=()=>{if(!qualityReviewSaving)$('#qualityReviewDialog').close();};
$('#qualityReviewDialog').addEventListener('cancel',event=>{if(qualityReviewSaving)event.preventDefault();});
$('#qualityReviewForm').addEventListener('input',()=>{
 let pages;try{pages=JSON.parse($('#qualityReviewPages').value);}catch{return;}
 if(!Array.isArray(pages)||pages.some(page=>typeof page!=='string'))return;
 $('#qualityReviewComparison').innerHTML=qualityReviewMarkup({...qualityReviewSelection,title:$('#qualityReviewName').value,caption:$('#qualityReviewCaption').value,pages},qualityReviewSource);
});
$('#qualityReviewForm').onsubmit=async event=>{
 event.preventDefault();if(qualityReviewSaving||!qualityReviewSelection)return;
 let pages;try{pages=JSON.parse($('#qualityReviewPages').value);}catch{$('#qualityReviewStatus').textContent='正文须为 JSON 字符串数组，例如 ["首图文案","第二页正文"]。';return;}
 qualityReviewSaving=true;$('#qualityReviewFields').disabled=true;$('#closeQualityReview').disabled=true;
 try{
  await api('/copies/'+encodeURIComponent(qualityReviewSelection.id)+'/approve','POST',{title:$('#qualityReviewName').value.trim(),caption:$('#qualityReviewCaption').value.trim(),pages});
  $('#qualityReviewDialog').close();$('#copyStatus').textContent='已人工通过并启用该版本。';await loadCopies();await loadOriginals();
 }catch(error){$('#qualityReviewStatus').textContent=error.message;}
 finally{qualityReviewSaving=false;$('#qualityReviewFields').disabled=false;$('#closeQualityReview').disabled=false;}
};
