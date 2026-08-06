const $ = (selector) => document.querySelector(selector);
let settings = {};
let overview = null;
let activePlan = null;
let groups = [];
let assetGroups = [];

$("#refreshOverviewBtn").addEventListener("click", loadOverview);
$("#createPlanBtn").addEventListener("click", createPlan);
$("#approvePlanBtn").addEventListener("click", approvePlan);
$("#saveSettingsBtn").addEventListener("click", saveSettings);
$("#saveSettingsBottomBtn").addEventListener("click", saveSettings);
$("#reloadPlansBtn").addEventListener("click", loadPlans);
$("#resetJudgmentsBtn").addEventListener("click", resetJudgments);
$("#profileSelect").addEventListener("change", () => loadOverview({ resetGroups: true }));
$("#autoCreate").addEventListener("change", toggleAutoCreate);
$("#operatorEnabled").addEventListener("change", toggleOperator);
$("#assetGroupSelect").addEventListener("change", updateSourceState);
$("#videoDir").addEventListener("input", updateSourceState);
$("#audioDir").addEventListener("input", updateSourceState);
$("#selectVideoDirBtn").addEventListener("click", () => selectDirectory("#videoDir", "选择小说视频素材目录"));
$("#selectAudioDirBtn").addEventListener("click", () => selectDirectory("#audioDir", "选择小说音频目录"));
$("#selectMusicDirBtn").addEventListener("click", () => selectDirectory("#backgroundMusicDir", "选择背景音乐目录"));

initialize();

async function initialize() {
  setBusy(true, "正在读取运营配置...");
  try {
    const [statusData, authData, assetData] = await Promise.all([
      requestJson("/api/operator/status"),
      requestJson("/api/auth/me"),
      requestJson("/api/asset-groups")
    ]);
    settings = statusData.settings || {};
    assetGroups = assetData.groups || [];
    renderProfiles(authData.profiles || []);
    renderAssetGroups(assetGroups);
    applySettings(settings);
    updateState(statusData);
    updateCycleState(statusData);
    await loadOverview();
    await loadPlans({ renderLatest: false });
  } catch (error) {
    setStatus(error.message || "小说 AI 自运营初始化失败。", true);
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
    updateCycleState({ settings });
    setStatus(settings.enabled
      ? "运营策略已保存。每天到设定时间会按当前账号组重新判断阶段。"
      : "小说 AI 自运营已关闭，不会自动抓取、生成策略或创建发布任务。");
  } catch (error) {
    setStatus(error.message || "保存策略失败。", true);
  } finally {
    setBusy(false);
  }
}

async function resetJudgments() {
  const confirmed = window.confirm("清空后，小说运营将从现在开始重新判断账号阶段；舒尔特阶段的旧数据仍保留在数据总览中，但不再参与运营决策。是否继续？");
  if (!confirmed) return;
  setBusy(true, "正在建立小说运营的新判断起点...");
  try {
    const data = await requestJson("/api/operator/reset-judgments", { method: "POST" });
    settings = data.settings || settings;
    await loadOverview();
    setStatus("账号判断已清空。后续只使用新起点之后发布的视频重新判断。 ");
  } catch (error) {
    setStatus(error.message || "清空账号判断失败。", true);
  } finally {
    setBusy(false);
  }
}

async function toggleOperator(event) {
  await saveSettings();
}

async function toggleAutoCreate(event) {
  if (!confirmAutoCreate(event)) return;
  await saveSettings();
}

async function createPlan() {
  if (!selectedGroups().length) return setStatus("请至少勾选一个账号组。", true);
  setBusy(true, "正在结合账号数据生成当天策略与脚本...");
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
  $("#maxDailyVideos").value = "300";
  $("#cycleDays").value = String(value.cycleDays || 7);
  $("#runTime").value = timeValue(value.runHour, value.runMinute);
  $("#publishTime").value = timeValue(value.publishHour, value.publishMinute);
  $("#publishWindow").value = String(value.publishWindowMinutes ?? 30);
  $("#slotInterval").value = String(value.slotIntervalMinutes || 180);
  $("#assetGroupSelect").value = value.assetGroupId || "";
  $("#videoDir").value = value.videoDir || "";
  $("#audioDir").value = value.audioDir || "";
  $("#backgroundMusicDir").value = value.backgroundMusicDir || "";
  $("#videoDesc").value = value.videoDesc || "#reddit #redditstories #storytime";
  $("#operatorEnabled").checked = value.enabled === true;
  $("#autoCreate").checked = value.autoCreateTasks === true;
  updateSourceState();
  updateCycleState({ settings: value });
}

function renderAssetGroups(items) {
  $("#assetGroupSelect").innerHTML = [
    '<option value="">不使用素材组</option>',
    ...items.map((group) => {
      const assetCount = Number(group.totalAssets ?? group.assets?.length ?? group.videoCount) || 0;
      return `<option value="${escapeAttr(group.id)}">${escapeHtml(group.name || group.id)} (${formatNumber(assetCount)} 条)</option>`;
    })
  ].join("");
}

