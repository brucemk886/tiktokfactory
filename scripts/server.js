import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { ensureProject, readConfig, renderPodcastVideo } from "./video-core.js";
import { createGeeLarkClient } from "./geelark-client.js";
import { discoverAssetLibraryGroups, getAssetUsageDashboard, getAssetGroup, getGeneratedVideoReuseDetail, listAssetGroups, readUsage } from "./asset-library.js";
import { resolveStorageDirs } from "./storage-paths.js";
import { createPublishService } from "./publish-service.js";
import { createAutoTaskManager } from "./auto-task-manager.js";
import { createTikTokAnalyticsService } from "./tiktok-analytics.js";
import { createCodexBrainService } from "./codex-brain.js";
import { createDeepSeekBrainService } from "./deepseek-brain.js";
import { createFeishuBookService } from "./feishu-books.js";
import { createAudioLibraryService } from "./audio-library.js";
import { createLocalAuthService } from "./local-auth.js";
import { createPsychologyTopicsService } from "./psychology-topics.js";
import { createKieAiService } from "./kie-ai.js";
import { createOperationBrainService } from "./operation-brain.js";
import { createOfficialTikTokAnalyticsService } from "./official-tiktok-analytics.js";

const root = process.cwd();
const port = Number(process.env.PORT || 3010);
const publicDir = path.join(root, "public");
const bootConfig = readConfig(root);
const { outputDir, workDir } = resolveStorageDirs(root, bootConfig);
const jobsDir = path.join(workDir, "jobs");
const publishRecordsPath = path.join(workDir, "publish-records.json");
const redditMixSettingsPath = path.join(workDir, "reddit-mix-settings.json");
const psychologySettingsPath = path.join(workDir, "psychology-video-settings.json");

