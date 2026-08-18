import { errorJson, json, now, readJson, safeId } from "./http.js";
import { applyJobToTask, cancelJob, enqueueJob, getJob } from "./jobs.js";
import { kvGet, kvSet } from "./kv.js";

export async function handleCompat(request, env, url, session) {
  if (!session) return null;
  const db = env.DB;
  const method = request.method;
  const pathname = url.pathname;

  if (method === "POST" && pathname === "/api/select-directory") {
    return errorJson("云端不支持弹出本机文件夹。请直接填写工人机上的路径，或在本机工人配置里指定素材目录。", 400);
  }

  if (method === "GET" && pathname === "/api/asset-groups") {
    return json({ groups: await kvGet(db, "asset-groups", []), usage: await kvGet(db, "asset-usage", {}) });
  }
  if (method === "GET" && pathname === "/api/shared-libraries") {
    return json({ libraries: await kvGet(db, "shared-libraries", []) });
  }
  if (method === "GET" && pathname === "/api/asset-usage") {
    return json({ groupId: url.searchParams.get("groupId") || "", clips: [], totals: { used: 0, unused: 0 } });
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
      const generation = payload.generation && typeof payload.generation === "object" ? payload.generation : {};
      const publish = payload.publish && typeof payload.publish === "object" ? payload.publish : {};
      if (taskType === "reddit-mix") {
        if (!String(generation.audioDir || "").trim() && !(Array.isArray(generation.audioItems) && generation.audioItems.length)) {
          return errorJson("请勾选混剪小说，或填写工人机上的音频目录。", 400);
        }
        if (!String(generation.videoDir || "").trim() && !String(generation.assetGroupId || "").trim()) {
          return errorJson("请选择素材组，或填写工人机上的视频素材目录。", 400);
        }
      }
      const task = {
        id: safeId(`task-${now()}`),
        name: String(payload.name || payload.taskType || "云端任务"),
        taskType,
        status: "queued",
        phase: "queued",
        message: "已下发本机混剪队列，等待 Local Factory 拉单。",
        progress: { current: 0, total: 0, percent: 1 },
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
      if (task.generationJobId) await cancelJob(db, task.generationJobId);
      await kvSet(db, "auto-tasks", tasks);
      return json({ ok: true });
    }
    if (method === "POST" && taskMatch[2] === "cancel") {
      if (task.generationJobId) await cancelJob(db, task.generationJobId);
      task.status = "canceled";
      task.phase = "canceled";
      task.message = "已取消";
      task.updatedAt = now();
      await kvSet(db, "auto-tasks", tasks);
      return json({ task });
    }
    if (method === "POST" && taskMatch[2] === "resume") {
      const job = await enqueueJob(db, {
        type: normalizeTaskType(task.taskType),
        title: task.name,
        payload: {
          ...(task.generation || {}),
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
      return errorJson("发布重试仍由本机出片完成后走官方通道，当前先完成混剪下发。", 501);
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

  if (method === "GET" && pathname === "/api/kie-ai") {
    return json({ configured: false, tasks: [], credit: null, cloud: true });
  }
  if (method === "POST" && pathname === "/api/kie-ai") {
    await enqueueJob(db, { type: "kie-ai", title: "Kie 生图", payload: await readJson(request), createdBy: session.user.username });
    return json({ accepted: true, queued: true, message: "生图请求已记录，工人机或后续云端 Kie 调用会处理。" });
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
