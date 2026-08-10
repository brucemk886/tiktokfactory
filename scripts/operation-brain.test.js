import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildAssignments,
  classifyAccounts,
  createOperationBrainService,
  decideStrategyRoute,
  isAutoPlanSkipped,
  summarizeContentFeedback
} from "./operation-brain.js";

test("scheduled skip only suppresses the matching local calendar date", () => {
  const settings = { skipAutoPlanDates: ["2026-08-07"] };
  assert.equal(isAutoPlanSkipped(settings, new Date("2026-08-07T19:00:00+08:00").getTime()), true);
  assert.equal(isAutoPlanSkipped(settings, new Date("2026-08-08T19:00:00+08:00").getTime()), false);
});

test("hybrid routing always runs full DeepSeek analysis before SOL final review", () => {
  const lowSample = decideStrategyRoute({
    provider: "hybrid",
    deepseekAvailable: true,
    solAvailable: true,
    overview: { privateAnalytics: { summary: { detailedVideoCount: 7, maxViews: 50_000, conflictCount: 2 } }, accounts: [] }
  });
  assert.equal(lowSample.decision, "deepseek_then_sol");
  assert.equal(lowSample.escalateToSol, true);
  assert.deepEqual(lowSample.reasons, ["full_private_dataset_analysis", "sol_final_review"]);

  const evidenceConflict = decideStrategyRoute({
    provider: "hybrid",
    deepseekAvailable: true,
    solAvailable: true,
    overview: {
      privateAnalytics: { summary: { detailedVideoCount: 12, maxViews: 12_000, conflictCount: 1, averageRetention3: 0.36, averageRetention5: 0.21 } },
      accounts: []
    }
  });
  assert.equal(evidenceConflict.decision, "deepseek_then_sol");
  assert.equal(evidenceConflict.escalateToSol, true);
  assert.ok(evidenceConflict.reasons.includes("full_private_dataset_analysis"));
  assert.ok(evidenceConflict.reasons.includes("sol_final_review"));
});

test("hybrid routing falls back to SOL when DeepSeek is unavailable", () => {
  const route = decideStrategyRoute({
    provider: "hybrid",
    deepseekAvailable: false,
    solAvailable: true,
    overview: { privateAnalytics: { summary: { detailedVideoCount: 0 } }, accounts: [] }
  });
  assert.equal(route.primaryProvider, "codex");
  assert.equal(route.decision, "sol_fallback");
  assert.equal(route.solCalled, true);
});

test("hybrid routing keeps the DeepSeek strategy when SOL review fails", async (t) => {
  const workDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-operation-hybrid-fallback-"));
  t.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const service = createOperationBrainService({
    workDir,
    now: () => new Date("2026-08-04T10:00:00+08:00").getTime(),
    listPhones: async () => [phone("one")],
    readPublishRecords: () => [],
    analyticsService: {
      getDashboard: () => ({
        accounts: [metrics("user-one")],
        summary: { videoCount: 12, matchedCount: 12 },
        status: { lastRun: { finishedAt: Date.now() } }
      })
    },
    privateAnalyticsService: {
      getPublicSettings: () => ({ configured: true }),
      getOperationSignals: async () => ({
        status: "ready",
        summary: {
          detailedVideoCount: 12,
          maxViews: 15_000,
          conflictCount: 1,
          averageRetention3: 0.35,
          averageRetention5: 0.2
        },
        accounts: []
      })
    },
    autoTaskManager: { listTasks: () => [], createTask: () => ({ id: "unused" }) },
    deepseekBrain: {
      getStatus: () => ({ model: "deepseek-v4-flash" }),
      analyzeOperationDataset: async (input) => {
        assert.equal(input.fullPrivatePerformance.summary.detailedVideoCount, 12);
        return ({
        model: "deepseek-v4-flash",
        durationMs: 120,
        analysisStats: { accounts: 1, videos: 12, retentionPoints: 240, batches: 2 },
        evidenceReport: {
          accountCount: 1,
          videoCount: 12,
          retentionPointCount: 240,
          batches: [{ batch: 1, analysis: { crossVideoPatterns: ["3-second drop"] } }]
        },
        usage: { inputTokens: 20, outputTokens: 30 },
        strategy: {
          executiveSummary: "Keep testing the strongest retention hook.",
          accountDiagnosis: "The account is still collecting samples.",
          contentDirection: "Use the saved Reddit workflow.",
          riskNotes: ["Do not overfit one post.", "Keep volume limits."],
          publishingPlan: []
        }
      });
      }
    },
    codexBrain: {
      getStatus: () => ({ operationModel: "gpt-5.6-sol" }),
      generateOperationStrategy: async (input) => {
        assert.equal(input.routeContext.mode, "full_dataset_review");
        assert.equal(input.deepseekEvidenceReport.videoCount, 12);
        throw new Error("SOL temporarily unavailable");
      }
    }
  });
  service.saveSettings({
    enabled: false,
    autoCreateTasks: false,
    strategyProvider: "hybrid",
    groupNames: ["test-group"],
    postsPerAccount: 1,
    assetGroupId: "test-assets",
    audioDir: "C:\\test-audio"
  });

  const plan = await service.createPlan();
  assert.equal(plan.aiStrategy.status, "completed");
  assert.equal(plan.aiStrategy.model, "deepseek-v4-flash");
  assert.equal(plan.aiStrategy.route.finalProvider, "deepseek");
  assert.equal(plan.aiStrategy.route.decision, "deepseek_only_after_sol_failure");
  assert.equal(plan.aiStrategy.route.analysisStats.retentionPoints, 240);
  assert.ok(plan.aiStrategy.route.reasons.includes("sol_review_failed"));
  assert.match(plan.aiStrategy.route.solError, /temporarily unavailable/);
});

