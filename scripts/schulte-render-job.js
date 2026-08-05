import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {readConfig} from "./video-core.js";
import {resolveStorageDirs} from "./storage-paths.js";

const root = process.cwd();
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg"]);
const TRAINING_MODES = ["sequence", "reverse", "missing", "duplicate"];
const LAYOUT_STYLES = ["classic", "balanced", "focus"];
const BACKGROUND_STYLES = ["mint", "sky", "lavender", "peach", "paper"];
const TRACKING_MODES = ["single", "dual", "triple"];
const TRACKING_BACKGROUNDS = ["forest", "navy", "violet", "graphite", "amber"];
const MEMORY_BACKGROUNDS = ["aqua", "navy", "violet", "forest", "sunset", "rose", "graphite"];
const payloadPath = process.argv[2] ? path.resolve(process.argv[2]) : "";
const jobPath = process.argv[3] ? path.resolve(process.argv[3]) : "";

run().catch((error) => {
  updateJob({
    status: "failed",
    percent: 100,
    message: "舒尔特训练样片生成失败。",
    error: error.message || "舒尔特训练样片生成失败。",
    updatedAt: Date.now()
  });
  process.exitCode = 1;
});

async function run() {
  if (!payloadPath || !jobPath) throw new Error("缺少舒尔特任务参数。");

  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  const config = readConfig(root);
  const {outputDir} = resolveStorageDirs(root, config);
  const projectDir = path.join(root, "schulte-grid-generator");
  const entry = path.join(projectDir, "src", "web-index.jsx");
  const publicDir = path.join(projectDir, "public");

  if (!fs.existsSync(entry)) throw new Error("舒尔特 Remotion 项目不存在。");
  fs.mkdirSync(outputDir, {recursive: true});

  const template = ["wheel", "tracking", "memory", "peripheral"].includes(payload.template)
    ? payload.template
    : "wheel";
  const day = clamp(payload.day, 1, 999, template === "tracking" ? 46 : 24);
  const seed = clamp(payload.seed, 1, 999999, template === "tracking" ? 4602 : 2407);
  const trackingSeconds = clamp(payload.trackingSeconds, 10, 90, 30);
  const durationSeconds = template === "tracking"
    ? trackingSeconds + 7
    : ["memory", "peripheral"].includes(template)
      ? 16
      : clamp(payload.durationSeconds, 12, 180, 32);
  const trainingStartsAt = clampDecimal(payload.trainingStartsAt, 3, Math.max(3, durationSeconds - 2), 4);
  const instructionStartsAt = clampDecimal(payload.instructionStartsAt, 1, Math.max(1, trainingStartsAt - 0.5), 2);
  const rotationSpeed = clampDecimal(payload.rotationSpeed, 0.25, 3, 2.5);
  const trainingMode = resolveVariation(payload.trainingMode, TRAINING_MODES, seed);
  const layoutStyle = resolveVariation(payload.layoutStyle, LAYOUT_STYLES, seed * 3 + day);
  const backgroundStyle = resolveVariation(payload.backgroundStyle, BACKGROUND_STYLES, seed * 7 + day);
  const trackingMode = resolveVariation(payload.trackingMode, TRACKING_MODES, seed + day);
  const trackingBackground = resolveVariation(payload.trackingBackground, TRACKING_BACKGROUNDS, seed * 5 + day);
  const memoryBackground = resolveVariation(payload.memoryBackground, MEMORY_BACKGROUNDS, seed * 11 + day);
  const instructionLanguage = payload.instructionLanguage === "en" ? "en" : "zh";
  const ballSpeed = clampDecimal(payload.ballSpeed, 0.5, 3, 1);
  const memorySteps = clamp(payload.memorySteps, 4, 8, 6);
  const peripheralTargets = clamp(payload.peripheralTargets, 2, 5, 3);
  const headline = String(
    payload.headline || (template === "tracking" ? "每日前额叶训练" : "专注力改造计划")
  ).trim().slice(0, 24);
  const mainTitle = String(payload.mainTitle || "每日前额叶训练").trim().slice(0, 24);
  const backgroundMusicMode = ["local", "built-in", "off"].includes(payload.backgroundMusicMode)
    ? payload.backgroundMusicMode
    : (String(payload.backgroundMusicDir || "").trim() ? "local" : (payload.backgroundMusicEnabled === false ? "off" : "built-in"));
  const backgroundMusicEnabled = backgroundMusicMode !== "off";
  const backgroundMusicVolume = clampDecimal(payload.backgroundMusicVolume, 0, 1, 0.35);
  const compositionId = ({
    wheel: "SchulteFocusWeb",
    tracking: "SchulteTrackingWeb",
    memory: "SchulteConcept4",
    peripheral: "SchulteConcept5"
  })[template];
  const outputName = buildOutputName({
    template,
    day,
    seed,
    trainingMode,
    layoutStyle,
    backgroundStyle,
    trackingMode,
    trackingBackground,
    memoryBackground,
    memorySteps,
    peripheralTargets
  });
  const outputPath = path.join(outputDir, outputName);
  const propsPath = path.join(path.dirname(jobPath), `${payload.jobId}.schulte-props.json`);
  const customMusic = prepareBackgroundMusic({
    mode: backgroundMusicMode,
    directory: payload.backgroundMusicDir,
    publicDir,
    jobId: payload.jobId,
    seed,
    day
  });
  const props = template === "tracking"
    ? {
        day,
        seed,
        trackingSeconds,
        ballSpeed,
        trackingMode,
        trackingBackground,
        headline,
        instructionLanguage,
        backgroundMusicEnabled,
        backgroundMusicVolume,
        backgroundMusicFile: customMusic.publicName
      }
      : template === "memory"
        ? {
            day,
            seed,
            headline,
            mainTitle,
            memorySteps,
            memoryBackground,
            instructionLanguage,
            backgroundMusicEnabled,
            backgroundMusicVolume,
            backgroundMusicFile: customMusic.publicName
          }
      : template === "peripheral"
        ? {
            day,
            seed,
            headline,
            mainTitle,
            peripheralTargets,
            instructionLanguage,
            backgroundMusicEnabled,
            backgroundMusicVolume,
            backgroundMusicFile: customMusic.publicName
          }
    : {
        day,
        seed,
        durationSeconds,
        trainingStartsAt,
        instructionStartsAt,
        rotationSpeed,
        trainingMode,
        layoutStyle,
        backgroundStyle,
        headline,
        mainTitle,
        backgroundMusicEnabled,
        backgroundMusicVolume,
        backgroundMusicFile: customMusic.publicName,
        instructionLanguage,
        rangeStart: 1,
        rangeEnd: 36
      };

  fs.writeFileSync(propsPath, JSON.stringify(props, null, 2), "utf8");

  updateJob({
    status: "running",
    error: null,
    percent: 12,
    message: `正在准备${templateName(template)}的随机题目...`,
    updatedAt: Date.now()
  });

  const command = process.execPath;
  const remotionCli = path.join(root, "node_modules", "@remotion", "cli", "remotion-cli.js");
  if (!fs.existsSync(remotionCli)) throw new Error("Remotion CLI 不存在，请先安装项目依赖。");
  const args = [
    remotionCli,
    "render",
    entry,
    compositionId,
    outputPath,
    "--props",
    propsPath,
    "--public-dir",
    publicDir,
    "--codec",
    "h264",
    "--crf",
    "20",
    "--concurrency",
    "4",
    "--overwrite"
  ];

  const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  if (fs.existsSync(chromePath)) args.push("--browser-executable", chromePath);

  updateJob({
    status: "running",
    percent: 30,
    message: `Remotion 正在渲染${templateName(template)}动画...`,
    renderStartedAt: Date.now(),
    estimatedRenderMs: Math.max(30000, durationSeconds * 1900),
    updatedAt: Date.now()
  });

  const result = spawnSync(command, args, {
    cwd: projectDir,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });

  try {
    fs.unlinkSync(propsPath);
  } catch {
    // Cleanup is best effort.
  }
  cleanupFile(customMusic.copiedPath);

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(detail.slice(-3000) || `Remotion 退出码 ${result.status}`);
  }
  if (!fs.existsSync(outputPath)) throw new Error("Remotion 未输出视频文件。");

  updateJob({
    status: "done",
    percent: 100,
    message: `${templateName(template)}样片生成完成。`,
    result: {
      template,
      videoUrl: `/outputs/${encodeURIComponent(outputName)}`,
      fileName: outputName,
      day,
      seed,
      durationSeconds,
      backgroundMusic: customMusic.sourceName || (backgroundMusicEnabled ? "内置专注音乐" : "无"),
      rotationSpeed,
      trainingMode,
      layoutStyle,
      backgroundStyle,
      trackingSeconds,
      ballSpeed,
      trackingMode,
      trackingBackground,
      memoryBackground,
      memorySteps,
      peripheralTargets
    },
    updatedAt: Date.now()
  });
}

