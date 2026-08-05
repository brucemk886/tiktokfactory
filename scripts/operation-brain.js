import fs from "node:fs";
import path from "node:path";

const ANALYSIS_WINDOW_DAYS = 10;

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
  maxAccounts: 100,
  runHour: 19,
  runMinute: 0,
  publishHour: 22,
  publishMinute: 0,
  publishWindowMinutes: 30,
  slotIntervalMinutes: 180,
  instructionLanguage: "en",
  backgroundMusicMode: "built-in",
  backgroundMusicVolume: 0.35
});

const STAGE_META = Object.freeze({
  cold_start: { label: "冷启动", tone: "blue" },
  testing: { label: "测试期", tone: "cyan" },
  breakout: { label: "爆发期", tone: "lime" },
  scaling: { label: "放量期", tone: "green" },
  qualified: { label: "十万达标", tone: "gold" },
  recovery: { label: "修复期", tone: "red" }
});

const CONTENT_RECIPES = Object.freeze({
  peripheral_hook: {
    id: "peripheral_hook",
    layer: "traffic",
    layerLabel: "流量层",
    label: "模板 5 · 周边闪视",
    template: "peripheral",
    durationSeconds: 18,
    headline: "Peripheral Vision Test",
    mainTitle: "How fast can you spot it?",
    videoDesc: "How fast did you spot every target? Comment your score. #focustest #braintraining #attentiontest",
    generation: { peripheralTargets: 3 }
  },
  tracking_hook: {
    id: "tracking_hook",
    layer: "traffic",
    layerLabel: "流量层",
    label: "模板 2 · 小球追踪",
    template: "tracking",
    durationSeconds: 27,
    headline: "Visual Tracking Test",
    mainTitle: "Keep your eyes on the target",
    videoDesc: "Did you keep track until the end? Comment your answer. #visualtest #focuschallenge #braintraining",
    generation: { trackingSeconds: 16, ballSpeed: 1.35, trackingMode: "auto" }
  },
  position_memory: {
    id: "position_memory",
    layer: "retention",
    layerLabel: "留存层",
    label: "模板 4 · 位置记忆",
    template: "memory",
    durationSeconds: 32,
    headline: "Position Memory",
    mainTitle: "Remember the full sequence",
    videoDesc: "How many positions did you remember? Share your score. #memorytest #brainexercise #focus",
    generation: { memorySteps: 6 }
  },
  schulte_complete: {
    id: "schulte_complete",
    layer: "long_view",
    layerLabel: "中视频验证",
    label: "模板 1 · 完整训练",
    template: "wheel",
    durationSeconds: 65,
    headline: "Daily Focus Training",
    mainTitle: "Complete the full challenge",
    videoDesc: "Complete the full focus challenge and comment your time. #schultetable #focus #braintraining",
    generation: {
      trainingStartsAt: 7,
      instructionStartsAt: 4,
      rotationSpeed: 2.5,
      trainingMode: "auto",
      layoutStyle: "auto",
      backgroundStyle: "auto"
    }
  }
});