function phone(id, groupName = "test-group") {
  return {
    id,
    envId: id,
    name: `user-${id}`,
    serialNo: id,
    groupName,
    remark: ""
  };
}

function metrics(username, overrides = {}) {
  return {
    username,
    videos: 12,
    totalViews: 1600,
    averageViews: 200,
    medianViews: 160,
    maxViews: 500,
    low100Rate: 20,
    low200Rate: 40,
    over500Rate: 20,
    over1000Rate: 5,
    engagement: 3,
    ...overrides
  };
}

test("classifies accounts into actionable traffic stages", () => {
  const phones = [phone("new"), phone("breakout"), phone("recovery")];
  const seven = [
    metrics("user-breakout", { averageViews: 1400, medianViews: 900, maxViews: 8000, over1000Rate: 50 }),
    metrics("user-recovery", { averageViews: 35, medianViews: 20, maxViews: 90, low200Rate: 100, over500Rate: 0 })
  ];
  const thirty = [
    metrics("user-breakout", { videos: 30, averageViews: 700 }),
    metrics("user-recovery", { videos: 30, averageViews: 500 })
  ];

  const result = classifyAccounts(phones, seven, thirty, { objective: "balanced" });
  assert.equal(result.find((item) => item.envId === "new").stage, "cold_start");
  assert.ok(["breakout", "scaling"].includes(result.find((item) => item.envId === "breakout").stage));
  assert.equal(result.find((item) => item.envId === "recovery").stage, "recovery");
  assert.match(result.find((item) => item.envId === "new").reason, /样本/);
});

test("marks the 30-day natural view milestone without using engagement", () => {
  const result = classifyAccounts(
    [phone("qualified")],
    [metrics("user-qualified", { engagement: 0 })],
    [metrics("user-qualified", { videos: 30, totalViews: 100000, engagement: 0 })],
    { objective: "traffic" }
  );

  assert.equal(result[0].stage, "qualified");
  assert.equal(result[0].metrics.views30d, 100000);
});

test("builds the requested number of standard Reddit assignments per account", () => {
  const accounts = classifyAccounts(
    [phone("one"), phone("two")],
    [metrics("user-one"), metrics("user-two")],
    [metrics("user-one", { videos: 25 }), metrics("user-two", { videos: 25 })],
    { objective: "balanced" }
  );
  const assignments = buildAssignments({
    accounts,
    settings: { postsPerAccount: 3, objective: "balanced" },
    planDate: "2026-07-29"
  });

  assert.equal(assignments.length, 6);
  for (const account of accounts) {
    const accountAssignments = assignments.filter((item) => item.account.envId === account.envId);
    assert.equal(accountAssignments.length, 3);
    assert.deepEqual(accountAssignments.map((item) => item.slot), [0, 1, 2]);
    assert.ok(accountAssignments.every((item) => !Object.hasOwn(item, "recipe")));
    assert.ok(accountAssignments.every((item) => !Object.hasOwn(item, "contentVariant")));
  }
});

