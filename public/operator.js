const $ = (selector) => document.querySelector(selector);
let settings = {};
let overview = null;
let activePlan = null;
let groups = [];
let deepseekSettings = {};

$("#refreshOverviewBtn").addEventListener("click", loadOverview);
$("#createPlanBtn").addEventListener("click", createPlan);
$("#approvePlanBtn").addEventListener("click", approvePlan);
$("#saveSettingsBtn").addEventListener("click", saveSettings);
$("#saveDeepseekBtn").addEventListener("click", saveDeepseekSettings);
$("#testDeepseekBtn").addEventListener("click", testDeepseekConnection);
$("#reloadPlansBtn").addEventListener("click", loadPlans);
$("#profileSelect").addEventListener("change", () => loadOverview({ resetGroups: true }));
$("#strategyProvider").addEventListener("change", updateModelControls);
$("#autoCreate").addEventListener("change", confirmAutoCreate);
$("#operatorEnabled").addEventListener("change", toggleOperator);
$("#autoAnalyze").addEventListener("change", () => {
  $("#operatorEnabled").checked = $("#autoAnalyze").checked;
});

initialize();

async function initialize() {
  setBusy(true, "正在读取运营配置...");
  try {
    const [statusData, authData, deepseekData] = await Promise.all([
      requestJson("/api/operator/status"),
      requestJson("/api/auth/me"),
      requestJson("/api/deepseek/settings")
    ]);
    settings = statusData.settings || {};
    deepseekSettings = deepseekData || {};
    renderProfiles(authData.profiles || []);
    applySettings(settings);
    applyDeepseekSettings(deepseekSettings);
    updateState(statusData);
    await loadOverview();
    await loadPlans({ renderLatest: false });
  } catch (error) {
    setStatus(error.message || "运营大脑初始化失败。", true);
  } finally {
    setBusy(false);
  }
}

async function loadOverview(options = {}) {
  setBusy(true, "正在读取 GeeLark 账号与最近数据...");
  try {
    const currentSelection = selectedGroups();
    const groupNames = options.resetGroups
      ? []
      : currentSelection.length
        ? currentSelection
        : settings.groupNames || [];
    const params = new URLSearchParams({
      profileId: $("#profileSelect").value,
      objective: "traffic"
    });
    groupNames.forEach((name) => params.append("group", name));
    overview = await requestJson(`/api/operator/overview?${params}`);
    groups = overview.groups || [];
    renderGroups(groups, options.resetGroups ? [] : groupNames.length ? groupNames : settings.groupNames || []);
    renderStageStrip(overview.stages || []);
    renderAccounts(overview.accounts || []);
    renderDataStatus(overview);
    setStatus(`已分析 ${overview.accountCount || 0} 个账号。`);
  } catch (error) {
    setStatus(error.message || "账号分析失败。", true);
  } finally {
    setBusy(false);
  }
}

async function saveSettings() {
  setBusy(true, "正在保存策略...");
  try {
    const data = await requestJson("/api/operator/settings", {
      method: "POST",
      body: JSON.stringify(collectSettings())
    });
    settings = data.settings || {};
    updateState({ settings, enabled: settings.enabled, autoCreateTasks: settings.autoCreateTasks });
    setStatus(settings.enabled
      ? "运营策略已保存。每天到设定时间会按当前账号组重新判断阶段。"
      : "运营大脑已关闭，不会自动抓取、生成策略或创建发布任务。");
  } catch (error) {
    setStatus(error.message || "保存策略失败。", true);
  } finally {
    setBusy(false);
  }
}

async function toggleOperator(event) {
  $("#autoAnalyze").checked = event.target.checked;
  await saveSettings();
}

