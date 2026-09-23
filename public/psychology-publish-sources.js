(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const labels = { queued: "排队中", running: "执行中", ready: "待合批", handoff: "等待渲染", submitted: "已提交中台", published: "已发布", publish_failed: "发布失败", done: "已完成", failed: "失败", cancelled: "已取消", cleaned: "任务已清理" };
  const sources = { "copy-library": "文案库原文", "copy-bank": "文案库改写", "topic-bank": "模板题库", peer: "同行爆款" };
  let offset = 0, hasMore = false;
  const stamp = (v) => v ? new Date(Number(v)).toLocaleString("zh-CN", { hour12: false }) : "—";
  const link = (url, label) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label || url)}</a>` : "—";

  function showView(view) {
    const manual = view === "manual";
    $("#autoView").hidden = manual;
    $("#manualView").hidden = !manual;
    document.querySelectorAll("[data-view]").forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.view === view)));
    const params = new URLSearchParams(location.search);
    if (manual) params.set("view", "manual"); else { params.delete("view"); params.delete("job"); }
    const search = params.toString();
    history.replaceState(null, "", location.pathname + (search ? "?" + search : ""));
    if (manual) $("#refreshBoard")?.click();
  }

  async function load() {
    const query = encodeURIComponent($("#query").value.trim());
    const mediaType = encodeURIComponent($("#mediaType").value);
    const range = encodeURIComponent($("#range").value);
    $("#listStatus").textContent = "正在读取发布记录…";
    $("#prevPage").disabled = true;
    $("#nextPage").disabled = true;
    try {
      const response = await fetch(`/api/psychology-auto-publish/sources?offset=${offset}&query=${query}&mediaType=${mediaType}&range=${range}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || "读取失败");
      hasMore = Boolean(data.hasMore);
      const items = data.items || [];
      $("#rows").innerHTML = items.length ? items.map((item) => `<tr>
        <td>${esc(item.batchName || "未命名批次")}<small>发布 ${esc(stamp(Number(item.scheduleAt) * 1000))}</small></td>
        <td>${item.mediaType === "photo" ? "图文" : "视频"}<small>${esc(item.sourceType === "library" ? (item.variantId ? "文案库改写" : "文案库原文") : sources[item.sourceType] || "同行爆款")}${item.variantId ? " · " + esc(item.variantId) : ""}</small></td>
        <td>${item.accountUsername ? `<span class="handle">@${esc(item.accountUsername)}</span>` : "—"}</td>
        <td>${link(item.publishedUrl, "打开我方帖子")}</td>
        <td>${item.peerUrl ? link(item.peerUrl, "打开爆款原帖") : (item.sourceType === "topic-bank" ? "题库题目，无爆款链接" : "—")}<small>${esc(item.peerTitle || "")}</small></td>
        <td>${esc(item.title || item.topicTitle || "—")}</td>
        <td>${esc(labels[item.status] || item.status || "—")}</td>
        <td>${item.detailJobId ? `<button type="button" class="detail-btn" data-detail="${esc(item.detailJobId)}">制作详情</button>` : `<span class="muted">${item.status === "cleaned" ? "任务已清理" : "—"}</span>`}</td>
      </tr>`).join("") : `<tr><td class="sources-empty" colspan="8">没有匹配的发布记录。</td></tr>`;
      $("#pageInfo").textContent = `第 ${Math.floor(offset / 20) + 1} 页`;
      $("#listStatus").textContent = items.length ? `本页 ${items.length} 条，按批次时间从新到旧。` : "没有匹配的发布记录。";
    } catch (error) {
      $("#rows").innerHTML = `<tr><td class="error" colspan="8">${esc(error.message)}</td></tr>`;
      $("#listStatus").textContent = error.message;
    }
    $("#prevPage").disabled = offset === 0;
    $("#nextPage").disabled = !hasMore;
  }

  async function openDetail(jobId) {
    const body = $("#detailBody");
    body.innerHTML = '<p class="muted">正在读取制作详情…</p>';
    $("#detailDialog").showModal();
    try { await window.psychologyProductionDetail(jobId, body); }
    catch (error) { body.innerHTML = `<p class="board-error">${esc(error.message)}</p>`; }
  }

  $("#rows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-detail]");
    if (button) openDetail(button.dataset.detail);
  });
  $("#closeDetail").addEventListener("click", () => $("#detailDialog").close());
  $("#detailDialog").addEventListener("click", (event) => { if (event.target === $("#detailDialog")) $("#detailDialog").close(); });
  document.querySelectorAll("[data-view]").forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));
  $("#searchBtn").addEventListener("click", () => { offset = 0; load(); });
  $("#query").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); offset = 0; load(); } });
  $("#mediaType").addEventListener("change", () => { offset = 0; load(); });
  $("#range").addEventListener("change", () => { offset = 0; load(); });
  $("#prevPage").addEventListener("click", () => { offset = Math.max(0, offset - 20); load(); });
  $("#nextPage").addEventListener("click", () => { offset += 20; load(); });
  const initial = new URLSearchParams(location.search).get("view") === "manual" ? "manual" : "auto";
  $("#autoView").hidden = initial === "manual";
  $("#manualView").hidden = initial !== "manual";
  document.querySelectorAll("[data-view]").forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.view === initial)));
  if (initial === "manual") $("#refreshBoard")?.click();
  load();
})();
