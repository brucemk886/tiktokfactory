import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildAssignments,
  classifyAccounts,
  createOperationBrainService,
  decideStrategyRoute,
  summarizeContentFeedback
} from "./operation-brain.js";

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
          allocationPlan: [],
          publishingPlan: [],
          recipeTuning: [],
          scripts: []
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
    postsPerAccount: 1
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
  assert.equal(result.find((item) => item.envId === "new").contentMix.schulte_complete, 5);
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

test("builds the requested number of varied assignments per account", () => {
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
    assert.notEqual(accountAssignments[0].recipe.id, accountAssignments[1].recipe.id);
    assert.notEqual(accountAssignments[1].recipe.id, accountAssignments[2].recipe.id);
    assert.ok(accountAssignments.every((item) => item.contentVariant?.id));
  }
});

test("attributes recent views to operation recipes for the next planning cycle", () => {
  const now = new Date("2026-07-29T10:00:00+08:00").getTime();
  const seconds = Math.floor(now / 1000);
  const feedback = summarizeContentFeedback([
    {
      username: "user-one",
      createTime: seconds - 3600,
      views: 1800,
      local: {
        operationMeta: { recipeId: "tracking_hook", contentVariantId: "lock-target" }
      }
    },
    {
      username: "user-one",
      createTime: seconds - 7200,
      views: 100,
      local: { templateId: "tracking" }
    },
    {
      username: "user-one",
      createTime: seconds - 12 * 24 * 3600,
      views: 500,
      local: { template: "模板 2 · 小球追踪" }
    }
  ], ["user-one"], now);

  const tracking = feedback.recipes.find((item) => item.recipeId === "tracking_hook");
  assert.equal(feedback.matchedVideos, 2);
  assert.equal(feedback.windowDays, 10);
  assert.equal(feedback.comparedWithPreviousDays, 10);
  assert.equal(tracking.sampleCount, 2);
  assert.equal(tracking.previousSampleCount, 1);
  assert.equal(tracking.averageViews, 950);
  assert.equal(tracking.over1000Rate, 50);
  assert.equal(tracking.topVariant.variantId, "lock-target");
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
    postsPerAccount: 2
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
  assert.ok(created.every((task) => task.payload.publish.autoPublish === true));
});

