import fs from "node:fs";
import path from "node:path";

const ANALYSIS_WINDOW_DAYS = 10;
const DAY_MS = 86_400_000;

const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  autoCreateTasks: false,
  useCodex: true,
  strategyProvider: "codex",
  strategyReasoning: "enabled",
  profileId: "default",
  groupNames: [],
  objective: "traffic",
  postsPerAccount: 2,
  maxDailyVideos: 300,
  cycleDays: 7,
  cycleStartedAt: 0,
  cycleEndsAt: 0,
  cycleStoppedAt: 0,
  cycleStopReason: "",
  analysisResetAt: 0,
  runHour: 19,
  runMinute: 0,
  publishHour: 22,
  publishMinute: 0,
  publishWindowMinutes: 30,
  slotIntervalMinutes: 180,
  assetGroupId: "",
  videoDir: "",
  audioDir: "",
  backgroundMusicDir: "",
  videoDesc: "#reddit #redditstories #storytime"
});

const STAGE_META = Object.freeze({
  cold_start: { label: "冷启动", tone: "blue" },
  testing: { label: "测试期", tone: "cyan" },
  breakout: { label: "爆发期", tone: "lime" },
  scaling: { label: "放量期", tone: "green" },
  qualified: { label: "十万达标", tone: "gold" },
  recovery: { label: "修复期", tone: "red" }
});

const REDDIT_WORKFLOW = Object.freeze({
  id: "reddit_auto",
  label: "Reddit 自动发布",
  videoDesc: "#reddit #redditstories #storytime"
});