test("attributes recent views to the standard Reddit workflow", () => {
  const now = new Date("2026-07-29T10:00:00+08:00").getTime();
  const seconds = Math.floor(now / 1000);
  const feedback = summarizeContentFeedback([
    {
      username: "user-one",
      createTime: seconds - 3600,
      views: 1800,
      local: {
        operationMeta: { createdBy: "operation-brain", workflowId: "reddit_auto" }
      }
    },
    {
      username: "user-one",
      createTime: seconds - 7200,
      views: 100,
      local: { operationMeta: { createdBy: "operation-brain", workflowId: "reddit_auto" } }
    },
    {
      username: "user-one",
      createTime: seconds - 12 * 24 * 3600,
      views: 500,
      local: { operationMeta: { createdBy: "operation-brain", workflowId: "reddit_auto" } }
    }
  ], ["user-one"], now);

  const workflow = feedback.workflows.find((item) => item.workflowId === "reddit_auto");
  assert.equal(feedback.matchedVideos, 2);
  assert.equal(feedback.windowDays, 10);
  assert.equal(feedback.comparedWithPreviousDays, 10);
  assert.equal(workflow.sampleCount, 2);
  assert.equal(workflow.previousSampleCount, 1);
  assert.equal(workflow.averageViews, 950);
  assert.equal(workflow.over1000Rate, 50);
});

test("summarizes audio performance for novel task selection", () => {
  const now = new Date("2026-07-29T10:00:00+08:00").getTime();
  const seconds = Math.floor(now / 1000);
  const video = (audioName, views, hoursAgo, likes = 0) => ({
    username: "user-one",
    createTime: seconds - hoursAgo * 3600,
    views,
    likes,
    local: {
      audioName,
      operationMeta: { createdBy: "operation-brain", workflowId: "reddit_auto" }
    }
  });
  const feedback = summarizeContentFeedback([
    video("winner.mp3", 1_300, 1, 130),
    video("winner.mp3", 1_000, 2, 100),
    video("weak.mp3", 0, 1),
    video("weak.mp3", 20, 2),
    video("weak.mp3", 40, 3),
    video("winner.mp3", 400, 11 * 24)
  ], ["user-one"], now);

  const winner = feedback.audioPerformance.find((item) => item.audioName === "winner.mp3");
  const weak = feedback.audioPerformance.find((item) => item.audioName === "weak.mp3");
  assert.equal(winner.recommendation, "prioritize");
  assert.equal(winner.sampleCount, 2);
  assert.equal(winner.engagementRate, 10);
  assert.equal(winner.previousAverageViews, 400);
  assert.equal(weak.recommendation, "deprioritize");
  assert.equal(weak.low200Rate, 100);
});

test("starts a bounded operating cycle and stops automatic work when it expires", async (t) => {
  const workDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-operation-cycle-"));
  t.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  let current = new Date("2026-08-06T10:00:00+08:00").getTime();
  const service = createOperationBrainService({
    workDir,
    now: () => current,
    listPhones: async () => [phone("one")],
    readPublishRecords: () => [],
    analyticsService: {
      getDashboard: () => ({ accounts: [], summary: {}, status: {} })
    },
    autoTaskManager: { listTasks: () => [], createTask: () => ({ id: "unused" }) }
  });

  const active = service.saveSettings({
    enabled: true,
    autoCreateTasks: true,
    cycleDays: 7,
    groupNames: ["test-group"],
    assetGroupId: "test-assets",
    audioDir: "C:\\test-audio"
  });
  assert.equal(active.cycleStartedAt, current);
  assert.equal(active.cycleEndsAt, current + 7 * 86_400_000);
  assert.equal(service.getStatus().cycle.status, "active");
  assert.equal(service.getStatus().cycle.remainingDays, 7);

  current = active.cycleEndsAt + 1;
  service.schedule();
  const expired = service.getStatus();
  assert.equal(expired.enabled, false);
  assert.equal(expired.autoCreateTasks, false);
  assert.equal(expired.settings.cycleStopReason, "expired");
  assert.equal(expired.cycle.status, "expired");
  await assert.rejects(() => service.createPlan(), /周期已经结束/);

  current += 60_000;
  const restarted = service.saveSettings({ enabled: true, autoCreateTasks: false });
  assert.equal(restarted.cycleStartedAt, current);
  assert.equal(restarted.cycleEndsAt, current + 7 * 86_400_000);
  assert.equal(service.getStatus().cycle.status, "active");
  service.saveSettings({ enabled: false });
});