const CONTENT_VARIANTS = Object.freeze({
  peripheral_hook: [
    {
      id: "sharp-eyes",
      headline: "Peripheral Vision Test",
      mainTitle: "Only sharp eyes spot all three",
      videoDesc: "How many targets did you spot? Comment your score. #focustest #attentiontest #braintraining"
    },
    {
      id: "wide-focus",
      headline: "Wide Focus Challenge",
      mainTitle: "Do not move your eyes",
      videoDesc: "Keep looking at the center and tell me what you saw. #peripheralvision #focuschallenge #attention"
    },
    {
      id: "fast-reaction",
      headline: "Fast Reaction Test",
      mainTitle: "Your first answer counts",
      videoDesc: "Did you catch every flash on the first try? #reactiontest #brainexercise #focus"
    }
  ],
  tracking_hook: [
    {
      id: "lock-target",
      headline: "Visual Tracking Test",
      mainTitle: "Lock onto the target",
      videoDesc: "Did you keep track until the end? Comment your answer. #visualtest #focuschallenge #braintraining"
    },
    {
      id: "no-blinking",
      headline: "No Blinking Challenge",
      mainTitle: "Follow the marked ball",
      videoDesc: "Which ball was it at the end? Drop your answer below. #trackingtest #attention #focustraining"
    },
    {
      id: "attention-check",
      headline: "Attention Check",
      mainTitle: "Most people lose it halfway",
      videoDesc: "Be honest: when did you lose the target? #attentiontest #visualtracking #brainchallenge"
    }
  ],
  position_memory: [
    {
      id: "full-sequence",
      headline: "Position Memory",
      mainTitle: "Remember the full sequence",
      videoDesc: "How many positions did you remember? Share your score. #memorytest #brainexercise #focus"
    },
    {
      id: "one-look",
      headline: "One Look Memory Test",
      mainTitle: "Do not replay it",
      videoDesc: "Comment the sequence before checking the answer. #visualmemory #memorychallenge #braintraining"
    },
    {
      id: "working-memory",
      headline: "Working Memory Check",
      mainTitle: "Can you hold every position?",
      videoDesc: "How far did your working memory take you? #workingmemory #focus #mindtraining"
    }
  ],
  schulte_complete: [
    {
      id: "daily-reset",
      headline: "Daily Focus Training",
      mainTitle: "Complete the full challenge",
      videoDesc: "Complete the full focus challenge and comment your time. #schultetable #focus #braintraining"
    },
    {
      id: "beat-yesterday",
      headline: "60-Second Focus Workout",
      mainTitle: "Can you beat yesterday's time?",
      videoDesc: "Save this and compare your time tomorrow. #dailyfocus #schultegrid #attentiontraining"
    },
    {
      id: "finish-line",
      headline: "Attention Endurance Test",
      mainTitle: "Finish without losing your place",
      videoDesc: "If you finished cleanly, comment your final time. #focusworkout #attentiontest #brainfitness"
    }
  ]
});