export function createOperationBrainService({
  workDir,
  analyticsService,
  privateAnalyticsService = null,
  autoTaskManager,
  codexBrain = null,
  deepseekBrain = null,
  listPhones,
  readPublishRecords,
  readRedditSettings = () => ({}),
  listProfiles = () => [],
  now = () => Date.now()
}) {
  const settingsPath = path.join(workDir, "operation-brain-settings.json");
  const plansDir = path.join(workDir, "operation-plans");
  fs.mkdirSync(plansDir, { recursive: true });
  let timer = null;
  let running = false;
  let nextRunAt = 0;
  let phoneCache = { key: "", expiresAt: 0, phones: [] };

  function getSettings() {
    return normalizeSettings(readJson(settingsPath, {}));
  }

  function saveSettings(payload = {}) {
    const current = getSettings();
    let next = normalizeSettings({ ...current, ...payload });
    const timestamp = now();
    const currentCycle = getCycleState(current, timestamp);
    const cycleDaysChanged = Object.hasOwn(payload, "cycleDays") && next.cycleDays !== current.cycleDays;
    const shouldStartCycle = next.enabled && next.groupNames.length > 0 && (
      !current.enabled ||
      !currentCycle.startedAt ||
      currentCycle.status === "expired"
    );
    if (shouldStartCycle) {
      next = startCycle(next, timestamp);
    } else if (next.enabled && cycleDaysChanged) {
      const startedAt = Number(current.cycleStartedAt) || timestamp;
      next = normalizeSettings({
        ...next,
        cycleStartedAt: startedAt,
        cycleEndsAt: startedAt + next.cycleDays * DAY_MS,
        cycleStoppedAt: 0,
        cycleStopReason: ""
      });
    } else if (current.enabled && !next.enabled) {
      next = normalizeSettings({
        ...next,
        cycleStoppedAt: timestamp,
        cycleStopReason: "manual"
      });
    }
    atomicWriteJson(settingsPath, { ...next, updatedAt: now() });
    schedule();
    return getSettings();
  }

  function getStatus() {
    const settings = getSettings();
    const plans = listPlans();
    return {
      enabled: settings.enabled,
      autoCreateTasks: settings.autoCreateTasks,
      running,
      nextRunAt,
      cycle: getCycleState(settings, now()),
      lastPlan: plans[0] || null,
      codex: codexBrain?.getStatus?.() || null,
      deepseek: deepseekBrain?.getStatus?.() || null,
      settings
    };
  }

  function resetJudgments() {
    const resetAt = now();
    const next = normalizeSettings({ ...getSettings(), analysisResetAt: resetAt });
    atomicWriteJson(settingsPath, { ...next, updatedAt: resetAt });
    return getSettings();
  }

  async function getOverview(payload = {}) {
    const settings = normalizeSettings({ ...getSettings(), ...payload });
    const phones = await getPhones(settings.profileId);
    const selected = filterPhones(phones, settings.groupNames).slice(0, settings.maxDailyVideos);
    const accountNames = selected.map((phone) => phone.serialName || phone.name).filter(Boolean);
    const records = readPublishRecords();
    const analysisStartedAt = Math.max(
      Number(settings.analysisResetAt) || 0,
      Number(settings.cycleStartedAt) || 0
    );
    const dashboard10 = analyticsService.getDashboard({ period: "10d", allowedAccounts: accountNames, publishedAfter: analysisStartedAt }, records);
    const dashboard30 = analyticsService.getDashboard({ period: "30d", allowedAccounts: accountNames, publishedAfter: analysisStartedAt }, records);
    const matchedVideos = filterVideosAfter(analyticsService.getMatchedVideos?.(records) || [], analysisStartedAt);
    const accounts = classifyAccounts(selected, dashboard10.accounts || [], dashboard30.accounts || [], {
      objective: settings.objective,
      analysisStartedAt
    });
    let privateAnalytics = {
      status: "unavailable",
      summary: { detailedVideoCount: 0 },
      accounts: [],
      error: "Fivetran destination is not configured."
    };
    if (privateAnalyticsService?.getPublicSettings?.().configured && privateAnalyticsService?.getOperationSignals) {
      try {
        privateAnalytics = await privateAnalyticsService.getOperationSignals({
          accountNames,
          days: ANALYSIS_WINDOW_DAYS,
          videosPerAccount: 30,
          publishedAfter: analysisStartedAt
        });
      } catch (error) {
        privateAnalytics = {
          status: "failed",
          summary: { detailedVideoCount: 0 },
          accounts: [],
          error: String(error?.message || error)
        };
      }
    }
    const privateByUsername = new Map((privateAnalytics.accounts || []).map((item) => [normalizeUsername(item.username), item]));
    for (const account of accounts) {
      account.privateMetrics = privateByUsername.get(normalizeUsername(account.username)) || null;
    }
    const currentPlans = listPlans({ includeArchived: true }).filter((plan) =>
      !analysisStartedAt || Number(plan?.createdAt) >= analysisStartedAt
    );
    applyOperationAges(accounts, matchedVideos, currentPlans, now());
    const contentFeedback = summarizeContentFeedback(
      matchedVideos,
      accountNames,
      now()
    );
    return {
      settings,
      profiles: listProfiles().map(({ id, name }) => ({ id, name })),
      groups: summarizeGroups(phones),
      accountCount: accounts.length,
      accounts,
      stages: summarizeStages(accounts),
      contentFeedback,
      privateAnalytics,
      dataStatus: {
        analysisStartedAt,
        lastRun: dashboard10.status?.lastRun || null,
        videoCount: dashboard10.summary?.videoCount || 0,
        matchedCount: dashboard10.summary?.matchedCount || 0,
        privateAnalytics: {
          status: privateAnalytics.status,
          detailedVideoCount: Number(privateAnalytics.summary?.detailedVideoCount) || 0,
          matchedAccountCount: Number(privateAnalytics.matchedAccountCount) || 0,
          error: privateAnalytics.error || ""
        },
        northStar: "natural_views",
        northStarNote: "小说 AI 自运营只优化自然播放量；互动数据仅用于诊断，不参与账号分层。"
      }
    };
  }

  async function createPlan(payload = {}) {
    if (running) throw statusError(409, "小说 AI 自运营正在生成另一份方案。");
    running = true;
    try {
      const requestedSettings = normalizeSettings({ ...getSettings(), ...payload });
      const cycle = getCycleState(requestedSettings, now());
      if (cycle.status === "expired") {
        throw statusError(409, "本轮小说 AI 自运营周期已经结束。请重新启用自运营，开始一个新的周期。");
      }
      const analyticsRefresh = await refreshAnalytics(requestedSettings, { force: true });
      const overview = await getOverview(payload);
      overview.dataStatus.analyticsRefresh = analyticsRefresh;
      const settings = overview.settings;
      if (!settings.groupNames.length) throw statusError(400, "请至少选择一个 GeeLark 账号组。");
      if (!overview.accounts.length) throw statusError(400, "选中的账号组里没有可运营账号。");
      if (!settings.assetGroupId && !settings.videoDir) throw statusError(400, "请先选择小说视频素材组或视频素材目录。");
      if (!settings.audioDir) throw statusError(400, "请先选择小说音频目录。");
      const redditDefaults = readRedditSettings() || {};
      const planDate = localDateKey(Number(payload.planDate) || now());
      const duplicate = listPlans().find((plan) =>
        plan.planDate === planDate &&
        plan.profileId === settings.profileId &&
        sameStringSet(plan.groupNames, settings.groupNames) &&
        !["canceled", "superseded"].includes(plan.status)
      );
      if (duplicate && payload.force !== true) {
        throw statusError(409, `${planDate} 的相同账号组已经有运营方案，请打开已有方案或使用强制重算。`);
      }

      let assignments = buildAssignments({
        accounts: overview.accounts,
        settings,
        planDate
      });
      let taskDrafts = buildTaskDrafts({
        assignments,
        settings,
        redditDefaults,
        planDate,
        createdAt: now()
      });
      const plannedVideos = taskDrafts.reduce((sum, task) => sum + task.accountCount, 0);
      if (plannedVideos > settings.maxDailyVideos) {
        throw statusError(400, `本次计划 ${plannedVideos} 条，超过每日 ${settings.maxDailyVideos} 条安全上限。`);
      }
      const strategyProvider = settings.strategyProvider;
      const baseStrategyInput = buildCodexOperationInput({ overview, taskDrafts, settings, planDate });
      const route = decideStrategyRoute({
        overview,
        provider: strategyProvider,
        deepseekAvailable: Boolean(deepseekBrain?.analyzeOperationDataset || deepseekBrain?.generateOperationStrategy),
        solAvailable: Boolean(codexBrain?.generateOperationStrategy)
      });
      let aiStrategy = strategyProvider === "rules"
        ? { status: "disabled", provider: "rules", route }
        : { status: route.primaryProvider ? "pending" : "unavailable", provider: strategyProvider, route };
      if (route.primaryProvider) {
        try {
          let finalProvider = route.primaryProvider;
          let firstPass = null;
          let aiResult;
          try {
            if (finalProvider === "deepseek" && deepseekBrain?.analyzeOperationDataset) {
              aiResult = await deepseekBrain.analyzeOperationDataset({
                ...baseStrategyInput,
                fullPrivatePerformance: overview.privateAnalytics
              }, { reasoningMode: settings.strategyReasoning });
            } else {
              const firstService = finalProvider === "deepseek" ? deepseekBrain : codexBrain;
              aiResult = await firstService.generateOperationStrategy(baseStrategyInput, { reasoningMode: settings.strategyReasoning });
            }
            firstPass = aiResult;
            if (finalProvider === "deepseek") {
              route.deepseekDurationMs = Number(aiResult.durationMs) || 0;
              route.analysisStats = aiResult.analysisStats || null;
            }
            if (finalProvider === "codex") route.solDurationMs = Number(aiResult.durationMs) || 0;
          } catch (error) {
            if (strategyProvider !== "hybrid" || finalProvider !== "deepseek" || !codexBrain?.generateOperationStrategy) throw error;
            route.solCalled = true;
            route.decision = "sol_fallback";
            route.reasons.push("deepseek_failed");
            finalProvider = "codex";
            aiResult = await codexBrain.generateOperationStrategy({
              ...baseStrategyInput,
              routeContext: { mode: "fallback", reasons: route.reasons }
            }, { reasoningMode: settings.strategyReasoning });
            route.solDurationMs = Number(aiResult.durationMs) || 0;
          }
          if (strategyProvider === "hybrid" && finalProvider === "deepseek" && route.escalateToSol && codexBrain?.generateOperationStrategy) {
            route.solCalled = true;
            try {
              const reviewedResult = await codexBrain.generateOperationStrategy({
                ...baseStrategyInput,
                preliminaryStrategy: summarizePreliminaryStrategy(firstPass?.strategy),
                deepseekEvidenceReport: firstPass?.evidenceReport || null,
                routeContext: {
                  mode: "full_dataset_review",
                  reasons: route.reasons,
                  analysisStats: firstPass?.analysisStats || null
                }
              }, { reasoningMode: settings.strategyReasoning });
              finalProvider = "codex";
              aiResult = reviewedResult;
              route.solDurationMs = Number(reviewedResult.durationMs) || 0;
            } catch (error) {
              route.decision = "deepseek_only_after_sol_failure";
              route.reasons.push("sol_review_failed");
              route.solError = String(error?.message || error).slice(0, 300);
              finalProvider = "deepseek";
              aiResult = firstPass;
            }
          }
          route.finalProvider = finalProvider;
          const appliedPublishingPlan = applyCodexPublishingPlan(overview.accounts, aiResult.strategy);
          assignments = buildAssignments({
            accounts: overview.accounts,
            settings,
            planDate
          });
          taskDrafts = buildTaskDrafts({
            assignments,
            settings,
            redditDefaults,
            planDate,
            createdAt: now()
          });
          aiStrategy = {
            status: "completed",
            provider: strategyProvider,
            model: aiResult.model || (finalProvider === "deepseek"
              ? deepseekBrain?.getStatus?.().model
              : codexBrain?.getStatus?.().operationModel) || "",
            generatedAt: aiResult.generatedAt || new Date(now()).toISOString(),
            durationMs: (Number(route.deepseekDurationMs) || 0) + (Number(route.solDurationMs) || 0) || Number(aiResult.durationMs) || 0,
            usage: aiResult.usage || null,
            route,
            ...aiResult.strategy,
            appliedPublishingPlan
          };
        } catch (error) {
          aiStrategy = {
            status: "failed",
            provider: strategyProvider,
            model: route.primaryProvider === "deepseek"
              ? deepseekBrain?.getStatus?.().model || ""
              : codexBrain?.getStatus?.().operationModel || "",
            route,
            error: String(error?.message || error)
          };
        }
      }
      const id = `op-${planDate.replaceAll("-", "")}-${hashText(`${settings.profileId}:${settings.groupNames.join("|")}:${now()}`).toString(36)}`;
      const plan = {
        id,
        planDate,
        status: "draft",
        profileId: settings.profileId,
        groupNames: settings.groupNames,
        objective: settings.objective,
        postsPerAccount: settings.postsPerAccount,
        accountCount: overview.accounts.length,
        plannedVideos,
        createdAt: now(),
        updatedAt: now(),
        dataStatus: overview.dataStatus,
        contentFeedback: overview.contentFeedback,
        privateAnalytics: compactPrivateAnalytics(overview.privateAnalytics),
        stages: overview.stages,
        accounts: overview.accounts,
        aiStrategy,
        taskDrafts,
        createdTaskIds: [],
        errors: []
      };
      writePlan(plan);
      if (settings.autoCreateTasks || payload.autoCreateTasks === true) {
        return approvePlan(id);
      }
      return plan;
    } finally {
      running = false;
    }
  }

  function listPlans({ includeArchived = false } = {}) {
    return fs.readdirSync(plansDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readJson(path.join(plansDir, entry.name), null))
      .filter(Boolean)
      .filter((plan) => includeArchived || Number(plan.deleted) !== 1)
      .sort((left, right) => Number(right.createdAt) - Number(left.createdAt));
  }

  function getPlan(id) {
    const plan = readJson(planPath(id), null);
    if (!plan) throw statusError(404, "运营方案不存在。");
    return plan;
  }

  function approvePlan(id) {
    const cycle = getCycleState(getSettings(), now());
    if (cycle.status === "expired") {
      throw statusError(409, "本轮小说 AI 自运营周期已经结束，不能再创建新的发布任务。");
    }
    const plan = getPlan(id);
    if (plan.status === "approved") return plan;
    if (!["draft", "partial"].includes(plan.status)) throw statusError(409, "当前方案状态不能创建任务。");
    const remainingVideos = (plan.taskDrafts || [])
      .filter((draft) => draft.status !== "created")
      .reduce((sum, draft) => sum + (Number(draft.accountCount) || 0), 0);
    const reservedVideos = countReservedVideos(autoTaskManager.listTasks(), plan.planDate);
    if (reservedVideos + remainingVideos > getSettings().maxDailyVideos) {
      throw statusError(
        409,
        `${plan.planDate} 已有 ${reservedVideos} 条视频进入排期，本方案还需创建 ${remainingVideos} 条，将超过每日安全上限。`
      );
    }
    const createdTaskIds = Array.isArray(plan.createdTaskIds) ? [...plan.createdTaskIds] : [];
    const errors = [];
    for (const draft of plan.taskDrafts || []) {
      if (draft.createdTaskId && createdTaskIds.includes(draft.createdTaskId)) continue;
      try {
        const task = autoTaskManager.createTask(draft.payload);
        draft.createdTaskId = task.id;
        draft.status = "created";
        createdTaskIds.push(task.id);
        patchPlan(plan.id, {
          status: "partial",
          taskDrafts: plan.taskDrafts,
          createdTaskIds,
          updatedAt: now()
        });
      } catch (error) {
        draft.status = "failed";
        draft.error = String(error?.message || error);
        errors.push({ draftId: draft.id, error: draft.error });
        break;
      }
    }
    const complete = (plan.taskDrafts || []).every((draft) => draft.status === "created");
    patchPlan(plan.id, {
      status: complete ? "approved" : "partial",
      approvedAt: complete ? now() : null,
      taskDrafts: plan.taskDrafts,
      createdTaskIds,
      errors,
      updatedAt: now()
    });
    return getPlan(plan.id);
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = null;
    nextRunAt = 0;
    let settings = getSettings();
    if (!settings.enabled || !settings.groupNames.length) return;
    if (!settings.cycleStartedAt || !settings.cycleEndsAt) {
      settings = startCycle(settings, now());
      atomicWriteJson(settingsPath, { ...settings, updatedAt: now() });
    }
    const cycle = getCycleState(settings, now());
    if (cycle.status === "expired") {
      stopExpiredCycle(settings);
      return;
    }
    const scheduledRun = nextLocalRun(now(), settings.runHour, settings.runMinute);
    const target = Math.min(scheduledRun, cycle.endsAt);
    nextRunAt = target;
    timer = setTimeout(async () => {
      try {
        if (target >= cycle.endsAt) {
          stopExpiredCycle(settings);
          return;
        }
        await createPlan({ ...settings, autoCreateTasks: settings.autoCreateTasks });
      } catch (error) {
        const logPath = path.join(plansDir, `scheduled-error-${Date.now()}.json`);
        atomicWriteJson(logPath, { at: now(), error: String(error?.message || error) });
      } finally {
        schedule();
      }
    }, Math.min(target - now(), 2_147_000_000));
    timer.unref?.();
  }

  function stopExpiredCycle(settings) {
    const stopped = normalizeSettings({
      ...settings,
      enabled: false,
      autoCreateTasks: false,
      cycleStoppedAt: now(),
      cycleStopReason: "expired"
    });
    atomicWriteJson(settingsPath, { ...stopped, updatedAt: now() });
    nextRunAt = 0;
  }

  async function refreshAnalytics(settings, { force = false } = {}) {
    if (!analyticsService?.fetchAccounts || !analyticsService?.getAccountFreshness) {
      return { status: "unavailable", refreshed: 0, stale: 0 };
    }
    try {
      const phones = await getPhones(settings.profileId);
      const selected = filterPhones(phones, settings.groupNames).slice(0, settings.maxDailyVideos);
      const accountNames = selected.map((phone) => phone.serialName || phone.name).filter(Boolean);
      const freshness = analyticsService.getAccountFreshness(accountNames, 12 * 60 * 60 * 1000);
      const staleAccounts = force
        ? accountNames
        : (Array.isArray(freshness?.staleAccounts) ? freshness.staleAccounts : []);
      if (!staleAccounts.length) {
        return { status: "fresh", refreshed: 0, stale: 0, checked: accountNames.length };
      }
      const result = await analyticsService.fetchAccounts(staleAccounts);
      return {
        status: result?.failed ? "partial" : "refreshed",
        refreshed: Number(result?.succeeded) || Math.max(0, staleAccounts.length - (Number(result?.failed) || 0)),
        stale: staleAccounts.length,
        failed: Number(result?.failed) || 0,
        checked: accountNames.length
      };
    } catch (error) {
      return {
        status: "failed",
        refreshed: 0,
        stale: 0,
        error: String(error?.message || error)
      };
    }
  }

  async function getPhones(profileId) {
    const key = String(profileId || "default");
    if (phoneCache.key === key && phoneCache.expiresAt > now()) return phoneCache.phones;
    const phones = await listPhones(key);
    phoneCache = { key, expiresAt: now() + 5 * 60 * 1000, phones };
    return phones;
  }

  function writePlan(plan) {
    atomicWriteJson(planPath(plan.id), plan);
  }

  function patchPlan(id, patch) {
    const current = getPlan(id);
    writePlan({ ...current, ...patch });
  }

  function planPath(id) {
    return path.join(plansDir, `${safeId(id)}.json`);
  }

  schedule();
  return { getSettings, saveSettings, resetJudgments, getStatus, getOverview, createPlan, listPlans, getPlan, approvePlan, schedule };
}