test("turning off novel operations also disables automatic task creation", (t) => {
  const workDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-operation-master-switch-"));
  t.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const service = createOperationBrainService({
    workDir,
    listPhones: async () => [],
    readPublishRecords: () => [],
    analyticsService: { getDashboard: () => ({ accounts: [], summary: {}, status: {} }) },
    autoTaskManager: { listTasks: () => [], createTask: () => ({ id: "unused" }) }
  });

  const settings = service.saveSettings({ enabled: false, autoCreateTasks: true });
  assert.equal(settings.enabled, false);
  assert.equal(settings.autoCreateTasks, false);
});

test("creates a reviewable plan before creating any publish task", async (t) => {
  const workDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-operation-brain-"));
  t.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const created = [];
  const service = createOperationBrainService({
    workDir,
    now: () => new Date("2026-07-29T10:00:00+08:00").getTime(),
    listPhones: async () => [phone("one")],
    readPublishRecords: () => [],
    analyticsService: {
      getDashboard: ({ period }) => ({
        accounts: [metrics("user-one", period === "30d" ? { videos: 25, averageViews: 180 } : {})],
        summary: { videoCount: 12, matchedCount: 12 },
        status: { lastRun: { finishedAt: Date.now() } }
      })
    },
    autoTaskManager: {
      listTasks: () => [],
      createTask: (payload) => {
        const task = { id: `task-${created.length + 1}`, payload };
        created.push(task);
        return task;
      }
    }
  });
  service.saveSettings({
    enabled: false,
    autoCreateTasks: false,
    groupNames: ["test-group"],
    postsPerAccount: 2,
    assetGroupId: "test-assets",
    audioDir: "C:\\test-audio"
  });

  const plan = await service.createPlan();
  assert.equal(plan.status, "draft");
  assert.equal(plan.plannedVideos, 2);
  assert.equal(plan.aiStrategy.status, "unavailable");
  assert.equal(created.length, 0);
  const firstSlot = plan.taskDrafts.find((draft) => draft.slot === 1);
  const firstSchedule = new Date(firstSlot.scheduleAt * 1000);
  assert.equal(firstSchedule.getHours(), 22);
  assert.ok(firstSchedule.getMinutes() >= 0 && firstSchedule.getMinutes() <= 30);

  const approved = service.approvePlan(plan.id);
  assert.equal(approved.status, "approved");
  assert.ok(created.length > 0);
  assert.ok(created.every((task) => task.payload.taskType === "reddit"));
  assert.ok(created.every((task) => task.payload.publish.autoPublish === true));
});

