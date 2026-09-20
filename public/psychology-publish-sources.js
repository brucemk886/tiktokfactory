(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const labels = { queued: "排队中", running: "执行中", ready: "待合批", handoff: "等待渲染", submitted: "已提交中台", done: "已完成", failed: "失败", cancelled: "已取消", missing: "已清理" };
  let offset = 0, hasMore = false;
  const stamp = (v) => v ? new Date(Number(v)).toLocaleString("zh-CN", { hour12: false }) : "—";
  const link = (url, label) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label || url)}</a>` : "—";
  async function load() {
    const query = encodeURIComponent($("#query").value.trim());
    const mediaType = encodeURIComponent($("#mediaType").value);
    $("#listStatus").textContent = "正在读取自动发布对标…";
    $("#prevPage").disabled = true;
    $("#nextPage").disabled = true;
    try {
      const response = await fetch(`/api/psychology-auto-publish/sources?offset=${offset}&query=${query}&mediaType=${mediaType}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || "读取失败");
      hasMore = Boolean(data.hasMore);
      const items = data.items || [];
      $("#rows").innerHTML = items.length ? items.map((item) => `<tr>
        <td>${esc(item.batchName || "未命名批次")}<small>${esc(stamp(item.createdAt))}</small></td>
        <td>${item.mediaType === "photo" ? "图文" : "视频"}<small>${item.sourceType === "topic-bank" ? "模板题库" : "同行爆款"}</small></td>
        <td>${item.accountUsername ? `<span class="handle">@${esc(item.accountUsername)}</span>` : "—"}</td>
        <td>${link(item.publishedUrl, item.publishedId ? `打开我方帖子` : "打开我方帖子")}</td>
        <td>${item.peerUrl ? link(item.peerUrl, "打开爆款原帖") : (item.sourceType === "topic-bank" ? "题库题目，无爆款链接" : "—")}</td>
        <td>${esc(item.peerTitle || item.topicTitle || item.title || "—")}</td>
        <td>${esc(labels[item.status] || item.status || "—")}</td>
      </tr>`).join("") : `<tr><td class="sources-empty" colspan="7">没有匹配的自动发布记录。</td></tr>`;
      $("#pageInfo").textContent = `第 ${Math.floor(offset / 20) + 1} 页`;
      $("#listStatus").textContent = items.length ? `本页 ${items.length} 条，按批次时间从新到旧。` : "没有匹配的自动发布记录。";
    } catch (error) {
      $("#rows").innerHTML = `<tr><td class="error" colspan="7">${esc(error.message)}</td></tr>`;
      $("#listStatus").textContent = error.message;
    }
    $("#prevPage").disabled = offset === 0;
    $("#nextPage").disabled = !hasMore;
  }
  $("#searchBtn").addEventListener("click", () => { offset = 0; load(); });
  $("#query").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); offset = 0; load(); } });
  $("#mediaType").addEventListener("change", () => { offset = 0; load(); });
  $("#prevPage").addEventListener("click", () => { offset = Math.max(0, offset - 20); load(); });
  $("#nextPage").addEventListener("click", () => { offset += 20; load(); });
  load();
})();