test("uses Codex once per plan and only applies copy to safe task fields", async (t) => {
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
        local: { operationMeta: { recipeId: "tracking_hook", createdBy: "operation-brain" } }
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
            contentDirection: "Use clear interaction prompts.",
            riskNotes: ["Do not overread one post.", "Keep the safety cap."],
            allocationPlan: [
              { stage: "cold_start", mix: { peripheral_hook: 55, tracking_hook: 30, position_memory: 10, schulte_complete: 5 }, rationale: "Short tests first." },
              { stage: "testing", mix: { peripheral_hook: 40, tracking_hook: 30, position_memory: 20, schulte_complete: 10 }, rationale: "Broaden the sample." },
              { stage: "breakout", mix: { peripheral_hook: 25, tracking_hook: 30, position_memory: 30, schulte_complete: 15 }, rationale: "Expand proven formats." },
              { stage: "scaling", mix: { peripheral_hook: 10, tracking_hook: 20, position_memory: 25, schulte_complete: 45 }, rationale: "Use longer proven sessions." },
              { stage: "qualified", mix: { peripheral_hook: 10, tracking_hook: 20, position_memory: 25, schulte_complete: 45 }, rationale: "Maintain the winning mix." },
              { stage: "recovery", mix: { peripheral_hook: 55, tracking_hook: 30, position_memory: 10, schulte_complete: 5 }, rationale: "Return to short hooks." }
            ],
            publishingPlan: [
              { stage: "cold_start", startHour: 20, startMinute: 15, windowMinutes: 30, slotIntervalMinutes: 120, rationale: "Test the strongest observed evening window." },
              { stage: "testing", startHour: 20, startMinute: 15, windowMinutes: 30, slotIntervalMinutes: 120, rationale: "Test the strongest observed evening window." },
              { stage: "breakout", startHour: 20, startMinute: 15, windowMinutes: 30, slotIntervalMinutes: 120, rationale: "Scale the strongest observed evening window." },
              { stage: "scaling", startHour: 20, startMinute: 15, windowMinutes: 30, slotIntervalMinutes: 120, rationale: "Scale the strongest observed evening window." },
              { stage: "qualified", startHour: 20, startMinute: 15, windowMinutes: 30, slotIntervalMinutes: 120, rationale: "Maintain the strongest observed evening window." },
              { stage: "recovery", startHour: 20, startMinute: 15, windowMinutes: 30, slotIntervalMinutes: 120, rationale: "Retest the strongest observed evening window." }
            ],
            recipeTuning: [
              { recipeId: "peripheral_hook", durationSeconds: 16, rotationSpeed: 0, trackingSeconds: 0, ballSpeed: 0, memorySteps: 0, peripheralTargets: 4, rationale: "Faster hook." },
              { recipeId: "tracking_hook", durationSeconds: 30, rotationSpeed: 0, trackingSeconds: 20, ballSpeed: 1.7, memorySteps: 0, peripheralTargets: 0, rationale: "Raise tracking difficulty." },
              { recipeId: "position_memory", durationSeconds: 38, rotationSpeed: 0, trackingSeconds: 0, ballSpeed: 0, memorySteps: 7, peripheralTargets: 0, rationale: "Test deeper memory." },
              { recipeId: "schulte_complete", durationSeconds: 72, rotationSpeed: 2.2, trackingSeconds: 0, ballSpeed: 0, memorySteps: 0, peripheralTargets: 0, rationale: "Keep the long session readable." }
            ],
            scripts: [
              { recipeId: "peripheral_hook", targetStage: "all", headline: "AI Peripheral", mainTitle: "Spot It Before Time Runs Out", videoDesc: "Comment your score. #focus #attention #test", rationale: "Fast feedback loop." },
              { recipeId: "tracking_hook", targetStage: "all", headline: "AI Tracking", mainTitle: "Keep Your Eyes On It", videoDesc: "Name the final ball. #tracking #focus #challenge", rationale: "Direct answer prompt." },
              { recipeId: "position_memory", targetStage: "all", headline: "AI Memory", mainTitle: "Remember Every Position", videoDesc: "Post your sequence. #memory #braintraining #focus", rationale: "Retention-oriented task." },
              { recipeId: "schulte_complete", targetStage: "all", headline: "AI Schulte", mainTitle: "Finish The Full Grid", videoDesc: "Comment your time. #schulte #focus #braintraining", rationale: "Longer watch-time proxy." }
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
    postsPerAccount: 2
  });

  const plan = await service.createPlan();
  assert.equal(codexCalls, 1);
  assert.equal(plan.aiStrategy.status, "completed");
  assert.equal(plan.aiStrategy.model, "gpt-5.6-sol");
  assert.ok(plan.aiStrategy.appliedAllocationPlan.length > 0);
  assert.ok(plan.aiStrategy.appliedAllocationPlan.every((item) => item.aiWeight === 1));
  assert.ok(plan.aiStrategy.appliedPublishingPlan.length > 0);
  assert.ok(plan.accounts.every((account) => account.experimentDay > 7));
  assert.ok(plan.taskDrafts.every((draft) => draft.aiScript?.modelSource === "codex"));
  assert.ok(plan.taskDrafts.every((draft) => draft.aiTuning?.modelSource === "codex"));
  assert.ok(plan.taskDrafts.every((draft) => draft.payload.generation.headline.startsWith("AI ")));
  assert.ok(plan.taskDrafts.every((draft) => draft.payload.publish.envIds.length === 1));
  assert.ok(plan.taskDrafts.every((draft) => draft.payload.publish.scheduleAt === draft.scheduleAt));
  const optimizedFirstSlot = plan.taskDrafts.find((draft) => draft.slot === 1);
  const optimizedSchedule = new Date(optimizedFirstSlot.scheduleAt * 1000);
  assert.equal(optimizedFirstSlot.payload.publish.operationMeta.experimentMode, "ai_optimized");
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
  service.saveSettings({ groupNames: ["test-group"], postsPerAccount: 1, useCodex: true });

  const plan = await service.createPlan();
  assert.equal(plan.status, "draft");
  assert.equal(plan.aiStrategy.status, "failed");
  assert.match(plan.aiStrategy.error, /connection interrupted/);
  assert.equal(plan.taskDrafts.length, 1);
  assert.equal(plan.taskDrafts[0].aiScript, undefined);
});