test("uses Codex once per plan and only applies the publishing schedule", async (t) => {
  const workDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-operation-codex-"));
  t.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  let codexCalls = 0;
  const service = createOperationBrainService({
    workDir,
    now: () => new Date("2026-07-30T10:00:00+08:00").getTime(),
    listPhones: async () => [phone("one")],
    readPublishRecords: () => [],
    analyticsService: {
      getAccountFreshness: () => ({ staleAccounts: [] }),
      fetchAccounts: async (accountNames) => {
        assert.deepEqual(accountNames, ["user-one"]);
        return { succeeded: 1, failed: 0 };
      },
      getDashboard: () => ({
        accounts: [metrics("user-one")],
        summary: { videoCount: 12, matchedCount: 12 },
        status: { lastRun: { finishedAt: Date.now() } }
      }),
      getMatchedVideos: () => [{
        username: "user-one",
        createTime: Math.floor(new Date("2026-07-20T20:00:00+08:00").getTime() / 1000),
        views: 900,
        local: { operationMeta: { workflowId: "reddit_auto", createdBy: "operation-brain" } }
      }]
    },
    autoTaskManager: {
      listTasks: () => [],
      createTask: () => {
        throw new Error("draft generation must not create tasks");
      }
    },
    codexBrain: {
      getStatus: () => ({ operationModel: "gpt-5.6-sol" }),
      generateOperationStrategy: async (input) => {
        codexCalls += 1;
        assert.equal(input.accountCount, 1);
        return {
          model: "gpt-5.6-sol",
          generatedAt: "2026-07-30T02:00:00.000Z",
          durationMs: 1200,
          usage: { inputTokens: 100, outputTokens: 200 },
          strategy: {
            executiveSummary: "Test one hook and one retention format.",
            accountDiagnosis: "The account is still collecting samples.",
            contentDirection: "Keep the saved Reddit generation settings.",
            riskNotes: ["Do not overread one post.", "Keep the safety cap."],
            publishingPlan: [
              { stage: "cold_start", startHour: 20, startMinute: 15, windowMinutes: 30, slotIntervalMinutes: 120, rationale: "Test the strongest observed evening window." },
              { stage: "testing", startHour: 20, startMinute: 15, windowMinutes: 30, slotIntervalMinutes: 120, rationale: "Test the strongest observed evening window." },
              { stage: "breakout", startHour: 20, startMinute: 15, windowMinutes: 30, slotIntervalMinutes: 120, rationale: "Scale the strongest observed evening window." },
              { stage: "scaling", startHour: 20, startMinute: 15, windowMinutes: 30, slotIntervalMinutes: 120, rationale: "Scale the strongest observed evening window." },
              { stage: "qualified", startHour: 20, startMinute: 15, windowMinutes: 30, slotIntervalMinutes: 120, rationale: "Maintain the strongest observed evening window." },
              { stage: "recovery", startHour: 20, startMinute: 15, windowMinutes: 30, slotIntervalMinutes: 120, rationale: "Retest the strongest observed evening window." }
            ]
          }
        };
      }
    }
  });
  service.saveSettings({
    enabled: false,
    autoCreateTasks: false,
    useCodex: true,
    groupNames: ["test-group"],
    postsPerAccount: 2,
    assetGroupId: "test-assets",
    audioDir: "C:\\test-audio"
  });

  const plan = await service.createPlan();
  assert.equal(codexCalls, 1);
  assert.equal(plan.aiStrategy.status, "completed");
  assert.equal(plan.aiStrategy.model, "gpt-5.6-sol");
  assert.ok(plan.aiStrategy.appliedPublishingPlan.length > 0);
  assert.ok(plan.accounts.every((account) => account.operationDay > 7));
  assert.ok(plan.taskDrafts.every((draft) => draft.workflowId === "reddit_auto"));
  assert.ok(plan.taskDrafts.every((draft) => !Object.hasOwn(draft, "aiScript")));
  assert.ok(plan.taskDrafts.every((draft) => !Object.hasOwn(draft, "aiTuning")));
  assert.ok(plan.taskDrafts.every((draft) => draft.payload.taskType === "reddit"));
  assert.ok(plan.taskDrafts.every((draft) => draft.payload.generation.assetGroupId === "test-assets"));
  assert.ok(plan.taskDrafts.every((draft) => draft.payload.generation.audioDir === "C:\\test-audio"));
  assert.ok(plan.taskDrafts.every((draft) => draft.payload.generation.segmentSeconds === 5));
  assert.ok(plan.taskDrafts.every((draft) => draft.payload.publish.envIds.length === 1));
  assert.ok(plan.taskDrafts.every((draft) => draft.payload.publish.scheduleAt === draft.scheduleAt));
  const optimizedFirstSlot = plan.taskDrafts.find((draft) => draft.slot === 1);
  const optimizedSchedule = new Date(optimizedFirstSlot.scheduleAt * 1000);
  assert.equal(optimizedFirstSlot.payload.publish.operationMeta.schedulingMode, "ai_optimized");
  assert.equal(optimizedSchedule.getHours(), 20);
  assert.ok(optimizedSchedule.getMinutes() >= 15 && optimizedSchedule.getMinutes() <= 45);
});