async function selectDirectory(selector, title) {
  const input = $(selector);
  const button = input.closest(".path-picker")?.querySelector("button");
  if (button) button.disabled = true;
  try {
    const data = await requestJson("/api/select-directory", {
      method: "POST",
      body: JSON.stringify({ initialPath: input.value.trim(), title })
    });
    if (!data.canceled && data.path) input.value = data.path;
    updateSourceState();
  } catch (error) {
    setStatus(error.message || "目录选择失败。", true);
  } finally {
    if (button) button.disabled = false;
  }
}

function updateSourceState() {
  const hasVideo = Boolean($("#assetGroupSelect").value || $("#videoDir").value.trim());
  const hasAudio = Boolean($("#audioDir").value.trim());
  const ready = hasVideo && hasAudio;
  const state = $("#sourceState");
  state.textContent = ready ? "小说素材已配置" : hasVideo ? "还需选择音频目录" : hasAudio ? "还需选择视频素材" : "尚未配置";
  state.classList.toggle("is-ready", ready);
}

function collectSettings() {
  const [runHour, runMinute] = parseTime($("#runTime").value);
  const [publishHour, publishMinute] = parseTime($("#publishTime").value);
  const strategyProvider = settings.strategyProvider || (settings.useCodex === false ? "rules" : "codex");
  return {
    enabled: $("#operatorEnabled").checked,
    autoCreateTasks: $("#autoCreate").checked,
    strategyProvider,
    strategyReasoning: settings.strategyReasoning === "disabled" ? "disabled" : "enabled",
    useCodex: ["hybrid", "codex"].includes(strategyProvider),
    profileId: $("#profileSelect").value || "default",
    groupNames: selectedGroups(),
    objective: "traffic",
    postsPerAccount: Number($("#postsPerAccount").value) || 2,
    maxDailyVideos: 300,
    cycleDays: Number($("#cycleDays").value) || 7,
    runHour,
    runMinute,
    publishHour,
    publishMinute,
    publishWindowMinutes: Number($("#publishWindow").value) || 0,
    slotIntervalMinutes: Number($("#slotInterval").value) || 180,
    assetGroupId: $("#assetGroupSelect").value,
    videoDir: $("#videoDir").value.trim(),
    audioDir: $("#audioDir").value.trim(),
    backgroundMusicDir: $("#backgroundMusicDir").value.trim(),
    videoDesc: $("#videoDesc").value.trim() || "#reddit #redditstories #storytime"
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
  const startedAt = Number(overview?.dataStatus?.analysisStartedAt || 0);
  const baseline = startedAt ? ` · 本轮从 ${formatDateTime(startedAt)} 起重新判断` : "";
  $("#accountMeta").textContent = `${accounts.length} 个账号 · 规则基于最近 10 天数据，并参考最近 30 天趋势${baseline}。`;
  $("#accountRows").innerHTML = accounts.length
    ? accounts.map((account) => {
      const pending = Boolean(account.judgmentPending);
      return `<tr>
        <td><strong>@${escapeHtml(account.username || "-")}</strong><small>${escapeHtml(account.serialNo || "")}</small></td>
        <td>${escapeHtml(account.groupName || "未分组")}</td>
        <td><span class="stage-badge" data-stage="${pending ? "pending" : escapeAttr(account.stage)}">${pending ? "待新数据" : escapeHtml(account.stageLabel)}</span></td>
        <td>${pending ? "-" : `${formatNumber(account.metrics?.videos10d ?? account.metrics?.videos7d ?? 0)} 条`}</td>
        <td>${pending ? "-" : `${formatNumber(account.metrics?.averageViews10d ?? account.metrics?.averageViews7d ?? 0)} / ${formatNumber(account.metrics?.medianViews10d ?? account.metrics?.medianViews7d ?? 0)}`}</td>
        <td>${pending ? "-" : `${Number(account.metrics?.low200Rate || 0).toFixed(0)}%`}</td>
        <td>${pending ? "-" : `${Number(account.metrics?.over1000Rate || 0).toFixed(0)}%`}</td>
        <td>${pending ? "-" : formatNumber(account.metrics?.views30d || 0)}</td>
        <td title="${escapeAttr(account.reason || "")}">${escapeHtml(shorten(account.reason || "", 48))}</td>
      </tr>`;
    }).join("")
    : '<tr><td colspan="9" class="empty-cell">选中的账号组没有可分析账号。</td></tr>';
}

function renderDataStatus(data) {
  $("#northStarNote").textContent = data.dataStatus?.northStarNote || "小说 AI 自运营只优化自然播放量。";
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
  renderAiDecision(plan.aiStrategy);
  $("#planMeta").textContent = `${plan.planDate} · ${plan.accountCount} 个账号 · ${plan.plannedVideos} 条 · ${statusText(plan.status)}`;
  $("#planSummary").innerHTML = [
    ["账号", plan.accountCount],
    ["视频", plan.plannedVideos],
    ["任务", drafts.length],
    ["已创建", plan.createdTaskIds?.length || 0]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${formatNumber(value)}</strong></div>`).join("");
  $("#planRows").innerHTML = drafts.length
    ? drafts.map((draft) => `<tr>
        <td>第 ${draft.slot} 时段</td>
        <td><strong>${escapeHtml(draft.templateLabel || "Reddit 自动发布")}</strong></td>
        <td>${draft.accountCount}</td>
        <td>${formatDateTime(Number(draft.scheduleAt) * 1000)}</td>
        <td>${escapeHtml(draft.reason || "")}</td>
        <td><span class="draft-status">${escapeHtml(draftStatusText(draft.status))}</span></td>
      </tr>`).join("")
    : '<tr><td colspan="6" class="empty-cell">方案中没有任务。</td></tr>';
  $("#approvePlanBtn").disabled = !["draft", "partial"].includes(plan.status);
}

function renderAiDecision(strategy = {}) {
  const panel = $("#aiDecision");
  if (!strategy || !strategy.status) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const stateText = {
    completed: "策略已生成",
    failed: "调用失败，已回退规则",
    unavailable: "智能策略暂不可用",
    disabled: "本方案未调用",
    pending: "正在生成"
  }[strategy.status] || strategy.status;
  $("#aiDecisionState").textContent = stateText;
  $("#aiDecisionState").classList.toggle("error", strategy.status === "failed");
  $("#aiDecisionTitle").textContent = strategy.status === "completed" ? "今日运营判断" : "策略模型状态";
  $("#aiExecutiveSummary").textContent = strategy.executiveSummary || strategy.error || "本方案使用规则引擎生成，账号分配与安全上限未交给 AI。";
  $("#aiAccountDiagnosis").textContent = strategy.accountDiagnosis || "未生成账号层诊断。";
  $("#aiContentDirection").textContent = strategy.contentDirection || "统一使用当前已保存的 Reddit 混剪、字幕和去重配置。";
  const notes = Array.isArray(strategy.riskNotes) ? strategy.riskNotes : [];
  $("#aiRiskNotes").innerHTML = notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
}

function updateState(status) {
  const enabled = status.enabled ?? status.settings?.enabled;
  const autoCreate = status.autoCreateTasks ?? status.settings?.autoCreateTasks;
  $("#operatorEnabled").checked = Boolean(enabled);
  $("#operatorState").textContent = !enabled ? "自动运行关闭" : autoCreate ? "全自动运行" : "每日自动生成草案";
}

function updateCycleState(status = {}) {
  const value = status.settings || settings || {};
  const cycle = status.cycle || deriveCycleState(value);
  const target = $("#cycleStatusText");
  const state = $("#operatorState");
  if (!target || !state) return;

  const enabled = status.enabled ?? value.enabled;
  const autoCreate = status.autoCreateTasks ?? value.autoCreateTasks;
  const expired = cycle.status === "expired" || cycle.stopReason === "expired";
  let message = `开启后连续运行 ${Number(value.cycleDays) || 7} 天并自动停止`;

  if (cycle.status === "active") {
    message = `运行至 ${formatDateTime(cycle.endsAt)}，剩余 ${cycle.remainingDays} 天`;
    state.textContent = `${autoCreate ? "全自动运行" : "每日生成草案"} · 剩余 ${cycle.remainingDays} 天`;
  } else if (expired) {
    message = `周期已于 ${formatDateTime(cycle.endsAt)} 结束，自动运行已关闭`;
    state.textContent = "周期已结束";
  } else if (cycle.status === "stopped" && cycle.startedAt) {
    message = "本轮周期已停止；重新开启会从当天开始新的周期";
    state.textContent = "自动运行关闭";
  } else if (!enabled) {
    state.textContent = "自动运行关闭";
  }

  target.textContent = message;
  target.classList.toggle("is-active", cycle.status === "active");
  target.classList.toggle("is-expired", expired);
}

function deriveCycleState(value = {}) {
  const current = Date.now();
  const startedAt = Number(value.cycleStartedAt) || 0;
  const endsAt = Number(value.cycleEndsAt) || 0;
  const remainingMs = endsAt ? Math.max(0, endsAt - current) : 0;
  let status = "not_started";
  if (startedAt && endsAt && current >= endsAt) status = "expired";
  else if (value.enabled && startedAt && endsAt) status = "active";
  else if (startedAt && endsAt) status = "stopped";
  return {
    status,
    startedAt,
    endsAt,
    stopReason: value.cycleStopReason || "",
    remainingDays: remainingMs ? Math.ceil(remainingMs / 86_400_000) : 0
  };
}

function confirmAutoCreate(event) {
  if (!event.target.checked) return true;
  const ok = window.confirm("开启后，小说 AI 自运营会在每天分析完成后直接创建 Reddit 视频生成与 GeeLark 发布任务。\n\n每日数量仍受硬上限保护。确认开启吗？");
  if (!ok) event.target.checked = false;
  return ok;
}

function setBusy(busy, message = "") {
  $("#createPlanBtn").disabled = busy;
  $("#refreshOverviewBtn").disabled = busy;
  $("#saveSettingsBtn").disabled = busy;
  $("#saveSettingsBottomBtn").disabled = busy;
  if (message) setStatus(message);
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