function templateName(template) {
  return ({
    wheel: "旋转数字圆盘",
    tracking: "小球视觉追踪",
    memory: "网格位置记忆",
    peripheral: "周边闪视捕捉"
  })[template] || "舒尔特训练";
}

function buildOutputName({
  template,
  day,
  seed,
  trainingMode,
  layoutStyle,
  backgroundStyle,
  trackingMode,
  trackingBackground,
  memoryBackground,
  memorySteps,
  peripheralTargets
}) {
  const details = template === "wheel"
    ? [
        trainingModeName(trainingMode, seed),
        layoutStyleName(layoutStyle),
        backgroundStyleName(backgroundStyle)
      ]
    : template === "tracking"
      ? [trackingModeName(trackingMode), trackingBackgroundName(trackingBackground)]
      : template === "memory"
        ? [`${memorySteps}步记忆`, memoryBackgroundName(memoryBackground)]
        : [`${peripheralTargets}目标`];
  const segments = [
    "舒尔特",
    templateFileName(template),
    `DAY${day}`,
    ...details,
    `种子${seed}`,
    Date.now()
  ];
  return `${segments.map(safeOutputSegment).filter(Boolean).join("-")}.mp4`;
}

function templateFileName(template) {
  return ({wheel: "模板1", tracking: "模板2", memory: "模板4", peripheral: "模板5"})[template] || "训练";
}

