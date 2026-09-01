import { applyArchiveViewsToSnapshot, collectSnapshotVideoIds, dashboardFromSnapshot } from "../../scripts/asset-usage-impact.js";
import { listElevenLabsVoices } from "../../scripts/elevenlabs-voices.js";
import { isKokoroVoiceId, listKokoroVoices } from "../../scripts/kokoro-voices.js";
import { errorJson, json, now, readJson, redirect, safeId } from "./http.js";
import { applyJobToTask, cancelJob, enqueueJob, findLatestOpeningVariantsJob, getJob, isDeletedTask, publicJob, videosForOfficialRetry } from "./jobs.js";
import { kvGet, kvSet } from "./kv.js";
import { serveNovelAudio } from "./novel-audio-archive.js";
import { buildAudioGeneratePayload, hydrateNovel, resolveNovelTitle } from "./novels.js";
import { peerRewriteOpeningPayload } from "../../scripts/novel-rewrite-source.js";
import { loadArchiveViewsByVideoIds } from "./official-archive-store.js";
import { isParkourVideoTemplate, normalizeVideoTemplate, resolveParkourVideoDir } from "../../scripts/video-template.js";

export async function handleCompat(request, env, url, session) {
  if (!session) return null;
  const db = env.DB;
  const method = request.method;
  const pathname = url.pathname;

  if (method === "POST" && pathname === "/api/select-directory") {
    return errorJson("云端不支持弹出本机文件夹。请直接填写工人机上的路径，或在本机工人配置里指定素材目录。", 400);
  }

  if (method === "GET" && pathname === "/api/asset-groups") {
    return json({ groups: publicAssetGroups(await kvGet(db, "asset-groups", [])), usage: await kvGet(db, "asset-usage", {}) });
  }
  if (method === "GET" && pathname === "/api/audio-groups") {
    return json({
      libraryRoot: "F:/音频目录",
      groups: publicAudioGroups(await kvGet(db, "audio-groups", []))
    });
  }
  if (method === "GET" && pathname === "/api/shared-libraries") {
    return json({ libraries: await kvGet(db, "shared-libraries", []) });
  }
  if (method === "GET" && pathname === "/api/asset-usage") {
    const snapshot = await kvGet(db, "asset-usage-dashboard", null);
    const views = await loadArchiveViewsByVideoIds(db, collectSnapshotVideoIds(snapshot));
    return json(dashboardFromSnapshot(applyArchiveViewsToSnapshot(snapshot, views), String(url.searchParams.get("groupId") || "")));
  }
  if (method === "GET" && pathname === "/api/asset-library-root") {
    return json({ libraryRoot: "", cloud: true, message: "素材目录在工人机本地。" });
  }

  if (pathname === "/api/reddit-mix/settings") {
    if (method === "GET") return json(await kvGet(db, "reddit-mix-settings", {}));
    if (method === "POST") {
      const settings = await kvSet(db, "reddit-mix-settings", await readJson(request));
      return json({ ok: true, settings });
    }
  }

  if (pathname === "/api/psychology/settings") {
    if (method === "GET") return json(await kvGet(db, "psychology-settings", defaultPsychology()));
    if (method === "POST") return json(await kvSet(db, "psychology-settings", { ...defaultPsychology(), ...await readJson(request) }));
  }

  if (method === "GET" && pathname === "/api/psychology-topics") {
    const items = await kvGet(db, "psychology-topics", []);
    return json({ items, total: items.length, page: 1, pageSize: items.length });
  }
  const topicMatch = pathname.match(/^\/api\/psychology-topics\/([^/]+)$/);
  if (method === "GET" && topicMatch) {
    const items = await kvGet(db, "psychology-topics", []);
    const topic = items.find((item) => item.id === decodeURIComponent(topicMatch[1]));
    if (!topic) return errorJson("题目不存在。", 404);
    return json({ topic });
  }

  if (pathname === "/api/auto-tasks") {
    if (method === "GET") {
      const tasks = await kvGet(db, "auto-tasks", []);
      const worker = await kvGet(db, "factory-worker-status", {
        running: false,
        cloud: true,
        message: "本机工人未上线。请在 Local Factory 运行 npm start。"
      });
      const live = [];
      for (const task of tasks) {
        if (isDeletedTask(task)) continue;
        if (task.generationJobId) {
          const job = await getJob(db, task.generationJobId);
          live.push(job ? applyJobToTask(task, job) : task);
        } else {
          live.push(task);
        }
      }
      return json({ tasks: live, worker });
    }
    if (method === "POST") {
      const payload = await readJson(request);
      const taskType = normalizeTaskType(payload.taskType);
      const generation = normalizeRedditGeneration(payload.generation);
      const publish = payload.publish && typeof payload.publish === "object" ? payload.publish : {};
      if (taskType === "reddit-mix") {
        if (!hasMixAudio(generation)) {
          return errorJson("请勾选小说平台。", 400);
        }
        if (isParkourVideoTemplate(generation)) {
          if (!String(generation.videoDir || "").trim()) return errorJson("请填写工人机上的跑酷视频目录。", 400);
        } else if (!String(generation.videoDir || "").trim() && !String(generation.assetGroupId || "").trim()) {
          return errorJson("请选择素材组，或填写工人机上的视频素材目录。", 400);
        }
      }
      const expectedVideoCount = Math.max(
        Number(generation.totalVideos) || 0,
        Array.isArray(generation.audioItems) ? generation.audioItems.length : 0
      );
      const task = {
        id: safeId(`task-${now()}`),
        name: String(payload.name || payload.taskType || "云端任务"),
        taskType,
        status: "queued",
        phase: "queued",
        message: "已下发本机混剪队列，等待 Local Factory 拉单。",
        expectedVideoCount,
        progress: { current: 0, total: expectedVideoCount, percent: 1 },
        generation,
        publish,
        generatedVideos: [],
        publishResults: [],
        createdAt: now(),
        updatedAt: now()
      };
      const job = await enqueueJob(db, {
        type: taskType,
        title: task.name,
        payload: {
          ...generation,
          taskId: task.id,
          taskName: task.name,
          taskType,
          publish,
          burnNovelBadge: publish.provider === "official"
        },
        createdBy: session.user.username
      });
      task.generationJobId = job.id;
      const tasks = await kvGet(db, "auto-tasks", []);
      tasks.unshift(task);
      await kvSet(db, "auto-tasks", tasks.slice(0, 500));
      return json({ task }, 201);
    }
  }

  const taskMatch = pathname.match(/^\/api\/auto-tasks\/([^/]+)(?:\/(cancel|resume|retry-publish))?$/);
  if (taskMatch) {
    const tasks = await kvGet(db, "auto-tasks", []);
    const task = tasks.find((item) => item.id === decodeURIComponent(taskMatch[1]));
    if (!task) return errorJson("任务不存在。", 404);
    if (method === "GET" && !taskMatch[2]) {
      if (!task.generationJobId) return json({ task });
      const job = await getJob(db, task.generationJobId);
      return json({ task: job ? applyJobToTask(task, job) : task });
    }
    if (method === "PATCH") {
      Object.assign(task, await readJson(request), { updatedAt: now() });
      await kvSet(db, "auto-tasks", tasks);
      return json({ task });
    }
    if (method === "DELETE") {
      task.status = "deleted";
      task.deleted = 1;
      task.deletedAt = now();
      task.updatedAt = now();
      if (task.generationJobId) await cancelJob(db, task.generationJobId);
      await kvSet(db, "auto-tasks", tasks);
      return json({ ok: true, task });
    }
    if (method === "POST" && taskMatch[2] === "cancel") {
      if (task.generationJobId) await cancelJob(db, task.generationJobId);
      task.status = "canceled";
      task.phase = "canceled";
      task.message = "任务已停止。";
      task.updatedAt = now();
      await kvSet(db, "auto-tasks", tasks);
      return json({ task });
    }
    if (method === "POST" && taskMatch[2] === "resume") {
      const job = await enqueueJob(db, {
        type: normalizeTaskType(task.taskType),
        title: task.name,
        payload: {
          ...normalizeRedditGeneration(task.generation),
          taskId: task.id,
          taskName: task.name,
          taskType: normalizeTaskType(task.taskType),
          publish: task.publish || {},
          burnNovelBadge: task.publish?.provider === "official"
        },
        createdBy: session.user.username
      });
      task.generationJobId = job.id;
      task.status = "queued";
      task.phase = "queued";
      task.message = "已重新下发本机混剪队列。";
      task.updatedAt = now();
      await kvSet(db, "auto-tasks", tasks);
      return json({ task });
    }
    if (method === "POST" && taskMatch[2] === "retry-publish") {
      const currentJob = task.generationJobId ? await getJob(db, task.generationJobId) : null;
      const videos = videosForOfficialRetry(task, currentJob);
      if (!videos.length) return errorJson("没有已生成的成片，无法重试发布。", 400);
      const job = await enqueueJob(db, {
        type: "official-publish",
        title: `${task.name} · 重试发布`,
        payload: {
          taskId: task.id,
          taskName: task.name,
          taskType: "official-publish",
          publishOnly: true,
          publish: task.publish || {},
          videos,
          generatedVideos: videos
        },
        createdBy: session.user.username
      });
      task.generationJobId = job.id;
      task.status = "queued";
      task.phase = "queued";
      task.message = "已重新下发官方发布，等待本机工人提交。";
      task.error = "";
      task.publishError = "";
      task.updatedAt = now();
      await kvSet(db, "auto-tasks", tasks);
      return json({ task });
    }
  }

  if (method === "GET" && pathname === "/api/publish-records") {
    const records = await kvGet(db, "publish-records", []);
    return json({
      records,
      summary: { recordCount: records.length, taskCount: records.length, accountCount: 0, groupCount: 0 },
      filters: { profiles: [], selectedProfileId: session.user.geelarkProfileId, groups: [], accounts: [] }
    });
  }

  if (method === "GET" && pathname === "/api/tiktok-analytics") {
    return json({ accounts: [], videos: [], totals: {}, period: url.searchParams.get("period") || "7d" });
  }
  if (method === "GET" && pathname === "/api/tiktok-analytics/account-details") {
    return json({ account: null, videos: [] });
  }
  if (method === "GET" && pathname === "/api/tiktok-analytics/audio-details") {
    return json({ audio: null, videos: [] });
  }
  if (pathname === "/api/tiktok-analytics/settings") {
    if (method === "GET") return json(await kvGet(db, "tiktok-analytics-settings", { profiles: [] }));
    if (method === "POST") return json(await kvSet(db, "tiktok-analytics-settings", await readJson(request)));
  }

  if (pathname.startsWith("/api/operator")) {
    return handleOperator(request, db, url, session);
  }

  const openingMatch = pathname.match(/^\/api\/novel-content\/novels\/([^/]+)\/opening-variants$/);
  if (method === "GET" && openingMatch) {
    const job = await findLatestOpeningVariantsJob(db, {
      novelId: decodeURIComponent(openingMatch[1]),
      createdBy: session.user.username
    });
    return json({ job: job ? publicJob(job) : null });
  }
  if (method === "POST" && openingMatch) {
    const novel = await hydrateNovel(db, decodeURIComponent(openingMatch[1]));
    if (!novel) return errorJson("没有找到该小说。", 404);
    const body = await readJson(request);
    const styles = Array.isArray(body.styles) ? body.styles : [];
    if (!styles.length) return errorJson("请先勾选至少 1 种风格，再生成改版开头。", 400);
    let rewritePayload;
    try {
      rewritePayload = peerRewriteOpeningPayload(novel, body);
    } catch (error) {
      return errorJson(error.message || "请先勾选一条已识别完成的同行爆款口播。", error.statusCode || 400);
    }
    const job = await enqueueJob(db, {
      type: "opening-variants",
      title: `生成 ${styles.length} 个改版开头`,
      payload: rewritePayload,
      createdBy: session.user.username
    });
    return json({
      queued: true,
      accepted: true,
      jobId: job.id,
      message: "已交给本机工人用 Codex 生成改版开头。"
    });
  }

  const titleMatch = pathname.match(/^\/api\/novel-content\/novels\/([^/]+)\/opening-titles$/);
  if (method === "POST" && titleMatch) {
    const novel = await hydrateNovel(db, decodeURIComponent(titleMatch[1]));
    if (!novel) return errorJson("没有找到该小说。", 404);
    const body = await readJson(request);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return errorJson("请先勾选要重写标题的开头。", 400);
    const job = await enqueueJob(db, {
      type: "opening-titles",
      title: `重写 ${items.length} 个开头标题`,
      payload: {
        novelId: novel.id,
        title: novel.title,
        language: body.language || "English",
        items: items.slice(0, 10).map((item) => ({
          id: String(item.id || "").trim(),
          style: String(item.style || "").trim(),
          styleLabel: String(item.styleLabel || "").trim(),
          openingTitle: String(item.openingTitle || "").trim(),
          script: String(item.script || "").trim().slice(0, 1200)
        })),
        model: body.model || ""
      },
      createdBy: session.user.username
    });
    return json({
      queued: true,
      accepted: true,
      jobId: job.id,
      message: "已交给本机工人单独重写开头标题。"
    });
  }

  if (method === "POST" && pathname === "/api/audio-library/generate-script") {
    const payload = await buildAudioGeneratePayload(db, await readJson(request));
    const job = await enqueueJob(db, {
      type: "audio-generate",
      title: payload.items.length > 1 ? `下发 ${payload.items.length} 条小说音频` : "生成小说音频",
      payload,
      createdBy: session.user.username
    });
    return json({
      queued: true,
      accepted: true,
      jobId: job.id,
      message: "已交给本机工人生成，完成后会传到线上网页，并写到 F:\\音频目录。"
    });
  }

  if (method === "POST" && pathname === "/api/audio-library/ensure-folder") {
    const body = await readJson(request);
    const novelId = String(body.novelId || "").trim();
    const novel = novelId ? await hydrateNovel(db, novelId) : null;
    const novelTitle = await resolveNovelTitle(db, body) || String(novel?.title || "").trim();
    if (!novelTitle) return errorJson("请先打开一本小说，再按书名建文件夹。", 400);
    const platform = String(body.platform || novel?.platform || "").trim();
    const job = await enqueueJob(db, {
      type: "audio-ensure-folder",
      title: `新建音频文件夹 ${novelTitle}`,
      payload: { novelTitle, novelId, platform },
      createdBy: session.user.username
    });
    return json({
      queued: true,
      accepted: true,
      jobId: job.id,
      message: `已让工人机在 F:\\音频目录\\${platform || "未分平台"} 下创建「${novelTitle}」文件夹。`
    });
  }

  if (method === "POST" && pathname === "/api/audio-library/sync-local") {
    const payload = await buildAudioGeneratePayload(db, await readJson(request));
    const job = await enqueueJob(db, {
      type: "audio-generate",
      title: `下发 ${payload.items.length} 条小说音频`,
      payload,
      createdBy: session.user.username
    });
    return json({
      queued: true,
      accepted: true,
      jobId: job.id,
      count: payload.items.length,
      message: `已下发 ${payload.items.length} 条到本机工人，生成后传到线上网页，并写入 F:\\音频目录。`
    });
  }

  const audioProgress = pathname.match(/^\/api\/audio-library\/progress\/([^/]+)$/);
  if (method === "GET" && audioProgress) {
    const job = await getJob(db, decodeURIComponent(audioProgress[1]));
    if (!job) return errorJson("音频任务不存在。", 404);
    return json(publicJob(job));
  }

  const audioFile = pathname.match(/^\/api\/audio-library\/([^/]+)\/file$/);
  if (method === "GET" && audioFile) {
    const audioId = decodeURIComponent(audioFile[1] || "");
    const response = await serveNovelAudio(env, audioId, request);
    if (!response) {
      return errorJson("网页还没有这份试听文件。重新生成后，工人机会在配音完成时传到线上。", 404);
    }
    return response;
  }

  if (method === "GET" && pathname === "/api/elevenlabs/voices") {
    const settings = await kvGet(db, "novel-seed-settings", {});
    const provider = String(url.searchParams.get("provider") || "").trim();
    if (provider === "kokoro") {
      return json(listKokoroVoices({ defaultVoiceId: String(settings.voiceId || "").trim() }));
    }
    const apiKey = String(env.ELEVENLABS_API_KEY || "").trim();
    if (!apiKey) {
      return errorJson("线上未配置 ElevenLabs API Key。请在 Cloudflare Worker 写入 ELEVENLABS_API_KEY。", 400);
    }
    try {
      return json(await listElevenLabsVoices({
        apiKey,
        defaultVoiceId: String(settings.voiceId || "").trim()
      }));
    } catch (error) {
      return errorJson(error.message || "读取 ElevenLabs 声音失败。", error.statusCode || 502);
    }
  }

  if (method === "GET" && /^\/api\/elevenlabs\/voices\/[^/]+\/preview$/.test(pathname)) {
    const voiceId = decodeURIComponent(pathname.split("/")[4] || "");
    if (isKokoroVoiceId(voiceId)) {
      return redirect(`/kokoro-previews/${voiceId}.mp3`);
    }
    return null;
  }

  if (method === "GET" && pathname === "/api/audio-library") {
    return json({ items: [] });
  }

  return null;
}

