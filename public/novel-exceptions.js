const KIND_LABELS = {
  production_failed: "混剪/生成失败",
  awaiting_review: "待人工确认",
  upload_handoff_failed: "上传交接失败",
  worker_heartbeat_timeout: "心跳超时",
  official_publish_failed: "官方发布失败",
  publish_needs_review: "需中台核查",
  result_sync_failed: "同步异常",
  account_auth_failed: "账号授权",
  other_production: "其他生产异常",
};

const WORKFLOW_LABELS = {
  open: "待处理",
  in_progress: "处理中",
  ignored: "忽略中",
  resolved: "已解决",
  deleted: "已删除",
};

const cursorStack = [""];
let loading = false;

const $ = (id) => document.getElementById(id);

function readFiltersFromUrl() {
  const params = new URLSearchParams(location.search);
  $("filterWorkflow").value = params.get("workflow") || "";
  $("filterKind").value = params.get("kind") || "";
  $("filterStage").value = params.get("stage") || "";
  if (params.get("cursor")) cursorStack.splice(0, cursorStack.length, "", params.get("cursor"));
}

function writeFiltersToUrl(cursor = "") {
  const params = new URLSearchParams();
  if ($("filterWorkflow").value) params.set("workflow", $("filterWorkflow").value);
  if ($("filterKind").value) params.set("kind", $("filterKind").value);
  if ($("filterStage").value) params.set("stage", $("filterStage").value);
  if (cursor) params.set("cursor", cursor);
  const next = `${location.pathname}${params.toString() ? `?${params}` : ""}`;
  history.replaceState({}, "", next);
}

function queryString(cursor = "") {
  const params = new URLSearchParams();
  if ($("filterWorkflow").value) params.set("workflowState", $("filterWorkflow").value);
  if ($("filterKind").value) params.set("kind", $("filterKind").value);
  if ($("filterStage").value) params.set("stage", $("filterStage").value);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function formatTime(value) {
  const stamp = Number(value) || 0;
  if (!stamp) return "—";
  return new Date(stamp).toLocaleString("zh-CN", { hour12: false });
}

function formatFreshness(block) {
  const at = Number(block?.at) || 0;
  return at ? formatTime(at) : "尚无成功更新";
}

async function loadSummary() {
  const response = await fetch(`/api/novel-exceptions/summary?${queryString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "读取计数失败。");
  const data = await response.json();
  $("sumOpen").textContent = String(data.open ?? 0);
  $("sumProgress").textContent = String(data.inProgress ?? 0);
  $("sumCritical").textContent = String(data.critical ?? 0);
  $("sumIgnored").textContent = String(data.ignored ?? 0);
  const fresh = data.sourceFreshness || {};
  $("sourceFreshness").textContent = `本地 ${formatFreshness(fresh.local)} · 工厂 ${formatFreshness(fresh.factory)} · 中台 ${formatFreshness(fresh.signalDesk)} · 对账 ${formatFreshness(fresh.reconcile)}`;
}

async function loadList() {
  if (loading) return;
  loading = true;
  const cursor = cursorStack[cursorStack.length - 1] || "";
  $("exceptionsStatus").textContent = "正在读取异常…";
  try {
    const response = await fetch(`/api/novel-exceptions?${queryString(cursor)}`, { cache: "no-store" });
    if (!response.ok) {
      $("exceptionsStatus").textContent = (await response.json().catch(() => ({}))).error || "读取异常失败。";
      $("exceptionRows").innerHTML = "";
      return;
    }
    const data = await response.json();
    renderRows(data.items || []);
    $("exceptionsStatus").textContent = (data.items || []).length
      ? `已加载 ${data.items.length} 条。覆盖当前筛选范围内的异常表，不是任务列表截断。`
      : "当前筛选下没有异常。空状态表示异常表无匹配行，不是加载失败。";
    $("nextPageBtn").disabled = !data.nextCursor;
    $("prevPageBtn").disabled = cursorStack.length <= 1;
    $("nextPageBtn").dataset.next = data.nextCursor || "";
    writeFiltersToUrl(cursor);
  } catch (error) {
    $("exceptionsStatus").textContent = error.message || "读取异常失败。";
    $("exceptionRows").innerHTML = "";
  } finally {
    loading = false;
  }
}

function renderRows(items) {
  $("exceptionRows").innerHTML = items.map((item) => {
    const novel = item.associated
      ? `${escapeHtml(item.details?.novelName || item.novelId || "已关联")} / ${escapeHtml(item.audioName || item.details?.audioName || "待关联")}`
      : "待关联";
    const jump = item.kind === "official_publish_failed" || item.kind === "publish_needs_review"
      ? `<a href="${escapeHtml(item.hubLink?.href || "https://tiktokaitool.com")}" target="_blank" rel="noreferrer">前往中台</a>`
      : `<a href="${escapeHtml(item.taskLink?.href || "/tasks")}">查看任务</a>`;
    return `<tr data-id="${escapeHtml(item.id)}">
      <td><span class="exception-badge ${escapeHtml(item.severity)}">${escapeHtml(item.severity === "critical" ? "严重" : item.severity === "warning" ? "警告" : "提示")}</span></td>
      <td><div class="exception-title">${escapeHtml(item.title)}</div><div class="exception-message">${escapeHtml(item.message)}</div></td>
      <td>${escapeHtml(WORKFLOW_LABELS[item.workflowState] || item.workflowState)}</td>
      <td>${novel}</td>
      <td>${escapeHtml(item.connectionId || "—")} / ${escapeHtml(item.workerId || "—")}</td>
      <td>${escapeHtml(KIND_LABELS[item.kind] || item.kind)}<div class="exception-message">${escapeHtml(item.sourceStatus || "")}</div></td>
      <td>${escapeHtml(formatTime(item.firstSeenAt))}<div class="exception-message">${escapeHtml(formatTime(item.lastSeenAt))}</div></td>
      <td>${escapeHtml(item.occurrenceCount)}</td>
      <td><div class="exception-row-actions">
        ${jump}
        <button type="button" data-open="${escapeHtml(item.id)}">详情</button>
        ${item.workflowState === "deleted" ? "" : `<button type="button" data-delete="${escapeHtml(item.id)}" data-version="${escapeHtml(item.version)}">删除</button>`}
      </div></td>
    </tr>`;
  }).join("");
}