export function classifyAccounts(phones, recentAccounts, thirtyDayAccounts, options = {}) {
  const recentByName = new Map((recentAccounts || []).map((item) => [normalizeName(item.username), item]));
  const thirtyByName = new Map((thirtyDayAccounts || []).map((item) => [normalizeName(item.username), item]));
  const measurable = (recentAccounts || []).filter((item) => Number(item.videos) >= 3);
  const benchmarkMedian = percentile(measurable.map((item) => Number(item.medianViews) || 0), 0.5) || 200;
  const benchmarkAverage = percentile(measurable.map((item) => Number(item.averageViews) || 0), 0.5) || 300;

  return (phones || []).map((phone) => {
    const username = String(phone.serialName || phone.name || "").trim();
    const normalizedUsername = normalizeName(username);
    const hasCurrentMetrics = recentByName.has(normalizedUsername) || thirtyByName.has(normalizedUsername);
    const judgmentPending = Boolean(Number(options.analysisStartedAt) > 0 && !hasCurrentMetrics);
    const recent = recentByName.get(normalizedUsername) || emptyMetrics();
    const thirty = thirtyByName.get(normalizedUsername) || emptyMetrics();
    const stage = detectStage(recent, thirty, {
      benchmarkMedian,
      benchmarkAverage
    });
    const confidence = Number(recent.videos) >= 9 ? "high" : Number(recent.videos) >= 3 ? "medium" : "low";
    return {
      envId: String(phone.id || ""),
      username,
      serialNo: String(phone.serialNo || ""),
      groupName: String(phone.groupName || ""),
      remark: String(phone.remark || ""),
      stage,
      stageLabel: STAGE_META[stage]?.label || stage,
      stageTone: STAGE_META[stage]?.tone || "gray",
      confidence,
      judgmentPending,
      metrics: {
        videos10d: Number(recent.videos) || 0,
        views10d: Number(recent.views) || 0,
        averageViews10d: Number(recent.averageViews) || 0,
        medianViews10d: Number(recent.medianViews) || 0,
        maxViews10d: Number(recent.maxViews) || 0,
        // Legacy aliases keep existing saved plans readable.
        videos7d: Number(recent.videos) || 0,
        views7d: Number(recent.views) || 0,
        averageViews7d: Number(recent.averageViews) || 0,
        medianViews7d: Number(recent.medianViews) || 0,
        maxViews7d: Number(recent.maxViews) || 0,
        low200Rate: round(Number(recent.low200Rate) || 0, 1),
        over500Rate: round(Number(recent.over500Rate) || 0, 1),
        over1000Rate: round(Number(recent.over1000Rate) || 0, 1),
        views30d: Number(thirty.views || thirty.totalViews) || 0,
        averageViews30d: Number(thirty.averageViews) || 0,
        trend: thirty.averageViews ? round(Number(recent.averageViews || 0) / Number(thirty.averageViews), 2) : 0
      },
      reason: judgmentPending
        ? "账号判断已清空，等待重置后的新视频数据。"
        : stageReason(stage, recent, thirty, { benchmarkMedian, benchmarkAverage })
    };
  }).sort((left, right) =>
    String(left.groupName).localeCompare(String(right.groupName), "zh-Hans-CN") ||
    right.metrics.averageViews10d - left.metrics.averageViews10d
  );
}