async function handleOperator(request, db, url, session) {
  const match = url.pathname.match(/^\/api\/operator\/(third-party|official)(\/.*)?$/);
  const scope = match?.[1] || "default";
  const rest = match ? `/api/operator${match[2] || ""}` : url.pathname;
  const key = `operator-${scope}`;
  const method = request.method;
  const settings = await kvGet(db, key, defaultOperatorSettings(scope));

  if (method === "GET" && rest === "/api/operator/status") {
    return json({
      enabled: Boolean(settings.enabled),
      autoCreateTasks: Boolean(settings.autoCreateTasks),
      running: false,
      nextRunAt: 0,
      cycle: { phase: "idle" },
      lastPlan: null,
      codex: null,
      deepseek: null,
      settings
    });
  }
  if (method === "GET" && rest === "/api/operator/overview") {
    return json({
      accounts: [],
      totals: {},
      official: scope === "official",
      message: scope === "official" ? "官方运营数据来自主站授权账号。" : "GeeLark 运营数据由工人机同步后写入。"
    });
  }
  if (method === "POST" && rest === "/api/operator/settings") {
    const next = { ...settings, ...await readJson(request), updatedAt: now() };
    await kvSet(db, key, next);
    return json({ settings: next });
  }
  if (method === "POST" && rest === "/api/operator/reset-judgments") {
    const next = { ...settings, analysisResetAt: now(), updatedAt: now() };
    await kvSet(db, key, next);
    return json({ settings: next });
  }
  if (method === "GET" && rest === "/api/operator/plans") {
    return json({ plans: await kvGet(db, `${key}-plans`, []) });
  }
  if (method === "POST" && rest === "/api/operator/plans") {
    const plan = { id: safeId(`plan-${now()}`), createdBy: session.user.username, createdAt: now(), ...(await readJson(request)) };
    const plans = await kvGet(db, `${key}-plans`, []);
    plans.unshift(plan);
    await kvSet(db, `${key}-plans`, plans.slice(0, 100));
    return json({ plan }, 201);
  }
  return null;
}

