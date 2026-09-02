import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { normalizeQuizPayload } from "./quiz-content.js";
import { readConfig } from "./video-core.js";
import { resolveStorageDirs } from "./storage-paths.js";

const root = process.cwd();
const payloadPath = process.argv[2] ? path.resolve(process.argv[2]) : "";
const jobPath = process.argv[3] ? path.resolve(process.argv[3]) : "";

run().catch((error) => {
  updateJob({
    status: "failed",
    percent: 100,
    message: "测试题视频生成失败。",
    error: error.message || "测试题视频生成失败。",
    updatedAt: Date.now()
  });
  process.exitCode = 1;
});

async function run() {
  if (!payloadPath || !jobPath) throw new Error("缺少测试题任务参数。");
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  const quiz = normalizeQuizPayload(payload);
  const config = readConfig(root);
  const { outputDir } = resolveStorageDirs(root, config);
  const projectDir = path.join(root, "quiz-video-generator");
  const entry = path.join(projectDir, "src", "index.jsx");
  const publicDir = path.join(projectDir, "public");
  const remotionCli = path.join(root, "node_modules", "@remotion", "cli", "remotion-cli.js");
  if (!fs.existsSync(entry)) throw new Error("测试题 Remotion 项目不存在。");
  if (!fs.existsSync(remotionCli)) throw new Error("Remotion CLI 不存在，请先安装项目依赖。");
  fs.mkdirSync(outputDir, { recursive: true });

  const builtInMusic = path.join(publicDir, "focus-ambient.wav");
  const props = {
    ...quiz,
    backgroundMusicEnabled: quiz.backgroundMusicEnabled && fs.existsSync(builtInMusic),
    backgroundMusicFile: "focus-ambient.wav"
  };
  const outputName = buildOutputName(quiz);
  const outputPath = path.join(outputDir, outputName);
  const propsPath = path.join(path.dirname(jobPath), `${safeSegment(payload.jobId)}.quiz-props.json`);
  fs.writeFileSync(propsPath, JSON.stringify(props, null, 2), "utf8");

  updateJob({
    status: "running",
    error: null,
    percent: 12,
    message: `正在排版 ${quiz.questions.length} 道测试题...`,
    updatedAt: Date.now()
  });

  const args = [
    remotionCli,
    "render",
    entry,
    "QuizPaper",
    outputPath,
    "--props",
    propsPath,
    "--codec",
    "h264",
    "--crf",
    "20",
    "--concurrency",
    "3",
    "--overwrite"
  ];
  if (fs.existsSync(publicDir)) args.push("--public-dir", publicDir);
  const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  if (fs.existsSync(chromePath)) args.push("--browser-executable", chromePath);

  updateJob({
    status: "running",
    percent: 30,
    message: "正在渲染试卷下滚与红笔揭晓动画...",
    renderStartedAt: Date.now(),
    estimatedRenderMs: Math.max(45000, quiz.durationSeconds * 1750),
    updatedAt: Date.now()
  });

  const result = spawnSync(process.execPath, args, {
    cwd: projectDir,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  try { fs.unlinkSync(propsPath); } catch { /* best effort */ }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(detail.slice(-3000) || `Remotion 退出码 ${result.status}`);
  }
  if (!fs.existsSync(outputPath)) throw new Error("Remotion 未输出测试题视频。");

  const renderedArtifact = {
    template: "quiz",
    videoUrl: `/outputs/${encodeURIComponent(outputName)}`,
    fileName: outputName,
    title: quiz.title,
    language: quiz.language,
    questionCount: quiz.questions.length,
    durationSeconds: quiz.durationSeconds,
    seed: quiz.seed,
    backgroundMusic: props.backgroundMusicEnabled ? "内置轻音乐" : "无"
  };
  updateJob({
    status: "done",
    percent: 100,
    message: "测试题视频生成完成。",
    result: renderedArtifact,
    results: [renderedArtifact],
    generatedVideos: [renderedArtifact],
    updatedAt: Date.now()
  });
}

function buildOutputName(quiz) {
  const language = quiz.language === "zh" ? "中文" : "English";
  return ["测试题", language, `${quiz.questions.length}题`, `种子${quiz.seed}`, Date.now()]
    .map(safeSegment)
    .filter(Boolean)
    .join("-") + ".mp4";
}

function safeSegment(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56) || String(Date.now());
}

function updateJob(patch) {
  if (!jobPath) return;
  const current = fs.existsSync(jobPath) ? JSON.parse(fs.readFileSync(jobPath, "utf8")) : {};
  fs.writeFileSync(jobPath, JSON.stringify({ ...current, ...patch }, null, 2), "utf8");
}