export function buildAssignments({ accounts, settings, planDate }) {
  const assignments = [];
  for (const account of accounts || []) {
    for (let slot = 0; slot < settings.postsPerAccount; slot++) {
      assignments.push({
        slot,
        account,
        publishingPlan: resolvePublishingPlan(account, settings)
      });
    }
  }
  return assignments;
}

export function summarizeContentFeedback(videos, allowedAccounts = [], currentTime = Date.now()) {
  const allowed = new Set((allowedAccounts || []).map(normalizeName).filter(Boolean));
  const currentSeconds = Math.floor(Number(currentTime) / 1000);
  const currentStart = currentSeconds - ANALYSIS_WINDOW_DAYS * 24 * 60 * 60;
  const previousStart = currentStart - ANALYSIS_WINDOW_DAYS * 24 * 60 * 60;
  const currentViews = [];
  const previousViews = [];
  let matchedVideos = 0;
  let unclassifiedVideos = 0;
  const publishTimeBuckets = new Map();

  for (const video of videos || []) {
    if (!video?.local) continue;
    if (allowed.size && !allowed.has(normalizeName(video.username))) continue;
    const createTime = Number(video.createTime) || 0;
    if (!createTime || createTime < previousStart || createTime > currentSeconds + 60) continue;
    if (!isRedditOperationVideo(video.local)) {
      unclassifiedVideos += 1;
      continue;
    }
    const target = createTime >= currentStart ? currentViews : previousViews;
    target.push(Number(video.views) || 0);
    if (createTime >= currentStart) {
      matchedVideos += 1;
      const created = new Date(createTime * 1000);
      const minute = created.getMinutes() < 30 ? 0 : 30;
      const bucketId = `${String(created.getHours()).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      const publishTimeViews = publishTimeBuckets.get(bucketId) || [];
      publishTimeViews.push(Number(video.views) || 0);
      publishTimeBuckets.set(bucketId, publishTimeViews);
    }
  }

  const averageViews = mean(currentViews);
  const previousAverageViews = mean(previousViews);
  const workflows = [{
      workflowId: REDDIT_WORKFLOW.id,
      label: REDDIT_WORKFLOW.label,
      sampleCount: currentViews.length,
      previousSampleCount: previousViews.length,
      averageViews: round(averageViews, 0),
      previousAverageViews: round(previousAverageViews, 0),
      medianViews: round(percentile(currentViews, 0.5), 0),
      maxViews: currentViews.length ? Math.max(...currentViews) : 0,
      low200Rate: currentViews.length
        ? round(currentViews.filter((views) => views < 200).length / currentViews.length * 100, 1)
        : 0,
      over1000Rate: currentViews.length
        ? round(currentViews.filter((views) => views >= 1000).length / currentViews.length * 100, 1)
        : 0,
      trend: previousAverageViews > 0 ? round(averageViews / previousAverageViews, 2) : 0,
    }];

  const publishTimePerformance = Array.from(publishTimeBuckets, ([time, views]) => ({
    time,
    sampleCount: views.length,
    averageViews: round(mean(views), 0),
    medianViews: round(percentile(views, 0.5), 0),
    maxViews: views.length ? Math.max(...views) : 0
  })).sort((left, right) => right.averageViews - left.averageViews || right.sampleCount - left.sampleCount);

  return {
    windowDays: ANALYSIS_WINDOW_DAYS,
    comparedWithPreviousDays: ANALYSIS_WINDOW_DAYS,
    matchedVideos,
    unclassifiedVideos,
    workflows,
    publishTimePerformance
  };
}

function isRedditOperationVideo(local = {}) {
  if (String(local?.operationMeta?.createdBy || "") === "operation-brain") return true;
  const template = `${local.templateId || ""} ${local.template || ""}`.toLowerCase();
  return /(reddit|混剪|novel|story)/i.test(template);
}

function buildTaskDrafts({ assignments, settings, redditDefaults = {}, planDate, createdAt }) {
  const grouped = new Map();
  for (const item of assignments) {
    const publishingPlan = item.publishingPlan || resolvePublishingPlan(item.account, settings);
    const publishingKey = [
      publishingPlan.mode,
      publishingPlan.startHour,
      publishingPlan.startMinute,
      publishingPlan.windowMinutes,
      publishingPlan.slotIntervalMinutes
    ].join(":");
    const key = `${item.slot}:${publishingKey}`;
    const group = grouped.get(key) || {
      slot: item.slot,
      publishingPlan,
      accounts: []
    };
    group.accounts.push(item.account);
    grouped.set(key, group);
  }
  return Array.from(grouped.values())
    .sort((left, right) => left.slot - right.slot)
    .map((group) => {
      const scheduleAt = scheduleForGroup(group, planDate);
      const accounts = group.accounts.map((account) => ({
        id: account.envId,
        name: account.username,
        serialNo: account.serialNo,
        groupName: account.groupName,
        remark: account.remark
      }));
      const savedSubtitle = redditDefaults.subtitle || {};
      const savedDedup = redditDefaults.dedup || {};
      const subtitleFontSize = Math.max(42, Math.min(92, Number(savedSubtitle.fontSize) || 62));
      const dedup = {
        enabled: true,
        ...savedDedup
      };
      return {
        id: `draft-${group.slot}-${REDDIT_WORKFLOW.id}-${scheduleAt}`,
        status: "draft",
        slot: group.slot + 1,
        scheduleAt,
        workflowId: REDDIT_WORKFLOW.id,
        template: "reddit",
        templateLabel: REDDIT_WORKFLOW.label,
        accountCount: accounts.length,
        accounts: accounts.map(({ id, name, groupName }) => ({ id, name, groupName })),
        reason: summarizeDraftReason(group.accounts),
        payload: {
          taskType: "reddit",
          name: `小说 AI 自运营 ${planDate} 第${group.slot + 1}时段 ${accounts.length}条`,
          generation: {
            assetGroupId: settings.assetGroupId,
            videoDir: settings.videoDir,
            includeVideoSubfolders: true,
            audioDir: settings.audioDir,
            backgroundMusicDir: settings.backgroundMusicDir,
            saveDir: "",
            segmentMode: "fixed",
            segmentSeconds: 5,
            totalVideos: accounts.length,
            subtitleYPercent: Number(savedSubtitle.yPercent) || 66,
            subtitleFontSize,
            subtitleAnimationMode: savedSubtitle.animationMode || "word-highlight",
            quality: "fast",
            autoCaptions: true,
            dedup
          },
          publish: {
            autoPublish: true,
            envIds: accounts.map((account) => account.id),
            accounts,
            videoDesc: settings.videoDesc || REDDIT_WORKFLOW.videoDesc,
            scheduleAt,
            intervalMinutes: 0,
            batchPublishLimit: settings.maxDailyVideos,
            dailyPublishLimit: settings.maxDailyVideos,
            geelarkProfileId: settings.profileId,
            operationMeta: {
              createdBy: "operation-brain",
              createdAt,
              planDate,
              objective: settings.objective,
              workflowId: REDDIT_WORKFLOW.id,
              schedulingMode: group.publishingPlan.mode,
              publishingPlan: group.publishingPlan,
              targetStages: Array.from(new Set(group.accounts.map((account) => account.stage).filter(Boolean)))
            }
          },
          geelarkProfileId: settings.profileId,
          operationMeta: {
            createdBy: "operation-brain",
            createdAt,
            planDate,
            objective: settings.objective,
            workflowId: REDDIT_WORKFLOW.id
          }
        }
      };
    });
}

function detectStage(seven, thirty, benchmark) {
  const videos = Number(seven.videos) || 0;
  const average = Number(seven.averageViews) || 0;
  const median = Number(seven.medianViews) || 0;
  const max = Number(seven.maxViews) || 0;
  const low200 = Number(seven.low200Rate) || 0;
  const over1000 = Number(seven.over1000Rate) || 0;
  const views30d = Number(thirty.views || thirty.totalViews) || 0;
  const trend = thirty.averageViews ? average / Number(thirty.averageViews) : 1;
  if (videos < 3) return "cold_start";
  if (videos < 9) return "testing";
  if (views30d >= 100000) return "qualified";
  if (low200 >= 70 || (trend < 0.55 && median < benchmark.benchmarkMedian * 0.65)) return "recovery";
  if (over1000 >= 20 || max >= Math.max(5000, benchmark.benchmarkAverage * 8)) return "breakout";
  if (median >= benchmark.benchmarkMedian * 1.25 && average >= benchmark.benchmarkAverage * 1.15) return "scaling";
  if (average >= benchmark.benchmarkAverage || median >= benchmark.benchmarkMedian) return "scaling";
  return "testing";
}

function stageReason(stage, seven, thirty, benchmark) {
  const videos = Number(seven.videos) || 0;
  if (stage === "cold_start") return `最近 ${ANALYSIS_WINDOW_DAYS} 天仅 ${videos} 条有效样本，先用标准 Reddit 任务扩大样本，不提前下结论。`;
  if (stage === "testing") return `仍在样本积累期，均播 ${Number(seven.averageViews) || 0}，继续按当前 Reddit 配置发布并观察分发。`;
  if (stage === "recovery") return `低于 200 播放占比 ${round(Number(seven.low200Rate) || 0, 0)}%，保持生成配置不变，优先调整发布节奏与样本量。`;
  if (stage === "breakout") return `最高播放 ${Number(seven.maxViews) || 0}，破 1000 比例 ${round(Number(seven.over1000Rate) || 0, 0)}%，扩大标准 Reddit 任务样本。`;
  if (stage === "qualified") return `最近 30 天自然播放达到 ${Number(thirty.views || thirty.totalViews) || 0}，已跨过 10 万播放里程碑。`;
  return `均播 ${Number(seven.averageViews) || 0}、中位 ${Number(seven.medianViews) || 0}，已达到组内放量标准。`;
}

function summarizeDraftReason(accounts) {
  const stages = summarizeStages(accounts);
  const dominant = stages.sort((left, right) => right.count - left.count)[0];
  return `${dominant?.label || "混合阶段"}账号为主，统一使用已保存的 Reddit 混剪、字幕和去重配置。`;
}

function summarizeStages(accounts) {
  const counts = new Map();
  for (const account of accounts || []) {
    if (account.judgmentPending) continue;
    counts.set(account.stage, (counts.get(account.stage) || 0) + 1);
  }
  return Object.entries(STAGE_META).map(([id, meta]) => ({
    id,
    label: meta.label,
    tone: meta.tone,
    count: counts.get(id) || 0
  }));
}

function summarizeGroups(phones) {
  const counts = new Map();
  for (const phone of phones || []) {
    const name = String(phone.groupName || "未分组").trim() || "未分组";
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return Array.from(counts, ([name, accountCount]) => ({ name, accountCount }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
}

function filterPhones(phones, groupNames) {
  const groups = new Set((groupNames || []).map(String).filter(Boolean));
  return (phones || []).filter((phone) => !groups.size || groups.has(String(phone.groupName || "")));
}

function buildCodexOperationInput({ overview, taskDrafts, settings, planDate }) {
  const accounts = Array.isArray(overview.accounts) ? overview.accounts : [];
  const stageSummary = Object.keys(STAGE_META).map((stage) => {
    const items = accounts.filter((account) => account.stage === stage);
    const averages = items.map((account) => Number(account.metrics?.averageViews10d ?? account.metrics?.averageViews7d) || 0);
    return {
      stage,
      count: items.length,
      averageViews: round(mean(averages), 0),
      medianViews: round(percentile(averages, 0.5), 0),
      low200Rate: round(mean(items.map((account) => Number(account.metrics?.low200Rate) || 0)), 1),
      over1000Rate: round(mean(items.map((account) => Number(account.metrics?.over1000Rate) || 0)), 1),
      views30d: round(items.reduce((sum, account) => sum + (Number(account.metrics?.views30d) || 0), 0), 0)
    };
  }).filter((item) => item.count > 0);

  return {
    planDate,
    objective: settings.objective,
    accountCount: accounts.length,
    stageSummary,
    workflowPerformance: overview.contentFeedback?.workflows || [],
    publishTimePerformance: overview.contentFeedback?.publishTimePerformance || [],
    privatePerformance: compactPrivateAnalytics(overview.privateAnalytics),
    drafts: (taskDrafts || []).map((draft) => ({
      workflowId: draft.workflowId,
      accountCount: Number(draft.accountCount) || 0,
      scheduleAt: Number(draft.scheduleAt) || 0
    }))
  };
}

export function decideStrategyRoute({
  overview = {},
  provider = "codex",
  deepseekAvailable = false,
  solAvailable = false
} = {}) {
  if (provider === "rules") {
    return {
      decision: "rules_only",
      primaryProvider: "",
      finalProvider: "rules",
      deepseekCalled: false,
      solCalled: false,
      escalateToSol: false,
      reasons: []
    };
  }
  if (provider === "deepseek" || provider === "codex") {
    const available = provider === "deepseek" ? deepseekAvailable : solAvailable;
    return {
      decision: available ? "single_provider" : "provider_unavailable",
      primaryProvider: available ? provider : "",
      finalProvider: available ? provider : "",
      deepseekCalled: available && provider === "deepseek",
      solCalled: available && provider === "codex",
      escalateToSol: false,
      reasons: []
    };
  }

  const summary = overview.privateAnalytics?.summary || {};
  const detailedVideoCount = Math.max(0, Number(summary.detailedVideoCount) || 0);
  const reasons = deepseekAvailable ? ["full_private_dataset_analysis"] : [];
  if (!detailedVideoCount) reasons.push("private_dataset_empty");
  if (!deepseekAvailable && solAvailable) reasons.push("deepseek_unavailable");
  const primaryProvider = deepseekAvailable ? "deepseek" : solAvailable ? "codex" : "";
  const escalateToSol = primaryProvider === "deepseek" && solAvailable;
  if (escalateToSol) reasons.push("sol_final_review");
  return {
    decision: !primaryProvider
      ? "provider_unavailable"
      : primaryProvider === "codex"
        ? "sol_fallback"
        : escalateToSol
          ? "deepseek_then_sol"
          : "deepseek_only",
    primaryProvider,
    finalProvider: primaryProvider,
    deepseekCalled: primaryProvider === "deepseek",
    solCalled: primaryProvider === "codex",
    escalateToSol,
    reasons,
    detailedVideoCount
  };
}

function compactPrivateAnalytics(value = {}, { videoLimit = 0 } = {}) {
  const accounts = (value.accounts || []).map((account) => ({
    username: normalizeUsername(account.username),
    videoCount: Number(account.videoCount) || 0,
    averageViews: account.averageViews ?? null,
    maxViews: Number(account.maxViews) || 0,
    averageWatchRatio: account.averageWatchRatio ?? null,
    averageFullWatchRate: account.averageFullWatchRate ?? null,
    averageRetention3: account.averageRetention3 ?? null,
    averageRetention5: account.averageRetention5 ?? null,
    averageRetention10: account.averageRetention10 ?? null,
    averageRetentionEnd: account.averageRetentionEnd ?? null,
    averageForYouRate: account.averageForYouRate ?? null,
    conflictCount: Number(account.conflictCount) || 0,
    videos: (account.videos || []).slice(0, Math.max(0, Number(videoLimit) || 0)).map((video) => ({
      videoId: String(video.videoId || ""),
      views: Number(video.views) || 0,
      duration: Number(video.duration) || 0,
      averageWatchRatio: video.averageWatchRatio ?? null,
      fullWatchRate: video.fullWatchRate ?? null,
      retentionAt3: video.retentionAt3 ?? null,
      retentionAt5: video.retentionAt5 ?? null,
      retentionAt10: video.retentionAt10 ?? null,
      retentionAtEnd: video.retentionAtEnd ?? null,
      forYouRate: video.forYouRate ?? null,
      conflict: String(video.conflict || "")
    }))
  })).slice(0, 100);
  return {
    status: String(value.status || "unavailable"),
    windowDays: Number(value.windowDays) || ANALYSIS_WINDOW_DAYS,
    matchedAccountCount: Number(value.matchedAccountCount) || 0,
    summary: value.summary || { detailedVideoCount: 0 },
    accounts
  };
}

function summarizePreliminaryStrategy(strategy = {}) {
  return {
    executiveSummary: sanitizeAiText(strategy.executiveSummary, 500),
    accountDiagnosis: sanitizeAiText(strategy.accountDiagnosis, 500),
    contentDirection: sanitizeAiText(strategy.contentDirection, 500),
    riskNotes: (strategy.riskNotes || []).slice(0, 6).map((item) => sanitizeAiText(item, 240)),
    publishingPlan: (strategy.publishingPlan || []).slice(0, 6)
  };
}

function applyCodexPublishingPlan(accounts, strategy) {
  const plans = new Map(
    (Array.isArray(strategy?.publishingPlan) ? strategy.publishingPlan : [])
      .map((item) => [String(item?.stage || ""), item])
      .filter(([stage]) => STAGE_META[stage])
  );
  const appliedByStage = new Map();

  for (const account of accounts || []) {
    const requested = plans.get(account.stage);
    if (!requested) continue;
    const plan = {
      mode: "ai_optimized",
      startHour: integer(requested.startHour, 20, 23, 22),
      startMinute: integer(requested.startMinute, 0, 59, 0),
      windowMinutes: integer(requested.windowMinutes, 0, 60, 30),
      slotIntervalMinutes: integer(requested.slotIntervalMinutes, 30, 360, 180),
      rationale: sanitizeAiText(requested.rationale, 300)
    };
    account.aiPublishingPlan = plan;
    appliedByStage.set(account.stage, { stage: account.stage, ...plan });
  }

  return Array.from(appliedByStage.values());
}

function resolvePublishingPlan(account, settings) {
  if ((Number(account?.operationDay) || 1) <= 7) {
    return {
      mode: "first_week",
      startHour: Number(settings.publishHour),
      startMinute: Number(settings.publishMinute),
      windowMinutes: Number(settings.publishWindowMinutes),
      slotIntervalMinutes: Number(settings.slotIntervalMinutes),
      rationale: "First-week fixed testing window"
    };
  }
  return account?.aiPublishingPlan || {
    mode: "rule_fallback",
    startHour: Number(settings.publishHour),
    startMinute: Number(settings.publishMinute),
    windowMinutes: Number(settings.publishWindowMinutes),
    slotIntervalMinutes: Number(settings.slotIntervalMinutes),
    rationale: "No AI timing plan available"
  };
}

function scheduleForGroup(group, planDate) {
  const plan = group.publishingPlan;
  const windowMinutes = Math.max(0, Number(plan.windowMinutes) || 0);
  const fiveMinuteSlots = Math.max(1, Math.floor(windowMinutes / 5) + 1);
  const jitterMinutes = Math.min(
    windowMinutes,
    (hashText(`${planDate}:${group.slot}:${REDDIT_WORKFLOW.id}:${group.accounts.map((item) => item.envId).join(",")}:time`) % fiveMinuteSlots) * 5
  );
  const startAt = localTimestamp(planDate, plan.startHour, plan.startMinute);
  return startAt + jitterMinutes * 60 + group.slot * plan.slotIntervalMinutes * 60;
}

function applyOperationAges(accounts, videos, plans, currentTime) {
  const earliestByAccount = new Map();
  const remember = (username, timestampSeconds) => {
    const key = normalizeName(username);
    const value = Number(timestampSeconds) || 0;
    if (!key || !value) return;
    const current = earliestByAccount.get(key);
    if (!current || value < current) earliestByAccount.set(key, value);
  };

  for (const video of videos || []) {
    if (!video?.local || !isRedditOperationVideo(video.local)) continue;
    remember(video.username, video.createTime);
  }
  for (const plan of plans || []) {
    if (!["approved", "partial"].includes(String(plan?.status || ""))) continue;
    for (const draft of plan.taskDrafts || []) {
      const timestamp = Number(draft.scheduleAt) || Math.floor(Number(plan.createdAt) / 1000);
      for (const account of draft.accounts || []) remember(account.name, timestamp);
    }
  }

  const today = new Date(currentTime);
  today.setHours(0, 0, 0, 0);
  for (const account of accounts || []) {
    const startedAt = earliestByAccount.get(normalizeName(account.username)) || 0;
    const started = startedAt ? new Date(startedAt * 1000) : null;
    started?.setHours(0, 0, 0, 0);
    account.operationStartedAt = startedAt || null;
    account.operationDay = started
      ? Math.max(1, Math.floor((today.getTime() - started.getTime()) / 86_400_000) + 1)
      : 1;
  }
}

function filterVideosAfter(videos, timestampMs) {
  const cutoff = Number(timestampMs) || 0;
  if (!cutoff) return videos || [];
  return (videos || []).filter((video) => Number(video?.createTime) * 1000 >= cutoff);
}


function normalizeSettings(value = {}) {
  const strategyProvider = ["hybrid", "deepseek", "codex", "rules"].includes(value.strategyProvider)
    ? value.strategyProvider
    : value.useCodex === false
      ? "rules"
      : DEFAULT_SETTINGS.strategyProvider;
  return {
    enabled: value.enabled === true,
    autoCreateTasks: value.autoCreateTasks === true,
    useCodex: ["hybrid", "codex"].includes(strategyProvider),
    strategyProvider,
    strategyReasoning: value.strategyReasoning === "disabled" ? "disabled" : "enabled",
    profileId: String(value.profileId || DEFAULT_SETTINGS.profileId),
    groupNames: Array.from(new Set((Array.isArray(value.groupNames) ? value.groupNames : []).map(String).map((item) => item.trim()).filter(Boolean))),
    objective: "traffic",
    postsPerAccount: integer(value.postsPerAccount, 1, 3, DEFAULT_SETTINGS.postsPerAccount),
    maxDailyVideos: DEFAULT_SETTINGS.maxDailyVideos,
    cycleDays: integer(value.cycleDays, 1, 30, DEFAULT_SETTINGS.cycleDays),
    cycleStartedAt: positiveTimestamp(value.cycleStartedAt),
    cycleEndsAt: positiveTimestamp(value.cycleEndsAt),
    cycleStoppedAt: positiveTimestamp(value.cycleStoppedAt),
    cycleStopReason: ["manual", "expired"].includes(value.cycleStopReason) ? value.cycleStopReason : "",
    analysisResetAt: positiveTimestamp(value.analysisResetAt),
    runHour: integer(value.runHour, 0, 23, DEFAULT_SETTINGS.runHour),
    runMinute: integer(value.runMinute, 0, 59, DEFAULT_SETTINGS.runMinute),
    publishHour: integer(value.publishHour, 0, 23, DEFAULT_SETTINGS.publishHour),
    publishMinute: integer(value.publishMinute, 0, 59, DEFAULT_SETTINGS.publishMinute),
    publishWindowMinutes: integer(value.publishWindowMinutes, 0, 60, DEFAULT_SETTINGS.publishWindowMinutes),
    slotIntervalMinutes: integer(value.slotIntervalMinutes, 15, 720, DEFAULT_SETTINGS.slotIntervalMinutes),
    assetGroupId: String(value.assetGroupId || "").trim(),
    videoDir: String(value.videoDir || "").trim(),
    audioDir: String(value.audioDir || "").trim(),
    backgroundMusicDir: String(value.backgroundMusicDir || "").trim(),
    videoDesc: sanitizeAiText(value.videoDesc || DEFAULT_SETTINGS.videoDesc, 500)
  };
}

function startCycle(settings, timestamp) {
  const startedAt = Number(timestamp) || Date.now();
  return normalizeSettings({
    ...settings,
    cycleStartedAt: startedAt,
    cycleEndsAt: startedAt + settings.cycleDays * DAY_MS,
    cycleStoppedAt: 0,
    cycleStopReason: ""
  });
}

function getCycleState(settings, timestamp = Date.now()) {
  const startedAt = positiveTimestamp(settings?.cycleStartedAt);
  const endsAt = positiveTimestamp(settings?.cycleEndsAt);
  const current = Number(timestamp) || Date.now();
  const remainingMs = endsAt ? Math.max(0, endsAt - current) : 0;
  let status = "not_started";
  if (startedAt && endsAt && current >= endsAt) status = "expired";
  else if (settings?.enabled && startedAt && endsAt) status = "active";
  else if (startedAt && endsAt) status = "stopped";
  return {
    status,
    days: integer(settings?.cycleDays, 1, 30, DEFAULT_SETTINGS.cycleDays),
    startedAt,
    endsAt,
    stoppedAt: positiveTimestamp(settings?.cycleStoppedAt),
    stopReason: String(settings?.cycleStopReason || ""),
    remainingDays: remainingMs ? Math.ceil(remainingMs / DAY_MS) : 0,
    remainingMs
  };
}

function positiveTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function sanitizeAiText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeUsername(value) {
  return String(value || "").trim().replace(/^@/, "").toLowerCase();
}

function mean(values) {
  const numbers = (values || []).map(Number).filter(Number.isFinite);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : 0;
}

function emptyMetrics() {
  return {
    videos: 0,
    views: 0,
    averageViews: 0,
    medianViews: 0,
    maxViews: 0,
    low200Rate: 0,
    over500Rate: 0,
    over1000Rate: 0,
    engagement: 0
  };
}

function nextLocalRun(currentTime, hour, minute) {
  const target = new Date(currentTime);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= currentTime) target.setDate(target.getDate() + 1);
  return target.getTime();
}

function localDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localTimestamp(dateKey, hour, minute) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return Math.floor(new Date(year, month - 1, day, hour, minute, 0, 0).getTime() / 1000);
}

function countReservedVideos(tasks, dateKey) {
  let count = 0;
  for (const task of tasks || []) {
    if (!task || Number(task.deleted) === 1 || ["canceled", "failed"].includes(task.status)) continue;
    for (const item of task.schedulePlan || []) {
      if (item?.date === dateKey) count += Number(item.count) || 0;
    }
  }
  return count;
}

function dayOfYear(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const start = new Date(year, 0, 0);
  const current = new Date(year, month - 1, day);
  return Math.floor((current - start) / 86_400_000);
}

function percentile(values, ratio) {
  const list = (values || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return 0;
  const index = Math.min(list.length - 1, Math.max(0, Math.round((list.length - 1) * ratio)));
  return list[index];
}

function sameStringSet(left, right) {
  const a = [...(left || [])].map(String).sort();
  const b = [...(right || [])].map(String).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function normalizeName(value) {
  return String(value || "").trim().replace(/^@/, "").toLowerCase();
}

function hashText(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function integer(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function decimal(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function statusError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function safeId(value) {
  return String(value || "plan").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160) || "plan";
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
  fs.renameSync(tempPath, filePath);
}