function trainingModeName(value, seed) {
  const challengeNumber = (Math.abs(Number(seed) || 0) % 36) + 1;
  return ({
    sequence: "顺序寻找",
    reverse: "倒序寻找",
    missing: `缺失数字${challengeNumber}`,
    duplicate: `重复数字${challengeNumber}`
  })[value] || "顺序寻找";
}

function layoutStyleName(value) {
  return ({
    classic: "经典6-12-18",
    balanced: "均衡8-12-16",
    focus: "聚焦6-10-20"
  })[value] || "经典6-12-18";
}

function backgroundStyleName(value) {
  return ({
    mint: "薄荷背景",
    sky: "天蓝背景",
    lavender: "紫灰背景",
    peach: "暖杏背景",
    paper: "纸白背景"
  })[value] || "薄荷背景";
}

function trackingModeName(value) {
  return ({single: "单目标", dual: "双目标", triple: "三目标"})[value] || "单目标";
}

function trackingBackgroundName(value) {
  return ({forest: "深林绿", navy: "深海蓝", violet: "暗夜紫", graphite: "石墨灰", amber: "琥珀棕"})[value] || "深林绿";
}

function memoryBackgroundName(value) {
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

function safeOutputSegment(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function updateJob(patch) {
  const current = fs.existsSync(jobPath)
    ? JSON.parse(fs.readFileSync(jobPath, "utf8"))
    : {};
  fs.writeFileSync(jobPath, JSON.stringify({...current, ...patch}, null, 2), "utf8");
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function clampDecimal(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function resolveVariation(value, options, seed) {
  return options.includes(value) ? value : options[Math.abs(Math.floor(Number(seed) || 0)) % options.length];
}

function prepareBackgroundMusic({mode, directory, publicDir, jobId, seed, day}) {
  if (mode !== "local") return {publicName: "focus-ambient.wav", copiedPath: "", sourceName: ""};
  const folder = path.resolve(String(directory || "").trim());
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    throw new Error(`背景音乐文件夹不存在：${folder}`);
  }
  const files = listAudioFiles(folder);
  if (!files.length) {
    throw new Error("选择的背景音乐文件夹中没有可用音频，请放入 MP3、WAV、M4A、AAC 或 OGG。");
  }
  const selected = files[Math.abs(Number(seed) + Number(day) * 31) % files.length];
  const extension = path.extname(selected).toLowerCase();
  const publicName = `schulte-music-${safeFileName(jobId)}${extension}`;
  const copiedPath = path.join(publicDir, publicName);
  fs.copyFileSync(selected, copiedPath);
  return {publicName, copiedPath, sourceName: path.basename(selected)};
}

function listAudioFiles(folder) {
  const results = [];
  const stack = [folder];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) results.push(fullPath);
    }
  }
  return results.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function cleanupFile(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
  } catch {
    // Temporary music copies are harmless and can be removed later.
  }
}

function safeFileName(value) {
  return String(value || Date.now())
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || String(Date.now());
}