async function saveDeepseekSettings() {
  const apiKey = $("#deepseekApiKey").value.trim();
  setDeepseekBusy(true, "正在保存 DeepSeek 配置...");
  try {
    deepseekSettings = await requestJson("/api/deepseek/settings", {
      method: "POST",
      body: JSON.stringify({
        apiKey,
        reasoningMode: $("#strategyReasoning").value
      })
    });
    $("#deepseekApiKey").value = "";
    applyDeepseekSettings(deepseekSettings);
    setDeepseekStatus("DeepSeek 配置已保存到本地，页面不会回传完整密钥。", false);
  } catch (error) {
    setDeepseekStatus(error.message || "保存 DeepSeek 配置失败。", true);
  } finally {
    setDeepseekBusy(false);
  }
}

async function testDeepseekConnection() {
  const apiKey = $("#deepseekApiKey").value.trim();
  setDeepseekBusy(true, "正在测试 DeepSeek V4 Flash...");
  try {
    const data = await requestJson("/api/deepseek/test", {
      method: "POST",
      body: JSON.stringify({
        apiKey,
        reasoningMode: $("#strategyReasoning").value
      })
    });
    deepseekSettings = data || deepseekSettings;
    applyDeepseekSettings(deepseekSettings);
    setDeepseekStatus(`连接成功，耗时 ${Math.max(1, Math.round((data.lastTest?.durationMs || 0) / 1000))} 秒。`, false);
  } catch (error) {
    setDeepseekStatus(error.message || "DeepSeek 连接测试失败。", true);
  } finally {
    setDeepseekBusy(false);
  }
}

async function createPlan() {
  if (!selectedGroups().length) return setStatus("请至少勾选一个账号组。", true);
  const provider = $("#strategyProvider").value;
  const providerLabel = provider === "deepseek" ? "DeepSeek V4 Flash" : provider === "codex" ? "Codex" : "规则引擎";
  setBusy(true, provider === "rules"
    ? "规则引擎正在计算每个账号的内容组合..."
    : `${providerLabel} 正在结合账号数据生成当天策略与脚本...`);
  try {
    const data = await requestJson("/api/operator/plans", {
      method: "POST",
      body: JSON.stringify({ ...collectSettings(), force: false, autoCreateTasks: false })
    });
    activePlan = data.plan;
    renderPlan(activePlan);
    setStatus(`方案已生成：${activePlan.accountCount} 个账号，计划 ${activePlan.plannedVideos} 条视频。`);
  } catch (error) {
    setStatus(error.message || "生成运营方案失败。", true);
  } finally {
    setBusy(false);
  }
}

async function approvePlan() {
  if (!activePlan?.id) return;
  const confirmed = window.confirm(`将为 ${activePlan.plannedVideos} 条视频创建生成与发布任务。\n\n系统会立即开始生成视频，但只会按方案中的计划时间提交发布。是否继续？`);
  if (!confirmed) return;
  setBusy(true, "正在安全创建任务...");
  try {
    const data = await requestJson(`/api/operator/plans/${encodeURIComponent(activePlan.id)}/approve`, { method: "POST" });
    activePlan = data.plan;
    renderPlan(activePlan);
    setStatus(activePlan.status === "approved"
      ? `已创建 ${activePlan.createdTaskIds?.length || 0} 个任务，可前往执行队列查看。`
      : "部分任务创建失败，已停止继续创建；修复后可安全重试。", activePlan.status !== "approved");
  } catch (error) {
    setStatus(error.message || "创建运营任务失败。", true);
  } finally {
    setBusy(false);
  }
}

async function loadPlans({ renderLatest = true } = {}) {
  try {
    const data = await requestJson("/api/operator/plans");
    const latest = (data.plans || [])[0];
    if (renderLatest && latest) {
      activePlan = await requestJson(`/api/operator/plans/${encodeURIComponent(latest.id)}`).then((item) => item.plan);
      renderPlan(activePlan);
      setStatus(`已打开 ${activePlan.planDate} 的最近运营方案。`);
    }
  } catch (error) {
    setStatus(error.message || "读取历史方案失败。", true);
  }
}