async function openDrawer(id) {
  const response = await fetch(`/api/novel-exceptions/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!response.ok) {
    $("exceptionsStatus").textContent = (await response.json().catch(() => ({}))).error || "读取详情失败。";
    return;
  }
  const data = await response.json();
  const item = data.item;
  $("exceptionDrawer").hidden = false;
  $("drawerBody").innerHTML = `
    <h2>${escapeHtml(item.title)}</h2>
    <p>${escapeHtml(item.message)}</p>
    <div class="exception-meta">
      <div>状态 ${escapeHtml(WORKFLOW_LABELS[item.workflowState] || "")} · 条件 ${escapeHtml(item.conditionState)} · 版本 ${escapeHtml(item.version)}</div>
      <div>任务 ${escapeHtml(item.localTaskId || item.cloudJobId || "—")} · 批次 ${escapeHtml(item.remoteBatchId || "—")}</div>
      <div>首次 ${escapeHtml(formatTime(item.firstSeenAt))} · 最近 ${escapeHtml(formatTime(item.lastSeenAt))} · 发生 ${escapeHtml(item.occurrenceCount)} 次</div>
    </div>
    <div class="exception-actions">
      <a href="${escapeHtml(item.taskLink?.href || "/tasks")}">查看任务列表</a>
      ${item.taskLink?.copyId ? `<button type="button" data-copy="${escapeHtml(item.taskLink.copyId)}">复制任务 ID</button>` : ""}
      ${item.kind === "official_publish_failed" || item.kind === "publish_needs_review"
        ? `<a href="${escapeHtml(item.hubLink?.href || "https://tiktokaitool.com")}" target="_blank" rel="noreferrer">前往中台</a>`
        : ""}
      ${item.hubLink?.copyId ? `<button type="button" data-copy="${escapeHtml(item.hubLink.copyId)}">复制批次 ID</button>` : ""}
      <button type="button" data-action="start">开始处理</button>
      <button type="button" data-action="review">复核</button>
      <button type="button" data-action="ignore">忽略</button>
      <button type="button" data-action="resolve_manual">人工结案</button>
      <button type="button" data-action="reopen">恢复处理</button>
      ${item.workflowState === "deleted" ? "" : '<button type="button" data-action="delete">删除</button>'}
    </div>
    <p class="field-help">删除只从异常列表拿走，不改任务、不发视频。同一条旧失败不会再出现；之后的新失败仍会进来。</p>
    <h3>处理记录</h3>
    <ul>${(data.actions || []).map((row) => `<li>${escapeHtml(formatTime(row.createdAt))} ${escapeHtml(row.action)} ${escapeHtml(row.reason)}</li>`).join("") || "<li>暂无</li>"}</ul>
  `;
  $("drawerBody").querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => runAction(item, button.dataset.action));
  });
  $("drawerBody").querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy || "");
        $("exceptionsStatus").textContent = `已复制 ${button.dataset.copy}`;
      } catch {
        $("exceptionsStatus").textContent = `请手动复制 ${button.dataset.copy}`;
      }
    });
  });
}

async function runAction(item, action) {
  let reason = "";
  let ignoreFor = "";
  if (action === "ignore") {
    reason = window.prompt("忽略原因（必填）", "") || "";
    ignoreFor = window.prompt("期限：1h / 24h / 空=本次事件", "24h") || "";
  }
  if (action === "resolve_manual") {
    reason = window.prompt("人工结案原因（必填，不会伪装成自动恢复）", "") || "";
  }
  if (action === "delete") {
    if (!window.confirm("从异常列表删除这条？不会改原任务，同一条旧失败不会再出现。")) return;
  }
  const requestId = `${action}-${item.id}-${Date.now()}`;
  const response = await fetch(`/api/novel-exceptions/${encodeURIComponent(item.id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, reason, ignoreFor, version: item.version, requestId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    $("exceptionsStatus").textContent = data.error || "更新失败。";
    return;
  }
  await Promise.all([loadSummary(), loadList()]);
  if (action === "delete") {
    $("exceptionDrawer").hidden = true;
    return;
  }
  if (data.item?.id) openDrawer(data.item.id);
}

function bind() {
  readFiltersFromUrl();
  $("refreshExceptionsBtn").addEventListener("click", () => {
    cursorStack.splice(0, cursorStack.length, "");
    Promise.all([loadSummary(), loadList()]);
  });
  ["filterWorkflow", "filterKind", "filterStage"].forEach((id) => {
    $(id).addEventListener("change", () => {
      cursorStack.splice(0, cursorStack.length, "");
      Promise.all([loadSummary(), loadList()]);
    });
  });
  $("nextPageBtn").addEventListener("click", () => {
    const next = $("nextPageBtn").dataset.next;
    if (!next) return;
    cursorStack.push(next);
    loadList();
  });
  $("prevPageBtn").addEventListener("click", () => {
    if (cursorStack.length <= 1) return;
    cursorStack.pop();
    loadList();
  });
  $("closeDrawerBtn").addEventListener("click", () => {
    $("exceptionDrawer").hidden = true;
  });
  $("exceptionRows").addEventListener("click", (event) => {
    const openId = event.target?.dataset?.open;
    if (openId) {
      openDrawer(openId);
      return;
    }
    const deleteId = event.target?.dataset?.delete;
    if (deleteId) {
      runAction({ id: deleteId, version: Number(event.target.dataset.version) || 1 }, "delete");
    }
  });
  $("deleteUnresolvedBtn").addEventListener("click", async () => {
    if (!window.confirm("删除当前未解决的全部异常？只清异常列表，不改任务。同一条旧失败不会再出现，之后的新失败仍会进来。")) return;
    const response = await fetch("/api/novel-exceptions/bulk-delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: $("filterKind").value,
        stage: $("filterStage").value,
        reason: "clear-unresolved",
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      $("exceptionsStatus").textContent = data.error || "批量删除失败。";
      return;
    }
    $("exceptionDrawer").hidden = true;
    cursorStack.splice(0, cursorStack.length, "");
    await Promise.all([loadSummary(), loadList()]);
    $("exceptionsStatus").textContent = data.truncated
      ? `已删除 ${data.deleted} 条，还有剩余，请再点一次。`
      : `已删除 ${data.deleted} 条旧异常。`;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") Promise.all([loadSummary(), loadList()]);
  });
}

bind();
Promise.all([loadSummary(), loadList()]).catch((error) => {
  $("exceptionsStatus").textContent = error.message || "读取异常失败。";
});
