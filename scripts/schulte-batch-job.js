import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";

const root = process.cwd();
const payloadPath = process.argv[2] ? path.resolve(process.argv[2]) : "";
const jobPath = process.argv[3] ? path.resolve(process.argv[3]) : "";
const TRAINING_MODES = ["sequence", "reverse", "missing", "duplicate"];
const LAYOUT_STYLES = ["classic", "balanced", "focus"];
const BACKGROUND_STYLES = ["mint", "sky", "lavender", "peach", "paper"];
const TRACKING_MODES = ["single", "dual", "triple"];
const TRACKING_BACKGROUNDS = ["forest", "navy", "violet", "graphite", "amber"];
const MEMORY_BACKGROUNDS = ["aqua", "navy", "violet", "forest", "sunset", "rose", "graphite"];

run().catch((error) => {
  updateJob({
    status: "failed",
    percent: 100,
    message: "舒尔特批量生成失败。",
    error: String(error?.message || error),
    updatedAt: Date.now()
  });
  process.exitCode = 1;
});

async function run() {
  if (!payloadPath || !jobPath) throw new Error("缺少舒尔特批量任务参数。");

  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  const total = clamp(payload.totalVideos, 1, 300, 1);
  const allowedTemplates = ["wheel", "tracking", "memory", "peripheral"];
  const templates = Array.from(new Set(
    (Array.isArray(payload.templates) ? payload.templates : [payload.template])
      .filter((template) => allowedTemplates.includes(template))
  ));
  if (!templates.length) templates.push("wheel");
  const primaryTemplate = templates[0];
  const startDay = clamp(payload.startDay ?? payload.day, 1, 999, primaryTemplate === "tracking" ? 46 : 24);
  const baseSeed = clamp(payload.seed, 1, 999999, primaryTemplate === "tracking" ? 4602 : 2407);
  const templateSequence = buildBalancedTemplateSequence(templates, total, baseSeed);
  const templateOccurrences = new Map();
  const runnerPath = path.join(root, "scripts", "schulte-render-job.js");
  const tempDir = path.dirname(jobPath);
  const results = [];
  const warnings = [];
  const usedSeeds = new Set();

  if (!fs.existsSync(runnerPath)) throw new Error("舒尔特单条渲染器不存在。");

  updateJob({
    status: "running",
    error: null,
    percent: 1,
    progressCurrent: 0,
    progressTotal: total,
    attempts: 0,
    failedVideoCount: 0,
    results,
    warnings,
    message: `准备批量生成 ${total} 条舒尔特视频...`,
    updatedAt: Date.now()
  });

  for (let index = 0; index < total; index++) {
    const number = index + 1;
    const template = templateSequence[index];
    const variationIndex = templateOccurrences.get(template) || 0;
    templateOccurrences.set(template, variationIndex + 1);
    const day = ((startDay - 1 + index) % 999) + 1;
    const seed = nextUniqueSeed(baseSeed, index, usedSeeds);
    const trainingMode = resolveBatchVariation(payload.trainingMode, TRAINING_MODES, variationIndex);
    const layoutStyle = resolveBatchVariation(payload.layoutStyle, LAYOUT_STYLES, Math.floor(variationIndex / TRAINING_MODES.length));
    const backgroundStyle = resolveBatchVariation(
      payload.backgroundStyle,
      BACKGROUND_STYLES,
      variationIndex * 2 + Math.floor(variationIndex / TRAINING_MODES.length)
    );
    const trackingMode = resolveBatchVariation(payload.trackingMode, TRACKING_MODES, variationIndex);
    const trackingBackground = resolveBatchVariation(payload.trackingBackground, TRACKING_BACKGROUNDS, variationIndex * 2);
    const memoryBackground = resolveBatchVariation(payload.memoryBackground, MEMORY_BACKGROUNDS, variationIndex * 3);
    const itemId = safeId(`${payload.jobId || "schulte-batch"}-${number}`);
    const itemPayloadPath = path.join(tempDir, `${itemId}.payload.json`);
    const itemJobPath = path.join(tempDir, `${itemId}.json`);
    const itemPayload = {
      ...payload,
      jobId: itemId,
      template,
      durationSeconds: template === "wheel"
        ? clamp(payload.wheelDurationSeconds ?? payload.durationSeconds, 12, 180, 32)
        : payload.durationSeconds,
      day,
      seed,
      trainingMode,
      layoutStyle,
      backgroundStyle,
      trackingMode,
      trackingBackground,
      memoryBackground
    };

    fs.writeFileSync(itemPayloadPath, JSON.stringify(itemPayload, null, 2), "utf8");
    fs.writeFileSync(itemJobPath, JSON.stringify({
      jobId: itemId,
      status: "queued",
      percent: 1,
      message: `等待生成第 ${number}/${total} 条视频。`,
      createdAt: Date.now()
    }, null, 2), "utf8");

    updateJob({
      status: "running",
      percent: Math.max(2, Math.floor(index / total * 100)),
      progressCurrent: index,
      progressTotal: total,
      attempts: number,
      failedVideoCount: warnings.length,
      results,
      warnings,
      message: template === "tracking"
        ? `正在生成第 ${number}/${total} 条 · DAY ${day} · ${trackingVariationLabel(trackingMode)} · ${trackingBackgroundLabel(trackingBackground)}`
        : template === "memory"
          ? `正在生成第 ${number}/${total} 条 · DAY ${day} · ${templateLabel(template)} · ${memoryBackgroundLabel(memoryBackground)} · 随机题目 ${seed}`
          : template === "peripheral"
            ? `正在生成第 ${number}/${total} 条 · DAY ${day} · ${templateLabel(template)} · 随机题目 ${seed}`
          : `正在生成第 ${number}/${total} 条 · DAY ${day} · ${variationLabel(trainingMode, seed)} · ${layoutLabel(layoutStyle)} · ${backgroundLabel(backgroundStyle)}`,
      updatedAt: Date.now()
    });

    const child = spawnSync(process.execPath, [runnerPath, itemPayloadPath, itemJobPath], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024
    });

    const itemJob = readJson(itemJobPath, {});
    if (child.status === 0 && itemJob.status === "done" && itemJob.result?.fileName) {
      results.push({
        ...itemJob.result,
        template: `schulte-${template}`,
        templateLabel: templateLabel(template),
        day,
        seed,
        sourceName: template === "tracking"
          ? `DAY ${day} · ${trackingVariationLabel(trackingMode)} · ${trackingBackgroundLabel(trackingBackground)}`
          : template === "memory"
            ? `DAY ${day} · ${templateLabel(template)} · ${memoryBackgroundLabel(memoryBackground)} · 随机题目 ${seed}`
            : template === "peripheral"
              ? `DAY ${day} · ${templateLabel(template)} · 随机题目 ${seed}`
            : `DAY ${day} · ${variationLabel(trainingMode, seed)} · ${layoutLabel(layoutStyle)} · ${backgroundLabel(backgroundStyle)}`
      });
    } else {
      const detail = String(itemJob.error || child.error?.message || child.stderr || child.stdout || `退出码 ${child.status}`).trim();
      warnings.push(`第 ${number} 条生成失败：${detail.slice(-600)}`);
    }

    cleanup(itemPayloadPath);
    cleanup(itemJobPath);

    updateJob({
      status: "running",
      percent: Math.max(2, Math.floor(number / total * 100)),
      progressCurrent: number,
      progressTotal: total,
      attempts: number,
      failedVideoCount: warnings.length,
      results,
      warnings,
      message: warnings.length
        ? `已处理 ${number}/${total} 条，成功 ${results.length} 条，跳过 ${warnings.length} 条失败视频。`
        : `已生成 ${number}/${total} 条舒尔特视频。`,
      updatedAt: Date.now()
    });
  }

  if (!results.length) {
    throw new Error(warnings.at(-1) || "本批次没有成功生成视频。");
  }

  updateJob({
    status: "done",
    error: null,
    percent: 100,
    progressCurrent: total,
    progressTotal: total,
    attempts: total,
    failedVideoCount: warnings.length,
    results,
    warnings,
    message: warnings.length
      ? `舒尔特批量生成完成：成功 ${results.length} 条，跳过 ${warnings.length} 条失败视频。`
      : `舒尔特批量生成完成，共 ${results.length} 条。`,
    updatedAt: Date.now()
  });
}

