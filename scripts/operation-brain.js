import fs from "node:fs";
import path from "node:path";
import { listMediaFiles } from "./asset-library.js";
import { buildContentRuleDiagnostics } from "./content-diagnosis-rules.js";

const ANALYSIS_WINDOW_DAYS = 10;
const OFFICIAL_ANALYSIS_WINDOW_DAYS = 30;
const OFFICIAL_VIDEOS_PER_ACCOUNT = 100;
const DAY_MS = 86_400_000;
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".opus", ".webm", ".ogg"]);

const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  autoCreateTasks: false,
  useCodex: true,
  dataStrategy: "third_party",
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
  skipAutoPlanDates: [],
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
  audioLibrary = null,
  novelContentLibrary = null,
  novelEffectService = null,
  novelLearningService = null,
  autoTaskManager,
  codexBrain = null,
  deepseekBrain = null,
  listPhones,
  readPublishRecords,
  readRedditSettings = () => ({}),
  listProfiles = () => [],
  fixedDataStrategy = null,
  accountSource = null,
  strategyPolicyProvider = null,
  defaultVoiceIdProvider = null,
  now = () => Date.now()
}) {
  const settingsPath = path.join(workDir, "operation-brain-settings.json");
  const plansDir = path.join(workDir, "operation-plans");
  fs.mkdirSync(plansDir, { recursive: true });
  let timer = null;
  let running = false;
  let nextRunAt = 0;
  let phoneCache = { key: "", expiresAt: 0, phones: [] };
  const officialMode = accountSource === "official";
  const legacyHybridMode = !fixedDataStrategy && !accountSource;
  const normalizeScopedSettings = (value = {}) => normalizeSettings({
    ...value,
    ...(legacyHybridMode && privateAnalyticsService && !Object.hasOwn(value, "dataStrategy")
      ? { dataStrategy: "official_api" }
      : {}),
    ...(fixedDataStrategy ? { dataStrategy: fixedDataStrategy } : {}),
    ...(officialMode ? { profileId: "official", groupNames: ["official"] } : {})
  });

  function getSettings() {
    return normalizeScopedSettings(readJson(settingsPath, {}));
  }

  function saveSettings(payload = {}) {
    const current = getSettings();
    let next = normalizeScopedSettings({ ...current, ...payload });
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
      next = normalizeScopedSettings({
        ...next,
        cycleStartedAt: startedAt,
        cycleEndsAt: startedAt + next.cycleDays * DAY_MS,
        cycleStoppedAt: 0,
        cycleStopReason: ""
      });
    } else if (current.enabled && !next.enabled) {
      next = normalizeScopedSettings({
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
    const next = normalizeScopedSettings({ ...getSettings(), analysisResetAt: resetAt });
    atomicWriteJson(settingsPath, { ...next, updatedAt: resetAt });
    return getSettings();
  }

  async function getOverview(payload = {}) {
    const settings = normalizeScopedSettings({ ...getSettings(), ...payload });
    const phones = await getPhones(settings.profileId);
    const selected = filterPhones(phones, settings.groupNames).slice(0, settings.maxDailyVideos);
    const accountNames = selected.map((phone) => phone.serialName || phone.name).filter(Boolean);
    const records = readPublishRecords();
    const analysisStartedAt = Math.max(
      Number(settings.analysisResetAt) || 0,
      Number(settings.cycleStartedAt) || 0
    );
    const emptyThirdPartyDashboard = { accounts: [], totals: {}, status: { lastRun: null } };
    const dashboard10 = officialMode
      ? emptyThirdPartyDashboard
      : analyticsService.getDashboard({ period: "10d", allowedAccounts: accountNames, publishedAfter: analysisStartedAt }, records);
    const dashboard30 = officialMode
      ? emptyThirdPartyDashboard
      : analyticsService.getDashboard({ period: "30d", allowedAccounts: accountNames, publishedAfter: analysisStartedAt }, records);
    const thirdPartyVideos = officialMode
      ? []
      : filterVideosAfter(analyticsService.getMatchedVideos?.(records) || [], analysisStartedAt);
    let privateAnalytics = {
      status: "unavailable",
      summary: { detailedVideoCount: 0 },
      accounts: [],
      error: "TikTok official data bridge is not configured."
    };
    if (settings.dataStrategy === "official_api" && privateAnalyticsService?.getPublicSettings?.().configured && privateAnalyticsService?.getOperationSignals) {
      try {
        privateAnalytics = await privateAnalyticsService.getOperationSignals({
          accountNames,
          days: OFFICIAL_ANALYSIS_WINDOW_DAYS,
          videosPerAccount: OFFICIAL_VIDEOS_PER_ACCOUNT,
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
    let novelEffectAnalysis = null;
    if (settings.dataStrategy === "official_api" && novelEffectService?.getDecisionContext) {
      try {
        novelEffectAnalysis = await novelEffectService.getDecisionContext({
          signals: privateAnalytics,
          days: OFFICIAL_ANALYSIS_WINDOW_DAYS
        });
      } catch (error) {
        novelEffectAnalysis = {
          summary: {},
          novels: [],
          videoMappings: [],
          dataStatus: { source: "official_api", status: "failed", error: String(error?.message || error) }
        };
      }
    }
    let novelLearning = null;
    if (settings.dataStrategy === "official_api" && novelLearningService) {
      try {
        novelLearningService.refreshFromAnalysis({ analysis: novelEffectAnalysis || {}, evaluatedAt: now() });
        novelLearning = novelLearningService.getStrategyContext();
      } catch (error) {
        novelLearning = {
          promotedPatterns: [], demotedPatterns: [], testingPatterns: [], activeExperiments: [],
          error: String(error?.message || error)
        };
      }
    }
    const official10 = buildOfficialDashboard(privateAnalytics, {
      days: ANALYSIS_WINDOW_DAYS,
      analysisStartedAt,
      currentTime: now()
    });
    const official30 = buildOfficialDashboard(privateAnalytics, {
      days: OFFICIAL_ANALYSIS_WINDOW_DAYS,
      analysisStartedAt,
      currentTime: now()
    });
    const useOfficialData = settings.dataStrategy === "official_api";
    const activeDashboard10 = useOfficialData ? official10 : dashboard10;
    const activeDashboard30 = useOfficialData ? official30 : dashboard30;
    const activeVideos = useOfficialData ? official30.videos : thirdPartyVideos;
    const accounts = classifyAccounts(selected, activeDashboard10.accounts || [], activeDashboard30.accounts || [], {
      objective: settings.objective,
      analysisStartedAt
    });
    const privateByUsername = new Map((privateAnalytics.accounts || []).map((item) => [normalizeUsername(item.username), item]));
    for (const account of accounts) {
      account.privateMetrics = useOfficialData
        ? privateByUsername.get(normalizeUsername(account.username)) || null
        : null;
    }
    const currentPlans = listPlans({ includeArchived: true }).filter((plan) =>
      !analysisStartedAt || Number(plan?.createdAt) >= analysisStartedAt
    );
    applyOperationAges(accounts, activeVideos, currentPlans, now());
    const contentFeedback = useOfficialData
      ? summarizeOfficialContentFeedback(privateAnalytics, accountNames, now())
      : summarizeContentFeedback(thirdPartyVideos, accountNames, now());
    const officialMappings = new Map((novelEffectAnalysis?.videoMappings || []).map((item) => [
      String(item.videoId || ""),
      item.local || null
    ]));
    const matchedVideoLinks = activeVideos.map((video) => ({
      id: video.id || video.videoId || "",
      videoId: video.videoId || video.id || "",
      username: video.username || "",
      caption: video.caption || "",
      createTime: normalizeVideoCreateTimeSeconds(video),
      views: Number(video.views) || 0,
      likes: Number(video.likes) || 0,
      comments: Number(video.comments) || 0,
      shares: Number(video.shares) || 0,
      local: useOfficialData
        ? officialMappings.get(String(video.videoId || video.id || "")) || null
        : video.local || null
    }));
    const strategyComparison = buildStrategyComparison({
      selected: settings.dataStrategy,
      thirdPartyDashboard: dashboard10,
      thirdPartyVideos,
      privateAnalytics
    });
    return {
      settings,
      profiles: officialMode
        ? [{ id: "official", name: "TikTok 官方授权账号" }]
        : listProfiles().map(({ id, name }) => ({ id, name })),
      groups: summarizeGroups(phones),
      accountCount: accounts.length,
      accounts,
      stages: summarizeStages(accounts),
      contentFeedback,
      matchedVideoLinks,
      novelEffectAnalysis,
      novelLearning,
      privateAnalytics,
      strategyComparison,
      dataStatus: {
        analysisStartedAt,
        selectedStrategy: settings.dataStrategy,
        lastRun: useOfficialData
          ? { finishedAt: Number(privateAnalytics.generatedAt) || 0 }
          : dashboard10.status?.lastRun || null,
        videoCount: activeVideos.length,
        matchedCount: activeVideos.length,
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
      const requestedSettings = normalizeScopedSettings({ ...getSettings(), ...payload });
      const cycle = getCycleState(requestedSettings, now());
      if (cycle.status === "expired") {
        throw statusError(409, "本轮小说 AI 自运营周期已经结束。请重新启用自运营，开始一个新的周期。");
      }
      const analyticsRefresh = await refreshAnalytics(requestedSettings, { force: true });
      const overview = await getOverview(payload);
      overview.dataStatus.analyticsRefresh = analyticsRefresh;
      const settings = overview.settings;
      if (!settings.groupNames.length) throw statusError(400, officialMode ? "暂无可用的 TikTok 官方授权账号。" : "请至少选择一个 GeeLark 账号组。");
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
        contentFeedback: overview.contentFeedback,
        planDate,
        createdAt: now()
      });
      const plannedVideos = taskDrafts.reduce((sum, task) => sum + task.accountCount, 0);
      if (plannedVideos > settings.maxDailyVideos) {
        throw statusError(400, `本次计划 ${plannedVideos} 条，超过每日 ${settings.maxDailyVideos} 条安全上限。`);
      }
      const strategyProvider = settings.strategyProvider;
      const strategyPolicy = typeof strategyPolicyProvider === "function" ? strategyPolicyProvider() : null;
      const baseStrategyInput = buildCodexOperationInput({ overview, taskDrafts, settings, planDate, audioLibrary, novelContentLibrary, strategyPolicy });
      const officialSlim = settings.dataStrategy === "official_api";
      const aiInput = officialSlim ? slimOfficialStrategyInput(baseStrategyInput) : baseStrategyInput;
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
            if (finalProvider === "deepseek" && officialSlim && deepseekBrain?.generateOperationStrategy) {
              aiResult = await deepseekBrain.generateOperationStrategy(aiInput, { reasoningMode: settings.strategyReasoning });
              route.analysisStats = aiResult.analysisStats || { mode: "local_score", ...aiInput.scoreboard, batches: 0 };
            } else if (finalProvider === "deepseek" && deepseekBrain?.analyzeOperationDataset) {
              aiResult = await deepseekBrain.analyzeOperationDataset({
                ...baseStrategyInput,
                fullPrivatePerformance: null
              }, { reasoningMode: settings.strategyReasoning });
            } else {
              const firstService = finalProvider === "deepseek" ? deepseekBrain : codexBrain;
              aiResult = await firstService.generateOperationStrategy(aiInput, { reasoningMode: settings.strategyReasoning });
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
              ...aiInput,
              routeContext: { mode: "fallback", reasons: route.reasons }
            }, { reasoningMode: settings.strategyReasoning });
            route.solDurationMs = Number(aiResult.durationMs) || 0;
          }
          if (strategyProvider === "hybrid" && finalProvider === "deepseek" && route.escalateToSol && codexBrain?.generateOperationStrategy) {
            route.solCalled = true;
            try {
              const reviewedResult = await codexBrain.generateOperationStrategy({
                ...aiInput,
                preliminaryStrategy: summarizePreliminaryStrategy(firstPass?.strategy),
                deepseekEvidenceReport: officialSlim ? null : firstPass?.evidenceReport || null,
                routeContext: {
                  mode: officialSlim ? "local_score_review" : "full_dataset_review",
                  reasons: route.reasons,
                  analysisStats: firstPass?.analysisStats || route.analysisStats || null
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
            contentFeedback: overview.contentFeedback,
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
      const optimizedContent = await materializeScriptOptimizations({
        strategy: aiStrategy,
        audioLibrary,
        planId: id,
        targetAudioDir: settings.audioDir,
        strategyPolicy,
        defaultVoiceId: typeof defaultVoiceIdProvider === "function" ? defaultVoiceIdProvider() : ""
      });
      const learningRegistration = settings.dataStrategy === "official_api" && novelLearningService
        ? novelLearningService.registerOptimizations({ planId: id, optimizedContent, createdAt: now() })
        : null;
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
        contentRuleDiagnostics: baseStrategyInput.contentRuleDiagnostics,
        stages: overview.stages,
        accounts: overview.accounts,
        aiStrategy,
        optimizedContent,
        novelLearning: overview.novelLearning || null,
        learningRegistration,
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
        if (isAutoPlanSkipped(settings, target)) {
          const skipPath = path.join(plansDir, `scheduled-skip-${localDateKey(target)}.json`);
          atomicWriteJson(skipPath, {
            at: now(),
            planDate: localDateKey(target),
            reason: "manual_skip"
          });
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
    const stopped = normalizeScopedSettings({
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
    if (officialMode) {
      return { status: "managed_by_official_bridge", refreshed: 0, stale: 0, checked: (await getPhones(settings.profileId)).length };
    }
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
    const key = officialMode ? "official" : String(profileId || "default");
    if (phoneCache.key === key && phoneCache.expiresAt > now()) return phoneCache.phones;
    let phones;
    if (officialMode) {
      const result = await privateAnalyticsService?.listAccounts?.();
      phones = (Array.isArray(result?.accounts) ? result.accounts : []).map((account, index) => {
        const schema = String(account?.schema || account?.id || `official-${index + 1}`);
        const username = String(account?.profile?.username || account?.username || account?.profile?.displayName || schema);
        return {
          id: schema,
          envId: schema,
          serialNo: schema,
          serialName: username,
          name: username,
          remark: "",
          groupName: "official",
          profileId: "official",
          source: "official"
        };
      });
    } else {
      phones = await listPhones(key);
    }
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
  const currentAudioSamples = new Map();
  const previousAudioSamples = new Map();

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
      addAudioSample(currentAudioSamples, video);
      const created = new Date(createTime * 1000);
      const minute = created.getMinutes() < 30 ? 0 : 30;
      const bucketId = `${String(created.getHours()).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      const publishTimeViews = publishTimeBuckets.get(bucketId) || [];
      publishTimeViews.push(Number(video.views) || 0);
      publishTimeBuckets.set(bucketId, publishTimeViews);
    } else {
      addAudioSample(previousAudioSamples, video);
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
  const audioPerformance = buildAudioPerformance(currentAudioSamples, previousAudioSamples);

  return {
    windowDays: ANALYSIS_WINDOW_DAYS,
    comparedWithPreviousDays: ANALYSIS_WINDOW_DAYS,
    matchedVideos,
    unclassifiedVideos,
    workflows,
    publishTimePerformance,
    audioPerformance
  };
}

function normalizeOfficialCreatedAt(video = {}) {
  let value = Number(video.createdAt ?? video.createTime) || 0;
  if (value > 0 && value < 1_000_000_000_000) value *= 1000;
  return value;
}

function normalizeVideoCreateTimeSeconds(video = {}) {
  const value = normalizeOfficialCreatedAt(video);
  return value ? Math.floor(value / 1000) : 0;
}

function buildOfficialDashboard(privateAnalytics = {}, {
  days = OFFICIAL_ANALYSIS_WINDOW_DAYS,
  analysisStartedAt = 0,
  currentTime = Date.now()
} = {}) {
  const startAt = Math.max(
    Number(analysisStartedAt) || 0,
    Number(currentTime) - Math.max(1, Number(days) || OFFICIAL_ANALYSIS_WINDOW_DAYS) * 24 * 60 * 60 * 1000
  );
  const videos = [];
  const accounts = (privateAnalytics.accounts || []).map((account) => {
    const accountVideos = (account.videos || []).filter((video) => {
      const createdAt = normalizeOfficialCreatedAt(video);
      return createdAt >= startAt && createdAt <= Number(currentTime) + 60_000;
    }).map((video) => ({ ...video, username: account.username }));
    videos.push(...accountVideos);
    const views = accountVideos.map((video) => Number(video.views) || 0);
    return {
      username: account.username,
      videos: views.length,
      views: views.reduce((sum, value) => sum + value, 0),
      averageViews: round(mean(views), 0),
      medianViews: round(percentile(views, 0.5), 0),
      maxViews: views.length ? Math.max(...views) : 0,
      low200Rate: views.length ? round(views.filter((value) => value < 200).length / views.length * 100, 1) : 0,
      over500Rate: views.length ? round(views.filter((value) => value >= 500).length / views.length * 100, 1) : 0,
      over1000Rate: views.length ? round(views.filter((value) => value >= 1000).length / views.length * 100, 1) : 0
    };
  });
  return {
    accounts,
    videos,
    summary: { videoCount: videos.length, matchedCount: videos.length },
    status: { lastRun: { finishedAt: Number(privateAnalytics.generatedAt) || 0 } }
  };
}

function summarizeOfficialContentFeedback(privateAnalytics = {}, allowedAccounts = [], currentTime = Date.now()) {
  const allowed = new Set((allowedAccounts || []).map(normalizeName).filter(Boolean));
  const currentStart = Number(currentTime) - ANALYSIS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const previousStart = currentStart - ANALYSIS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const currentViews = [];
  const previousViews = [];
  const publishTimeBuckets = new Map();
  for (const account of privateAnalytics.accounts || []) {
    if (allowed.size && !allowed.has(normalizeName(account.username))) continue;
    for (const video of account.videos || []) {
      const createdAt = normalizeOfficialCreatedAt(video);
      if (!createdAt || createdAt < previousStart || createdAt > Number(currentTime) + 60_000) continue;
      const views = Number(video.views) || 0;
      if (createdAt >= currentStart) {
        currentViews.push(views);
        const created = new Date(createdAt);
        const minute = created.getMinutes() < 30 ? 0 : 30;
        const bucketId = `${String(created.getHours()).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        const bucket = publishTimeBuckets.get(bucketId) || [];
        bucket.push(views);
        publishTimeBuckets.set(bucketId, bucket);
      } else {
        previousViews.push(views);
      }
    }
  }
  const averageViews = mean(currentViews);
  const previousAverageViews = mean(previousViews);
  return {
    dataSource: "official_api",
    windowDays: ANALYSIS_WINDOW_DAYS,
    comparedWithPreviousDays: ANALYSIS_WINDOW_DAYS,
    matchedVideos: currentViews.length,
    unclassifiedVideos: 0,
    workflows: [{
      workflowId: "official_api",
      label: "TikTok 官方 API",
      sampleCount: currentViews.length,
      previousSampleCount: previousViews.length,
      averageViews: round(averageViews, 0),
      previousAverageViews: round(previousAverageViews, 0),
      medianViews: round(percentile(currentViews, 0.5), 0),
      maxViews: currentViews.length ? Math.max(...currentViews) : 0,
      low200Rate: currentViews.length ? round(currentViews.filter((value) => value < 200).length / currentViews.length * 100, 1) : 0,
      over1000Rate: currentViews.length ? round(currentViews.filter((value) => value >= 1000).length / currentViews.length * 100, 1) : 0,
      trend: previousAverageViews > 0 ? round(averageViews / previousAverageViews, 2) : 0
    }],
    publishTimePerformance: Array.from(publishTimeBuckets, ([time, views]) => ({
      time,
      sampleCount: views.length,
      averageViews: round(mean(views), 0),
      medianViews: round(percentile(views, 0.5), 0),
      maxViews: views.length ? Math.max(...views) : 0
    })).sort((left, right) => right.averageViews - left.averageViews),
    audioPerformance: []
  };
}

function buildStrategyComparison({ selected, thirdPartyDashboard = {}, thirdPartyVideos = [], privateAnalytics = {} }) {
  const officialAccounts = privateAnalytics.accounts || [];
  const officialVideoCount = officialAccounts.reduce((sum, account) => sum + (account.videos || []).length, 0);
  return {
    selected: normalizeDataStrategy(selected),
    thirdParty: {
      id: "third_party",
      label: "第三方数据策略",
      status: thirdPartyVideos.length ? "ready" : "empty",
      accountCount: (thirdPartyDashboard.accounts || []).length,
      videoCount: thirdPartyVideos.length,
      generatedAt: Number(thirdPartyDashboard.status?.lastRun?.finishedAt) || 0
    },
    officialApi: {
      id: "official_api",
      label: "官方 API 完整数据策略",
      status: privateAnalytics.status || (officialVideoCount ? "ready" : "empty"),
      accountCount: officialAccounts.length,
      videoCount: officialVideoCount,
      generatedAt: Number(privateAnalytics.generatedAt) || 0,
      error: String(privateAnalytics.error || "")
    }
  };
}

function addAudioSample(samples, video) {
  const audioName = String(video?.local?.audioName || "").trim();
  if (!audioName) return;
  const key = audioName.toLowerCase();
  const entry = samples.get(key) || { audioName, views: [], interactions: [], accounts: new Set() };
  const views = Number(video.views) || 0;
  const interactionFields = [video.likes, video.comments, video.shares, video.bookmarks];
  const hasPublicInteractionMetrics = interactionFields.some((value) => value !== undefined && value !== null && value !== "");
  const totalInteractions = (Number(video.likes) || 0)
    + (Number(video.comments) || 0)
    + (Number(video.shares) || 0)
    + (Number(video.bookmarks) || 0);
  entry.views.push(views);
  if (hasPublicInteractionMetrics && views > 0) {
    entry.interactions.push(totalInteractions / views * 100);
  }
  const account = normalizeName(video.username);
  if (account) entry.accounts.add(account);
  samples.set(key, entry);
}

function buildAudioPerformance(currentSamples, previousSamples) {
  const current = Array.from(currentSamples.values());
  const comparableMedians = current
    .filter((entry) => entry.views.length >= 2)
    .map((entry) => percentile(entry.views, 0.5));
  const baselineMedian = mean(comparableMedians);
  const baselineAverage = mean(current.flatMap((entry) => entry.views));
  const baselineEngagement = mean(current
    .filter((entry) => entry.views.length >= 2)
    .flatMap((entry) => entry.interactions || []));

  return current.map((entry) => {
    const views = entry.views;
    const previous = previousSamples.get(String(entry.audioName).toLowerCase())?.views || [];
    const averageViews = mean(views);
    const medianViews = percentile(views, 0.5);
    const engagementRate = mean(entry.interactions || []);
    const low200Rate = views.length ? views.filter((value) => value < 200).length / views.length * 100 : 0;
    const over1000Rate = views.length ? views.filter((value) => value >= 1000).length / views.length * 100 : 0;
    const sampleCount = views.length;
    let recommendation = "explore";
    const hasEngagementSignal = (entry.interactions || []).length > 0;
    const supportsPriority = !hasEngagementSignal
      || baselineEngagement <= 0
      || engagementRate >= baselineEngagement * 0.75
      || medianViews >= Math.max(250, baselineMedian * 1.45);
    // Reach remains the hard safety gate. Public interaction only breaks ties and validates promotion.
    if (sampleCount >= 3 && low200Rate >= 85 && medianViews < Math.max(100, baselineMedian * 0.5)) {
      recommendation = "deprioritize";
    } else if (sampleCount >= 2 && medianViews >= Math.max(250, baselineMedian * 1.15) && averageViews >= Math.max(300, baselineAverage * 1.1) && supportsPriority) {
      recommendation = "prioritize";
    } else if (sampleCount >= 2) {
      recommendation = "rotate";
    }
    return {
      audioName: entry.audioName,
      sampleCount,
      accountCount: entry.accounts.size,
      totalViews: views.reduce((sum, value) => sum + value, 0),
      averageViews: round(averageViews, 0),
      medianViews: round(medianViews, 0),
      maxViews: views.length ? Math.max(...views) : 0,
      low200Rate: round(low200Rate, 1),
      over1000Rate: round(over1000Rate, 1),
      engagementRate: round(engagementRate, 2),
      engagementSampleCount: (entry.interactions || []).length,
      previousAverageViews: round(mean(previous), 0),
      trend: previous.length && mean(previous) > 0 ? round(averageViews / mean(previous), 2) : 0,
      recommendation
    };
  }).sort((left, right) => {
    const tier = { prioritize: 0, rotate: 1, explore: 2, deprioritize: 3 };
    return tier[left.recommendation] - tier[right.recommendation]
      || right.medianViews - left.medianViews
      || right.averageViews - left.averageViews
      || right.engagementRate - left.engagementRate
      || right.sampleCount - left.sampleCount;
  });
}

function isRedditOperationVideo(local = {}) {
  if (String(local?.operationMeta?.createdBy || "") === "operation-brain") return true;
  const template = `${local.templateId || ""} ${local.template || ""}`.toLowerCase();
  return /(reddit|混剪|novel|story)/i.test(template);
}

function buildTaskDrafts({ assignments, settings, redditDefaults = {}, contentFeedback = {}, planDate, createdAt }) {
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
    .map((group, taskIndex) => {
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
      const audioSelection = buildAudioSelection({
        audioDir: settings.audioDir,
        audioPerformance: contentFeedback.audioPerformance,
        totalVideos: accounts.length,
        offset: taskIndex * Math.max(1, accounts.length)
      });
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
            audioPriority: audioSelection.names,
            audioPriorityMode: audioSelection.mode,
            audioOffset: audioSelection.offset,
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
            openingTitleEnabled: savedSubtitle.openingTitleEnabled === true,
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

function buildAudioSelection({ audioDir, audioPerformance = [], totalVideos = 1, offset = 0 }) {
  let available = [];
  try {
    available = listMediaFiles(audioDir, Array.from(AUDIO_EXTENSIONS));
  } catch {
    return { names: [], mode: "directory-rotation", offset: 0 };
  }
  if (!available.length) return { names: [], mode: "directory-rotation", offset: 0 };

  const namesByKey = new Map();
  for (const file of available) {
    const name = path.basename(file);
    if (!namesByKey.has(name.toLowerCase())) namesByKey.set(name.toLowerCase(), name);
  }
  const ranked = (audioPerformance || [])
    .map((item) => ({ ...item, fileName: namesByKey.get(String(item.audioName || "").toLowerCase()) }))
    .filter((item) => item.fileName);
  const deprioritized = new Set(
    ranked.filter((item) => item.recommendation === "deprioritize").map((item) => item.fileName)
  );
  const preferred = ranked
    .filter((item) => item.recommendation === "prioritize" || item.recommendation === "rotate")
    .map((item) => item.fileName);
  const exploration = [
    ...ranked.filter((item) => item.recommendation === "explore").map((item) => item.fileName),
    ...available.map((file) => path.basename(file)).filter((name) => !ranked.some((item) => item.fileName === name))
  ];
  const fallback = available.map((file) => path.basename(file)).filter((name) => !deprioritized.has(name));
  const primaryPool = uniqueStrings(preferred.length ? preferred : fallback);
  const explorationPool = uniqueStrings(exploration.filter((name) => !deprioritized.has(name)));
  const primary = rotateList(primaryPool, offset);
  const exploratory = rotateList(explorationPool, offset);
  const selected = [];
  const count = Math.max(1, Math.floor(Number(totalVideos) || 1));
  let primaryIndex = 0;
  let explorationIndex = 0;

  for (let index = 0; index < count; index += 1) {
    const shouldExplore = exploratory.length > 0 && (index + 1) % 3 === 0;
    const pool = shouldExplore ? exploratory : primary.length ? primary : exploratory;
    if (!pool.length) break;
    const poolIndex = shouldExplore || !primary.length ? explorationIndex++ : primaryIndex++;
    selected.push(pool[poolIndex % pool.length]);
  }

  return {
    names: selected.length ? selected : rotateList(fallback, offset),
    mode: ranked.length ? "performance-guided" : "directory-rotation",
    offset: 0
  };
}

function uniqueStrings(values) {
  return Array.from(new Set((values || []).map(String).filter(Boolean)));
}

function rotateList(values, offset = 0) {
  const list = uniqueStrings(values);
  if (!list.length) return [];
  const index = Math.abs(Math.floor(Number(offset) || 0)) % list.length;
  return [...list.slice(index), ...list.slice(0, index)];
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

function buildCodexOperationInput({ overview, taskDrafts, settings, planDate, audioLibrary, novelContentLibrary, strategyPolicy = null }) {
  const accounts = Array.isArray(overview.accounts) ? overview.accounts : [];
  const useOfficialData = settings.dataStrategy === "official_api";
  const selectedPrivateAnalytics = useOfficialData
    ? overview.privateAnalytics
    : { status: "not_selected", summary: { detailedVideoCount: 0 }, accounts: [] };
  const novelContent = novelContentLibrary?.getAiContext?.() || { novels: [], scripts: [] };
  const novelEffectAnalysis = compactNovelEffectAnalysis(overview.novelEffectAnalysis);
  const scriptLibrary = buildScriptLibrary(
    audioLibrary,
    overview.contentFeedback?.audioPerformance || [],
    novelContent,
    novelEffectAnalysis
  );
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
    dataStrategy: settings.dataStrategy,
    strategyComparison: overview.strategyComparison,
    accountCount: accounts.length,
    stageSummary,
    workflowPerformance: overview.contentFeedback?.workflows || [],
    audioPerformance: (overview.contentFeedback?.audioPerformance || []).slice(0, 100),
    novelContent,
    novelEffectAnalysis,
    novelLearning: overview.novelLearning || null,
    strategyPolicy,
    scriptLibrary,
    contentRuleDiagnostics: buildContentRuleDiagnostics({
      privateAnalytics: selectedPrivateAnalytics,
      matchedVideos: overview.matchedVideoLinks || [],
      scriptLibrary,
      generatedAt: Number(selectedPrivateAnalytics?.generatedAt) || Date.now(),
      thresholds: strategyPolicy?.diagnosis || {}
    }),
    publishTimePerformance: overview.contentFeedback?.publishTimePerformance || [],
    privatePerformance: useOfficialData
      ? compactPrivateAnalytics(selectedPrivateAnalytics, { videoLimit: OFFICIAL_VIDEOS_PER_ACCOUNT })
      : null,
    drafts: (taskDrafts || []).map((draft) => ({
      workflowId: draft.workflowId,
      accountCount: Number(draft.accountCount) || 0,
      scheduleAt: Number(draft.scheduleAt) || 0
    }))
  };
}

function buildScriptLibrary(audioLibrary, audioPerformance = [], novelContent = {}, novelEffectAnalysis = {}) {
  const performanceByName = new Map((audioPerformance || []).map((item) => [
    String(item.audioName || "").trim().toLowerCase(),
    item
  ]));
  const hierarchyByAudioId = new Map((novelContent.scripts || []).map((item) => [String(item.audioId || ""), item]));
  const novelById = new Map((novelContent.novels || []).map((item) => [String(item.id || ""), item]));
  const officialByScriptId = new Map();
  const officialByAudioId = new Map();
  for (const novel of novelEffectAnalysis.novels || []) {
    for (const script of novel.scripts || []) {
      if (script.id) officialByScriptId.set(String(script.id), script.performance || null);
      if (script.audioId) officialByAudioId.set(String(script.audioId), script.performance || null);
    }
  }
  return (audioLibrary?.list?.() || []).filter((item) => String(item.script || "").trim()).slice(0, 40).map((item) => {
    const hierarchy = hierarchyByAudioId.get(String(item.id || "")) || {};
    const novel = novelById.get(String(hierarchy.novelId || "")) || {};
    return {
    id: String(item.id || ""),
    scriptId: String(hierarchy.id || ""),
    novelId: String(hierarchy.novelId || ""),
    novelTitle: String(novel.title || ""),
    parentScriptId: String(hierarchy.parentScriptId || ""),
    hookVariantId: String(hierarchy.hookVariantId || ""),
    versionLabel: String(hierarchy.versionLabel || ""),
    title: String(item.title || ""),
    script: String(item.script || ""),
    performance: officialByScriptId.get(String(hierarchy.id || ""))
      || officialByAudioId.get(String(item.id || ""))
      || performanceByName.get(String(item.title || "").trim().toLowerCase())
      || null,
    performanceSource: officialByScriptId.has(String(hierarchy.id || "")) || officialByAudioId.has(String(item.id || ""))
      ? "official_api"
      : "third_party"
    };
  });
}

function compactNovelEffectAnalysis(value = {}) {
  const normalizePerformance = (performance = {}) => ({
    videoCount: Math.max(0, Number(performance.videoCount) || 0),
    accountCount: Math.max(0, Number(performance.accountCount) || 0),
    totalViews: Math.max(0, Number(performance.totalViews) || 0),
    averageViews: Math.max(0, Number(performance.averageViews) || 0),
    maxViews: Math.max(0, Number(performance.maxViews) || 0),
    comments: Math.max(0, Number(performance.comments) || 0),
    averageTimeWatched: nullableNumber(performance.averageTimeWatched),
    fullWatchRate: nullableNumber(performance.fullWatchRate),
    retentionAt3: nullableNumber(performance.retentionAt3),
    diagnosis: String(performance.diagnosis || "")
  });
  return {
    dataStatus: value?.dataStatus || null,
    summary: value?.summary || {},
    novels: (value?.novels || []).slice(0, 40).map((novel) => ({
      id: String(novel.id || ""),
      title: String(novel.title || ""),
      performance: normalizePerformance(novel.performance),
      scripts: (novel.scripts || []).slice(0, 100).map((script) => ({
        id: String(script.id || ""),
        novelId: String(script.novelId || novel.id || ""),
        parentScriptId: String(script.parentScriptId || ""),
        hookVariantId: String(script.hookVariantId || ""),
        audioId: String(script.audioId || script.audio?.id || ""),
        title: String(script.title || script.audio?.title || ""),
        versionLabel: String(script.versionLabel || ""),
        performance: normalizePerformance(script.performance)
      }))
    }))
  };
}

function nullableNumber(value) {
  return value === null || value === undefined || value === "" ? null : Number(value) || 0;
}

async function materializeScriptOptimizations({ strategy = {}, audioLibrary, planId, targetAudioDir, strategyPolicy = null, defaultVoiceId = "" }) {
  if (strategyPolicy?.rewrite?.enabled === false) return [];
  const maxVariants = Math.max(1, Math.min(10, Number(strategyPolicy?.rewrite?.maxVariants) || 3));
  const requests = Array.isArray(strategy?.scriptOptimizations) ? strategy.scriptOptimizations.slice(0, maxVariants) : [];
  if (!requests.length || !audioLibrary?.generateFromOptimizedScript) return [];
  if (strategyPolicy?.audio?.enabled === false || strategyPolicy?.audio?.generateAfterRewrite === false) {
    return requests.map((request) => ({ ...request, status: "rewrite_ready", audio: null }));
  }
  const configuredAudioDir = String(strategyPolicy?.audio?.outputDirectory || "").trim();
  const available = new Map((audioLibrary.list?.() || []).map((item) => [String(item.id || ""), item]));
  const results = [];
  for (const request of requests) {
    const sourceAudioId = String(request?.sourceAudioId || "").trim();
    const source = available.get(sourceAudioId);
    if (!source) {
      results.push({ ...request, status: "skipped", error: "对应的本地原文与音频不存在，未生成新音频。" });
      continue;
    }
    try {
      const audio = await audioLibrary.generateFromOptimizedScript({
        sourceAudioId,
        sourceVideoId: request.sourceVideoId,
        title: request.title || `${source.title} AI优化版`,
        script: request.rewrittenScript,
        voiceId: String(strategyPolicy?.audio?.voiceId || defaultVoiceId || "").trim(),
        diagnosis: request.diagnosis,
        evidenceSummary: request.evidenceSummary,
        rewriteMetadata: {
          problemLayer: request.problemLayer,
          rewriteScope: request.rewriteScope,
          targetSecondRange: request.targetSecondRange,
          estimatedSourceSentence: request.estimatedSourceSentence,
          rewriteGoal: request.rewriteGoal,
          singleVariable: request.singleVariable,
          preservedFacts: request.preservedFacts,
          changeLog: request.changeLog
        },
        planId,
        targetAudioDir: configuredAudioDir || targetAudioDir
      });
      results.push({ ...request, status: "completed", originalScript: source.script || "", audio });
    } catch (error) {
      results.push({ ...request, status: "failed", originalScript: source.script || "", error: String(error?.message || error) });
    }
  }
  return results;
}

export function slimOfficialStrategyInput(input = {}) {
  const diagnostics = input.contentRuleDiagnostics || {};
  const videos = Array.isArray(diagnostics.videos) ? diagnostics.videos : [];
  const eligible = videos.filter((item) => item.rewriteEligible === true).slice(0, 12);
  const eligibleIds = new Set(eligible.map((item) => String(item.videoId || "")));
  const compact = input.privatePerformance && typeof input.privatePerformance === "object"
    ? input.privatePerformance
    : null;
  return {
    ...input,
    contentRuleDiagnostics: {
      version: diagnostics.version || "",
      generatedAt: diagnostics.generatedAt || 0,
      thresholds: diagnostics.thresholds || {},
      summary: diagnostics.summary || {},
      videos: eligible
    },
    privatePerformance: compact
      ? {
          ...compact,
          accounts: (compact.accounts || []).map((account) => ({
            ...account,
            videos: (account.videos || []).filter((video) => eligibleIds.has(String(video.videoId || "")))
          }))
        }
      : compact,
    scoreboard: {
      videoCount: Number(diagnostics.summary?.videoCount) || videos.length,
      rewriteEligibleCount: Number(diagnostics.summary?.rewriteEligibleCount) || eligible.length,
      decisions: diagnostics.summary?.decisions || {},
      sentToModel: eligible.length
    }
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

  const selectedDataStrategy = overview.settings?.dataStrategy;
  const legacyFullPrivateData = !selectedDataStrategy;
  const useOfficialData = selectedDataStrategy === "official_api" || legacyFullPrivateData;
  const summary = overview.privateAnalytics?.summary || {};
  const detailedVideoCount = useOfficialData
    ? Math.max(0, Number(summary.detailedVideoCount) || 0)
    : Math.max(0, Number(overview.dataStatus?.videoCount) || 0);
  const reasons = deepseekAvailable
    ? [useOfficialData ? "local_score_rewrite" : "third_party_dataset_analysis"]
    : [];
  if (!detailedVideoCount) reasons.push(useOfficialData ? "official_dataset_empty" : "third_party_dataset_empty");
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
    dataStrategy: useOfficialData ? "official_api" : "third_party",
    detailedVideoCount
  };
}

function compactPrivateAnalytics(value = {}, { videoLimit = 0 } = {}) {
  const accounts = (value.accounts || []).map((account) => ({
    username: normalizeUsername(account.username),
    profile: account.profile || {},
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
      caption: String(video.caption || "").slice(0, 500),
      views: Number(video.views) || 0,
      reach: Number(video.reach) || 0,
      duration: Number(video.duration) || 0,
      averageTimeWatched: video.averageTimeWatched ?? null,
      averageWatchRatio: video.averageWatchRatio ?? null,
      fullWatchRate: video.fullWatchRate ?? null,
      retentionAt3: video.retentionAt3 ?? null,
      retentionAt5: video.retentionAt5 ?? null,
      retentionAt10: video.retentionAt10 ?? null,
      retentionAtEnd: video.retentionAtEnd ?? null,
      largestRetentionDrop: video.largestRetentionDrop ?? null,
      largestRetentionDropSecond: video.largestRetentionDropSecond ?? null,
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
  const enabled = value.enabled === true;
  const strategyProvider = ["hybrid", "deepseek", "codex", "rules"].includes(value.strategyProvider)
    ? value.strategyProvider
    : value.useCodex === false
      ? "rules"
      : DEFAULT_SETTINGS.strategyProvider;
  return {
    enabled,
    autoCreateTasks: enabled && value.autoCreateTasks === true,
    useCodex: ["hybrid", "codex"].includes(strategyProvider),
    dataStrategy: normalizeDataStrategy(value.dataStrategy),
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
    skipAutoPlanDates: Array.from(new Set((Array.isArray(value.skipAutoPlanDates) ? value.skipAutoPlanDates : [])
      .map((item) => String(item || "").trim())
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item))))
      .sort()
      .slice(-31),
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

function normalizeDataStrategy(value) {
  return value === "official_api" ? "official_api" : "third_party";
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

export function isAutoPlanSkipped(settings, timestamp = Date.now()) {
  const planDate = localDateKey(timestamp);
  return Array.isArray(settings?.skipAutoPlanDates) && settings.skipAutoPlanDates.includes(planDate);
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