ensureProject(root, bootConfig);
fs.mkdirSync(jobsDir, { recursive: true });
const localAuth = createLocalAuthService({ workDir, initialGeeLark: bootConfig.geelark || {} });
const publishService = createPublishService({
  root,
  workDir,
  outputDir,
  readConfig,
  resolveConfig: (profileId) => ({ ...readConfig(root), geelark: resolveGeeLarkConfig(profileId) })
});
const autoTaskManager = createAutoTaskManager({ root, workDir, outputDir, publishService, outputRetentionHours: 48 });
const tiktokAnalytics = createTikTokAnalyticsService({
  workDir,
  defaultApiKeys: bootConfig.tiktokApiStoreApiKeys,
  defaultApiKey: bootConfig.tiktokApiStoreApiKey
});
const codexBrain = createCodexBrainService({ root, workDir });
const deepseekBrain = createDeepSeekBrainService({ workDir });
const feishuBooks = createFeishuBookService({ root, workDir, readConfig });
const audioLibrary = createAudioLibraryService({ root, workDir, readConfig });
const psychologyTopics = createPsychologyTopicsService({ workDir });
const kieAi = createKieAiService({ workDir, readApiKey: () => readPsychologySettings().kieApiKey });
const privateTikTokAnalytics = createOfficialTikTokAnalyticsService({ workDir });
const operationBrain = createOperationBrainService({
  workDir,
  analyticsService: tiktokAnalytics,
  privateAnalyticsService: privateTikTokAnalytics,
  autoTaskManager,
  codexBrain,
  deepseekBrain,
  listPhones: listGeeLarkPhonesForProfile,
  readPublishRecords,
  readRedditSettings: () => readRedditMixSettings().settings,
  listProfiles: () => localAuth.listProfiles()
});
let scheduledAccountsCache = { expiresAt: 0, accounts: null };
tiktokAnalytics.scheduleNextRun(getScheduledTikTokAccounts);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/login") {
      if (localAuth.getSession(req)) return redirect(res, "/tasks");
      return sendFile(res, path.join(publicDir, "login.html"), "text/html; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/login.js") return sendFile(res, path.join(publicDir, "login.js"), "text/javascript; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/access.css") return sendFile(res, path.join(publicDir, "access.css"), "text/css; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/access.js") return sendFile(res, path.join(publicDir, "access.js"), "text/javascript; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/setup") {
      if (localAuth.hasUsers()) return redirect(res, "/login");
      if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: "首次管理员初始化只能在本机完成。" });
      return sendFile(res, path.join(publicDir, "setup.html"), "text/html; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/setup.js") return sendFile(res, path.join(publicDir, "setup.js"), "text/javascript; charset=utf-8");

    if (req.method === "POST" && url.pathname === "/api/auth/setup") {
      if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: "首次管理员初始化只能在本机完成。" });
      const payload = await readJsonBody(req);
      const user = localAuth.setupAdmin(payload);
      const session = localAuth.login({ username: user.username, password: payload.password });
      return sendJson(res, 201, { ok: true, user: session.user }, { "Set-Cookie": sessionCookie(session.token) });
    }
    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const session = localAuth.login(await readJsonBody(req));
      return sendJson(res, 200, { ok: true, user: session.user }, { "Set-Cookie": sessionCookie(session.token) });
    }
    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      localAuth.logout(localAuth.getSession(req)?.token);
      return sendJson(res, 200, { ok: true }, { "Set-Cookie": "lf_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
    }

    const session = localAuth.getSession(req);
    if (url.pathname.startsWith("/api/")) {
      if (!session) return sendJson(res, 401, { error: "请先登录。" });
      if (!canAccessApi(session.user, url.pathname)) return sendJson(res, 403, { error: "当前账号没有此功能权限。" });
    } else if (requiresLogin(url.pathname)) {
      if (!localAuth.hasUsers()) return redirect(res, isLoopbackRequest(req) ? "/setup" : "/login");
      if (!session) return redirect(res, "/login");
      if (!canAccessPage(session.user, url.pathname)) return redirect(res, "/tasks");
    }

    if (req.method === "GET" && url.pathname === "/accounts") {
      return sendFile(res, path.join(publicDir, "accounts.html"), "text/html; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/accounts.js") {
      return sendFile(res, path.join(publicDir, "accounts.js"), "text/javascript; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/api/auth/me") {
      return sendJson(res, 200, { user: session.user, profiles: session.user.role === "admin" ? localAuth.listProfiles() : [] });
    }
    if (req.method === "GET" && url.pathname === "/api/admin/accounts") {
      return sendJson(res, 200, { users: localAuth.listUsers(), profiles: localAuth.listProfiles() });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/accounts") {
      return sendJson(res, 201, { user: localAuth.createUser(await readJsonBody(req)) });
    }
    if (req.method === "PATCH" && url.pathname.match(/^\/api\/admin\/accounts\/[^/]+$/)) {
      return sendJson(res, 200, { user: localAuth.updateUser(decodeURIComponent(url.pathname.split("/").pop()), await readJsonBody(req)) });
    }
    if (req.method === "POST" && url.pathname === "/api/admin/geelark-profiles") {
      return sendJson(res, 200, { profile: localAuth.saveProfile(await readJsonBody(req)) });
    }
    if (req.method === "GET" && url.pathname.match(/^\/api\/admin\/geelark-profiles\/[^/]+\/groups$/)) {
      if (session.user.role !== "admin") return sendJson(res, 403, { error: "?????????? GeeLark ???" });
      const profileId = decodeURIComponent(url.pathname.split("/")[4]);
      if (!localAuth.getProfile(profileId)) return sendJson(res, 404, { error: "GeeLark 配置不存在。" });
      const phones = await listGeeLarkPhonesForProfile(profileId);
      const counts = new Map();
      for (const phone of phones) {
        const groupName = String(phone.groupName || "").trim();
        if (groupName) counts.set(groupName, (counts.get(groupName) || 0) + 1);
      }
      const groups = Array.from(counts, ([name, accountCount]) => ({ name, accountCount }))
        .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
      return sendJson(res, 200, { groups, accountCount: phones.length });
    }
    if (req.method === "DELETE" && url.pathname.match(/^\/api\/admin\/geelark-profiles\/[^/]+$/)) {
      localAuth.deleteProfile(decodeURIComponent(url.pathname.split("/").pop()));
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/") {
      return sendFile(res, path.join(publicDir, "index.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/app.css") {
      return sendFile(res, path.join(publicDir, "app.css"), "text/css; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/app.js") {
      return sendFile(res, path.join(publicDir, "app.js"), "text/javascript; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/stats") {
      return sendFile(res, path.join(publicDir, "stats.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/stats.js") {
      return sendFile(res, path.join(publicDir, "stats.js"), "text/javascript; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/analytics") {
      return sendFile(res, path.join(publicDir, "analytics.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/analytics.js") {
      return sendFile(res, path.join(publicDir, "analytics.js"), "text/javascript; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/analytics.css") {
      return sendFile(res, path.join(publicDir, "analytics.css"), "text/css; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/analytics-settings") {
      return sendFile(res, path.join(publicDir, "analytics-settings.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/analytics-settings.js") {
      return sendFile(res, path.join(publicDir, "analytics-settings.js"), "text/javascript; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/tiktok-connections") {
      return sendFile(res, path.join(publicDir, "tiktok-connections.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/tiktok-connections.js") {
      return sendFile(res, path.join(publicDir, "tiktok-connections.js"), "text/javascript; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/tiktok-connections.css") {
      return sendFile(res, path.join(publicDir, "tiktok-connections.css"), "text/css; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/tiktok-video-detail") {
      return sendFile(res, path.join(publicDir, "tiktok-video-detail.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/tiktok-video-detail.js") {
      return sendFile(res, path.join(publicDir, "tiktok-video-detail.js"), "text/javascript; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/tiktok-video-detail.css") {
      return sendFile(res, path.join(publicDir, "tiktok-video-detail.css"), "text/css; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/reddit") {
      return sendFile(res, path.join(publicDir, "reddit.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/reddit.js") {
      return sendFile(res, path.join(publicDir, "reddit.js"), "text/javascript; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/psychology") {
      return sendFile(res, path.join(publicDir, "psychology.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/psychology.js") {
      return sendFile(res, path.join(publicDir, "psychology.js"), "text/javascript; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/psychology.css") {
      return sendFile(res, path.join(publicDir, "psychology.css"), "text/css; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/schulte") {
      return sendFile(res, path.join(publicDir, "schulte.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/schulte.js") {
      return sendFile(res, path.join(publicDir, "schulte.js"), "text/javascript; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/schulte.css") {
      return sendFile(res, path.join(publicDir, "schulte.css"), "text/css; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/schulte-sample.mp4") {
      return sendFile(
        res,
        path.join(root, "schulte-grid-generator", "output", "schulte-focus-sample.mp4"),
        "video/mp4"
      );
    }

    if (req.method === "GET" && url.pathname === "/psychology-topics") {
      return sendFile(res, path.join(publicDir, "psychology-topics.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/psychology-topics.js") {
      return sendFile(res, path.join(publicDir, "psychology-topics.js"), "text/javascript; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/ai") {
      return sendFile(res, path.join(publicDir, "ai.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/ai.js") {
      return sendFile(res, path.join(publicDir, "ai.js"), "text/javascript; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/module-pages.css") {
      return sendFile(res, path.join(publicDir, "module-pages.css"), "text/css; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/tasks") {
      return sendFile(res, path.join(publicDir, "tasks.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/tasks.js") {
      return sendFile(res, path.join(publicDir, "tasks.js"), "text/javascript; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/tasks.css") {
      return sendFile(res, path.join(publicDir, "tasks.css"), "text/css; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/operator") {
      return sendFile(res, path.join(publicDir, "operator.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/operator.js") {
      return sendFile(res, path.join(publicDir, "operator.js"), "text/javascript; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/operator.css") {
      return sendFile(res, path.join(publicDir, "operator.css"), "text/css; charset=utf-8");
    }

    if (req.method === "GET" && ["/asset-cutter", "/novel-library", "/audio-library"].includes(url.pathname)) {
      return redirect(res, "/tasks");
    }

    if (req.method === "GET" && url.pathname === "/asset-usage") {
      return sendFile(res, path.join(publicDir, "asset-usage.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/asset-usage.js") {
      return sendFile(res, path.join(publicDir, "asset-usage.js"), "text/javascript; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/asset-usage.css") {
      return sendFile(res, path.join(publicDir, "asset-usage.css"), "text/css; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname.startsWith("/outputs/")) {
      const fileName = path.basename(decodeURIComponent(url.pathname.slice("/outputs/".length)));
      return sendFile(res, path.join(outputDir, fileName), "video/mp4");
    }

    if (req.method === "GET" && url.pathname === "/api/private-tiktok/settings") {
      return sendJson(res, 200, { settings: privateTikTokAnalytics.getPublicSettings() }, { "Cache-Control": "no-store" });
    }

    if (req.method === "POST" && url.pathname === "/api/private-tiktok/settings") {
      if (session.user.role !== "admin") return sendJson(res, 403, { error: "仅管理员可以修改 TikTok 数据桥接配置。" });
      return sendJson(res, 200, { settings: privateTikTokAnalytics.saveSettings(await readJsonBody(req)) });
    }

    if (req.method === "POST" && url.pathname === "/api/private-tiktok/test") {
      if (session.user.role !== "admin") return sendJson(res, 403, { error: "仅管理员可以测试 TikTok 数据桥接。" });
      return sendJson(res, 200, await privateTikTokAnalytics.testConnection(), { "Cache-Control": "no-store" });
    }

    if (req.method === "GET" && url.pathname === "/api/private-tiktok/accounts") {
      return sendJson(res, 200, await privateTikTokAnalytics.listAccounts(), { "Cache-Control": "no-store" });
    }

    if (req.method === "GET" && url.pathname === "/api/private-tiktok/videos") {
      return sendJson(res, 200, await privateTikTokAnalytics.listVideos({
        schema: url.searchParams.get("schema"),
        query: url.searchParams.get("query"),
        limit: url.searchParams.get("limit"),
        includePrivate: url.searchParams.get("includePrivate") === "1"
      }), { "Cache-Control": "no-store" });
    }

    if (req.method === "GET" && /^\/api\/private-tiktok\/videos\/[^/]+$/.test(url.pathname)) {
      return sendJson(res, 200, await privateTikTokAnalytics.getVideoDetail({
        schema: url.searchParams.get("schema"),
        videoId: decodeURIComponent(url.pathname.split("/").pop())
      }), { "Cache-Control": "no-store" });
    }

    if (req.method === "GET" && url.pathname === "/api/codex/status") {
      if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: "Codex ???????????" });
      return sendJson(res, 200, codexBrain.getStatus());
    }

    if (req.method === "GET" && url.pathname === "/api/deepseek/settings") {
      return sendJson(res, 200, deepseekBrain.getPublicSettings());
    }

    if (req.method === "POST" && url.pathname === "/api/deepseek/settings") {
      try {
        return sendJson(res, 200, deepseekBrain.saveSettings(await readJsonBody(req)));
      } catch (error) {
        return sendJson(res, Number(error.statusCode) || 400, { error: error.message || "保存 DeepSeek 设置失败。" });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/deepseek/test") {
      try {
        return sendJson(res, 200, await deepseekBrain.testConnection(await readJsonBody(req)));
      } catch (error) {
        return sendJson(res, Number(error.statusCode) || 502, { error: error.message || "DeepSeek ???????" });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/operator/status") {
      return sendJson(res, 200, operationBrain.getStatus());
    }

    if (req.method === "GET" && url.pathname === "/api/operator/overview") {
      try {
        return sendJson(res, 200, await operationBrain.getOverview({
          profileId: url.searchParams.get("profileId") || undefined,
          groupNames: url.searchParams.getAll("group"),
          objective: url.searchParams.get("objective") || undefined
        }));
      } catch (error) {
        return sendJson(res, Number(error.statusCode) || 502, { error: error.message || "读取运营数据失败。" });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/operator/settings") {
      try {
        return sendJson(res, 200, { settings: operationBrain.saveSettings(await readJsonBody(req)) });
      } catch (error) {
        return sendJson(res, Number(error.statusCode) || 400, { error: error.message || "保存运营设置失败。" });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/operator/reset-judgments") {
      try {
        return sendJson(res, 200, { settings: operationBrain.resetJudgments() });
      } catch (error) {
        return sendJson(res, Number(error.statusCode) || 400, { error: error.message || "清空账号判断失败。" });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/operator/plans") {
      return sendJson(res, 200, { plans: operationBrain.listPlans() });
    }

    if (req.method === "POST" && url.pathname === "/api/operator/plans") {
      try {
        return sendJson(res, 201, { plan: await operationBrain.createPlan(await readJsonBody(req)) });
      } catch (error) {
        return sendJson(res, Number(error.statusCode) || 500, { error: error.message || "生成运营方案失败。" });
      }
    }

    if (req.method === "GET" && /^\/api\/operator\/plans\/[^/]+$/.test(url.pathname)) {
      try {
        return sendJson(res, 200, { plan: operationBrain.getPlan(decodeURIComponent(url.pathname.split("/").pop())) });
      } catch (error) {
        return sendJson(res, Number(error.statusCode) || 404, { error: error.message || "运营方案不存在。" });
      }
    }

    if (req.method === "POST" && /^\/api\/operator\/plans\/[^/]+\/approve$/.test(url.pathname)) {
      try {
        const planId = decodeURIComponent(url.pathname.split("/")[4]);
        return sendJson(res, 200, { plan: operationBrain.approvePlan(planId) });
      } catch (error) {
        return sendJson(res, Number(error.statusCode) || 500, { error: error.message || "创建运营任务失败。" });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/psychology-topics/settings") {
      return sendJson(res, 200, psychologyTopics.getPublicSettings());
    }

    if (req.method === "POST" && url.pathname === "/api/psychology-topics/settings") {
      try {
        return sendJson(res, 200, { settings: psychologyTopics.saveSettings(await readJsonBody(req)) });
      } catch (error) {
        return sendJson(res, Number(error.statusCode) || 500, { error: error.message || "保存题库配置失败。" });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/psychology-topics/sync") {
      try {
        return sendJson(res, 200, await psychologyTopics.sync());
      } catch (error) {
        return sendJson(res, Number(error.statusCode) || 502, { error: error.message || "同步心理学题库失败。" });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/psychology-topics") {
      return sendJson(res, 200, psychologyTopics.list({
        query: url.searchParams.get("query") || "",
        page: url.searchParams.get("page") || 1,
        pageSize: url.searchParams.get("pageSize") || 20
      }));
    }

    if (req.method === "GET" && /^\/api\/psychology-topics\/[^/]+$/.test(url.pathname)) {
      const topic = psychologyTopics.get(decodeURIComponent(url.pathname.split("/").pop()));
      return topic ? sendJson(res, 200, { topic }) : sendJson(res, 404, { error: "心理学题目不存在。" });
    }

    if (req.method === "POST" && url.pathname === "/api/ai/generate") {
      if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: "AI 创作仅允许在本机使用。" });
      try {
        return sendJson(res, 200, await codexBrain.generateCreation(await readJsonBody(req)));
      } catch (error) {
        return sendJson(res, Number(error.statusCode) || 502, { error: error.message || "AI 创作失败。" });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/kie-ai") {
      return sendJson(res, 200, await kieAi.getOverview());
    }

    if (req.method === "POST" && url.pathname === "/api/kie-ai") {
      try {
        return sendJson(res, 201, { task: await kieAi.createTask(await readJsonBody(req)) });
      } catch (error) {
        return sendJson(res, Number(error.statusCode) || 502, { error: error.message || "Kie.ai 生成任务提交失败。" });
      }
    }

    if (req.method === "GET" && /^\/api\/kie-ai\/[^/]+$/.test(url.pathname)) {
      try {
        return sendJson(res, 200, { task: await kieAi.refreshTask(decodeURIComponent(url.pathname.split("/").pop())) });
      } catch (error) {
        return sendJson(res, Number(error.statusCode) || 502, { error: error.message || "Kie.ai 任务状态读取失败。" });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/novel-library/status") {
      return sendJson(res, 200, feishuBooks.getStatus());
    }

    if (req.method === "GET" && url.pathname === "/api/novel-library") {
      const data = await feishuBooks.getLibrary({
        sheetId: String(url.searchParams.get("sheetId") || ""),
        query: String(url.searchParams.get("query") || ""),
        channel: String(url.searchParams.get("channel") || ""),
        tag: String(url.searchParams.get("tag") || ""),
        page: Number(url.searchParams.get("page")) || 1,
        pageSize: Number(url.searchParams.get("pageSize")) || 20
      });
      return sendJson(res, 200, data);
    }

    if (req.method === "POST" && url.pathname === "/api/novel-library/sync") {
      const payload = await readJsonBody(req);
      const library = await feishuBooks.syncSheet(String(payload.sheetId || ""));
      return sendJson(res, 200, {
        ok: true,
        sheet: library.sheet,
        syncedAt: library.syncedAt,
        totalRowsRead: library.totalRowsRead,
        totalBooks: library.books.length
      });
    }

    if (req.method === "POST" && url.pathname === "/api/codex/test") {
      if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: "Codex 接口仅允许在本机访问。" });
      try {
        return sendJson(res, 200, await codexBrain.testConnection());
      } catch (error) {
        return sendJson(res, Number(error.statusCode) || 502, { error: error.message || "Codex 连接测试失败。" });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/novel-marketing/generate") {
      if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: "小说营销生成接口仅允许在本机访问。" });
      try {
        const payload = await readJsonBody(req);
        return sendJson(res, 200, await codexBrain.generateNovelMarketing(payload));
      } catch (error) {
        return sendJson(res, Number(error.statusCode) || 502, { error: error.message || "小说营销素材生成失败。" });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/audio-library") {
      if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: "音频素材库仅允许在本机访问。" });
      return sendJson(res, 200, { items: audioLibrary.list() });
    }

    if (req.method === "GET" && url.pathname === "/api/reddit-mix/settings") {
      return sendJson(res, 200, readRedditMixSettings());
    }

    if (req.method === "POST" && url.pathname === "/api/reddit-mix/settings") {
      if (session.user.role !== "admin") return sendJson(res, 403, { error: "只有管理员可以修改统一混剪配置。" });
      const payload = await readJsonBody(req);
      const settings = saveRedditMixSettings(payload);
      return sendJson(res, 200, { ok: true, settings });
    }

    if (req.method === "POST" && url.pathname === "/api/audio-library/generate") {
      if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: "音频生成功能仅允许在本机访问。" });
      try {
        const payload = await readJsonBody(req);
        const item = await audioLibrary.generateFromMarketing(payload);
        return sendJson(res, 200, { item });
      } catch (error) {
        return sendJson(res, Number(error.statusCode) || 502, { error: error.message || "音频生成失败。" });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/audio-library/prepare-task") {
      if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: "音频任务准备接口仅允许在本机访问。" });
      try {
        const payload = await readJsonBody(req);
        return sendJson(res, 200, audioLibrary.prepareTaskBatch(payload.ids));
      } catch (error) {
        return sendJson(res, Number(error.statusCode) || 500, { error: error.message || "准备音频任务失败。" });
      }
    }

    if (req.method === "GET" && url.pathname.match(/^\/api\/audio-library\/[^/]+\/file$/)) {
      if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: "音频素材库仅允许在本机访问。" });
      const audioId = safeId(decodeURIComponent(url.pathname.split("/")[3]));
      const audioPath = audioLibrary.resolveAudioPath(audioId);
      if (!audioPath) return sendJson(res, 404, { error: "音频文件不存在。" });
      return sendFile(res, audioPath, mediaContentType(audioPath));
    }

    if (req.method === "GET" && url.pathname === "/api/publish-records") {
      return sendJson(res, 200, getPublishRecordsSummary(url.searchParams, session.user));
    }

    if (req.method === "GET" && url.pathname === "/api/tiktok-analytics") {
      const publishRecords = readPublishRecords();
      const requestedProfileId = String(url.searchParams.get("profileId") || "").trim();
      if (session.user.role !== "admin" && requestedProfileId && requestedProfileId !== session.user.geelarkProfileId) {
        return sendJson(res, 403, { error: "????????????? GeeLark ???" });
      }
      const analyticsProfileId = resolveAnalyticsProfileId(session.user, requestedProfileId);
      let allowedAccounts = [];
      let availableGroups = null;
      if (analyticsProfileId) {
        if (!localAuth.getProfile(analyticsProfileId)) return sendJson(res, 404, { error: "GeeLark ??????" });
        const profilePhones = session.user.role === "admin"
          ? await getCurrentGeeLarkPhones([analyticsProfileId])
          : await getAuthorizedGeeLarkPhones(session.user);
        const profileAccounts = new Set(profilePhones
          .map((phone) => String(phone.serialName || "").trim().replace(/^@/, "").toLowerCase())
          .filter(Boolean));
        const profileGroups = Array.from(new Set(profilePhones
          .map((phone) => String(phone.groupName || "").trim())
          .filter(Boolean)))
          .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
        availableGroups = profileGroups;
        allowedAccounts = Array.from(profileAccounts);
      } else {
        allowedAccounts = await getAnalyticsAllowedAccounts(session.user, publishRecords);
      }
      return sendJson(res, 200, tiktokAnalytics.getDashboard({
        period: String(url.searchParams.get("period") || "10d"),
        group: String(url.searchParams.get("group") || ""),
        account: String(url.searchParams.get("account") || ""),
        sort: String(url.searchParams.get("sort") || "views"),
        allowedAccounts,
        availableGroups
      }, publishRecords));
    }

    if (req.method === "GET" && url.pathname === "/api/tiktok-analytics/settings") {
      const settings = tiktokAnalytics.getSettings();
      const profiles = getAccessiblePublishProfiles(session.user).map((profile) => ({ id: profile.id, name: profile.name }));
      const requestedProfileIds = url.searchParams.getAll("profileId").map((item) => String(item).trim()).filter(Boolean);
      const sourceProfileIds = session.user.role === "admin"
        ? (requestedProfileIds.length ? requestedProfileIds : settings.profileIds)
        : [session.user.geelarkProfileId || "default"];
      const configuredProfileIds = sourceProfileIds
        .filter((profileId) => profiles.some((profile) => profile.id === profileId));
      const defaultProfileId = configuredProfileIds[0]
        || profiles.find((profile) => profile.id === "default")?.id
        || profiles[0]?.id
        || "";
      const profileIds = configuredProfileIds.length ? configuredProfileIds : (defaultProfileId ? [defaultProfileId] : []);
      let currentPhones = [];
      let groupReadError = "";
      try {
        currentPhones = !profileIds.length
          ? []
          : session.user.role === "admin"
            ? await getCurrentGeeLarkPhones(profileIds)
            : await getAuthorizedGeeLarkPhones(session.user);
      } catch (error) {
        // A temporary GeeLark failure must not hide locally saved account profiles.
        groupReadError = error.message || "GeeLark 账号组读取失败。";
      }
      return sendJson(res, 200, {
        settings,
        profiles,
        activeProfileIds: profileIds,
        defaultProfileId,
        accountCount: currentPhones.length,
        groupReadError,
        availableGroups: Array.from(new Set(currentPhones.map((phone) => phone.groupName).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-Hans-CN")),
        groupCounts: Object.fromEntries(Array.from(new Set(currentPhones.map((phone) => phone.groupName).filter(Boolean))).map((groupName) => [
          groupName,
          currentPhones.filter((phone) => phone.groupName === groupName).length
        ]))
      });
    }

    if (req.method === "GET" && url.pathname.match(/^\/api\/tiktok-analytics\/videos\/[^/]+\/reuse$/)) {
      const videoId = decodeURIComponent(url.pathname.split("/")[4]);
      const publishRecords = readPublishRecords();
      const video = tiktokAnalytics.getVideo(videoId, publishRecords);
      if (!video) return sendJson(res, 404, { error: "没有找到这条 TikTok 视频的数据。" });
      if (session.user.role !== "admin") {
        const allowedAccounts = new Set(await getAnalyticsAllowedAccounts(session.user, publishRecords));
        const username = String(video.username || "").trim().replace(/^@/, "").toLowerCase();
        if (!allowedAccounts.has(username)) return sendJson(res, 403, { error: "你没有查看这条视频素材明细的权限。" });
      }
      if (!video.local?.fileName) return sendJson(res, 404, { error: "这条视频尚未匹配到本地发布记录。" });
      const reuse = getGeneratedVideoReuseDetail(root, video.local.fileName);
      if (!reuse) return sendJson(res, 404, { error: "没有找到这条成片的素材抽取记录。" });

      const metricsByOutput = new Map(tiktokAnalytics.getMatchedVideos(publishRecords)
        .filter((item) => item.local?.fileName)
        .map((item) => [normalizeOutputId(item.local.fileName), item]));
      const relatedVideos = reuse.relatedVideos.map((item) => {
        const related = metricsByOutput.get(normalizeOutputId(item.outputId));
        return {
          ...item,
          views: Number(related?.views) || 0,
          likes: Number(related?.likes) || 0,
          username: related?.username || "",
          shareUrl: related?.shareUrl || "",
          description: related?.description || "",
          createTime: Number(related?.createTime) || 0,
          matchDistanceSeconds: Number(related?.local?.matchDistanceSeconds) || 0,
          matchConfidence: related?.local?.matchConfidence || "",
          hasMetrics: Boolean(related)
        };
      });
      return sendJson(res, 200, { video, reuse: { ...reuse, relatedVideos } });
    }

    if (req.method === "GET" && url.pathname === "/api/tiktok-analytics/audio-details") {
      const audioName = String(url.searchParams.get("audioName") || "");
      const detail = tiktokAnalytics.getAudioDetail(audioName, {
        period: String(url.searchParams.get("period") || "10d"),
        group: String(url.searchParams.get("group") || ""),
        account: String(url.searchParams.get("account") || ""),
        sort: String(url.searchParams.get("sort") || "newest")
      }, readPublishRecords());
      if (!detail) return sendJson(res, 404, { error: "没有找到这条音频的发布数据。" });
      return sendJson(res, 200, {
        ...detail,
        audioAvailable: Boolean(findKnownAudioPath(detail.audioName))
      });
    }

    if (req.method === "GET" && url.pathname === "/api/tiktok-analytics/account-details") {
      const username = String(url.searchParams.get("username") || "");
      const publishRecords = readPublishRecords();
      const allowedAccounts = await getAnalyticsAllowedAccounts(session.user, publishRecords);
      const detail = tiktokAnalytics.getAccountDetail(username, {
        period: String(url.searchParams.get("period") || "10d"),
        group: String(url.searchParams.get("group") || ""),
        sort: String(url.searchParams.get("sort") || "newest"),
        allowedAccounts
      }, publishRecords);
      if (!detail) return sendJson(res, 404, { error: "没有找到这个账号的发布数据。" });
      return sendJson(res, 200, detail);
    }

    if (req.method === "GET" && url.pathname === "/api/tiktok-analytics/audio-file") {
      const audioName = String(url.searchParams.get("audioName") || "");
      const audioPath = findKnownAudioPath(audioName);
      if (!audioPath) return sendJson(res, 404, { error: "没有找到本地音频文件。请确认自动任务的音频目录仍然存在。" });
      return sendFile(res, audioPath, mediaContentType(audioPath));
    }

    if (req.method === "POST" && url.pathname === "/api/tiktok-analytics/settings") {
      const payload = await readJsonBody(req);
      const settings = tiktokAnalytics.saveSettings(payload);
      scheduledAccountsCache = { expiresAt: 0, accounts: null };
      const nextRunAt = tiktokAnalytics.scheduleNextRun(getScheduledTikTokAccounts);
      return sendJson(res, 200, { settings, nextRunAt });
    }

    if (req.method === "POST" && url.pathname === "/api/tiktok-analytics/fetch-demo") {
      const payload = await readJsonBody(req);
      const result = await tiktokAnalytics.fetchAccount(String(payload.username || "elyseugt6i3"));
      return sendJson(res, 200, { ok: true, result });
    }

    if (req.method === "POST" && url.pathname === "/api/tiktok-analytics/fetch-group") {
      if (tiktokAnalytics.isRunning()) return sendJson(res, 409, { error: "TikTok 数据抓取任务正在执行。" });
      const payload = await readJsonBody(req);
      const profileId = String(payload.profileId || "").trim();
      const groupNames = Array.isArray(payload.groupNames)
        ? payload.groupNames.map((item) => String(item).trim()).filter(Boolean)
        : [String(payload.groupName || "").trim()].filter(Boolean);
      if (!profileId) return sendJson(res, 400, { error: "???? GeeLark ???" });
      if (!groupNames.length) return sendJson(res, 400, { error: "????????????????" });
      if (session.user.role !== "admin" && profileId !== session.user.geelarkProfileId) {
        return sendJson(res, 403, { error: "????????????? GeeLark ???" });
      }
      let accounts = [];
      if (session.user.role === "admin") {
        accounts = await getCurrentGeeLarkAccounts(groupNames, profileId);
      } else {
        const allowedGroups = new Set((session.user.allowedGeeLarkGroups || []).map((item) => String(item).trim()).filter(Boolean));
        const unauthorizedGroup = groupNames.find((groupName) => !allowedGroups.has(groupName));
        if (unauthorizedGroup) return sendJson(res, 403, { error: "??????? GeeLark ????????" });
        accounts = (await getAuthorizedGeeLarkPhones(session.user))
          .filter((phone) => groupNames.includes(String(phone.groupName || "").trim()))
          .map((phone) => String(phone.name || phone.remark || "").trim())
          .filter(Boolean);
      }
      if (!accounts.length) return sendJson(res, 400, { error: "??????????????" });
      void tiktokAnalytics.fetchAccounts(accounts).catch((error) => console.error("TikTok analytics fetch failed:", error));
      return sendJson(res, 202, { ok: true, profileId, groupNames, accountCount: accounts.length });
    }

    if (req.method === "POST" && url.pathname === "/api/tiktok-analytics/fetch-all") {
      return sendJson(res, 410, { error: "全账号抓取已关闭，请选择账号组后抓取。" });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/publish-records\/[^/]+\/retry$/)) {
      const recordId = decodeURIComponent(url.pathname.split("/")[3]);
      const payload = await readJsonBody(req);
      const record = readPublishRecords().find((entry) => String(entry.id) === String(recordId));
      if (!canAccessPublishRecord(session.user, record)) return sendJson(res, 403, { error: "无权重新执行此发布记录。" });
      if (session.user.role !== "admin") {
        delete payload.envId;
        delete payload.accountName;
      }
      const result = await publishService.retryRecord(recordId, payload);
      return sendJson(res, 200, result);
    }

    if (req.method === "GET" && url.pathname === "/api/asset-groups") {
      const groups = getConfiguredAssetGroups();
      return sendJson(res, 200, { groups, usage: readUsage(root) });
    }

    if (req.method === "GET" && url.pathname === "/api/asset-usage") {
      const groups = getConfiguredAssetGroups();
      return sendJson(res, 200, getAssetUsageDashboard(root, String(url.searchParams.get("groupId") || ""), {
        groupIds: groups.map((group) => group.id)
      }));
    }

    if (req.method === "GET" && url.pathname === "/api/asset-library-root") {
      return sendJson(res, 200, { libraryRoot: String(readConfig(root).assetLibraryRoot || "F:/视频素材") });
    }

    if (req.method === "POST" && url.pathname === "/api/asset-library-root/sync") {
      const payload = await readJsonBody(req);
      const libraryRoot = String(payload.libraryRoot || "").trim();
      if (!libraryRoot) return sendJson(res, 400, { error: "请选择素材总库目录。" });
      const jobId = safeId(`asset-root-sync-${Date.now()}`);
      const payloadPath = path.join(jobsDir, `${jobId}.payload.json`);
      const jobPath = path.join(jobsDir, `${jobId}.json`);
      fs.writeFileSync(payloadPath, JSON.stringify({ jobId, libraryRoot }, null, 2), "utf8");
      writeJob(jobPath, { jobId, status: "queued", percent: 1, message: "素材总库同步任务已加入队列。", createdAt: Date.now() });
      const child = spawn(process.execPath, [path.join(root, "scripts", "asset-root-sync-job.js"), payloadPath, jobPath], {
        cwd: root, detached: false, stdio: "ignore", windowsHide: true
      });
      patchJob(jobPath, { workerPid: child.pid, status: "running", message: "正在扫描素材总库...", updatedAt: Date.now() });
      child.unref();
      return sendJson(res, 200, { jobId });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/asset-library-root/sync/progress/")) {
      const jobId = safeId(decodeURIComponent(url.pathname.slice("/api/asset-library-root/sync/progress/".length)));
      const jobPath = path.join(jobsDir, `${jobId}.json`);
      if (!fs.existsSync(jobPath)) return sendJson(res, 404, { error: "素材总库同步任务不存在。" });
      return sendJson(res, 200, readJob(jobPath));
    }

    if (req.method === "POST" && url.pathname === "/api/asset-usage/reindex/start") {
      const payload = await readJsonBody(req);
      const groupId = String(payload.groupId || "").trim();
      getAssetGroup(root, groupId);
      const jobId = safeId(`asset-index-${groupId}-${Date.now()}`);
      const payloadPath = path.join(jobsDir, `${jobId}.payload.json`);
      const jobPath = path.join(jobsDir, `${jobId}.json`);
      fs.writeFileSync(payloadPath, JSON.stringify({ jobId, groupId }, null, 2), "utf8");
      writeJob(jobPath, {
        jobId,
        status: "queued",
        percent: 1,
        message: "素材索引任务已加入队列。",
        createdAt: Date.now()
      });
      const child = spawn(process.execPath, [path.join(root, "scripts", "asset-index-job.js"), payloadPath, jobPath], {
        cwd: root,
        detached: false,
        stdio: "ignore",
        windowsHide: true
      });
      patchJob(jobPath, { workerPid: child.pid, status: "running", message: "正在扫描素材目录...", updatedAt: Date.now() });
      child.unref();
      return sendJson(res, 200, { jobId });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/asset-usage/reindex/progress/")) {
      const jobId = safeId(decodeURIComponent(url.pathname.slice("/api/asset-usage/reindex/progress/".length)));
      const jobPath = path.join(jobsDir, `${jobId}.json`);
      if (!fs.existsSync(jobPath)) return sendJson(res, 404, { error: "素材索引任务不存在。" });
      return sendJson(res, 200, readJob(jobPath));
    }

    if (req.method === "POST" && url.pathname === "/api/select-directory") {
      const payload = await readJsonBody(req);
      const selectedPath = await openDirectoryDialog({
        initialPath: session.user.role === "admin" ? payload.initialPath : (session.user.allowedDirectory || payload.initialPath),
        title: payload.title
      });
      if (selectedPath && session.user.role !== "admin" && !isPathInside(selectedPath, session.user.allowedDirectory)) {
        return sendJson(res, 403, { error: "当前账号只能选择管理员分配的共享目录及其子文件夹。" });
      }
      return sendJson(res, 200, { canceled: !selectedPath, path: selectedPath || "" });
    }

    if (req.method === "GET" && url.pathname === "/api/shared-libraries") {
      const libraryRoot = String(session.user.allowedDirectory || "").trim();
      if (!libraryRoot) return sendJson(res, 200, { configured: false, root: "", libraries: [] });
      if (!fs.existsSync(libraryRoot)) return sendJson(res, 200, { configured: false, root: libraryRoot, libraries: [], error: "共享素材目录当前无法访问。" });
      const libraries = [{ name: "共享目录根目录", path: libraryRoot }, ...fs.readdirSync(libraryRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => ({ name: entry.name, path: path.join(libraryRoot, entry.name) }))
        .sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"))];
      return sendJson(res, 200, { configured: true, root: libraryRoot, libraries });
    }

    if (req.method === "GET" && url.pathname === "/api/geelark/phones") {
      const config = resolveGeeLarkConfig(session.user.geelarkProfileId);
      const client = createGeeLarkClient({ geelark: config });
      if (!client.isConfigured()) return sendJson(res, 200, { configured: false, phones: [] });
      const phones = await getAuthorizedGeeLarkPhones(session.user);
      return sendJson(res, 200, { configured: true, phones });
    }

    if (req.method === "POST" && url.pathname === "/api/geelark/publish") {
      const payload = await readJsonBody(req);
      payload.geelarkProfileId = session.user.geelarkProfileId;
      payload.ownerUserId = session.user.id;
      const result = await publishService.publishBatch(payload, {
        batchId: payload.batchId || `manual-${Date.now()}`,
        retryDelayMs: 2 * 60 * 1000,
        autoRetry: true
      });
      return sendJson(res, 200, result);
    }

    if (req.method === "GET" && url.pathname === "/api/geelark/safety") {
      return sendJson(res, 200, publishService.getSafetySummary());
    }

    if (req.method === "GET" && url.pathname === "/api/psychology/settings") {
      const settings = readPsychologySettings();
      return sendJson(res, 200, {
        configured: Boolean(settings.kieApiKey && settings.elevenLabsApiKey && settings.elevenLabsVoiceId),
        kieConfigured: Boolean(settings.kieApiKey),
        elevenLabsConfigured: Boolean(settings.elevenLabsApiKey),
        elevenLabsVoiceId: settings.elevenLabsVoiceId,
        elevenLabsModelId: settings.elevenLabsModelId,
        imageModels: settings.imageModels,
        totalVideos: settings.totalVideos,
        aspectRatio: settings.aspectRatio || "16:9",
        titlePosition: settings.titlePosition,
        titleFontSize: settings.titleFontSize,
        motion: settings.motion,
    backgroundMusicDir: settings.backgroundMusicDir || "",
    backgroundMusicVolume: Number(settings.backgroundMusicVolume ?? 0.10)
      });
    }

    if (req.method === "POST" && url.pathname === "/api/psychology/settings") {
      return sendJson(res, 200, { ok: true, settings: publicPsychologySettings(savePsychologySettings(await readJsonBody(req))) });
    }
    if (req.method === "POST" && url.pathname === "/api/schulte/start") {
      const payload = await readJsonBody(req);
      payload.template = ["wheel", "tracking", "memory", "peripheral"].includes(payload.template)
        ? payload.template
        : "wheel";
      payload.backgroundMusicMode = ["local", "built-in", "off"].includes(payload.backgroundMusicMode)
        ? payload.backgroundMusicMode
        : (String(payload.backgroundMusicDir || "").trim() ? "local" : "built-in");
      payload.backgroundMusicEnabled = payload.backgroundMusicEnabled !== false;
      payload.backgroundMusicDir = String(payload.backgroundMusicDir || "").trim();
      payload.backgroundMusicVolume = Math.max(
        0,
        Math.min(1, Number.isFinite(Number(payload.backgroundMusicVolume)) ? Number(payload.backgroundMusicVolume) : 0.35)
      );
      payload.trainingMode = ["auto", "sequence", "reverse", "missing", "duplicate"].includes(payload.trainingMode)
        ? payload.trainingMode
        : "auto";
      payload.layoutStyle = ["auto", "classic", "balanced", "focus"].includes(payload.layoutStyle)
        ? payload.layoutStyle
        : "auto";
      payload.backgroundStyle = ["auto", "mint", "sky", "lavender", "peach", "paper"].includes(payload.backgroundStyle)
        ? payload.backgroundStyle
        : "auto";
      payload.trackingMode = ["auto", "single", "dual", "triple"].includes(payload.trackingMode)
        ? payload.trackingMode
        : "auto";
      payload.trackingBackground = ["auto", "forest", "navy", "violet", "graphite", "amber"].includes(payload.trackingBackground)
        ? payload.trackingBackground
        : "auto";
      if (payload.backgroundMusicMode === "local" && !payload.backgroundMusicDir) {
        return sendJson(res, 400, { error: "请选择本地背景音乐文件夹，或改用内置音乐。" });
      }
      if (payload.template === "tracking") {
        payload.trackingSeconds = Math.max(10, Math.min(90, Number(payload.trackingSeconds) || 30));
        payload.ballSpeed = Math.max(0.5, Math.min(3, Number(payload.ballSpeed) || 1));
        payload.durationSeconds = payload.trackingSeconds + 7;
        payload.trainingStartsAt = 3;
      } else if (payload.template === "memory") {
        payload.memorySteps = Math.max(4, Math.min(8, Math.round(Number(payload.memorySteps) || 6)));
        payload.durationSeconds = 16;
      } else if (payload.template === "peripheral") {
        payload.peripheralTargets = Math.max(2, Math.min(5, Math.round(Number(payload.peripheralTargets) || 3)));
        payload.durationSeconds = 16;
      } else {
        const durationSeconds = Math.max(12, Math.min(180, Number(payload.durationSeconds) || 32));
        const trainingStartsAt = Math.max(3, Math.min(20, Number(payload.trainingStartsAt) || 4));
        const instructionStartsAt = Math.max(1, Math.min(10, Number(payload.instructionStartsAt) || 2));
        payload.rotationSpeed = Math.max(0.25, Math.min(3, Number(payload.rotationSpeed) || 2.5));
        payload.trainingStartsAt = trainingStartsAt;
        payload.instructionStartsAt = instructionStartsAt;
        if (instructionStartsAt >= trainingStartsAt - 0.5) {
          return sendJson(res, 400, { error: "提示出现时间至少要比计时开始早 0.5 秒。" });
        }
        if (trainingStartsAt >= durationSeconds - 2) {
          return sendJson(res, 400, { error: "计时开始时间必须早于视频结束时间。" });
        }
      }

      const jobId = safeId(`schulte-${Date.now()}`);
      const payloadPath = path.join(jobsDir, `${jobId}.payload.json`);
      const jobPath = path.join(jobsDir, `${jobId}.json`);
      fs.writeFileSync(payloadPath, JSON.stringify({ ...payload, jobId }, null, 2), "utf8");
      writeJob(jobPath, {
        jobId,
        type: "schulte",
        status: "queued",
        percent: 2,
        message: "舒尔特训练任务已加入生成队列。",
        createdAt: Date.now()
      });

      const child = spawn(process.execPath, [path.join(root, "scripts", "schulte-render-job.js"), payloadPath, jobPath], {
        cwd: root,
        detached: false,
        stdio: "ignore",
        windowsHide: true
      });
      patchJob(jobPath, {
        workerPid: child.pid,
        message: "舒尔特训练任务已启动。",
        updatedAt: Date.now()
      });
      child.unref();

      return sendJson(res, 200, { jobId });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/schulte/progress/")) {
      const jobId = safeId(decodeURIComponent(url.pathname.slice("/api/schulte/progress/".length)));
      const jobPath = path.join(jobsDir, `${jobId}.json`);
      if (!fs.existsSync(jobPath)) return sendJson(res, 404, { error: "舒尔特训练任务不存在。" });
      return sendJson(res, 200, readJobWithEstimate(jobPath));
    }

    if (req.method === "GET" && url.pathname === "/api/auto-tasks") {
      const includeDeleted = session.user.role === "admin" && url.searchParams.get("includeDeleted") === "1";
      return sendJson(res, 200, { tasks: filterTasksForUser(autoTaskManager.listTasks({ includeDeleted }), session.user), worker: autoTaskManager.getStatus() });
    }

    if (req.method === "POST" && url.pathname === "/api/auto-tasks") {
      const payload = await readJsonBody(req);
      if (payload.taskType === "psychology") {
        const settings = readPsychologySettings();
        if (!settings.kieApiKey || !settings.elevenLabsApiKey || !settings.elevenLabsVoiceId) {
          return sendJson(res, 400, { error: "请先在心理学视频页面完成 Kie、ElevenLabs 和 Voice ID 配置。" });
        }
        payload.generation = {
          ...publicPsychologySettings(settings),
          ...(payload.generation || {}),
          elevenLabsVoiceId: String(payload.generation?.elevenLabsVoiceId || settings.elevenLabsVoiceId || "")
        };
      }
      if (session.user.role !== "admin") {
        const generation = payload.generation || {};
        if (String(generation.assetGroupId || "").trim()) return sendJson(res, 403, { error: "成员账号只能使用分配的共享素材库，不能使用管理员素材组。" });
        for (const directory of [generation.videoDir, generation.audioDir, generation.backgroundMusicDir].filter(Boolean)) {
          if (!isPathInside(directory, session.user.allowedDirectory)) return sendJson(res, 403, { error: "任务目录必须位于管理员分配的共享素材目录内。" });
        }
        if (payload.publish?.autoPublish !== false) {
          const authorizedPhones = await getAuthorizedGeeLarkPhones(session.user);
          const authorizedById = new Map(authorizedPhones.map((phone) => [String(phone.id), phone]));
          const envIds = Array.from(new Set((payload.publish?.envIds || []).map(String).filter(Boolean)));
          const unauthorizedIds = envIds.filter((envId) => !authorizedById.has(envId));
          if (unauthorizedIds.length) {
            return sendJson(res, 403, { error: "任务中包含未授权的 GeeLark 账号，请刷新账号列表后重新选择。" });
          }
          payload.publish.accounts = envIds.map((envId) => {
            const phone = authorizedById.get(envId);
            return { id: envId, name: phone.serialName || "", serialNo: phone.serialNo || "", groupName: phone.groupName || "", remark: phone.remark || "" };
          });
        }
      }
      payload.ownerUserId = session.user.id;
      payload.geelarkProfileId = session.user.geelarkProfileId;
      payload.publish = { ...(payload.publish || {}), ownerUserId: session.user.id, geelarkProfileId: session.user.geelarkProfileId };
      return sendJson(res, 201, { task: autoTaskManager.createTask(payload) });
    }

    if (req.method === "PATCH" && url.pathname.match(/^\/api\/auto-tasks\/[^/]+$/)) {
      const taskId = safeId(decodeURIComponent(url.pathname.split("/")[3]));
      const task = autoTaskManager.getTask(taskId);
      if (!canAccessTask(session.user, task)) return sendJson(res, 403, { error: "无权修改此任务。" });
      const payload = await readJsonBody(req);
      return sendJson(res, 200, { task: autoTaskManager.renameTask(taskId, payload.name) });
    }
    if (req.method === "DELETE" && url.pathname.match(/^\/api\/auto-tasks\/[^/]+$/)) {
      if (session.user.role !== "admin") return sendJson(res, 403, { error: "仅管理员可隐藏任务。" });
      const taskId = safeId(decodeURIComponent(url.pathname.split("/")[3]));
      return sendJson(res, 200, { task: autoTaskManager.archiveTask(taskId, session.user.id) });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/auto-tasks/")) {
      const taskId = safeId(decodeURIComponent(url.pathname.slice("/api/auto-tasks/".length)));
      const task = autoTaskManager.getTask(taskId);
      if (!canAccessTask(session.user, task)) return sendJson(res, 403, { error: "无权查看此任务。" });
      return sendJson(res, 200, { task });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/auto-tasks\/[^/]+\/cancel$/)) {
      const taskId = safeId(decodeURIComponent(url.pathname.split("/")[3]));
      if (!canAccessTask(session.user, autoTaskManager.getTask(taskId))) return sendJson(res, 403, { error: "无权操作此任务。" });
      return sendJson(res, 200, { task: autoTaskManager.cancelTask(taskId) });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/auto-tasks\/[^/]+\/resume$/)) {
      const taskId = safeId(decodeURIComponent(url.pathname.split("/")[3]));
      if (!canAccessTask(session.user, autoTaskManager.getTask(taskId))) return sendJson(res, 403, { error: "无权操作此任务。" });
      return sendJson(res, 200, { task: autoTaskManager.resumeTask(taskId) });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/auto-tasks\/[^/]+\/retry-publish$/)) {
      const taskId = safeId(decodeURIComponent(url.pathname.split("/")[3]));
      if (!canAccessTask(session.user, autoTaskManager.getTask(taskId))) return sendJson(res, 403, { error: "无权操作此任务。" });
      const payload = await readJsonBody(req);
      const result = await autoTaskManager.retryPublishRecord(taskId, String(payload.recordId || ""), payload);
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/api/generate/start") {
      const payload = await readJsonBody(req);
      const text = String(payload.text || "").trim();
      const hasUploadedAudio = Boolean(payload.audioBase64 && payload.audioName);
      const hasAudioUrl = Boolean(String(payload.audioUrl || "").trim());
      const audioLibraryPath = payload.audioLibraryId ? audioLibrary.resolveAudioPath(payload.audioLibraryId) : "";
      if (payload.audioLibraryId && !audioLibraryPath) return sendJson(res, 404, { error: "音频素材库中的文件不存在。" });
      if (!hasUploadedAudio && !hasAudioUrl && !audioLibraryPath && !text) {
        return sendJson(res, 400, { error: "请输入配音文案、上传音频，或填写音频链接。" });
      }

      const jobId = safeId(`${payload.id || timestampId()}-${Date.now()}`);
      const payloadPath = path.join(jobsDir, `${jobId}.payload.json`);
      const jobPath = path.join(jobsDir, `${jobId}.json`);

      const jobPayload = { ...payload, jobId };
      if (audioLibraryPath) {
        jobPayload.audioLibraryPath = audioLibraryPath;
        jobPayload.audioName = audioLibrary.get(payload.audioLibraryId)?.fileName || path.basename(audioLibraryPath);
        jobPayload.autoTts = false;
      } else {
        delete jobPayload.audioLibraryPath;
      }
      fs.writeFileSync(payloadPath, JSON.stringify(jobPayload, null, 2), "utf8");
      writeJob(jobPath, {
        jobId,
        status: "queued",
        percent: 1,
        message: "宸插姞鍏ョ敓鎴愰槦鍒?..",
        template: payload.template || "player",
        createdAt: Date.now()
      });

      const child = spawn(process.execPath, [path.join(root, "scripts", "render-job.js"), payloadPath, jobPath], {
        cwd: root,
        detached: false,
        stdio: "ignore",
        windowsHide: true
      });
      patchJob(jobPath, {
        workerPid: child.pid,
        message: "Generation started.",
        updatedAt: Date.now()
      });
      child.unref();

      return sendJson(res, 200, { jobId });
    }

    if (req.method === "POST" && url.pathname === "/api/reddit-mix/start") {
      const payload = await readJsonBody(req);
      if (!String(payload.audioDir || "").trim()) return sendJson(res, 400, { error: "请输入音频文件夹路径。" });
      if (!String(payload.videoDir || "").trim() && !String(payload.assetGroupId || "").trim()) {
        return sendJson(res, 400, { error: "请选择素材组或视频素材目录。" });
      }

      const jobId = safeId(`reddit-mix-${Date.now()}`);
      const payloadPath = path.join(jobsDir, `${jobId}.payload.json`);
      const jobPath = path.join(jobsDir, `${jobId}.json`);

      fs.writeFileSync(payloadPath, JSON.stringify({ ...payload, jobId }, null, 2), "utf8");
      writeJob(jobPath, {
        jobId,
        status: "queued",
        percent: 1,
        message: "Reddit 混剪任务已加入队列。",
        createdAt: Date.now()
      });

      const child = spawn(process.execPath, [path.join(root, "scripts", "reddit-mix-job.js"), payloadPath, jobPath], {
        cwd: root,
        detached: false,
        stdio: "ignore",
        windowsHide: true
      });
      patchJob(jobPath, {
        workerPid: child.pid,
        message: "Reddit 混剪已开始。",
        updatedAt: Date.now()
      });
      child.unref();

      return sendJson(res, 200, { jobId });
    }

    if (req.method === "POST" && url.pathname === "/api/asset-groups/preprocess/start") {
      const payload = await readJsonBody(req);
      if (!String(payload.inputDir || "").trim()) return sendJson(res, 400, { error: "请输入输入素材文件夹路径。" });
      if (String(payload.mode || "cut") === "cut" && !String(payload.outputDir || "").trim()) {
        return sendJson(res, 400, { error: "请输入输出素材组文件夹路径。" });
      }

      const jobId = safeId(`asset-preprocess-${Date.now()}`);
      const payloadPath = path.join(jobsDir, `${jobId}.payload.json`);
      const jobPath = path.join(jobsDir, `${jobId}.json`);

      fs.writeFileSync(payloadPath, JSON.stringify({ ...payload, jobId }, null, 2), "utf8");
      writeJob(jobPath, {
        jobId,
        status: "queued",
        percent: 1,
        message: "素材组任务已加入队列。",
        createdAt: Date.now()
      });

      const child = spawn(process.execPath, [path.join(root, "scripts", "asset-preprocess-job.js"), payloadPath, jobPath], {
        cwd: root,
        detached: false,
        stdio: "ignore",
        windowsHide: true
      });
      patchJob(jobPath, {
        workerPid: child.pid,
        message: "素材组任务已开始。",
        updatedAt: Date.now()
      });
      child.unref();

      return sendJson(res, 200, { jobId });
    }

    if (req.method === "POST" && url.pathname === "/api/folder-classify/start") {
      const payload = await readJsonBody(req);
      if (!String(payload.sourceDir || "").trim()) return sendJson(res, 400, { error: "Please select a source folder." });
      if (!String(payload.saveDir || "").trim()) return sendJson(res, 400, { error: "Please select a save folder." });

      const jobId = safeId(`folder-classify-${Date.now()}`);
      const payloadPath = path.join(jobsDir, `${jobId}.payload.json`);
      const jobPath = path.join(jobsDir, `${jobId}.json`);

      fs.writeFileSync(payloadPath, JSON.stringify({ ...payload, jobId }, null, 2), "utf8");
      writeJob(jobPath, {
        jobId,
        status: "queued",
        percent: 1,
        message: "Folder classify queued.",
        createdAt: Date.now()
      });

      const child = spawn(process.execPath, [path.join(root, "scripts", "folder-classify-job.js"), payloadPath, jobPath], {
        cwd: root,
        detached: false,
        stdio: "ignore",
        windowsHide: true
      });
      patchJob(jobPath, {
        workerPid: child.pid,
        message: "Folder classify started.",
        updatedAt: Date.now()
      });
      child.unref();

      return sendJson(res, 200, { jobId });
    }

    if (req.method === "POST" && url.pathname === "/api/images/unsplash/start") {
      const payload = await readJsonBody(req);
      if (!String(payload.accessKey || "").trim()) return sendJson(res, 400, { error: "Please enter an Unsplash Access Key." });
      if (!String(payload.keywords || "").trim()) return sendJson(res, 400, { error: "Please enter keywords." });
      if (!String(payload.outputDir || "").trim()) return sendJson(res, 400, { error: "Please enter an output folder." });

      const jobId = safeId(`unsplash-images-${Date.now()}`);
      const payloadPath = path.join(jobsDir, `${jobId}.payload.json`);
      const jobPath = path.join(jobsDir, `${jobId}.json`);

      fs.writeFileSync(payloadPath, JSON.stringify({ ...payload, jobId }, null, 2), "utf8");
      writeJob(jobPath, {
        jobId,
        status: "queued",
        percent: 1,
        message: "Unsplash image download queued.",
        createdAt: Date.now()
      });

      const child = spawn(process.execPath, [path.join(root, "scripts", "unsplash-image-job.js"), payloadPath, jobPath], {
        cwd: root,
        detached: false,
        stdio: "ignore",
        windowsHide: true
      });
      patchJob(jobPath, {
        workerPid: child.pid,
        message: "Unsplash image download started.",
        updatedAt: Date.now()
      });
      child.unref();

      return sendJson(res, 200, { jobId });
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/generate/cancel/")) {
      const jobId = safeId(decodeURIComponent(url.pathname.slice("/api/generate/cancel/".length)));
      const jobPath = path.join(jobsDir, `${jobId}.json`);
      if (!fs.existsSync(jobPath)) return sendJson(res, 404, { error: "任务不存在。" });

      const job = readJob(jobPath);
      if (job.workerPid) {
        killProcessTree(job.workerPid);
      }
      patchJob(jobPath, {
        status: "canceled",
        percent: 100,
        message: "已停止生成。",
        updatedAt: Date.now()
      });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/reddit-mix/cancel/")) {
      const jobId = safeId(decodeURIComponent(url.pathname.slice("/api/reddit-mix/cancel/".length)));
      const jobPath = path.join(jobsDir, `${jobId}.json`);
      if (!fs.existsSync(jobPath)) return sendJson(res, 404, { error: "任务不存在。" });

      const job = readJob(jobPath);
      if (job.workerPid) killProcessTree(job.workerPid);
      patchJob(jobPath, {
        status: "canceled",
        percent: 100,
        message: "Reddit 混剪已停止。",
        updatedAt: Date.now()
      });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/asset-groups/preprocess/cancel/")) {
      const jobId = safeId(decodeURIComponent(url.pathname.slice("/api/asset-groups/preprocess/cancel/".length)));
      const jobPath = path.join(jobsDir, `${jobId}.json`);
      if (!fs.existsSync(jobPath)) return sendJson(res, 404, { error: "任务不存在。" });

      const job = readJob(jobPath);
      if (job.workerPid) killProcessTree(job.workerPid);
      patchJob(jobPath, {
        status: "canceled",
        percent: 100,
        message: "素材组任务已停止。",
        updatedAt: Date.now()
      });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/folder-classify/cancel/")) {
      const jobId = safeId(decodeURIComponent(url.pathname.slice("/api/folder-classify/cancel/".length)));
      const jobPath = path.join(jobsDir, `${jobId}.json`);
      if (!fs.existsSync(jobPath)) return sendJson(res, 404, { error: "Job not found." });

      const job = readJob(jobPath);
      if (job.workerPid) killProcessTree(job.workerPid);
      patchJob(jobPath, {
        status: "canceled",
        percent: 100,
        message: "Folder classify canceled.",
        updatedAt: Date.now()
      });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/images/unsplash/cancel/")) {
      const jobId = safeId(decodeURIComponent(url.pathname.slice("/api/images/unsplash/cancel/".length)));
      const jobPath = path.join(jobsDir, `${jobId}.json`);
      if (!fs.existsSync(jobPath)) return sendJson(res, 404, { error: "Job not found." });

      const job = readJob(jobPath);
      if (job.workerPid) killProcessTree(job.workerPid);
      patchJob(jobPath, {
        status: "canceled",
        cancelRequested: true,
        percent: 100,
        message: "Unsplash image download canceled.",
        updatedAt: Date.now()
      });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/generate/progress/")) {
      const jobId = safeId(decodeURIComponent(url.pathname.slice("/api/generate/progress/".length)));
      const jobPath = path.join(jobsDir, `${jobId}.json`);
      if (!fs.existsSync(jobPath)) return sendJson(res, 404, { error: "任务不存在。" });
      return sendJson(res, 200, readJobWithEstimate(jobPath));
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/reddit-mix/progress/")) {
      const jobId = safeId(decodeURIComponent(url.pathname.slice("/api/reddit-mix/progress/".length)));
      const jobPath = path.join(jobsDir, `${jobId}.json`);
      if (!fs.existsSync(jobPath)) return sendJson(res, 404, { error: "任务不存在。" });
      return sendJson(res, 200, readJob(jobPath));
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/asset-groups/preprocess/progress/")) {
      const jobId = safeId(decodeURIComponent(url.pathname.slice("/api/asset-groups/preprocess/progress/".length)));
      const jobPath = path.join(jobsDir, `${jobId}.json`);
      if (!fs.existsSync(jobPath)) return sendJson(res, 404, { error: "任务不存在。" });
      return sendJson(res, 200, readJob(jobPath));
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/folder-classify/progress/")) {
      const jobId = safeId(decodeURIComponent(url.pathname.slice("/api/folder-classify/progress/".length)));
      const jobPath = path.join(jobsDir, `${jobId}.json`);
      if (!fs.existsSync(jobPath)) return sendJson(res, 404, { error: "Job not found." });
      return sendJson(res, 200, readJob(jobPath));
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/images/unsplash/progress/")) {
      const jobId = safeId(decodeURIComponent(url.pathname.slice("/api/images/unsplash/progress/".length)));
      const jobPath = path.join(jobsDir, `${jobId}.json`);
      if (!fs.existsSync(jobPath)) return sendJson(res, 404, { error: "Job not found." });
      return sendJson(res, 200, readJob(jobPath));
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      const payload = await readJsonBody(req);
      const result = await generateImmediately(payload);
      return sendJson(res, 200, result);
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || "生成失败。" });
  }
});

server.listen(port, () => {
  console.log(`Podcast video maker is running: http://localhost:${port}`);
});

function getConfiguredAssetGroups() {
  const libraryRoot = String(readConfig(root).assetLibraryRoot || "").trim();
  const discovered = discoverAssetLibraryGroups(root, libraryRoot);
  if (!discovered.length) return listAssetGroups(root);
  const allowedIds = new Set(discovered.map((group) => group.id));
  return listAssetGroups(root).filter((group) => allowedIds.has(group.id));
}

async function getCurrentGeeLarkPhones(profileIds = tiktokAnalytics.getSettings().profileIds) {
  const selectedProfileIds = Array.from(new Set((profileIds || []).map((item) => String(item).trim()).filter(Boolean)));
  const phonesByProfile = await Promise.all(selectedProfileIds.map(async (profileId) => {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const phones = await listGeeLarkPhonesForProfile(profileId);
        return phones.map((phone) => ({ ...phone, profileId }));
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    throw lastError;
  }));
  const selectedPhones = phonesByProfile.flat();
  return Array.from(new Map(selectedPhones.filter((phone) => phone.id).map((phone) => [`${phone.profileId}:${phone.id}`, phone])).values());

  const config = readConfig(root);
  const client = createGeeLarkClient(config);
  if (!client.isConfigured()) throw new Error("GeeLark API 未配置，无法读取当前账号组。");
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const phones = [];
      for (let page = 1; page <= 20; page++) {
        const data = await client.listPhones({ page, pageSize: 100 });
        const batch = normalizeGeeLarkList(data);
        phones.push(...batch);
        if (batch.length < 100) break;
      }
      return Array.from(new Map(phones.map((phone) => [String(phone.id || phone.serialName), phone])).values());
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw lastError || new Error("读取 GeeLark 当前账号组失败。");
}

async function getCurrentGeeLarkAccounts(groupNames = [], profileId = "") {
  const selectedGroups = new Set((Array.isArray(groupNames) ? groupNames : [groupNames]).map((item) => String(item).trim()).filter(Boolean));
  const phones = await getCurrentGeeLarkPhones(profileId ? [profileId] : undefined);
  return Array.from(new Set(phones
    .filter((phone) => !selectedGroups.size || selectedGroups.has(String(phone.groupName || "").trim()))
    .map((phone) => String(phone.serialName || "").trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

async function getScheduledTikTokAccounts() {
  const groups = tiktokAnalytics.getSettings().groups || [];
  const phones = await getCurrentGeeLarkPhones();
  const selectedGroups = new Set(groups);
  return Array.from(new Set(phones
    .filter((phone) => selectedGroups.has(String(phone.groupName || "").trim()))
    .map((phone) => String(phone.serialName || "").trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean)));
}

async function getScheduledTikTokAccountsCached() {
  if (scheduledAccountsCache.accounts && scheduledAccountsCache.expiresAt > Date.now()) {
    return scheduledAccountsCache.accounts;
  }
  try {
    const accounts = await getScheduledTikTokAccounts();
    scheduledAccountsCache = { expiresAt: Date.now() + 5 * 60 * 1000, accounts };
    return accounts;
  } catch (error) {
    console.warn("Unable to refresh configured TikTok accounts:", error.message || error);
    return scheduledAccountsCache.accounts;
  }
}

async function getAnalyticsAllowedAccounts(user, publishRecords = null) {
  if (user?.role !== "admin") {
    const phones = await getAuthorizedGeeLarkPhones(user);
    return Array.from(new Set(phones
      .map((phone) => String(phone.serialName || "").trim().replace(/^@/, "").toLowerCase())
      .filter(Boolean)));
  }
  const configuredGroups = user.role === "admin"
    ? new Set((tiktokAnalytics.getSettings().groups || []).map((group) => String(group).trim()).filter(Boolean))
    : new Set((user.allowedGeeLarkGroups || []).map((group) => String(group).trim()).filter(Boolean));
  const records = (publishRecords || readPublishRecords()).filter((record) => {
    if (!configuredGroups.has(String(record.groupName || "").trim())) return false;
    return user.role === "admin" || canAccessPublishRecord(user, record);
  });
  return Array.from(new Set(records
    .map((record) => String(record.accountName || "").trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean)));
}

function resolveAnalyticsProfileId(user, requestedProfileId = "") {
  const requested = String(requestedProfileId || "").trim();
  if (user?.role === "admin") return requested;
  const assigned = String(user?.geelarkProfileId || "default").trim() || "default";
  return assigned;
}

function normalizeOutputId(value) {
  const fileName = path.basename(String(value || ""));
  return path.basename(fileName, path.extname(fileName)).toLowerCase();
}

async function generateImmediately(payload) {
  const title = String(payload.title || "").trim();
  const text = String(payload.text || "").trim();
  const hasUploadedAudio = Boolean(payload.audioBase64 && payload.audioName);
  const hasAudioUrl = Boolean(String(payload.audioUrl || "").trim());
  if (!hasUploadedAudio && !hasAudioUrl && !text) {
    throw new Error("请输入配音文案、上传音频，或填写音频链接。");
  }

  const id = safeId(payload.id || timestampId());
  const config = readConfig(root);
  const renderConfig = applyAspect(config, payload.aspect);
  let audioPath = null;
  let backgroundPath = null;

  if (payload.backgroundBase64 && payload.backgroundName) {
    const ext = safeImageExtension(payload.backgroundName);
    backgroundPath = path.join(workDir, `${id}.background${ext}`);
    fs.writeFileSync(backgroundPath, Buffer.from(payload.backgroundBase64, "base64"));
  }

  if (hasUploadedAudio) {
    const ext = safeAudioExtension(payload.audioName);
    audioPath = path.join(workDir, `${id}${ext}`);
    fs.writeFileSync(audioPath, Buffer.from(payload.audioBase64, "base64"));
  } else if (hasAudioUrl) {
    audioPath = await downloadAudioUrl(payload.audioUrl, workDir, id, payload.audioName);
  } else if (payload.autoTts !== false) {
    audioPath = await synthesizeAudio({ id, text, payload, renderConfig });
  }

  const result = renderPodcastVideo({
    root,
    config: renderConfig,
    id,
    title,
    scriptText: text,
    audioPath,
    backgroundPath,
    backgroundColor: payload.backgroundColor,
    template: payload.template || "player",
    duration: Number(payload.duration) || renderConfig.defaultDuration
  });

  return {
    id: result.id,
    title: result.title,
    duration: result.duration,
    videoUrl: `/outputs/${encodeURIComponent(path.basename(result.outputPath))}`
  };
}

async function synthesizeAudio({ id, text, payload, renderConfig }) {
  if (payload.ttsProvider === "elevenlabs") {
    return synthesizeWithElevenLabs({
      id,
      text,
      apiKey: process.env.ELEVENLABS_API_KEY || renderConfig.elevenLabsApiKey,
      voiceId: payload.elevenLabsVoiceId || renderConfig.elevenLabsVoiceId,
      modelId: payload.elevenLabsModelId || renderConfig.elevenLabsModelId,
      outputFormat: payload.elevenLabsOutputFormat || renderConfig.elevenLabsOutputFormat
    });
  }

  return synthesizeSpeech({
    id,
    text,
    voiceName: renderConfig.ttsVoice,
    rate: renderConfig.ttsRate,
    volume: renderConfig.ttsVolume
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > 120 * 1024 * 1024) {
        req.destroy();
        reject(new Error("上传内容太大。"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("请求格式错误。"));
      }
    });
    req.on("error", reject);
  });
}

function openDirectoryDialog({ initialPath = "", title = "" } = {}) {
  return new Promise((resolve, reject) => {
    const safeInitialPath = String(initialPath || "").replace(/'/g, "''");
    const safeTitle = String(title || "Select folder").replace(/'/g, "''");
    const command = [
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;",
      "Add-Type -AssemblyName System.Windows.Forms;",
      "Add-Type -AssemblyName System.Drawing;",
      "$owner = New-Object System.Windows.Forms.Form;",
      "$owner.TopMost = $true;",
      "$owner.StartPosition = 'CenterScreen';",
      "$owner.Size = New-Object System.Drawing.Size(1,1);",
      "$owner.ShowInTaskbar = $false;",
      "$owner.WindowState = 'Minimized';",
      "$owner.Show();",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;",
      "$dialog.Description = '" + safeTitle + "';",
      "$dialog.ShowNewFolderButton = $true;",
      "$initialPath = '" + safeInitialPath + "';",
      "if ($initialPath -and [System.IO.Directory]::Exists($initialPath)) { $dialog.SelectedPath = $initialPath; }",
      "if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  Write-Output $dialog.SelectedPath;",
      "}",
      "$owner.Close();",
      "$owner.Dispose();"
    ].join(" ");

    const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-Command", command], {
      cwd: root,
      windowsHide: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || "Failed to open folder picker."));
        return;
      }
      resolve(stdout.trim());
    });
  });
}
function sendFile(res, filePath, contentType) {
  if (!fs.existsSync(filePath)) return sendJson(res, 404, { error: "File not found" });
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store, max-age=0"
  });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(value));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function sessionCookie(token) {
  return `lf_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;
}

function requiresLogin(pathname) {
  return !["/login", "/login.js", "/setup", "/setup.js", "/app.css", "/access.css"].includes(pathname);
}

function canAccessPage(user, pathname) {
  if (user.role === "admin") return true;
  return new Set(["/tasks", "/tasks.js", "/tasks.css", "/stats", "/stats.js", "/analytics", "/analytics.js", "/analytics.css", "/app.css", "/access.css", "/access.js"]).has(pathname) || pathname.startsWith("/outputs/");
}

function canAccessApi(user, pathname) {
  if (pathname.startsWith("/api/auth/")) return true;
  if (user.role === "admin") return true;
  return pathname === "/api/geelark/phones" || pathname === "/api/geelark/safety" || pathname === "/api/asset-groups" || pathname === "/api/shared-libraries" || pathname === "/api/reddit-mix/settings" || pathname === "/api/select-directory" || pathname === "/api/publish-records" || pathname === "/api/tiktok-analytics" || pathname === "/api/tiktok-analytics/account-details" || /^\/api\/tiktok-analytics\/videos\/[^/]+\/reuse$/.test(pathname) || /^\/api\/publish-records\/[^/]+\/retry$/.test(pathname) || pathname === "/api/auto-tasks" || /^\/api\/auto-tasks\/[^/]+(?:\/(?:cancel|resume|retry-publish))?$/.test(pathname);
}

function readPsychologySettings() {
  const base = {
    kieApiKey: String(process.env.KIE_API_KEY || bootConfig.kieApiKey || "").trim(),
    elevenLabsApiKey: String(process.env.ELEVENLABS_API_KEY || bootConfig.elevenLabsApiKey || "").trim(),
    elevenLabsVoiceId: String(bootConfig.elevenLabsVoiceId || "").trim(),
    elevenLabsModelId: String(bootConfig.elevenLabsModelId || "eleven_multilingual_v2"),
    imageModels: ["nano-banana"],
    totalVideos: 1,
    aspectRatio: "16:9",
    titlePosition: 14,
    titleFontSize: 68,
    motion: "test-motion",
    backgroundMusicDir: "",
    backgroundMusicVolume: 0.10
  };
  if (!fs.existsSync(psychologySettingsPath)) return base;
  try {
    const saved = JSON.parse(fs.readFileSync(psychologySettingsPath, "utf8"));
    return { ...base, ...saved };
  } catch {
    return base;
  }
}

function savePsychologySettings(payload = {}) {
  const current = readPsychologySettings();
  const imageModels = Array.isArray(payload.imageModels)
    ? payload.imageModels.filter((model) => model === "grok" || model === "nano-banana")
    : current.imageModels;
  const next = {
    ...current,
    ...(String(payload.kieApiKey || "").trim() ? { kieApiKey: String(payload.kieApiKey).trim() } : {}),
    ...(String(payload.elevenLabsApiKey || "").trim() ? { elevenLabsApiKey: String(payload.elevenLabsApiKey).trim() } : {}),
    elevenLabsVoiceId: String(payload.elevenLabsVoiceId ?? current.elevenLabsVoiceId).trim(),
    elevenLabsModelId: String(payload.elevenLabsModelId || current.elevenLabsModelId || "eleven_multilingual_v2"),
    imageModels: imageModels.length ? imageModels : ["nano-banana"],
    totalVideos: Math.max(1, Math.min(300, Math.floor(Number(payload.totalVideos) || current.totalVideos || 1))),
    aspectRatio: payload.aspectRatio === "16:9" ? "16:9" : (payload.aspectRatio === "9:16" ? "9:16" : (current.aspectRatio || "16:9")),
    titlePosition: clampNumber(payload.titlePosition, 8, 55, current.titlePosition || 14),
    titleFontSize: clampNumber(payload.titleFontSize, 42, 100, current.titleFontSize || 68),
    motion: ["none", "slow-zoom", "test-motion"].includes(payload.motion) ? payload.motion : (current.motion || "test-motion"),
    backgroundMusicDir: String(payload.backgroundMusicDir ?? current.backgroundMusicDir ?? "").trim(),
    backgroundMusicVolume: clampNumber(payload.backgroundMusicVolume, 0, 0.5, current.backgroundMusicVolume ?? 0.10),
    updatedAt: Date.now()
  };
  fs.mkdirSync(path.dirname(psychologySettingsPath), { recursive: true });
  fs.writeFileSync(psychologySettingsPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function publicPsychologySettings(settings) {
  return {
    configured: Boolean(settings.kieApiKey && settings.elevenLabsApiKey && settings.elevenLabsVoiceId),
    kieConfigured: Boolean(settings.kieApiKey),
    elevenLabsConfigured: Boolean(settings.elevenLabsApiKey),
    elevenLabsVoiceId: settings.elevenLabsVoiceId,
    elevenLabsModelId: settings.elevenLabsModelId,
    imageModels: settings.imageModels,
    totalVideos: settings.totalVideos,
        aspectRatio: settings.aspectRatio || "16:9",
    titlePosition: settings.titlePosition,
    titleFontSize: settings.titleFontSize,
    motion: settings.motion,
    backgroundMusicDir: settings.backgroundMusicDir || "",
    backgroundMusicVolume: Number(settings.backgroundMusicVolume ?? 0.10)
  };
}

function readRedditMixSettings() {
  if (!fs.existsSync(redditMixSettingsPath)) return { exists: false, settings: {} };
  try {
    const value = JSON.parse(fs.readFileSync(redditMixSettingsPath, "utf8"));
    return { exists: true, settings: normalizeRedditMixSettings(value) };
  } catch {
    return { exists: false, settings: {} };
  }
}

function saveRedditMixSettings(payload) {
  const current = readRedditMixSettings().settings;
  const next = normalizeRedditMixSettings({
    ...current,
    ...(payload?.subtitle ? { subtitle: payload.subtitle } : {}),
    ...(payload?.dedup ? { dedup: payload.dedup } : {})
  });
  fs.mkdirSync(path.dirname(redditMixSettingsPath), { recursive: true });
  fs.writeFileSync(redditMixSettingsPath, JSON.stringify({ ...next, updatedAt: Date.now() }, null, 2), "utf8");
  return next;
}

function normalizeRedditMixSettings(value) {
  const subtitle = value?.subtitle && typeof value.subtitle === "object" ? value.subtitle : {};
  const dedup = value?.dedup && typeof value.dedup === "object" ? value.dedup : {};
  return {
    subtitle: {
      yPercent: clampNumber(subtitle.yPercent, 38, 82, 66),
      fontSize: clampNumber(subtitle.fontSize, 42, 92, 62),
      animationMode: subtitle.animationMode === "word-highlight" ? "word-highlight" : "sentence"
    },
    dedup: {
      enabled: dedup.enabled !== false,
      scaleMin: clampNumber(dedup.scaleMin, 1, 1.3, 1.03),
      scaleMax: clampNumber(dedup.scaleMax, 1, 1.3, 1.08),
      rotateMin: clampNumber(dedup.rotateMin, -15, 15, -0.8),
      rotateMax: clampNumber(dedup.rotateMax, -15, 15, 0.8),
      brightnessMin: clampNumber(dedup.brightnessMin, -0.5, 0.5, -0.03),
      brightnessMax: clampNumber(dedup.brightnessMax, -0.5, 0.5, 0.04),
      contrastMin: clampNumber(dedup.contrastMin, 0.5, 2, 0.96),
      contrastMax: clampNumber(dedup.contrastMax, 0.5, 2, 1.06),
      saturationMin: clampNumber(dedup.saturationMin, 0, 2, 0.95),
      saturationMax: clampNumber(dedup.saturationMax, 0, 2, 1.12),
      mirrorChance: clampNumber(dedup.mirrorChance, 0, 100, 30),
      sharpen: clampNumber(dedup.sharpen, 0, 2, 0.2),
      speedMin: clampNumber(dedup.speedMin, 0.5, 2, 0.96),
      speedMax: clampNumber(dedup.speedMax, 0.5, 2, 1.04),
      overlayDir: String(dedup.overlayDir || "").trim(),
      overlayOpacity: clampNumber(dedup.overlayOpacity, 0, 1, 0.01),
      overlayCount: Math.round(clampNumber(dedup.overlayCount, 0, 20, 0))
    }
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function canAccessTask(user, task) {
  return user.role === "admin" || String(task?.ownerUserId || "") === String(user.id);
}

function filterTasksForUser(tasks, user) {
  return user.role === "admin" ? tasks : tasks.filter((task) => canAccessTask(user, task));
}

function canAccessPublishRecord(user, record) {
  if (!user || !record) return false;
  if (user.role === "admin") return true;
  if (String(record.ownerUserId || "") !== String(user.id)) return false;
  const allowedGroups = new Set((user.allowedGeeLarkGroups || []).map((group) => String(group).trim()).filter(Boolean));
  return allowedGroups.has(String(record.groupName || "").trim());
}

function resolveGeeLarkConfig(profileId) {
  const profile = localAuth.getProfile(profileId || "default");
  if (!profile) return readConfig(root).geelark || {};
  return { apiBaseUrl: profile.apiBaseUrl, appId: profile.appId, apiKey: profile.apiKey };
}

async function listGeeLarkPhonesForProfile(profileId) {
  const client = createGeeLarkClient({ geelark: resolveGeeLarkConfig(profileId) });
  if (!client.isConfigured()) throw new Error("GeeLark API 未配置，无法读取账号分组。");
  const phones = [];
  for (let page = 1; page <= 20; page++) {
    const data = await client.listPhones({ page, pageSize: 100 });
    const batch = normalizeGeeLarkList(data);
    phones.push(...batch);
    if (batch.length < 100) break;
  }
  return Array.from(new Map(phones.filter((phone) => phone.id).map((phone) => [String(phone.id), phone])).values());
}

async function getAuthorizedGeeLarkPhones(user) {
  const allowedGroups = new Set((user.allowedGeeLarkGroups || []).map((group) => String(group).trim()).filter(Boolean));
  if (user.role !== "admin" && !allowedGroups.size) return [];
  const phones = await listGeeLarkPhonesForProfile(user.geelarkProfileId || "default");
  if (user.role === "admin") return phones;
  return phones.filter((phone) => allowedGroups.has(String(phone.groupName || "").trim()));
}

function isPathInside(selectedPath, allowedRoot) {
  const rootPath = String(allowedRoot || "").trim();
  if (!rootPath) return false;
  const selected = path.resolve(String(selectedPath));
  const allowed = path.resolve(rootPath);
  return selected === allowed || selected.startsWith(`${allowed}${path.sep}`);
}

function isLoopbackRequest(req) {
  const address = String(req.socket?.remoteAddress || "").toLowerCase();
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function normalizeGeeLarkList(data) {
  const list = Array.isArray(data) ? data
    : Array.isArray(data?.list) ? data.list
      : Array.isArray(data?.records) ? data.records
        : Array.isArray(data?.items) ? data.items
          : Array.isArray(data?.data?.list) ? data.data.list
            : [];

  return list.map((phone) => ({
    id: phone.id || phone.envId || phone.phoneId || "",
    serialName: phone.serialName || phone.name || phone.deviceName || "",
    serialNo: phone.serialNo || "",
    groupName: phone.group?.name || phone.groupName || "",
    remark: phone.remark || "",
    status: phone.status,
    rpaStatus: phone.rpaStatus
  }));
}

function buildAccountMap(accounts) {
  const map = new Map();
  if (!Array.isArray(accounts)) return map;
  for (const account of accounts) {
    const id = String(account?.id || "");
    if (!id) continue;
    map.set(id, {
      id,
      name: String(account.name || ""),
      serialNo: String(account.serialNo || ""),
      groupName: String(account.groupName || ""),
      remark: String(account.remark || "")
    });
  }
  return map;
}

function resolveNonNegativeIndex(value, fallback = 0) {
  const number = Number(value);
  if (Number.isInteger(number) && number >= 0) return number;
  const fallbackNumber = Number(fallback);
  return Number.isInteger(fallbackNumber) && fallbackNumber >= 0 ? fallbackNumber : 0;
}

async function readRecentGeeLarkTasks(client) {
  const data = await client.historyRecords({ size: 100 });
  return Array.isArray(data?.items) ? data.items : [];
}

function findExistingPublishTask(remoteTasks, localRecords, { planName, scheduleAt, envId }) {
  const name = String(planName || "");
  const schedule = Number(scheduleAt) || 0;
  const phoneId = String(envId || "");

  const local = (localRecords || []).find((record) => {
    const recordPlan = path.basename(String(record.fileName || ""), path.extname(String(record.fileName || "")));
    return recordPlan === name &&
      String(record.assignedEnvId || "") === phoneId &&
      Math.abs(Number(record.scheduleAt || 0) - schedule) <= 60 &&
      Array.isArray(record.taskIds) &&
      record.taskIds.length;
  });
  if (local) return { ...local, id: local.taskIds?.[0], taskIds: local.taskIds };

  return (remoteTasks || []).find((task) => (
    Number(task.taskType) === 1 &&
    String(task.planName || "") === name &&
    String(task.envId || "") === phoneId &&
    Math.abs(Number(task.scheduleAt || 0) - schedule) <= 60
  ));
}

function buildPublishRecord({
  index,
  filePath,
  video,
  account,
  assignedEnvId,
  audioIndex,
  templateIndex,
  scheduleAt,
  intervalMinutes,
  videoDesc,
  resourceUrl,
  taskIds,
  status,
  note
}) {
  return {
    id: safeId(`${Date.now()}-${index}-${path.basename(filePath)}`),
    createdAt: Date.now(),
    source: "geelark",
    platform: "tiktok",
    status: status || "submitted",
    fileName: path.basename(filePath),
    title: video.title || "",
    audioName: video.audioName || "",
    audioIndex,
    template: video.template || "",
    templateIndex,
    templateLabel: video.templateLabel || "",
    variant: Number(video.variant) || 1,
    localVideoUrl: video.videoUrl || video.url || "",
    resourceUrl: resourceUrl || "",
    taskIds: Array.isArray(taskIds) ? taskIds : [],
    assignedEnvId,
    accountName: account.name || "",
    accountSerialNo: account.serialNo || "",
    groupName: account.groupName || "",
    videoDesc: videoDesc || "",
    scheduleAt,
    intervalMinutes,
    shareLink: "",
    metrics: null,
    lastCheckedAt: null,
    note: note || ""
  };
}

function readPublishRecords() {
  if (!fs.existsSync(publishRecordsPath)) return [];
  try {
    const value = JSON.parse(fs.readFileSync(publishRecordsPath, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writePublishRecords(records) {
  fs.mkdirSync(path.dirname(publishRecordsPath), { recursive: true });
  fs.writeFileSync(publishRecordsPath, JSON.stringify(records, null, 2), "utf8");
}

function appendPublishRecords(records) {
  if (!records.length) return;
  const current = readPublishRecords();
  writePublishRecords([...records, ...current]);
}

function getPublishRecordsSummary(searchParams, user = null) {
  const range = String(searchParams.get("range") || "7d");
  const requestedProfileId = String(searchParams.get("profileId") || "").trim();
  const group = String(searchParams.get("group") || "").trim();
  const account = String(searchParams.get("account") || "").trim().toLowerCase();
  const from = resolveStatsFrom(range);
  const profiles = getAccessiblePublishProfiles(user);
  const defaultProfileId = String(user?.geelarkProfileId || profiles[0]?.id || "default");
  const profileId = profiles.some((profile) => profile.id === requestedProfileId)
    ? requestedProfileId
    : defaultProfileId;
  const allRecords = readPublishRecords()
    .filter((record) => canAccessPublishRecord(user, record))
    // Records created before multiple GeeLark profiles were introduced belong to the default profile.
    .filter((record) => String(record.geelarkProfileId || "default") === profileId);
  const records = allRecords
    .filter((record) => !from || Number(record.scheduleAt) * 1000 >= from)
    .filter((record) => !group || record.groupName === group)
    .filter((record) => {
      if (!account) return true;
      return [
        record.accountName,
        record.accountSerialNo,
        record.assignedEnvId,
        Array.isArray(record.taskIds) ? record.taskIds.join(" ") : "",
        record.fileName,
        record.title,
        record.audioName,
        record.template,
        record.templateLabel,
        record.videoDesc
      ].filter(Boolean).join(" ").toLowerCase().includes(account);
    })
    .sort((a, b) => Number(b.scheduleAt || 0) - Number(a.scheduleAt || 0));

  const groups = uniqueSorted(allRecords.map((record) => record.groupName).filter(Boolean));
  const accounts = uniqueSorted(allRecords.map((record) => record.accountName || record.assignedEnvId).filter(Boolean));
  const taskCount = records.reduce((sum, record) => sum + (Array.isArray(record.taskIds) ? record.taskIds.length : 0), 0);
  return {
    records,
    summary: {
      recordCount: records.length,
      taskCount,
      accountCount: new Set(records.map((record) => record.assignedEnvId).filter(Boolean)).size,
      groupCount: new Set(records.map((record) => record.groupName).filter(Boolean)).size
    },
    filters: { profiles, selectedProfileId: profileId, groups, accounts }
  };
}

function getAccessiblePublishProfiles(user) {
  if (!user) return [];
  if (user.role === "admin") return localAuth.listProfiles();
  const profile = localAuth.getProfile(user.geelarkProfileId || "default");
  return profile ? [{ id: profile.id, name: profile.name }] : [];
}

function resolveStatsFrom(range) {
  const now = Date.now();
  if (range === "1d") return now - 24 * 60 * 60 * 1000;
  if (range === "7d") return now - 7 * 24 * 60 * 60 * 1000;
  if (range === "30d") return now - 30 * 24 * 60 * 60 * 1000;
  return 0;
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort((a, b) => String(a).localeCompare(String(b), "zh-Hans-CN"));
}

function resolveOutputVideoPath(value) {
  const raw = String(value || "");
  const fileName = path.basename(decodeURIComponent(raw.replace(/^\/outputs\//, "")));
  if (!fileName || path.extname(fileName).toLowerCase() !== ".mp4") {
    throw new Error("只能发布 outputs 目录下的 mp4 视频。");
  }
  const filePath = path.join(outputDir, fileName);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(outputDir) + path.sep) || !fs.existsSync(resolved)) {
    throw new Error(`视频文件不存在：${fileName}`);
  }
  return resolved;
}

function writeJob(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function readJob(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function patchJob(filePath, patch) {
  const current = fs.existsSync(filePath) ? readJob(filePath) : {};
  writeJob(filePath, { ...current, ...patch });
}

function killProcessTree(pid) {
  const safePid = Number(pid);
  if (!Number.isInteger(safePid) || safePid <= 0) return;

  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(safePid), "/T", "/F"], {
      encoding: "utf8",
      windowsHide: true
    });
    return;
  }

  try {
    process.kill(safePid, "SIGTERM");
  } catch {
    // Process may have already exited.
  }
}

function readJobWithEstimate(filePath) {
  const job = readJob(filePath);
  if (job.status !== "running" || !job.renderStartedAt || !job.estimatedRenderMs) return job;

  const elapsed = Date.now() - job.renderStartedAt;
  const renderProgress = Math.min(1, Math.max(0, elapsed / job.estimatedRenderMs));
  const estimatedPercent = Math.round(30 + renderProgress * 64);
  return {
    ...job,
    percent: Math.max(Number(job.percent) || 0, Math.min(94, estimatedPercent))
  };
}

async function downloadAudioUrl(audioUrl, targetDir, id, fileName = "") {
  let parsed;
  try {
    parsed = new URL(String(audioUrl).trim());
  } catch {
    throw new Error("音频链接格式不正确。");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("音频链接只支持 http 或 https。");
  }

  if (isTikTokUrl(parsed)) {
    return downloadMediaAudioWithYtDlp(String(audioUrl).trim(), targetDir, id);
  }

  const response = await fetch(parsed);
  if (!response.ok) {
    throw new Error(`音频链接下载失败：${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1024) throw new Error("音频链接没有返回有效音频。");

  const ext = safeAudioExtension(fileName || parsed.pathname);
  const outputPath = path.join(targetDir, `${id}.remote${ext}`);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

function isTikTokUrl(parsed) {
  return /(^|\.)tiktok\.com$/i.test(parsed.hostname);
}

function downloadMediaAudioWithYtDlp(mediaUrl, targetDir, id) {
  const outputTemplate = path.join(targetDir, `${id}.remote.%(ext)s`);
  const before = new Set(fs.readdirSync(targetDir));
  const ytDlp = resolveYtDlpCommand();
  const attempts = [
    ["鐩存帴鎻愬彇", []],
    ["读取 Chrome Cookie 后提取", ["--cookies-from-browser", "chrome"]]
  ];
  const errors = [];

  for (const [label, extraArgs] of attempts) {
    const result = runYtDlpAudioExtract(ytDlp, outputTemplate, mediaUrl, extraArgs);
    if (result.status === 0) break;
    errors.push(`${label}失败：${extractCommandError(result)}`);
  }

  if (errors.length === attempts.length) {
    throw new Error(`TikTok 音频提取失败：${errors.join("；")}`);
  }

  const downloaded = fs.readdirSync(targetDir)
    .filter((name) => !before.has(name) && name.startsWith(`${id}.remote.`))
    .map((name) => path.join(targetDir, name))
    .filter((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).size > 1024)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  const audioPath = downloaded.find((filePath) => [".mp3", ".m4a", ".wav", ".aac", ".opus", ".webm"].includes(path.extname(filePath).toLowerCase()));
  if (!audioPath) throw new Error("TikTok 音频提取失败：没有生成有效音频文件。");
  return audioPath;
}

function runYtDlpAudioExtract(ytDlp, outputTemplate, mediaUrl, extraArgs = []) {
  return spawnSync(ytDlp, [
    "--no-playlist",
    "--no-warnings",
    "--force-overwrites",
    ...extraArgs,
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
    "-o",
    outputTemplate,
    mediaUrl
  ], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024
  });
}

function resolveYtDlpCommand() {
  for (const command of ["yt-dlp", "yt-dlp.exe"]) {
    const result = spawnSync(command, ["--version"], { encoding: "utf8", windowsHide: true });
    if (result.status === 0) return command;
  }
  throw new Error("没有找到 yt-dlp，请先安装 yt-dlp 后再使用 TikTok 链接提取音频。");
}

function extractCommandError(result) {
  return String(result.stderr || result.stdout || "未知错误").trim().slice(0, 1200);
}

function safeId(value) {
  const cleaned = String(value)
    .trim()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || timestampId();
}

function timestampId() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("");
}

function safeAudioExtension(fileName) {
  const ext = path.extname(String(fileName)).toLowerCase();
  return [".mp3", ".wav", ".m4a", ".aac"].includes(ext) ? ext : ".mp3";
}

function safeImageExtension(fileName) {
  const ext = path.extname(String(fileName)).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".png";
}

function applyAspect(config, aspect) {
  if (aspect === "landscape") {
    return {
      ...config,
      width: 1920,
      height: 1080,
      titleFontSize: 52,
      timeFontSize: 40,
      controlFontSize: 82
    };
  }

  return {
    ...config,
    width: 1080,
    height: 1920,
    titleFontSize: 58,
    timeFontSize: 44,
    controlFontSize: 88
  };
}

function synthesizeSpeech({ id, text, voiceName, rate, volume }) {
  const textPath = path.join(workDir, `${id}.tts.txt`);
  const outputPath = path.join(workDir, `${id}.tts.wav`);
  fs.writeFileSync(textPath, text, "utf8");

  const scriptPath = path.join(root, "scripts", "sapi-tts.ps1");
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-TextPath",
    textPath,
    "-OutputPath",
    outputPath,
    "-Rate",
    String(Number.isFinite(Number(rate)) ? Number(rate) : 0),
    "-Volume",
    String(Number.isFinite(Number(volume)) ? Number(volume) : 100)
  ];

  if (voiceName) args.push("-VoiceName", String(voiceName));

  const result = spawnSync("powershell.exe", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`本地自动配音失败：${result.stderr || result.stdout || "未知错误"}`);
  }
  assertAudioFile(outputPath, "本地自动配音失败：没有生成有效音频。");

  return outputPath;
}

async function synthesizeWithElevenLabs({ id, text, apiKey, voiceId, modelId, outputFormat }) {
  if (!apiKey) throw new Error("ElevenLabs API Key 未配置。");
  if (!voiceId) throw new Error("请输入 ElevenLabs Voice ID。");

  const safeFormat = outputFormat || "mp3_44100_128";
  const outputPath = path.join(workDir, `${id}.elevenlabs.mp3`);
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(safeFormat)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      model_id: modelId || "eleven_multilingual_v2"
    })
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    const message = buffer.toString("utf8").slice(0, 800);
    throw new Error(`ElevenLabs 配音失败：${message || response.status}`);
  }

  fs.writeFileSync(outputPath, buffer);
  assertAudioFile(outputPath, "ElevenLabs 没有返回有效音频。");
  return outputPath;
}

function assertAudioFile(filePath, message) {
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  if (!stat || stat.size < 1024) throw new Error(message);
}

function findKnownAudioPath(audioName) {
  const fileName = path.basename(String(audioName || ""));
  if (!fileName) return "";
  for (const dir of getKnownAudioDirs()) {
    const resolvedDir = path.resolve(dir);
    const candidate = path.resolve(resolvedDir, fileName);
    if (!candidate.startsWith(resolvedDir + path.sep)) continue;
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return "";
}

function getKnownAudioDirs() {
  const tasksDir = path.join(workDir, "scheduled-tasks");
  const dirs = new Set();
  if (!fs.existsSync(tasksDir)) return [];
  for (const fileName of fs.readdirSync(tasksDir)) {
    if (!fileName.endsWith(".json")) continue;
    try {
      const task = JSON.parse(fs.readFileSync(path.join(tasksDir, fileName), "utf8"));
      const audioDir = String(task.generation?.audioDir || "").trim();
      if (audioDir && fs.existsSync(audioDir) && fs.statSync(audioDir).isDirectory()) {
        dirs.add(path.resolve(audioDir));
      }
    } catch {}
  }
  return Array.from(dirs);
}

function mediaContentType(filePath) {
  const ext = path.extname(String(filePath)).toLowerCase();
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".ogg" || ext === ".opus") return "audio/ogg";
  if (ext === ".flac") return "audio/flac";
  return "application/octet-stream";
}