function renderProfiles(profiles) {
  const select = $("#profileSelect");
  select.innerHTML = profiles.length
    ? profiles.map((profile) => `<option value="${escapeAttr(profile.id)}">${escapeHtml(profile.name || profile.id)}</option>`).join("")
    : '<option value="default">默认 GeeLark 账号</option>';
}

function applySettings(value) {
  $("#profileSelect").value = value.profileId || "default";
  $("#postsPerAccount").value = String(value.postsPerAccount || 2);
  $("#maxDailyVideos").value = String(value.maxDailyVideos || 300);
  $("#maxAccounts").value = String(value.maxAccounts || 100);
  $("#runTime").value = timeValue(value.runHour, value.runMinute);
  $("#publishTime").value = timeValue(value.publishHour, value.publishMinute);
  $("#publishWindow").value = String(value.publishWindowMinutes ?? 30);
  $("#slotInterval").value = String(value.slotIntervalMinutes || 180);
  $("#strategyProvider").value = value.strategyProvider || (value.useCodex === false ? "rules" : "codex");
  $("#strategyReasoning").value = value.strategyReasoning === "disabled" ? "disabled" : "enabled";
  $("#operatorEnabled").checked = value.enabled === true;
  $("#autoAnalyze").checked = value.enabled === true;
  $("#autoCreate").checked = value.autoCreateTasks === true;
  updateModelControls();
}

function applyDeepseekSettings(value = {}) {
  deepseekSettings = value;
  $("#deepseekApiKey").placeholder = value.configured
    ? `已保存 ${value.apiKeyHint || "API Key"}，留空保持不变`
    : "粘贴 DeepSeek API Key";
  const state = $("#deepseekConnectionState");
  state.textContent = value.configured ? `已配置 ${value.model || "DeepSeek V4 Flash"}` : "尚未配置 DeepSeek";
  state.classList.toggle("is-ready", Boolean(value.configured));
  updateModelControls();
}

function updateModelControls() {
  const usesDeepseek = ["hybrid", "deepseek"].includes($("#strategyProvider").value);
  $("#deepseekKeyField").classList.toggle("is-muted", !usesDeepseek);
  $("#strategyReasoning").disabled = !usesDeepseek;
}

function collectSettings() {
  const [runHour, runMinute] = parseTime($("#runTime").value);
  const [publishHour, publishMinute] = parseTime($("#publishTime").value);
  return {
    enabled: $("#operatorEnabled").checked,
    autoCreateTasks: $("#autoCreate").checked,
    strategyProvider: $("#strategyProvider").value,
    strategyReasoning: $("#strategyReasoning").value,
    useCodex: ["hybrid", "codex"].includes($("#strategyProvider").value),
    profileId: $("#profileSelect").value || "default",
    groupNames: selectedGroups(),
    objective: "traffic",
    postsPerAccount: Number($("#postsPerAccount").value) || 2,
    maxDailyVideos: Number($("#maxDailyVideos").value) || 300,
    maxAccounts: Number($("#maxAccounts").value) || 100,
    runHour,
    runMinute,
    publishHour,
    publishMinute,
    publishWindowMinutes: Number($("#publishWindow").value) || 0,
    slotIntervalMinutes: Number($("#slotInterval").value) || 180,
    instructionLanguage: "en",
    backgroundMusicMode: "built-in",
    backgroundMusicVolume: 0.35
  };
}

function renderGroups(items, selectedNames) {
  const selected = new Set(selectedNames || []);
  $("#groupList").innerHTML = items.length
    ? items.map((group) => `<label class="operator-group-item">
        <input type="checkbox" value="${escapeAttr(group.name)}" ${selected.has(group.name) ? "checked" : ""} />
        <span><strong>${escapeHtml(group.name)}</strong><small>${group.accountCount} 个账号</small></span>
      </label>`).join("")
    : '<span class="loading-line">当前 GeeLark 配置没有可用账号组。</span>';
  $("#groupList").querySelectorAll("input").forEach((input) => input.addEventListener("change", updateGroupSelection));
  updateGroupSelection();
}