function templateLabel(template) {
  return ({
    wheel: "舒尔特模板 1",
    tracking: "舒尔特模板 2",
    memory: "舒尔特模板 4",
    peripheral: "舒尔特模板 5"
  })[template] || "舒尔特训练";
}

function buildBalancedTemplateSequence(templates, total, seed) {
  const sequence = [];
  for (let cycle = 0; sequence.length < total; cycle++) {
    const shuffled = seededShuffle(templates, Number(seed) + cycle * 7919);
    for (const template of shuffled) {
      if (sequence.length >= total) break;
      sequence.push(template);
    }
  }
  return sequence;
}

function seededShuffle(values, seed) {
  const result = [...values];
  let state = (Math.abs(Math.trunc(Number(seed) || 1)) >>> 0) || 1;
  for (let index = result.length - 1; index > 0; index--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function nextUniqueSeed(baseSeed, index, usedSeeds) {
  let seed = ((baseSeed - 1 + index * 104729) % 999999) + 1;
  while (usedSeeds.has(seed)) seed = seed >= 999999 ? 1 : seed + 1;
  usedSeeds.add(seed);
  return seed;
}

function resolveBatchVariation(value, options, index) {
  return options.includes(value) ? value : options[Math.abs(index) % options.length];
}

function variationLabel(value, seed) {
  const challengeNumber = (Math.abs(Number(seed) || 0) % 36) + 1;
  return ({
    sequence: "顺序寻找",
    reverse: "倒序寻找",
    missing: `缺失数字 ${challengeNumber}`,
    duplicate: `重复数字 ${challengeNumber}`
  })[value] || "顺序寻找";
}

function layoutLabel(value) {
  return ({
    classic: "经典 6 / 12 / 18",
    balanced: "均衡 8 / 12 / 16",
    focus: "聚焦 6 / 10 / 20"
  })[value] || "经典 6 / 12 / 18";
}

function backgroundLabel(value) {
  return ({
    mint: "薄荷背景",
    sky: "天蓝背景",
    lavender: "紫灰背景",
    peach: "暖杏背景",
    paper: "纸白背景"
  })[value] || "薄荷背景";
}

function trackingVariationLabel(value) {
  return ({single: "单目标", dual: "双目标", triple: "三目标"})[value] || "单目标";
}

function trackingBackgroundLabel(value) {
  return ({forest: "深林绿", navy: "深海蓝", violet: "暗夜紫", graphite: "石墨灰", amber: "琥珀棕"})[value] || "深林绿";
}

function memoryBackgroundLabel(value) {
  return ({
    aqua: "冰川青",
    navy: "深海蓝",
    violet: "暮光紫",
    forest: "森林绿",
    sunset: "日落橙",
    rose: "玫瑰粉",
    graphite: "石墨黑"
  })[value] || "冰川青";
}

function updateJob(patch) {
  const current = readJson(jobPath, {});
  const tempPath = `${jobPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify({...current, ...patch}, null, 2), "utf8");
  if (fs.existsSync(jobPath)) fs.rmSync(jobPath);
  fs.renameSync(tempPath, jobPath);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function cleanup(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
  } catch {
    // Temporary files are harmless and can be cleared with the job cache.
  }
}

function safeId(value) {
  return String(value || "schulte")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || "schulte";
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}