const BASE_MIXES = Object.freeze({
  cold_start: { peripheral_hook: 45, tracking_hook: 35, position_memory: 15, schulte_complete: 5 },
  testing: { peripheral_hook: 35, tracking_hook: 30, position_memory: 25, schulte_complete: 10 },
  breakout: { peripheral_hook: 25, tracking_hook: 25, position_memory: 30, schulte_complete: 20 },
  scaling: { peripheral_hook: 20, tracking_hook: 20, position_memory: 25, schulte_complete: 35 },
  qualified: { peripheral_hook: 20, tracking_hook: 20, position_memory: 25, schulte_complete: 35 },
  recovery: { peripheral_hook: 50, tracking_hook: 35, position_memory: 12, schulte_complete: 3 }
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
    const next = normalizeSettings({ ...getSettings(), ...payload });
    atomicWriteJson(settingsPath, { ...next, updatedAt: now() });
    schedule();
    return next;
  }

  function getStatus() {
    const settings = getSettings();
    const plans = listPlans();
    return {
      enabled: settings.enabled,
      autoCreateTasks: settings.autoCreateTasks,
      running,
      nextRunAt,
      lastPlan: plans[0] || null,
      codex: codexBrain?.getStatus?.() || null,
      deepseek: deepseekBrain?.getStatus?.() || null,
      settings
    };
  }

  async function getOverview(payload = {}) {
    const settings = normalizeSettings({ ...getSettings(), ...payload });
    const phones = await getPhones(settings.profileId);
    const selected = filterPhones(phones, settings.groupNames).slice(0, settings.maxAccounts);
    const accountNames = selected.map((phone) => phone.serialName || phone.name).filter(Boolean);
    const records = readPublishRecords();
    const dashboard10 = analyticsService.getDashboard({ period: "10d", allowedAccounts: accountNames }, records);
    const dashboard30 = analyticsService.getDashboard({ period: "30d", allowedAccounts: accountNames }, records);
    const matchedVideos = analyticsService.getMatchedVideos?.(records) || [];
    const accounts = classifyAccounts(selected, dashboard10.accounts || [], dashboard30.accounts || [], {
      objective: settings.objective
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
          videosPerAccount: 30
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
    applyExperimentAges(accounts, matchedVideos, listPlans({ includeArchived: true }), now());
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
        northStarNote: "运营大脑只优化自然播放量；互动数据仅用于诊断，不参与账号分层。"
      }
    };
  }

  async function createPlan(payload = {}) {
    if (running) throw statusError(409, "运营大脑正在生成另一份方案。");
    running = true;
    try {
      const requestedSettings = normalizeSettings({ ...getSettings(), ...payload });
      const analyticsRefresh = await refreshAnalytics(requestedSettings, { force: true });
      const overview = await getOverview(payload);
      overview.dataStatus.analyticsRefresh = analyticsRefresh;
      const settings = overview.settings;
      if (!settings.groupNames.length) throw statusError(400, "请至少选择一个 GeeLark 账号组。");
      if (!overview.accounts.length) throw statusError(400, "选中的账号组里没有可运营账号。");
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
          const appliedAllocationPlan = applyCodexAllocations(overview.accounts, aiResult.strategy);
          const appliedPublishingPlan = applyCodexPublishingPlan(overview.accounts, aiResult.strategy);
          assignments = buildAssignments({
            accounts: overview.accounts,
            settings,
            planDate
          });
          taskDrafts = buildTaskDrafts({
            assignments,
            settings,
            planDate,
            createdAt: now()
          });
          applyCodexStrategy(taskDrafts, aiResult.strategy, overview.accounts, finalProvider);
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
            appliedAllocationPlan,
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
    const settings = getSettings();
    if (!settings.enabled || !settings.groupNames.length) return;
    const target = nextLocalRun(now(), settings.runHour, settings.runMinute);
    nextRunAt = target;
    timer = setTimeout(async () => {
      try {
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

  async function refreshAnalytics(settings, { force = false } = {}) {
    if (!analyticsService?.fetchAccounts || !analyticsService?.getAccountFreshness) {
      return { status: "unavailable", refreshed: 0, stale: 0 };
    }
    try {
      const phones = await getPhones(settings.profileId);
      const selected = filterPhones(phones, settings.groupNames).slice(0, settings.maxAccounts);
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
  return { getSettings, saveSettings, getStatus, getOverview, createPlan, listPlans, getPlan, approvePlan, schedule };
}

export function classifyAccounts(phones, recentAccounts, thirtyDayAccounts, options = {}) {
  const recentByName = new Map((recentAccounts || []).map((item) => [normalizeName(item.username), item]));
  const thirtyByName = new Map((thirtyDayAccounts || []).map((item) => [normalizeName(item.username), item]));
  const measurable = (recentAccounts || []).filter((item) => Number(item.videos) >= 3);
  const benchmarkMedian = percentile(measurable.map((item) => Number(item.medianViews) || 0), 0.5) || 200;
  const benchmarkAverage = percentile(measurable.map((item) => Number(item.averageViews) || 0), 0.5) || 300;

  return (phones || []).map((phone) => {
    const username = String(phone.serialName || phone.name || "").trim();
    const recent = recentByName.get(normalizeName(username)) || emptyMetrics();
    const thirty = thirtyByName.get(normalizeName(username)) || emptyMetrics();
    const stage = detectStage(recent, thirty, {
      benchmarkMedian,
      benchmarkAverage
    });
    const mix = adjustMix(BASE_MIXES[stage] || BASE_MIXES.testing);
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
      contentMix: mix,
      reason: stageReason(stage, recent, thirty, { benchmarkMedian, benchmarkAverage })
    };
  }).sort((left, right) =>
    String(left.groupName).localeCompare(String(right.groupName), "zh-Hans-CN") ||
    right.metrics.averageViews10d - left.metrics.averageViews10d
  );
}

export function buildAssignments({ accounts, settings, planDate }) {
  const assignments = [];
  for (const account of accounts || []) {
    let previousRecipe = "";
    for (let slot = 0; slot < settings.postsPerAccount; slot++) {
      const salt = `${planDate}:${account.envId}:${slot}:${settings.objective}`;
      const recipeId = chooseWeighted(account.contentMix, hashText(salt), previousRecipe);
      previousRecipe = recipeId;
      const recipe = CONTENT_RECIPES[recipeId] || CONTENT_RECIPES.position_memory;
      const variants = CONTENT_VARIANTS[recipe.id] || [];
      const contentVariant = variants[hashText(`${salt}:copy`) % Math.max(1, variants.length)] || {
        id: "default",
        headline: recipe.headline,
        mainTitle: recipe.mainTitle,
        videoDesc: recipe.videoDesc
      };
      assignments.push({
        slot,
        account,
        recipe,
        contentVariant,
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
  const buckets = new Map(Object.keys(CONTENT_RECIPES).map((recipeId) => [recipeId, {
    current: [],
    previous: [],
    variants: new Map()
  }]));
  let matchedVideos = 0;
  let unclassifiedVideos = 0;
  const publishTimeBuckets = new Map();

  for (const video of videos || []) {
    if (!video?.local) continue;
    if (allowed.size && !allowed.has(normalizeName(video.username))) continue;
    const createTime = Number(video.createTime) || 0;
    if (!createTime || createTime < previousStart || createTime > currentSeconds + 60) continue;
    const recipeId = resolveRecipeId(video.local);
    if (!recipeId || !buckets.has(recipeId)) {
      unclassifiedVideos += 1;
      continue;
    }
    const bucket = buckets.get(recipeId);
    const target = createTime >= currentStart ? bucket.current : bucket.previous;
    target.push(Number(video.views) || 0);
    if (createTime >= currentStart) {
      matchedVideos += 1;
      const created = new Date(createTime * 1000);
      const minute = created.getMinutes() < 30 ? 0 : 30;
      const bucketId = `${String(created.getHours()).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      const publishTimeViews = publishTimeBuckets.get(bucketId) || [];
      publishTimeViews.push(Number(video.views) || 0);
      publishTimeBuckets.set(bucketId, publishTimeViews);
      const variantId = String(video.local?.operationMeta?.contentVariantId || "legacy");
      const variant = bucket.variants.get(variantId) || [];
      variant.push(Number(video.views) || 0);
      bucket.variants.set(variantId, variant);
    }
  }

  const recipes = Array.from(buckets, ([recipeId, bucket]) => {
    const averageViews = mean(bucket.current);
    const previousAverageViews = mean(bucket.previous);
    const variants = Array.from(bucket.variants, ([variantId, views]) => ({
      variantId,
      sampleCount: views.length,
      averageViews: round(mean(views), 0),
      maxViews: views.length ? Math.max(...views) : 0
    })).sort((left, right) => right.averageViews - left.averageViews);
    return {
      recipeId,
      label: CONTENT_RECIPES[recipeId].label,
      sampleCount: bucket.current.length,
      previousSampleCount: bucket.previous.length,
      averageViews: round(averageViews, 0),
      previousAverageViews: round(previousAverageViews, 0),
      medianViews: round(percentile(bucket.current, 0.5), 0),
      maxViews: bucket.current.length ? Math.max(...bucket.current) : 0,
      low200Rate: bucket.current.length
        ? round(bucket.current.filter((views) => views < 200).length / bucket.current.length * 100, 1)
        : 0,
      over1000Rate: bucket.current.length
        ? round(bucket.current.filter((views) => views >= 1000).length / bucket.current.length * 100, 1)
        : 0,
      trend: previousAverageViews > 0 ? round(averageViews / previousAverageViews, 2) : 0,
      topVariant: variants[0] || null
    };
  });

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
    recipes,
    publishTimePerformance
  };
}

function resolveRecipeId(local = {}) {
  const explicit = String(local?.operationMeta?.recipeId || "");
  if (CONTENT_RECIPES[explicit]) return explicit;
  const template = `${local.templateId || ""} ${local.template || ""}`.toLowerCase();
  if (/(peripheral|周边闪视|模板\s*5)/i.test(template)) return "peripheral_hook";
  if (/(tracking|小球追踪|模板\s*2)/i.test(template)) return "tracking_hook";
  if (/(memory|位置记忆|模板\s*4)/i.test(template)) return "position_memory";
  if (/(wheel|完整训练|旋转数字|模板\s*1)/i.test(template)) return "schulte_complete";
  return "";
}

function buildTaskDrafts({ assignments, settings, planDate, createdAt }) {
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
    const key = `${item.slot}:${item.recipe.id}:${item.contentVariant.id}:${publishingKey}`;
    const group = grouped.get(key) || {
      slot: item.slot,
      recipe: item.recipe,
      contentVariant: item.contentVariant,
      publishingPlan,
      accounts: []
    };
    group.accounts.push(item.account);
    grouped.set(key, group);
  }
  return Array.from(grouped.values())
    .sort((left, right) => left.slot - right.slot || left.recipe.id.localeCompare(right.recipe.id))
    .map((group, index) => {
      const scheduleAt = scheduleForGroup(group, planDate);
      const accounts = group.accounts.map((account) => ({
        id: account.envId,
        name: account.username,
        serialNo: account.serialNo,
        groupName: account.groupName,
        remark: account.remark
      }));
      const seed = 1 + (hashText(`${planDate}:${group.recipe.id}:${group.slot}:${group.accounts.map((item) => item.envId).join(",")}`) % 999998);
      const day = 1 + ((dayOfYear(planDate) + group.slot + index) % 999);
      return {
        id: `draft-${group.slot}-${group.recipe.id}-${group.contentVariant.id}-${scheduleAt}`,
        status: "draft",
        slot: group.slot + 1,
        scheduleAt,
        recipeId: group.recipe.id,
        template: group.recipe.template,
        templateLabel: group.recipe.label,
        layer: group.recipe.layer,
        layerLabel: group.recipe.layerLabel,
        accountCount: accounts.length,
        accounts: accounts.map(({ id, name, groupName }) => ({ id, name, groupName })),
        reason: summarizeDraftReason(group.accounts, group.recipe),
        payload: {
          taskType: "schulte",
          name: `运营大脑 ${planDate} ${group.recipe.layerLabel} ${group.recipe.label} ${accounts.length}条`,
          generation: {
            template: group.recipe.template,
            totalVideos: accounts.length,
            startDay: day,
            seed,
            durationSeconds: group.recipe.durationSeconds,
            instructionLanguage: settings.instructionLanguage,
            headline: group.contentVariant.headline,
            mainTitle: group.contentVariant.mainTitle,
            backgroundMusicMode: settings.backgroundMusicMode,
            backgroundMusicEnabled: settings.backgroundMusicMode !== "off",
            backgroundMusicVolume: settings.backgroundMusicVolume,
            ...group.recipe.generation
          },
          publish: {
            autoPublish: true,
            envIds: accounts.map((account) => account.id),
            accounts,
            videoDesc: group.contentVariant.videoDesc,
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
              recipeId: group.recipe.id,
              contentVariantId: group.contentVariant.id,
              experimentMode: group.publishingPlan.mode,
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
            recipeId: group.recipe.id,
            contentVariantId: group.contentVariant.id
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

function adjustMix(base) {
  const result = { ...base };
  for (const key of Object.keys(result)) result[key] = Math.max(0, result[key]);
  const total = Object.values(result).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, round(value / total * 100, 1)]));
}

function chooseWeighted(mix, seed, avoid = "") {
  const entries = Object.entries(mix || {}).filter(([, weight]) => Number(weight) > 0);
  const preferred = entries.filter(([id]) => id !== avoid);
  const source = preferred.length ? preferred : entries;
  const total = source.reduce((sum, [, weight]) => sum + Number(weight), 0);
  let cursor = (seed % 1_000_000) / 1_000_000 * total;
  for (const [id, weight] of source) {
    cursor -= Number(weight);
    if (cursor <= 0) return id;
  }
  return source.at(-1)?.[0] || "position_memory";
}

function stageReason(stage, seven, thirty, benchmark) {
  const videos = Number(seven.videos) || 0;
  if (stage === "cold_start") return `最近 ${ANALYSIS_WINDOW_DAYS} 天仅 ${videos} 条有效样本，先扩大题型测试，不提前下结论。`;
  if (stage === "testing") return `仍在样本积累期，均播 ${Number(seven.averageViews) || 0}，继续用短模板测试自然分发。`;
  if (stage === "recovery") return `低于 200 播放占比 ${round(Number(seven.low200Rate) || 0, 0)}%，需要提高强钩子短模板占比。`;
  if (stage === "breakout") return `最高播放 ${Number(seven.maxViews) || 0}，破 1000 比例 ${round(Number(seven.over1000Rate) || 0, 0)}%，复制胜出结构并扩大样本。`;
  if (stage === "qualified") return `最近 30 天自然播放达到 ${Number(thirty.views || thirty.totalViews) || 0}，已跨过 10 万播放里程碑。`;
  return `均播 ${Number(seven.averageViews) || 0}、中位 ${Number(seven.medianViews) || 0}，已达到组内放量标准。`;
}

function summarizeDraftReason(accounts, recipe) {
  const stages = summarizeStages(accounts);
  const dominant = stages.sort((left, right) => right.count - left.count)[0];
  return `${dominant?.label || "混合阶段"}账号为主，按${recipe.layerLabel}分配 ${recipe.label}。`;
}

function summarizeStages(accounts) {
  const counts = new Map();
  for (const account of accounts || []) counts.set(account.stage, (counts.get(account.stage) || 0) + 1);
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
  const accountById = new Map(accounts.map((account) => [String(account.envId), account]));
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

  const drafts = (taskDrafts || []).map((draft) => ({
    recipeId: draft.recipeId,
    layer: draft.layer,
    accountCount: Number(draft.accountCount) || 0,
    targetStages: Array.from(new Set(
      (draft.accounts || [])
        .map((account) => accountById.get(String(account.id))?.stage)
        .filter(Boolean)
    ))
  }));

  return {
    planDate,
    objective: settings.objective,
    accountCount: accounts.length,
    stageSummary,
    baselineMixes: BASE_MIXES,
    contentPerformance: overview.contentFeedback?.recipes || [],
    publishTimePerformance: overview.contentFeedback?.publishTimePerformance || [],
    privatePerformance: compactPrivateAnalytics(overview.privateAnalytics),
    drafts
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
    allocationPlan: (strategy.allocationPlan || []).slice(0, 6),
    publishingPlan: (strategy.publishingPlan || []).slice(0, 6),
    recipeTuning: (strategy.recipeTuning || []).slice(0, 4),
    scripts: (strategy.scripts || []).slice(0, 12)
  };
}

function applyCodexStrategy(taskDrafts, strategy, accounts = [], modelSource = "codex") {
  const scripts = Array.isArray(strategy?.scripts) ? strategy.scripts : [];
  const tunings = new Map(
    (Array.isArray(strategy?.recipeTuning) ? strategy.recipeTuning : [])
      .map((item) => [String(item?.recipeId || ""), item])
      .filter(([recipeId]) => CONTENT_RECIPES[recipeId])
  );
  const accountById = new Map((accounts || []).map((account) => [String(account.envId), account]));
  for (const draft of taskDrafts || []) {
    const tuning = tunings.get(draft.recipeId);
    if (tuning) applyRecipeTuning(draft, tuning, modelSource);
    const stages = new Set((draft.accounts || [])
      .map((account) => accountById.get(String(account.id))?.stage)
      .filter(Boolean));
    const candidates = scripts.filter((script) =>
      script.recipeId === draft.recipeId &&
      (script.targetStage === "all" || !stages.size || stages.has(script.targetStage))
    );
    const fallback = scripts.filter((script) => script.recipeId === draft.recipeId);
    const source = candidates.length ? candidates : fallback;
    if (!source.length) {
      if (draft.aiTuning?.rationale) draft.reason = `${draft.reason} AI 参数：${draft.aiTuning.rationale}`;
      continue;
    }
    const script = source[hashText(`${draft.id}:${draft.scheduleAt}`) % source.length];
    const headline = sanitizeAiText(script.headline, 80);
    const mainTitle = sanitizeAiText(script.mainTitle, 140);
    const videoDesc = sanitizeAiText(script.videoDesc, 500);
    const rationale = sanitizeAiText(script.rationale, 300);
    if (headline) draft.payload.generation.headline = headline;
    if (mainTitle) draft.payload.generation.mainTitle = mainTitle;
    if (videoDesc) draft.payload.publish.videoDesc = videoDesc;
    draft.aiScript = {
      modelSource,
      targetStage: script.targetStage || "all",
      headline,
      mainTitle,
      videoDesc,
      rationale
    };
    const notes = [
      rationale ? `AI 文案：${rationale}` : "",
      draft.aiTuning?.rationale ? `AI 参数：${draft.aiTuning.rationale}` : ""
    ].filter(Boolean);
    if (notes.length) draft.reason = `${draft.reason} ${notes.join("；")}`;
  }
}

function applyCodexAllocations(accounts, strategy) {
  const plans = new Map(
    (Array.isArray(strategy?.allocationPlan) ? strategy.allocationPlan : [])
      .map((item) => [String(item?.stage || ""), item])
      .filter(([stage]) => STAGE_META[stage])
  );
  const aiWeight = 1;
  const appliedByStage = new Map();

  for (const account of accounts || []) {
    const stage = account.stage;
    const base = adjustMix(BASE_MIXES[stage] || BASE_MIXES.testing);
    const requested = plans.get(stage);
    if (!requested) {
      account.contentMix = base;
      continue;
    }
    const blended = Object.fromEntries(Object.keys(base).map((recipeId) => [
      recipeId,
      Number(base[recipeId]) * (1 - aiWeight) + Number(requested.mix?.[recipeId] || 0) * aiWeight
    ]));
    const mix = constrainStageMix(stage, blended);
    account.contentMix = mix;
    account.aiAllocationRationale = sanitizeAiText(requested.rationale, 300);
    appliedByStage.set(stage, {
      stage,
      mix,
      aiWeight: round(aiWeight, 2),
      rationale: account.aiAllocationRationale
    });
  }

  return Array.from(appliedByStage.values());
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
  if ((Number(account?.experimentDay) || 1) <= 7) {
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
    (hashText(`${planDate}:${group.slot}:${group.recipe.id}:${group.accounts.map((item) => item.envId).join(",")}:time`) % fiveMinuteSlots) * 5
  );
  const startAt = localTimestamp(planDate, plan.startHour, plan.startMinute);
  return startAt + jitterMinutes * 60 + group.slot * plan.slotIntervalMinutes * 60;
}

function applyExperimentAges(accounts, videos, plans, currentTime) {
  const earliestByAccount = new Map();
  const remember = (username, timestampSeconds) => {
    const key = normalizeName(username);
    const value = Number(timestampSeconds) || 0;
    if (!key || !value) return;
    const current = earliestByAccount.get(key);
    if (!current || value < current) earliestByAccount.set(key, value);
  };

  for (const video of videos || []) {
    if (!video?.local || !resolveRecipeId(video.local)) continue;
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
    account.experimentStartedAt = startedAt || null;
    account.experimentDay = started
      ? Math.max(1, Math.floor((today.getTime() - started.getTime()) / 86_400_000) + 1)
      : 1;
  }
}

function constrainStageMix(stage, requested) {
  const recipeIds = Object.keys(CONTENT_RECIPES);
  const schulteCaps = {
    cold_start: 10,
    testing: 20,
    breakout: 30,
    scaling: 45,
    qualified: 45,
    recovery: 10
  };
  const values = Object.fromEntries(recipeIds.map((recipeId) => [
    recipeId,
    Math.max(3, Number(requested?.[recipeId]) || 0)
  ]));
  values.schulte_complete = Math.max(3, Math.min(values.schulte_complete, schulteCaps[stage] || 20));
  const remaining = 100 - values.schulte_complete;
  const shortIds = recipeIds.filter((recipeId) => recipeId !== "schulte_complete");
  const distributable = Math.max(0, remaining - shortIds.length * 3);
  const shortWeights = Object.fromEntries(shortIds.map((recipeId) => [
    recipeId,
    Math.max(0, values[recipeId] - 3)
  ]));
  const weightTotal = shortIds.reduce((sum, recipeId) => sum + shortWeights[recipeId], 0);
  for (const recipeId of shortIds) {
    const ratio = weightTotal > 0 ? shortWeights[recipeId] / weightTotal : 1 / shortIds.length;
    values[recipeId] = 3 + distributable * ratio;
  }
  return adjustMix(values);
}

function applyRecipeTuning(draft, tuning, modelSource = "codex") {
  const generation = draft?.payload?.generation;
  if (!generation) return;
  const rationale = sanitizeAiText(tuning.rationale, 300);
  if (draft.recipeId === "peripheral_hook") {
    generation.durationSeconds = decimal(tuning.durationSeconds, 12, 28, generation.durationSeconds);
    generation.peripheralTargets = integer(tuning.peripheralTargets, 2, 5, generation.peripheralTargets || 3);
  } else if (draft.recipeId === "tracking_hook") {
    generation.trackingSeconds = decimal(tuning.trackingSeconds, 12, 35, generation.trackingSeconds || 16);
    generation.durationSeconds = Math.max(
      generation.trackingSeconds + 8,
      decimal(tuning.durationSeconds, 20, 46, generation.durationSeconds)
    );
    generation.ballSpeed = decimal(tuning.ballSpeed, 0.8, 2.4, generation.ballSpeed || 1.35);
  } else if (draft.recipeId === "position_memory") {
    generation.durationSeconds = decimal(tuning.durationSeconds, 20, 48, generation.durationSeconds);
    generation.memorySteps = integer(tuning.memorySteps, 4, 8, generation.memorySteps || 6);
  } else if (draft.recipeId === "schulte_complete") {
    generation.durationSeconds = decimal(tuning.durationSeconds, 60, 90, generation.durationSeconds);
    generation.rotationSpeed = decimal(tuning.rotationSpeed, 0.5, 3, generation.rotationSpeed || 2.5);
  }
  draft.aiTuning = {
    modelSource,
    recipeId: draft.recipeId,
    durationSeconds: Number(generation.durationSeconds) || 0,
    rotationSpeed: Number(generation.rotationSpeed) || 0,
    trackingSeconds: Number(generation.trackingSeconds) || 0,
    ballSpeed: Number(generation.ballSpeed) || 0,
    memorySteps: Number(generation.memorySteps) || 0,
    peripheralTargets: Number(generation.peripheralTargets) || 0,
    rationale
  };
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
    maxDailyVideos: integer(value.maxDailyVideos, 1, 300, DEFAULT_SETTINGS.maxDailyVideos),
    maxAccounts: integer(value.maxAccounts, 1, 100, DEFAULT_SETTINGS.maxAccounts),
    runHour: integer(value.runHour, 0, 23, DEFAULT_SETTINGS.runHour),
    runMinute: integer(value.runMinute, 0, 59, DEFAULT_SETTINGS.runMinute),
    publishHour: integer(value.publishHour, 0, 23, DEFAULT_SETTINGS.publishHour),
    publishMinute: integer(value.publishMinute, 0, 59, DEFAULT_SETTINGS.publishMinute),
    publishWindowMinutes: integer(value.publishWindowMinutes, 0, 60, DEFAULT_SETTINGS.publishWindowMinutes),
    slotIntervalMinutes: integer(value.slotIntervalMinutes, 15, 720, DEFAULT_SETTINGS.slotIntervalMinutes),
    instructionLanguage: value.instructionLanguage === "zh" ? "zh" : "en",
    backgroundMusicMode: ["built-in", "off"].includes(value.backgroundMusicMode) ? value.backgroundMusicMode : DEFAULT_SETTINGS.backgroundMusicMode,
    backgroundMusicVolume: decimal(value.backgroundMusicVolume, 0, 1, DEFAULT_SETTINGS.backgroundMusicVolume)
  };
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