function updateGroupSelection() {
  const names = selectedGroups();
  const count = groups.filter((group) => names.includes(group.name)).reduce((sum, group) => sum + Number(group.accountCount || 0), 0);
  $("#groupSelectionText").textContent = names.length ? `已选 ${names.length} 组 · ${count} 个账号` : "未选择账号组";
}

function selectedGroups() {
  return Array.from($("#groupList").querySelectorAll("input:checked")).map((input) => input.value);
}

function renderStageStrip(stages) {
  for (const stage of stages) {
    const target = document.querySelector(`[data-stage="${CSS.escape(stage.id)}"] strong`);
    if (target) target.textContent = String(stage.count || 0);
  }
}

function renderAccounts(accounts) {
  $("#accountMeta").textContent = `${accounts.length} 个账号 · 规则基于最近 10 天数据，并参考最近 30 天趋势。`;
  $("#accountRows").innerHTML = accounts.length
    ? accounts.map((account) => `<tr>
        <td><strong>@${escapeHtml(account.username || "-")}</strong><small>${escapeHtml(account.serialNo || "")}</small></td>
        <td>${escapeHtml(account.groupName || "未分组")}</td>
        <td><span class="stage-badge" data-stage="${escapeAttr(account.stage)}">${escapeHtml(account.stageLabel)}</span></td>
        <td>${formatNumber(account.metrics?.videos10d ?? account.metrics?.videos7d ?? 0)} 条</td>
        <td>${formatNumber(account.metrics?.averageViews10d ?? account.metrics?.averageViews7d ?? 0)} / ${formatNumber(account.metrics?.medianViews10d ?? account.metrics?.medianViews7d ?? 0)}</td>
        <td>${Number(account.metrics?.low200Rate || 0).toFixed(0)}%</td>
        <td>${Number(account.metrics?.over1000Rate || 0).toFixed(0)}%</td>
        <td>${formatNumber(account.metrics?.views30d || 0)}</td>
        <td title="${escapeAttr(account.reason || "")}">${escapeHtml(shorten(account.reason || "", 48))}</td>
      </tr>`).join("")
    : '<tr><td colspan="9" class="empty-cell">选中的账号组没有可分析账号。</td></tr>';
}

function renderDataStatus(data) {
  $("#northStarNote").textContent = data.dataStatus?.northStarNote || "运营大脑只优化自然播放量。";
  const lastRun = data.dataStatus?.lastRun;
  const finishedAt = Number(lastRun?.finishedAt || lastRun?.startedAt || 0);
  const privateState = data.dataStatus?.privateAnalytics || {};
  const privateText = privateState.status === "ready"
    ? ` · 留存 ${Number(privateState.detailedVideoCount) || 0} 条`
    : privateState.status === "failed"
      ? " · 留存读取失败"
      : " · 暂无授权留存";
  $("#dataFreshness").textContent = `${finishedAt ? `数据 ${formatDateTime(finishedAt)}` : "尚无抓取数据"}${privateText}`;
}