function defaultPsychology() {
  return {
    kieApiKey: "",
    elevenLabsApiKey: "",
    elevenLabsVoiceId: "",
    elevenLabsModelId: "eleven_multilingual_v2",
    imageModels: ["nano-banana"],
    totalVideos: 1,
    aspectRatio: "16:9",
    titlePosition: 14,
    titleFontSize: 68,
    motion: "test-motion",
    backgroundMusicDir: "",
    backgroundMusicVolume: 0.1
  };
}

function normalizeTaskType(value) {
  if (value === "psychology") return "psychology";
  if (value === "schulte") return "schulte";
  return "reddit-mix";
}

function normalizeRedditGeneration(value = {}) {
  const generation = value && typeof value === "object" ? { ...value } : {};
  generation.videoTemplate = normalizeVideoTemplate(generation.videoTemplate);
  if (generation.videoTemplate === "parkour") {
    generation.videoDir = resolveParkourVideoDir(generation.videoDir);
    generation.assetGroupId = "";
  }
  generation.audioDirs = (Array.isArray(generation.audioDirs) ? generation.audioDirs : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const audioDir = String(generation.audioDir || "").trim();
  if (audioDir && !generation.audioDirs.includes(audioDir)) generation.audioDirs.unshift(audioDir);
  if (!generation.audioDir && generation.audioDirs[0]) generation.audioDir = generation.audioDirs[0];
  return generation;
}

function hasMixAudio(generation = {}) {
  if (String(generation.audioDir || "").trim()) return true;
  if (Array.isArray(generation.audioDirs) && generation.audioDirs.some((item) => String(item || "").trim())) return true;
  if (Array.isArray(generation.audioItems) && generation.audioItems.length) return true;
  return false;
}

function defaultOperatorSettings(scope) {
  return {
    enabled: false,
    autoCreateTasks: false,
    dataStrategy: scope === "official" ? "official_api" : "geelark",
    profileId: scope === "official" ? "official" : "default",
    groupNames: [],
    maxDailyVideos: 20
  };
}

function publicAssetGroups(groups) {
  return (Array.isArray(groups) ? groups : []).map((group) => {
    const totalAssets = Number(group.totalAssets ?? group.clipCount ?? group.assetCount ?? group.videoCount ?? (group.assets || []).length) || 0;
    return {
      ...group,
      totalAssets,
      clipCount: Number(group.clipCount || totalAssets) || totalAssets
    };
  });
}

function publicAudioGroups(groups) {
  return (Array.isArray(groups) ? groups : []).map((group) => {
    const paths = Array.isArray(group.paths)
      ? group.paths.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    return {
      id: String(group.id || group.name || "").trim(),
      kind: String(group.kind || "").trim(),
      name: String(group.name || group.id || "").trim(),
      path: String(group.path || paths[0] || group.sourceDir || "").trim(),
      paths,
      totalAssets: Number(group.totalAssets ?? group.clipCount ?? group.fileCount) || 0,
      bookCount: Number(group.bookCount) || 0,
      rootOnly: group.rootOnly === true,
      parentId: String(group.parentId || "").trim(),
      novelId: String(group.novelId || "").trim(),
      platform: String(group.platform || "").trim(),
      promotionCode: String(group.promotionCode || "").trim(),
      promotionCopy: String(group.promotionCopy || "").trim()
    };
  }).filter((group) => group.id && (group.path || group.paths.length));
}