test("keeps the rule draft when Codex generation fails", async (t) => {
  const workDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-operation-codex-fallback-"));
  t.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const service = createOperationBrainService({
    workDir,
    now: () => new Date("2026-07-31T10:00:00+08:00").getTime(),
    listPhones: async () => [phone("one")],
    readPublishRecords: () => [],
    analyticsService: {
      getDashboard: () => ({
        accounts: [metrics("user-one")],
        summary: { videoCount: 12, matchedCount: 12 },
        status: { lastRun: { finishedAt: Date.now() } }
      })
    },
    autoTaskManager: { listTasks: () => [], createTask: () => ({ id: "unused" }) },
    codexBrain: {
      getStatus: () => ({ operationModel: "gpt-5.6-sol" }),
      generateOperationStrategy: async () => {
        throw new Error("connection interrupted");
      }
    }
  });
  service.saveSettings({
    groupNames: ["test-group"],
    postsPerAccount: 1,
    useCodex: true,
    assetGroupId: "test-assets",
    audioDir: "C:\\test-audio"
  });

  const plan = await service.createPlan();
  assert.equal(plan.status, "draft");
  assert.equal(plan.aiStrategy.status, "failed");
  assert.match(plan.aiStrategy.error, /connection interrupted/);
  assert.equal(plan.taskDrafts.length, 1);
  assert.equal(plan.taskDrafts[0].aiScript, undefined);
});

test("uses the fixed 300-video daily limit without a configurable account ceiling", (t) => {
  const workDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-operation-fixed-limit-"));
  t.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const service = createOperationBrainService({
    workDir,
    listPhones: async () => [],
    readPublishRecords: () => [],
    analyticsService: { getDashboard: () => ({ accounts: [], summary: {}, status: {} }) },
    autoTaskManager: { listTasks: () => [], createTask: () => ({ id: "unused" }) }
  });

  const saved = service.saveSettings({ maxDailyVideos: 25, maxAccounts: 1 });
  assert.equal(saved.maxDailyVideos, 300);
  assert.equal(Object.hasOwn(saved, "maxAccounts"), false);
});

test("resetting judgments establishes a durable analysis baseline", async (t) => {
  const workDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-operation-reset-"));
  t.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const resetAt = new Date("2026-08-06T11:30:00+08:00").getTime();
  const dashboardCalls = [];
  let privateArgs = null;
  const service = createOperationBrainService({
    workDir,
    now: () => resetAt,
    listPhones: async () => [phone("one")],
    readPublishRecords: () => [],
    analyticsService: {
      getDashboard: (options) => {
        dashboardCalls.push(options);
        return {
          accounts: options.publishedAfter ? [] : [metrics("user-one")],
          summary: { videoCount: options.publishedAfter ? 0 : 12, matchedCount: 0 },
          status: {}
        };
      },
      getMatchedVideos: () => [{
        username: "user-one",
        createTime: Math.floor((resetAt - 60_000) / 1000),
        views: 9000,
        local: { operationMeta: { workflowId: "reddit_auto", createdBy: "operation-brain" } }
      }]
    },
    privateAnalyticsService: {
      getPublicSettings: () => ({ configured: true }),
      getOperationSignals: async (options) => {
        privateArgs = options;
        return { status: "ready", summary: { detailedVideoCount: 0 }, accounts: [] };
      }
    },
    autoTaskManager: { listTasks: () => [], createTask: () => ({ id: "unused" }) }
  });
  service.saveSettings({ groupNames: ["test-group"] });

  const reset = service.resetJudgments();
  assert.equal(reset.analysisResetAt, resetAt);
  assert.equal(service.getSettings().analysisResetAt, resetAt);

  const overview = await service.getOverview();
  assert.equal(dashboardCalls.length, 2);
  assert.ok(dashboardCalls.every((options) => options.publishedAfter === resetAt));
  assert.equal(privateArgs.publishedAfter, resetAt);
  assert.equal(overview.accounts[0].stage, "cold_start");
  assert.equal(overview.accounts[0].judgmentPending, true);
  assert.equal(overview.accounts[0].reason, "账号判断已清空，等待重置后的新视频数据。");
  assert.equal(overview.accounts[0].metrics.videos10d, 0);
  assert.equal(overview.accounts[0].operationDay, 1);
  assert.equal(overview.stages.reduce((sum, item) => sum + item.count, 0), 0);
  assert.equal(overview.contentFeedback.matchedVideos, 0);
  assert.equal(overview.dataStatus.analysisStartedAt, resetAt);
});