function renderPlan(plan) {
  const drafts = plan.taskDrafts || [];
  renderAiDecision(plan.aiStrategy, plan.contentFeedback);
  $("#planMeta").textContent = `${plan.planDate} · ${plan.accountCount} 个账号 · ${plan.plannedVideos} 条 · ${statusText(plan.status)}`;
  $("#planSummary").innerHTML = [
    ["账号", plan.accountCount],
    ["视频", plan.plannedVideos],
    ["任务", drafts.length],
    ["已创建", plan.createdTaskIds?.length || 0],
    ["策略模型", plan.aiStrategy?.status === "completed" ? strategyProviderName(plan.aiStrategy) : "规则草案"]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${formatNumber(value)}</strong></div>`).join("");
  $("#planRows").innerHTML = drafts.length
    ? drafts.map((draft) => `<tr>
        <td>第 ${draft.slot} 时段</td>
        <td><span class="layer-badge" data-layer="${escapeAttr(draft.layer)}">${escapeHtml(draft.layerLabel)}</span></td>
        <td><strong>${escapeHtml(draft.templateLabel)}</strong>${draft.aiScript?.mainTitle ? `<small class="ai-script-copy">${escapeHtml(draft.aiScript.mainTitle)}</small>` : ""}</td>
        <td>${draft.accountCount}</td>
        <td>${formatDateTime(Number(draft.scheduleAt) * 1000)}</td>
        <td>${escapeHtml(draft.reason || "")}</td>
        <td><span class="draft-status">${escapeHtml(draftStatusText(draft.status))}</span></td>
      </tr>`).join("")
    : '<tr><td colspan="7" class="empty-cell">方案中没有任务。</td></tr>';
  $("#approvePlanBtn").disabled = !["draft", "partial"].includes(plan.status);
}

function renderAiDecision(strategy = {}, feedback = {}) {
  const panel = $("#aiDecision");
  if (!strategy || !strategy.status) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const stateText = {
    completed: `${strategy.model || strategyProviderName(strategy)} · ${formatDuration(strategy.durationMs)}${strategyRouteText(strategy.route)}`,
    failed: "调用失败，已回退规则",
    unavailable: `${strategyProviderName(strategy)} 不可用`,
    disabled: "本方案未调用",
    pending: "正在生成"
  }[strategy.status] || strategy.status;
  $("#aiDecisionState").textContent = stateText;
  $("#aiDecisionState").classList.toggle("error", strategy.status === "failed");
  $("#aiDecisionTitle").textContent = strategy.status === "completed" ? "今日运营判断" : "策略模型状态";
  $("#aiExecutiveSummary").textContent = strategy.executiveSummary || strategy.error || "本方案使用规则引擎生成，账号分配与安全上限未交给 AI。";
  $("#aiAccountDiagnosis").textContent = strategy.accountDiagnosis || "未生成账号层诊断。";
  $("#aiContentDirection").textContent = strategy.contentDirection || "沿用规则引擎内容组合。";
  const recipeLabels = {
    peripheral_hook: "周边闪视",
    tracking_hook: "小球追踪",
    position_memory: "位置记忆",
    schulte_complete: "完整训练"
  };
  const stageLabels = {
    cold_start: "冷启动",
    testing: "测试期",
    breakout: "爆发期",
    scaling: "放量期",
    qualified: "十万达标",
    recovery: "修复期"
  };
  const recipes = Array.isArray(feedback?.recipes) ? feedback.recipes : [];
  $("#aiContentFeedback").innerHTML = recipes.map((item) => {
    const trend = Number(item.trend) > 0 ? ` · 趋势 ${Number(item.trend).toFixed(2)}x` : "";
    return `<div><strong>${escapeHtml(recipeLabels[item.recipeId] || item.recipeId)}</strong><span>${formatNumber(item.sampleCount)} 条 · 均播 ${formatNumber(item.averageViews)}${trend}</span></div>`;
  }).join("") || '<div class="evidence-empty">暂无可归因样本，按基线探索。</div>';
  const allocations = Array.isArray(strategy.appliedAllocationPlan) ? strategy.appliedAllocationPlan : [];
  $("#aiAllocationPlan").innerHTML = allocations.map((item) => {
    const mix = Object.entries(item.mix || {})
      .map(([recipeId, value]) => `${recipeLabels[recipeId] || recipeId} ${Number(value).toFixed(0)}%`)
      .join(" · ");
    return `<div><strong>${escapeHtml(stageLabels[item.stage] || item.stage)}</strong><span>${escapeHtml(mix)}</span></div>`;
  }).join("") || '<div class="evidence-empty">使用规则引擎基线配比。</div>';
  const notes = Array.isArray(strategy.riskNotes) ? strategy.riskNotes : [];
  $("#aiRiskNotes").innerHTML = notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
}

function strategyProviderName(strategy = {}) {
  return strategy.provider === "hybrid"
    ? "DeepSeek + SOL 智能路由"
    : strategy.provider === "deepseek"
    ? "DeepSeek V4 Flash"
    : strategy.provider === "rules"
      ? "规则引擎"
      : "本地 Codex";
}

function strategyRouteText(route = {}) {
  if (!route?.decision) return "";
  const labels = {
    deepseek_only: " · DeepSeek 全量分析",
    deepseek_then_sol: " · DeepSeek 全量分析 → SOL 最终决策",
    deepseek_only_after_sol_failure: " · DeepSeek 全量分析（SOL 复核失败）",
    sol_fallback: " · SOL 兜底",
    single_provider: "",
    rules_only: ""
  };
  const sampleCount = Number(route.detailedVideoCount) || 0;
  const analyzed = Number(route.analysisStats?.videos) || sampleCount;
  return `${labels[route.decision] || ""}${analyzed ? ` · 已分析 ${analyzed} 条完整视频数据` : ""}`;
}

function updateState(status) {
  const enabled = status.enabled ?? status.settings?.enabled;
  const autoCreate = status.autoCreateTasks ?? status.settings?.autoCreateTasks;
  $("#operatorEnabled").checked = Boolean(enabled);
  $("#autoAnalyze").checked = Boolean(enabled);
  $("#operatorState").textContent = !enabled ? "自动运行关闭" : autoCreate ? "全自动运行" : "每日自动生成草案";
}

function confirmAutoCreate(event) {
  if (!event.target.checked) return;
  const ok = window.confirm("开启后，运营大脑会在每天分析完成后直接创建视频生成与 GeeLark 发布任务。\n\n每日数量仍受硬上限保护。确认开启吗？");
  if (!ok) event.target.checked = false;
}

function setBusy(busy, message = "") {
  $("#createPlanBtn").disabled = busy;
  $("#refreshOverviewBtn").disabled = busy;
  $("#saveSettingsBtn").disabled = busy;
  if (message) setStatus(message);
}

function setDeepseekBusy(busy, message = "") {
  $("#saveDeepseekBtn").disabled = busy;
  $("#testDeepseekBtn").disabled = busy;
  if (message) setDeepseekStatus(message);
}

function setDeepseekStatus(message, error = false) {
  const target = $("#deepseekStatus");
  target.textContent = message;
  target.style.color = error ? "#ff8e91" : "";
}

function setStatus(message, error = false) {
  const target = $("#settingsStatus");
  target.textContent = message;
  target.style.color = error ? "#ff8e91" : "";
  $("#planStatus").textContent = message;
  $("#planStatus").style.color = error ? "#ff8e91" : "";
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败：HTTP ${response.status}`);
  return data;
}

function timeValue(hour, minute) {
  return `${String(Number(hour) || 0).padStart(2, "0")}:${String(Number(minute) || 0).padStart(2, "0")}`;
}

function parseTime(value) {
  const [hour, minute] = String(value || "00:00").split(":").map(Number);
  return [Number.isFinite(hour) ? hour : 0, Number.isFinite(minute) ? minute : 0];
}

function statusText(status) {
  return ({ draft: "待审核", partial: "部分创建", approved: "已创建任务" })[status] || status || "未知";
}

function draftStatusText(status) {
  return ({ draft: "草案", created: "已建任务", failed: "创建失败" })[status] || status || "草案";
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function formatNumber(value) {
  if (typeof value === "string") return value;
  return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
}

function formatDuration(value) {
  const seconds = Math.max(0, Math.round((Number(value) || 0) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)}分${seconds % 60}秒` : `${seconds}秒`;
}

function shorten(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
