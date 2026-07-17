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
import { createFeishuBookService } from "./feishu-books.js";

const root = process.cwd();
const port = Number(process.env.PORT || 3010);
const publicDir = path.join(root, "public");
const bootConfig = readConfig(root);
const { outputDir, workDir } = resolveStorageDirs(root, bootConfig);
const jobsDir = path.join(workDir, "jobs");
const publishRecordsPath = path.join(workDir, "publish-records.json");

ensureProject(root, bootConfig);
fs.mkdirSync(jobsDir, { recursive: true });
const publishService = createPublishService({ root, workDir, outputDir, readConfig });
const autoTaskManager = createAutoTaskManager({ root, workDir, outputDir, publishService, outputRetentionHours: 48 });
const tiktokAnalytics = createTikTokAnalyticsService({
  workDir,
  defaultApiKeys: bootConfig.tiktokApiStoreApiKeys,
  defaultApiKey: bootConfig.tiktokApiStoreApiKey
});
const codexBrain = createCodexBrainService({ root });
const feishuBooks = createFeishuBookService({ root, workDir, readConfig });
let scheduledAccountsCache = { expiresAt: 0, accounts: null };
tiktokAnalytics.scheduleNextRun(getScheduledTikTokAccounts);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

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

    if (req.method === "GET" && url.pathname === "/reddit") {
      return sendFile(res, path.join(publicDir, "reddit.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/reddit.js") {
      return sendFile(res, path.join(publicDir, "reddit.js"), "text/javascript; charset=utf-8");
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

    if (req.method === "GET" && url.pathname === "/asset-cutter") {
      return sendFile(res, path.join(publicDir, "asset-cutter.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/asset-cutter.js") {
      return sendFile(res, path.join(publicDir, "asset-cutter.js"), "text/javascript; charset=utf-8");
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

    if (req.method === "GET" && url.pathname === "/novel-library") {
      return sendFile(res, path.join(publicDir, "novel-library.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/novel-library.js") {
      return sendFile(res, path.join(publicDir, "novel-library.js"), "text/javascript; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname === "/novel-library.css") {
      return sendFile(res, path.join(publicDir, "novel-library.css"), "text/css; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname.startsWith("/outputs/")) {
      const fileName = path.basename(decodeURIComponent(url.pathname.slice("/outputs/".length)));
      return sendFile(res, path.join(outputDir, fileName), "video/mp4");
    }

    if (req.method === "GET" && url.pathname === "/api/codex/status") {
      if (!isLoopbackRequest(req)) return sendJson(res, 403, { error: "Codex 接口仅允许在本机访问。" });
      return sendJson(res, 200, codexBrain.getStatus());
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

    if (req.method === "GET" && url.pathname === "/api/publish-records") {
      return sendJson(res, 200, getPublishRecordsSummary(url.searchParams));
    }

    if (req.method === "GET" && url.pathname === "/api/tiktok-analytics") {
      const allowedAccounts = await getScheduledTikTokAccountsCached();
      return sendJson(res, 200, tiktokAnalytics.getDashboard({
        period: String(url.searchParams.get("period") || "7d"),
        group: String(url.searchParams.get("group") || ""),
        account: String(url.searchParams.get("account") || ""),
        sort: String(url.searchParams.get("sort") || "views"),
        allowedAccounts
      }, readPublishRecords()));
    }

    if (req.method === "GET" && url.pathname === "/api/tiktok-analytics/settings") {
      const currentPhones = await getCurrentGeeLarkPhones();
      return sendJson(res, 200, {
        settings: tiktokAnalytics.getSettings(),
        accountCount: currentPhones.length,
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
        period: String(url.searchParams.get("period") || "7d"),
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
      const allowedAccounts = await getScheduledTikTokAccountsCached();
      const detail = tiktokAnalytics.getAccountDetail(username, {
        period: String(url.searchParams.get("period") || "7d"),
        group: String(url.searchParams.get("group") || ""),
        sort: String(url.searchParams.get("sort") || "newest"),
        allowedAccounts
      }, readPublishRecords());
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
      const groupName = String(payload.groupName || "").trim();
      if (!groupName) return sendJson(res, 400, { error: "请先选择需要抓取的账号组。" });
      const accounts = await getCurrentGeeLarkAccounts(groupName);
      if (!accounts.length) return sendJson(res, 400, { error: "当前账号组没有可抓取的账号。" });
      void tiktokAnalytics.fetchAccounts(accounts).catch((error) => console.error("TikTok analytics fetch failed:", error));
      return sendJson(res, 202, { ok: true, groupName, accountCount: accounts.length });
    }

    if (req.method === "POST" && url.pathname === "/api/tiktok-analytics/fetch-all") {
      return sendJson(res, 410, { error: "全账号抓取已关闭，请选择账号组后抓取。" });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/publish-records\/[^/]+\/retry$/)) {
      const recordId = decodeURIComponent(url.pathname.split("/")[3]);
      const payload = await readJsonBody(req);
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
        initialPath: payload.initialPath,
        title: payload.title
      });
      return sendJson(res, 200, { canceled: !selectedPath, path: selectedPath || "" });
    }

    if (req.method === "GET" && url.pathname === "/api/geelark/phones") {
      const config = readConfig(root);
      const client = createGeeLarkClient(config);
      if (!client.isConfigured()) return sendJson(res, 200, { configured: false, phones: [] });
      const data = await client.listPhones({
        page: Number(url.searchParams.get("page")) || 1,
        pageSize: Number(url.searchParams.get("pageSize")) || 100
      });
      return sendJson(res, 200, { configured: true, phones: normalizeGeeLarkList(data) });
    }

    if (req.method === "POST" && url.pathname === "/api/geelark/publish") {
      const payload = await readJsonBody(req);
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

    if (req.method === "GET" && url.pathname === "/api/auto-tasks") {
      return sendJson(res, 200, { tasks: autoTaskManager.listTasks(), worker: autoTaskManager.getStatus() });
    }

    if (req.method === "POST" && url.pathname === "/api/auto-tasks") {
      const payload = await readJsonBody(req);
      return sendJson(res, 201, { task: autoTaskManager.createTask(payload) });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/auto-tasks/")) {
      const taskId = safeId(decodeURIComponent(url.pathname.slice("/api/auto-tasks/".length)));
      return sendJson(res, 200, { task: autoTaskManager.getTask(taskId) });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/auto-tasks\/[^/]+\/cancel$/)) {
      const taskId = safeId(decodeURIComponent(url.pathname.split("/")[3]));
      return sendJson(res, 200, { task: autoTaskManager.cancelTask(taskId) });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/auto-tasks\/[^/]+\/resume$/)) {
      const taskId = safeId(decodeURIComponent(url.pathname.split("/")[3]));
      return sendJson(res, 200, { task: autoTaskManager.resumeTask(taskId) });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/auto-tasks\/[^/]+\/retry-publish$/)) {
      const taskId = safeId(decodeURIComponent(url.pathname.split("/")[3]));
      const payload = await readJsonBody(req);
      const result = await autoTaskManager.retryPublishRecord(taskId, String(payload.recordId || ""), payload);
      return sendJson(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/api/generate/start") {
      const payload = await readJsonBody(req);
      const text = String(payload.text || "").trim();
      const hasUploadedAudio = Boolean(payload.audioBase64 && payload.audioName);
      const hasAudioUrl = Boolean(String(payload.audioUrl || "").trim());
      if (!hasUploadedAudio && !hasAudioUrl && !text) {
        return sendJson(res, 400, { error: "请输入配音文案、上传音频，或填写音频链接。" });
      }

      const jobId = safeId(`${payload.id || timestampId()}-${Date.now()}`);
      const payloadPath = path.join(jobsDir, `${jobId}.payload.json`);
      const jobPath = path.join(jobsDir, `${jobId}.json`);

      fs.writeFileSync(payloadPath, JSON.stringify({ ...payload, jobId }, null, 2), "utf8");
      writeJob(jobPath, {
        jobId,
        status: "queued",
        percent: 1,
        message: "已加入生成队列...",
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

async function getCurrentGeeLarkPhones() {
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

async function getCurrentGeeLarkAccounts(groupName = "") {
  const phones = await getCurrentGeeLarkPhones();
  return Array.from(new Set(phones
    .filter((phone) => !groupName || String(phone.groupName || "").trim() === groupName)
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

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
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

function getPublishRecordsSummary(searchParams) {
  const range = String(searchParams.get("range") || "7d");
  const group = String(searchParams.get("group") || "").trim();
  const account = String(searchParams.get("account") || "").trim().toLowerCase();
  const from = resolveStatsFrom(range);
  const records = readPublishRecords()
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

  const groups = uniqueSorted(readPublishRecords().map((record) => record.groupName).filter(Boolean));
  const accounts = uniqueSorted(readPublishRecords().map((record) => record.accountName || record.assignedEnvId).filter(Boolean));
  const taskCount = records.reduce((sum, record) => sum + (Array.isArray(record.taskIds) ? record.taskIds.length : 0), 0);
  return {
    records,
    summary: {
      recordCount: records.length,
      taskCount,
      accountCount: new Set(records.map((record) => record.assignedEnvId).filter(Boolean)).size,
      groupCount: new Set(records.map((record) => record.groupName).filter(Boolean)).size
    },
    filters: { groups, accounts }
  };
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
    ["直接提取", []],
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
