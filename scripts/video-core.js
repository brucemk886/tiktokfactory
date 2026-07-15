import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveStorageDirs } from "./storage-paths.js";

export function ensureProject(root, config = readConfig(root)) {
  const { outputDir, workDir } = resolveStorageDirs(root, config);
  ensureDir(path.join(root, "input", "scripts"));
  ensureDir(path.join(root, "input", "audio"));
  ensureDir(outputDir);
  ensureDir(workDir);
}

export function readConfig(root) {
  return readJson(path.join(root, "config.json"));
}

export function renderPodcastVideo({
  root,
  config,
  id,
  scriptText,
  title = "",
  audioPath = null,
  backgroundPath = null,
  backgroundColor = "",
  template = "player",
  duration = null,
  captions = null,
  captionPositions = null
}) {
  ensureProject(root, config);
  const { outputDir, workDir } = resolveStorageDirs(root, config);

  const videoTitle = String(title || "").trim() || firstMeaningfulLine(scriptText) || id;
  const outputPath = path.join(outputDir, `${id}.mp4`);
  const shouldBurnCaptions = hasCaptionCues(captions) && supportsCaptionTemplate(template);
  const renderOutputPath = shouldBurnCaptions
    ? path.join(workDir, `${id}.no-captions.mp4`)
    : outputPath;
  const resolvedDuration = audioPath ? probeDuration(audioPath, config.defaultDuration) : duration;
  const safeDuration = Number.isFinite(resolvedDuration) && resolvedDuration > 0
    ? resolvedDuration
    : config.defaultDuration;

  if (!supportsActiveTemplate(template)) {
    throw new Error(`Unsupported template: ${template}`);
  }

  if (template === "minimal-wave" && audioPath) {
    renderFastJournalVideo({ root, config, title: videoTitle, audioPath, backgroundPath, backgroundColor, outputPath: renderOutputPath, duration: safeDuration, id });
  } else if ((template === "center-wave" || template === "player" || template === "journal-wave") && audioPath) {
    renderRemotionVideo({ root, config, title: videoTitle, scriptText, captions, audioPath, backgroundPath, backgroundColor, template, outputPath: renderOutputPath, duration: safeDuration, id });
  } else {
    renderVideo({ config, title: videoTitle, audioPath, backgroundPath, backgroundColor, template, outputPath: renderOutputPath, duration: safeDuration });
  }

  if (shouldBurnCaptions) {
    burnCaptions({ root, id, inputPath: renderOutputPath, outputPath, captions, config, template, captionPositions });
  }

  return { id, outputPath, duration: safeDuration, title: videoTitle };
}

export function findMatchingAudio(root, id, config) {
  const audioDir = path.join(root, "input", "audio");
  const extensions = config.audioExtensions || [".mp3", ".wav", ".m4a", ".aac"];
  for (const ext of extensions) {
    const candidate = path.join(audioDir, `${id}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function renderVideo({ config, title, audioPath, backgroundPath, backgroundColor, template, outputPath, duration }) {
  const width = numberOr(config.width, 1080);
  const height = numberOr(config.height, 1920);
  const fps = numberOr(config.fps, 30);
  const font = ffPath(config.fontFile || "C:/Windows/Fonts/msyh.ttc");
  const controlFont = ffPath(config.controlFontFile || config.fontFile || "C:/Windows/Fonts/seguisym.ttf");
  const bg = cleanHex(backgroundColor || config.background, "000000");
  const text = cleanHex(config.textColor, "f5f5f5");
  const wave = cleanHex(config.waveColor, "ffffff");
  const titleSize = numberOr(config.titleFontSize, Math.round(height * 0.03));
  const timeSize = numberOr(config.timeFontSize, Math.round(height * 0.023));
  const controlSize = numberOr(config.controlFontSize, Math.round(height * 0.046));
  const elapsedTime = elapsedDrawText();
  const remainingTime = countdownDrawText(duration);
  const totalTime = fixedDurationText(duration);
  const safeTitle = escapeDrawText(title);

  const layout = makeLayout({ width, height, template });

  const backgroundInputIndex = backgroundPath ? (audioPath ? 1 : 0) : null;
  const baseSource = backgroundPath
    ? [
        `color=c=${bg}:s=${width}x${height}:r=${fps}:d=${duration}[black]`,
        `[${backgroundInputIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=rgba,colorchannelmixer=aa=0.76[bgimg]`,
        `[black][bgimg]overlay=0:0:format=auto,drawbox=x=0:y=0:w=${width}:h=${height}:color=000000@0.34:t=fill[base]`
      ].join(";")
    : `color=c=${bg}:s=${width}x${height}:r=${fps}:d=${duration}[base]`;

  const common = [
    baseSource,
    `[base]drawtext=fontfile='${font}':text='${safeTitle}':x=(w-tw)/2:y=${layout.titleY}:fontsize=${titleSize}:fontcolor=${text}:borderw=2:bordercolor=000000[title]`
  ];

  if (layout.showTime) {
    common.push(
      `[title]drawtext=fontfile='${font}':text='${elapsedTime}':x=${layout.leftX}:y=${layout.timeY}:fontsize=${timeSize}:fontcolor=${text}:borderw=2:bordercolor=000000[elapsed]`,
      `[elapsed]drawtext=fontfile='${font}':text='${remainingTime}':x=w-tw-${layout.rightX}:y=${layout.timeY}:fontsize=${timeSize}:fontcolor=${text}:borderw=2:bordercolor=000000[total]`
    );
  }

  const waveInput = layout.showTime ? "total" : "title";
  const controls = layout.showControls
    ? [
        `[waveout]drawtext=fontfile='${controlFont}':text='鈾?:x=${layout.heartX}:y=${layout.controlsY}:fontsize=${controlSize}:fontcolor=${text}[heart]`,
        `[heart]drawtext=fontfile='${controlFont}':text='鈼€鈼€':x=${layout.backX}:y=${layout.controlsY}:fontsize=${controlSize}:fontcolor=${text}[back]`,
        `[back]drawbox=x=${layout.pauseX1}:y=${layout.controlsY + Math.round(controlSize * 0.18)}:w=${layout.pauseWidth}:h=${layout.pauseHeight}:color=${text}:t=fill[pause1]`,
        `[pause1]drawbox=x=${layout.pauseX2}:y=${layout.controlsY + Math.round(controlSize * 0.18)}:w=${layout.pauseWidth}:h=${layout.pauseHeight}:color=${text}:t=fill[pause]`,
        `[pause]drawtext=fontfile='${controlFont}':text='鈻垛柖':x=${layout.forwardX}:y=${layout.controlsY}:fontsize=${controlSize}:fontcolor=${text}[forward]`,
        `[forward]drawtext=fontfile='${controlFont}':text='鈽?:x=${layout.menuX}:y=${layout.controlsY}:fontsize=${controlSize}:fontcolor=${text}[v]`
      ]
    : [`[waveout]null[v]`];

  const filters = layout.kind === "journal"
    ? journalTemplateFilters({ baseSource, font, controlFont, title: safeTitle, elapsedTime, totalTime, duration, width, height, layout, hasBackground: Boolean(backgroundPath), backgroundColor: bg })
    : audioPath
      ? [
          ...common,
          audioWaveSource({ color: wave, fps, waveWidth: layout.waveWidth, waveHeight: layout.waveHeight, style: layout.waveStyle }),
          `[${waveInput}][wave]overlay=x=(W-w)/2:y=${layout.waveY}:format=auto[waveout]`,
          ...controls
        ].join(";")
      : [
          ...common,
          dynamicWaveSource({ color: wave, fps, duration, waveWidth: layout.waveWidth, waveHeight: layout.waveHeight }),
          `[${waveInput}][wave]overlay=x=(W-w)/2:y=${layout.waveY}:format=auto[waveout]`,
          ...controls
        ].join(";");

  const args = ["-y", "-hide_banner"];
  if (audioPath) args.push("-i", audioPath);
  if (backgroundPath) args.push("-loop", "1", "-t", String(duration), "-i", backgroundPath);

  args.push("-filter_complex", filters, "-map", "[v]");
  if (audioPath) {
    args.push("-map", "0:a:0", "-shortest");
  } else {
    args.push("-t", String(duration));
  }
  args.push("-c:v", config.videoCodec || "libx264", "-pix_fmt", "yuv420p", "-r", String(fps));
  if (audioPath) args.push("-c:a", config.audioCodec || "aac", "-b:a", "192k");
  args.push(outputPath);

  run("ffmpeg", args);
}

function renderRemotionVideo({ root, config, title, scriptText, captions, audioPath, backgroundPath, backgroundColor, template, outputPath, duration, id }) {
  const { workDir } = resolveStorageDirs(root, config);
  const propsPath = path.join(workDir, `${id}.remotion-props.json`);
  const tempVideoPath = path.join(workDir, `${id}.remotion-video.mp4`);
  const assetDir = path.join(root, "public", "remotion-assets");
  ensureDir(assetDir);
  const audioAssetName = `${id}.audio${path.extname(audioPath) || ".mp3"}`;
  const audioAssetPath = path.join(assetDir, audioAssetName);
  fs.copyFileSync(audioPath, audioAssetPath);

  let backgroundAssetName = "";
  if (backgroundPath) {
    backgroundAssetName = `${id}.background${path.extname(backgroundPath) || ".png"}`;
    fs.copyFileSync(backgroundPath, path.join(assetDir, backgroundAssetName));
  }

  const props = {
    title,
    template,
    width: numberOr(config.width, 1080),
    height: numberOr(config.height, 1920),
    duration,
    audioSrc: `remotion-assets/${audioAssetName}`,
    includeAudio: false,
    backgroundSrc: backgroundAssetName ? `remotion-assets/${backgroundAssetName}` : "",
    backgroundColor: normalizeHexColor(backgroundColor || config.background || "#000000", "#000000"),
    audioLevels: (template === "player" || template === "center-wave" || template === "journal-wave") ? analyzeAudioLevels(audioPath, duration) : null
  };
  fs.writeFileSync(propsPath, JSON.stringify(props, null, 2), "utf8");

  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = [
    "remotion",
    "render",
    cliPath(path.relative(root, path.join(root, "remotion", "index.jsx"))),
    "PodcastVideo",
    cliPath(path.relative(root, tempVideoPath)),
    "--props",
    cliPath(path.relative(root, propsPath)),
    "--overwrite"
  ];

  run(command, args);
  muxAudio({ videoPath: tempVideoPath, audioPath, outputPath, config });
}

function muxAudio({ videoPath, audioPath, outputPath, config }) {
  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-shortest",
    "-c:v",
    "copy",
    "-c:a",
    config.audioCodec || "aac",
    "-b:a",
    "192k",
    outputPath
  ]);
}

function supportsCaptionTemplate(template) {
  return ["player", "center-wave", "minimal-wave", "journal-wave"].includes(template);
}

function supportsActiveTemplate(template) {
  return ["player", "center-wave", "minimal-wave", "journal-wave"].includes(template);
}

function hasCaptionCues(captions) {
  return Array.isArray(captions?.cues) && captions.cues.some((cue) => String(cue?.text || "").trim());
}

function burnCaptions({ root, id, inputPath, outputPath, captions, config, template, captionPositions }) {
  const { workDir } = resolveStorageDirs(root, config);
  const assPath = path.join(workDir, `${id}.captions.ass`);
  const width = numberOr(config.width, 1080);
  const height = numberOr(config.height, 1920);
  const yRatio = resolveCaptionY(template, captionPositions, config);
  fs.writeFileSync(assPath, makeAssSubtitles(captions.cues, { width, height, yRatio }), "utf8");

  run("ffmpeg", [
    "-y",
    "-hide_banner",
    "-i",
    inputPath,
    "-vf",
    `subtitles='${ffPath(assPath).replace(/'/g, "\\'")}'`,
    "-c:v",
    config.videoCodec || "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    outputPath
  ]);
}

function makeAssSubtitles(cues, { width, height, yRatio }) {
  const fontSize = Math.max(44, Math.round(height * 0.04));
  const y = Math.round(height * Math.max(0.2, Math.min(0.82, Number(yRatio) || 0.5)));
  const safeCues = cues
    .map((cue) => ({
      start: Math.max(0, Number(cue.start) || 0),
      end: Math.max(0, Number(cue.end) || 0),
      text: wrapCaptionText(cue.text)
    }))
    .filter((cue) => cue.text && cue.end > cue.start);

  const events = safeCues.map((cue) => {
    return `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,{\\an5\\pos(${Math.round(width / 2)},${y})}${escapeAssText(cue.text)}`;
  }).join("\n");

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Microsoft YaHei,${fontSize},&H00FFFFFF,&H0000FFFF,&H9A000000,&H66000000,-1,0,0,0,100,100,0,0,1,7,1,5,70,70,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`;
}

function resolveCaptionY(template, captionPositions, config) {
  const defaults = {
    player: 0.5,
    "center-wave": 0.68,
    "minimal-wave": 0.46,
    "journal-wave": 0.5
  };
  const configPositions = config.captionPositions && typeof config.captionPositions === "object" ? config.captionPositions : {};
  const payloadPositions = captionPositions && typeof captionPositions === "object" ? captionPositions : {};
  const value = Number(payloadPositions[template] ?? configPositions[template] ?? defaults[template] ?? 0.5);
  return Math.max(0.2, Math.min(0.82, value));
}

function wrapCaptionText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (visibleCaptionLength(text) <= 24) return text;

  const chars = Array.from(text);
  let line = "";
  const lines = [];
  for (const char of chars) {
    const next = `${line}${char}`;
    if (visibleCaptionLength(next) > 22 && line) {
      lines.push(line.trim());
      line = char;
    } else {
      line = next;
    }
    if (lines.length === 1 && visibleCaptionLength(line) > 22) break;
  }
  if (line) lines.push(line.trim());
  return lines.slice(0, 2).join("\\N");
}

function visibleCaptionLength(value) {
  return Array.from(String(value || "")).reduce((sum, char) => sum + (/[\u4e00-\u9fff]/.test(char) ? 2 : 1), 0);
}

function assTime(value) {
  const total = Math.max(0, Number(value) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  const centiseconds = Math.floor((total - Math.floor(total)) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function escapeAssText(value) {
  return String(value || "")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

function renderHyperframesVideo({ root, config, title, audioPath, backgroundPath, backgroundColor, outputPath, duration, id }) {
  const { workDir } = resolveStorageDirs(root, config);
  const width = numberOr(config.width, 1080);
  const height = numberOr(config.height, 1920);
  const fps = numberOr(config.fps, 30);
  const projectDir = path.join(workDir, `hyperframes-${id}`);
  const assetsDir = path.join(projectDir, "assets");
  ensureDir(assetsDir);

  const audioName = `audio${path.extname(audioPath) || ".mp3"}`;
  fs.copyFileSync(audioPath, path.join(assetsDir, audioName));

  let backgroundName = "";
  if (backgroundPath) {
    backgroundName = `background${path.extname(backgroundPath) || ".png"}`;
    fs.copyFileSync(backgroundPath, path.join(assetsDir, backgroundName));
  }

  fs.writeFileSync(path.join(projectDir, "hyperframes.json"), JSON.stringify({
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    paths: {
      blocks: "compositions",
      components: "compositions/components",
      assets: "assets"
    }
  }, null, 2), "utf8");

  fs.writeFileSync(path.join(projectDir, "index.html"), hyperframesPodcastHtml({
    title,
    audioName,
    backgroundName,
    backgroundColor: normalizeHexColor(backgroundColor || config.background || "#050506", "#050506"),
    width,
    height,
    duration,
    audioLevels: analyzeAudioLevels(audioPath, duration)
  }), "utf8");

  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  run(command, [
    "--yes",
    "hyperframes@0.7.26",
    "render",
    "--output",
    outputPath,
    "--quality",
    "standard",
    "--fps",
    String(fps),
    "--workers",
    "1"
  ], { cwd: projectDir, env: hyperframesBrowserEnv() });
}

function renderHyperframesChatVideo({ root, config, title, scriptText, audioPath, backgroundPath, backgroundColor, outputPath, duration, id }) {
  const { workDir } = resolveStorageDirs(root, config);
  const width = numberOr(config.width, 1080);
  const height = numberOr(config.height, 1920);
  const fps = numberOr(config.fps, 30);
  const projectDir = path.join(workDir, `hyperframes-${id}`);
  const assetsDir = path.join(projectDir, "assets");
  ensureDir(assetsDir);

  const audioName = `audio${path.extname(audioPath) || ".mp3"}`;
  fs.copyFileSync(audioPath, path.join(assetsDir, audioName));

  let backgroundName = "";
  if (backgroundPath) {
    backgroundName = `background${path.extname(backgroundPath) || ".png"}`;
    fs.copyFileSync(backgroundPath, path.join(assetsDir, backgroundName));
  }

  fs.writeFileSync(path.join(projectDir, "hyperframes.json"), JSON.stringify({
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    paths: {
      blocks: "compositions",
      components: "compositions/components",
      assets: "assets"
    }
  }, null, 2), "utf8");

  fs.writeFileSync(path.join(projectDir, "index.html"), hyperframesChatHtml({
    title,
    scriptText,
    audioName,
    backgroundName,
    backgroundColor: normalizeHexColor(backgroundColor || config.background || "#101318", "#101318"),
    width,
    height,
    duration
  }), "utf8");

  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  run(command, [
    "--yes",
    "hyperframes@0.7.26",
    "render",
    "--output",
    outputPath,
    "--quality",
    "standard",
    "--fps",
    String(fps),
    "--workers",
    "1"
  ], { cwd: projectDir, env: hyperframesBrowserEnv() });
}

function renderHyperframesDanmuVideo({ root, config, title, scriptText, audioPath, backgroundPath, backgroundColor, outputPath, duration, id }) {
  renderHyperframesHtmlVideo({
    root,
    config,
    title,
    scriptText,
    audioPath,
    backgroundPath,
    backgroundColor,
    outputPath,
    duration,
    id,
    projectPrefix: "hyperframes-danmu",
    htmlFactory: hyperframesDanmuHtml
  });
}

function renderHyperframesChatDanmuVideo({ root, config, title, scriptText, audioPath, backgroundPath, backgroundColor, outputPath, duration, id }) {
  renderHyperframesHtmlVideo({
    root,
    config,
    title,
    scriptText,
    audioPath,
    backgroundPath,
    backgroundColor,
    outputPath,
    duration,
    id,
    projectPrefix: "hyperframes-chat-danmu",
    htmlFactory: hyperframesChatDanmuHtml
  });
}

function renderHyperframesHtmlVideo({ root, config, title, scriptText, audioPath, backgroundPath, backgroundColor, outputPath, duration, id, projectPrefix, htmlFactory }) {
  const { workDir } = resolveStorageDirs(root, config);
  const width = numberOr(config.width, 1080);
  const height = numberOr(config.height, 1920);
  const fps = numberOr(config.fps, 30);
  const projectDir = path.join(workDir, `${projectPrefix}-${id}`);
  const assetsDir = path.join(projectDir, "assets");
  ensureDir(assetsDir);

  const audioName = `audio${path.extname(audioPath) || ".mp3"}`;
  fs.copyFileSync(audioPath, path.join(assetsDir, audioName));

  let backgroundName = "";
  if (backgroundPath) {
    backgroundName = `background${path.extname(backgroundPath) || ".png"}`;
    fs.copyFileSync(backgroundPath, path.join(assetsDir, backgroundName));
  }

  fs.writeFileSync(path.join(projectDir, "hyperframes.json"), JSON.stringify({
    $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
    paths: {
      blocks: "compositions",
      components: "compositions/components",
      assets: "assets"
    }
  }, null, 2), "utf8");

  fs.writeFileSync(path.join(projectDir, "index.html"), htmlFactory({
    title,
    scriptText,
    audioName,
    backgroundName,
    backgroundColor: normalizeHexColor(backgroundColor || config.background || "#121015", "#121015"),
    width,
    height,
    duration
  }), "utf8");

  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  run(command, [
    "--yes",
    "hyperframes@0.7.26",
    "render",
    "--output",
    outputPath,
    "--quality",
    "standard",
    "--fps",
    String(fps),
    "--workers",
    "1"
  ], { cwd: projectDir, env: hyperframesBrowserEnv() });
}

function hyperframesBrowserEnv() {
  const chromePath = findLocalChrome();
  if (!chromePath) return {};
  return {
    HYPERFRAMES_BROWSER_PATH: chromePath,
    PUPPETEER_EXECUTABLE_PATH: chromePath,
    CHROME_PATH: chromePath
  };
}

function findLocalChrome() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : ""
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function hyperframesDanmuHtml({ title, scriptText, audioName, backgroundName, backgroundColor, width, height, duration }) {
  const safeTitle = escapeHtml(title);
  const safeDuration = Math.max(0.1, Number(duration) || 1).toFixed(3);
  const safeAudio = escapeHtml(`assets/${audioName}`);
  const safeBackground = backgroundName ? escapeHtml(`assets/${backgroundName}`) : "";
  const safeColor = normalizeHexColor(backgroundColor, "#121015");
  const storyLines = parseStoryLines(scriptText, title, 5);
  const lineMarkup = storyLines.map((line, index) => `<div id="story-line-${index}" class="story-line">${escapeHtml(line)}</div>`).join("");
  const comments = buildDanmuComments(scriptText, title, 18);
  const commentMarkup = buildDanmuMarkup(comments, width, height, 0.18, 0.73);
  const backgroundMarkup = safeBackground
    ? `<img class="bg-image" src="${safeBackground}" alt="" />`
    : `<div class="bg-fallback"></div>`;

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: #121015; }
      body { font-family: "Microsoft YaHei", "PingFang SC", "Inter", sans-serif; color: #fff; }
      #root { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: #121015; }
      .bg-image, .bg-fallback { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .bg-fallback { background: ${safeColor}; }
      .shade { position: absolute; inset: 0; background: ${safeBackground ? "rgba(0,0,0,.64)" : "radial-gradient(circle at 50% 18%, rgba(255,255,255,.1), rgba(0,0,0,.34) 34%, rgba(0,0,0,.68))"}; }
      .stage { position: absolute; inset: ${Math.round(height * 0.065)}px ${Math.round(width * 0.055)}px; }
      .tag { display: none; align-items: center; padding: ${Math.round(height * 0.008)}px ${Math.round(width * 0.026)}px; border-radius: 999px; background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.2); font-size: ${Math.round(height * 0.017)}px; font-weight: 900; color: rgba(255,255,255,.78); }
      .title { margin-top: ${Math.round(height * 0.028)}px; max-width: 90%; font-size: ${Math.round(height * 0.038)}px; line-height: 1.13; font-weight: 900; text-shadow: 0 5px 24px rgba(0,0,0,.58); }
      .story-card { position: absolute; left: 0; right: 0; top: ${Math.round(height * 0.24)}px; padding: ${Math.round(height * 0.036)}px ${Math.round(width * 0.052)}px; border-radius: ${Math.round(width * 0.04)}px; background: rgba(255,255,255,.9); color: #15161c; box-shadow: 0 28px 90px rgba(0,0,0,.46); border: 1px solid rgba(255,255,255,.42); }
      .story-line { font-size: ${Math.round(height * 0.026)}px; line-height: 1.38; font-weight: 900; letter-spacing: 0; margin: ${Math.round(height * 0.012)}px 0; }
      .danmu-layer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
      .danmu { position: absolute; white-space: nowrap; padding: ${Math.round(height * 0.009)}px ${Math.round(width * 0.026)}px; border-radius: 999px; font-size: ${Math.round(height * 0.019)}px; font-weight: 900; color: #fff; background: rgba(0,0,0,.5); border: 1px solid rgba(255,255,255,.2); box-shadow: 0 8px 28px rgba(0,0,0,.32); text-shadow: 0 2px 8px rgba(0,0,0,.45); }
      .danmu.hot { background: rgba(255,79,116,.72); }
      .danmu.soft { background: rgba(255,255,255,.2); }
      audio { display: none; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${safeDuration}" data-width="${width}" data-height="${height}">
      ${backgroundMarkup}
      <div class="shade"></div>
      <div id="visual" data-start="0" data-duration="${safeDuration}" data-track-index="1" class="stage">
        <div class="tag">灏忚鎺ㄦ枃</div>
        <div class="title">${safeTitle}</div>
        <div class="story-card">${lineMarkup}</div>
      </div>
      <div class="danmu-layer" data-layout-allow-overflow>${commentMarkup}</div>
      <audio id="audio" data-start="0" data-duration="${safeDuration}" data-track-index="2" src="${safeAudio}" data-volume="1"></audio>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const duration = ${safeDuration};
      const tl = gsap.timeline({ paused: true });
      tl.from(".tag", { opacity: 0, y: 20, duration: 0.44, ease: "power2.out" }, 0.16);
      tl.from(".title", { opacity: 0, y: 34, duration: 0.64, ease: "expo.out" }, 0.28);
      tl.from(".story-card", { opacity: 0, y: 52, scale: 0.97, duration: 0.72, ease: "power3.out" }, 0.5);
      tl.from(".story-line", { opacity: 0, y: 18, duration: 0.42, stagger: 0.18, ease: "power2.out" }, 0.8);
      animateDanmu(tl, duration, ${width});
      window.__timelines["main"] = tl;
      function animateDanmu(timeline, totalDuration, canvasWidth) {
        const items = Array.from(document.querySelectorAll(".danmu"));
        items.forEach((item, index) => {
          const cycle = 7.4 + (index % 5) * 0.72;
          const delay = 0.7 + (index * 0.64) % Math.max(1, totalDuration - 0.8);
          const repeat = Math.max(0, Math.ceil((totalDuration - delay) / cycle) - 1);
          timeline.fromTo(item, { x: 0, opacity: 0 }, { x: -(canvasWidth + 980), opacity: 1, duration: cycle, repeat, ease: "none" }, delay);
        });
      }
    </script>
  </body>
</html>`;
}

function hyperframesChatDanmuHtml({ title, scriptText, audioName, backgroundName, backgroundColor, width, height, duration }) {
  const safeTitle = escapeHtml(title);
  const safeDuration = Math.max(0.1, Number(duration) || 1).toFixed(3);
  const safeAudio = escapeHtml(`assets/${audioName}`);
  const safeBackground = backgroundName ? escapeHtml(`assets/${backgroundName}`) : "";
  const safeColor = normalizeHexColor(backgroundColor, "#101318");
  const messages = parseChatMessages(scriptText, title).slice(0, 7);
  const bubbles = messages.map((message, index) => {
    const side = message.side === "right" ? "right" : "left";
    const sender = escapeHtml(message.sender);
    const text = escapeHtml(message.text);
    return `<div id="mix-bubble-${index}" class="bubble-row ${side}">
      <div class="avatar">${sender.slice(0, 1).toUpperCase()}</div>
      <div class="bubble"><div class="sender">${sender}</div><div class="message">${text}</div></div>
    </div>`;
  }).join("");
  const comments = buildDanmuComments(scriptText, title, 14);
  const commentMarkup = buildDanmuMarkup(comments, width, height, 0.13, 0.82);
  const backgroundMarkup = safeBackground
    ? `<img class="bg-image" src="${safeBackground}" alt="" />`
    : `<div class="bg-fallback"></div>`;

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: #101318; }
      body { font-family: "Microsoft YaHei", "PingFang SC", "Inter", sans-serif; color: #fff; }
      #root { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: #101318; }
      .bg-image, .bg-fallback { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .bg-fallback { background: ${safeColor}; }
      .shade { position: absolute; inset: 0; background: ${safeBackground ? "rgba(0,0,0,.6)" : "linear-gradient(145deg, rgba(0,0,0,.18), rgba(0,0,0,.56))"}; }
      .phone-card { position: absolute; left: ${Math.round(width * 0.055)}px; right: ${Math.round(width * 0.055)}px; top: ${Math.round(height * 0.08)}px; bottom: ${Math.round(height * 0.075)}px; border-radius: ${Math.round(width * 0.047)}px; overflow: hidden; background: rgba(12,16,22,.78); border: 1px solid rgba(255,255,255,.18); box-shadow: 0 30px 90px rgba(0,0,0,.48); backdrop-filter: blur(10px); }
      .header { padding: ${Math.round(height * 0.032)}px ${Math.round(width * 0.045)}px ${Math.round(height * 0.02)}px; border-bottom: 1px solid rgba(255,255,255,.12); }
      .eyebrow { display: none; font-size: ${Math.round(height * 0.016)}px; font-weight: 900; color: rgba(255,255,255,.64); }
      .chat-title { margin-top: ${Math.round(height * 0.01)}px; font-size: ${Math.round(height * 0.029)}px; line-height: 1.13; font-weight: 900; }
      .chat-list { position: absolute; left: ${Math.round(width * 0.04)}px; right: ${Math.round(width * 0.04)}px; top: ${Math.round(height * 0.165)}px; bottom: ${Math.round(height * 0.05)}px; display: flex; flex-direction: column; justify-content: center; gap: ${Math.round(height * 0.016)}px; }
      .bubble-row { display: flex; align-items: flex-end; gap: ${Math.round(width * 0.02)}px; opacity: 0; }
      .bubble-row.right { flex-direction: row-reverse; }
      .avatar { width: ${Math.round(width * 0.064)}px; height: ${Math.round(width * 0.064)}px; border-radius: 50%; display: grid; place-items: center; flex: 0 0 auto; font-size: ${Math.round(height * 0.016)}px; font-weight: 900; color: #111827; background: #f6f7fb; }
      .bubble-row.right .avatar { background: #bcf7d4; }
      .bubble { max-width: 72%; padding: ${Math.round(height * 0.014)}px ${Math.round(width * 0.03)}px; border-radius: ${Math.round(width * 0.032)}px; background: rgba(255,255,255,.92); color: #141820; box-shadow: 0 12px 34px rgba(0,0,0,.24); }
      .bubble-row.right .bubble { background: #dcffe9; }
      .sender { margin-bottom: ${Math.round(height * 0.005)}px; font-size: ${Math.round(height * 0.013)}px; font-weight: 900; color: rgba(17,24,39,.5); }
      .message { font-size: ${Math.round(height * 0.021)}px; line-height: 1.3; font-weight: 850; overflow-wrap: anywhere; }
      .danmu-layer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
      .danmu { position: absolute; white-space: nowrap; padding: ${Math.round(height * 0.008)}px ${Math.round(width * 0.024)}px; border-radius: 999px; font-size: ${Math.round(height * 0.017)}px; font-weight: 900; color: #fff; background: rgba(0,0,0,.48); border: 1px solid rgba(255,255,255,.18); box-shadow: 0 8px 26px rgba(0,0,0,.3); text-shadow: 0 2px 7px rgba(0,0,0,.46); }
      .danmu.hot { background: rgba(255,79,116,.7); }
      .danmu.soft { background: rgba(255,255,255,.2); }
      audio { display: none; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${safeDuration}" data-width="${width}" data-height="${height}">
      ${backgroundMarkup}
      <div class="shade"></div>
      <div id="visual" class="phone-card" data-start="0" data-duration="${safeDuration}" data-track-index="1">
        <div class="header"><div class="eyebrow">鐑瘎鍓ф儏</div><div class="chat-title">${safeTitle}</div></div>
        <div class="chat-list">${bubbles}</div>
      </div>
      <div class="danmu-layer" data-layout-allow-overflow>${commentMarkup}</div>
      <audio id="audio" data-start="0" data-duration="${safeDuration}" data-track-index="2" src="${safeAudio}" data-volume="1"></audio>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const duration = ${safeDuration};
      const count = ${messages.length};
      const step = Math.max(0.75, (duration - 1.5) / Math.max(1, count));
      const tl = gsap.timeline({ paused: true });
      tl.from(".phone-card", { opacity: 0, y: 38, scale: 0.985, duration: 0.7, ease: "power3.out" }, 0.12);
      tl.from(".chat-title", { opacity: 0, y: 20, duration: 0.5, ease: "expo.out" }, 0.34);
      for (let i = 0; i < count; i++) {
        const side = document.querySelector("#mix-bubble-" + i)?.classList.contains("right") ? 1 : -1;
        tl.fromTo("#mix-bubble-" + i, { opacity: 0, y: 26, x: side * 22, scale: 0.95 }, { opacity: 1, y: 0, x: 0, scale: 1, duration: 0.48, ease: "back.out(1.45)" }, 0.76 + i * step);
      }
      animateDanmu(tl, duration, ${width});
      window.__timelines["main"] = tl;
      function animateDanmu(timeline, totalDuration, canvasWidth) {
        const items = Array.from(document.querySelectorAll(".danmu"));
        items.forEach((item, index) => {
          const cycle = 7.1 + (index % 5) * 0.66;
          const delay = 0.45 + (index * 0.58) % Math.max(1, totalDuration - 0.7);
          const repeat = Math.max(0, Math.ceil((totalDuration - delay) / cycle) - 1);
          timeline.fromTo(item, { x: 0, opacity: 0 }, { x: -(canvasWidth + 900), opacity: 1, duration: cycle, repeat, ease: "none" }, delay);
        });
      }
    </script>
  </body>
</html>`;
}

function hyperframesChatHtml({ title, scriptText, audioName, backgroundName, backgroundColor, width, height, duration }) {
  const safeTitle = escapeHtml(title);
  const safeDuration = Math.max(0.1, Number(duration) || 1).toFixed(3);
  const safeAudio = escapeHtml(`assets/${audioName}`);
  const safeBackground = backgroundName ? escapeHtml(`assets/${backgroundName}`) : "";
  const safeColor = normalizeHexColor(backgroundColor, "#101318");
  const messages = parseChatMessages(scriptText, title);
  const bubbleGap = Math.round(height * 0.018);
  const bubbles = messages.map((message, index) => {
    const side = message.side === "right" ? "right" : "left";
    const sender = escapeHtml(message.sender);
    const text = escapeHtml(message.text);
    return `<div id="bubble-${index}" class="bubble-row ${side}">
      <div class="avatar">${sender.slice(0, 1).toUpperCase()}</div>
      <div class="bubble">
        <div class="sender">${sender}</div>
        <div class="message">${text}</div>
      </div>
    </div>`;
  }).join("");
  const backgroundMarkup = safeBackground
    ? `<img class="bg-image" src="${safeBackground}" alt="" />`
    : `<div class="bg-fallback"></div>`;

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: #101318; }
      body { font-family: "Microsoft YaHei", "PingFang SC", "Inter", sans-serif; color: #fff; }
      #root { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: #101318; }
      .bg-image, .bg-fallback { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .bg-fallback { background: ${safeColor}; }
      .shade { position: absolute; inset: 0; background: ${safeBackground ? "rgba(0,0,0,.58)" : "linear-gradient(145deg, rgba(0,0,0,.16), rgba(0,0,0,.42))"}; }
      .frame { position: absolute; inset: ${Math.round(height * 0.055)}px ${Math.round(width * 0.052)}px; border-radius: ${Math.round(width * 0.045)}px; overflow: hidden; background: rgba(12,16,22,.72); border: 1px solid rgba(255,255,255,.18); box-shadow: 0 32px 90px rgba(0,0,0,.46); backdrop-filter: blur(10px); }
      .header { height: ${Math.round(height * 0.145)}px; padding: ${Math.round(height * 0.032)}px ${Math.round(width * 0.05)}px 0; border-bottom: 1px solid rgba(255,255,255,.1); background: linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,0)); }
      .eyebrow { display: none; font-size: ${Math.round(height * 0.018)}px; line-height: 1.2; color: rgba(255,255,255,.64); font-weight: 800; letter-spacing: 0; }
      .chat-title { margin-top: ${Math.round(height * 0.012)}px; font-size: ${Math.round(height * 0.032)}px; line-height: 1.12; font-weight: 900; text-shadow: 0 3px 18px rgba(0,0,0,.45); }
      .chat-list { position: absolute; left: ${Math.round(width * 0.044)}px; right: ${Math.round(width * 0.044)}px; top: ${Math.round(height * 0.175)}px; bottom: ${Math.round(height * 0.075)}px; display: flex; flex-direction: column; justify-content: center; gap: ${bubbleGap}px; }
      .bubble-row { display: flex; align-items: flex-end; gap: ${Math.round(width * 0.022)}px; width: 100%; opacity: 0; }
      .bubble-row.right { flex-direction: row-reverse; }
      .avatar { width: ${Math.round(width * 0.074)}px; height: ${Math.round(width * 0.074)}px; border-radius: 50%; display: grid; place-items: center; flex: 0 0 auto; font-size: ${Math.round(height * 0.018)}px; font-weight: 900; color: #111827; background: #f5f7fb; box-shadow: 0 10px 24px rgba(0,0,0,.28); }
      .bubble-row.right .avatar { background: #b8f2d5; }
      .bubble { max-width: 72%; padding: ${Math.round(height * 0.017)}px ${Math.round(width * 0.034)}px ${Math.round(height * 0.019)}px; border-radius: ${Math.round(width * 0.036)}px; background: rgba(255,255,255,.92); color: #12151b; box-shadow: 0 12px 34px rgba(0,0,0,.26); }
      .bubble-row.left .bubble { border-bottom-left-radius: ${Math.round(width * 0.01)}px; }
      .bubble-row.right .bubble { border-bottom-right-radius: ${Math.round(width * 0.01)}px; background: #d7ffe8; }
      .sender { margin-bottom: ${Math.round(height * 0.006)}px; font-size: ${Math.round(height * 0.014)}px; line-height: 1.15; font-weight: 900; color: rgba(17,24,39,.52); }
      .message { font-size: ${Math.round(height * 0.023)}px; line-height: 1.32; font-weight: 800; overflow-wrap: anywhere; }
      .typing { position: absolute; left: ${Math.round(width * 0.08)}px; bottom: ${Math.round(height * 0.03)}px; display: flex; gap: ${Math.round(width * 0.012)}px; opacity: .82; }
      .typing span { width: ${Math.round(width * 0.016)}px; height: ${Math.round(width * 0.016)}px; border-radius: 50%; background: rgba(255,255,255,.8); }
      audio { display: none; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${safeDuration}" data-width="${width}" data-height="${height}">
      ${backgroundMarkup}
      <div class="shade"></div>
      <div id="visual" class="frame" data-start="0" data-duration="${safeDuration}" data-track-index="1">
        <div class="header">
          <div class="chat-title">${safeTitle}</div>
        </div>
        <div class="chat-list">${bubbles}</div>
        <div class="typing"><span></span><span></span><span></span></div>
      </div>
      <audio id="audio" data-start="0" data-duration="${safeDuration}" data-track-index="2" src="${safeAudio}" data-volume="1"></audio>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const duration = ${safeDuration};
      const count = ${messages.length};
      const step = Math.max(0.72, (duration - 1.4) / Math.max(1, count));
      const tl = gsap.timeline({ paused: true });
      tl.from(".frame", { opacity: 0, y: 42, scale: 0.985, duration: 0.72, ease: "power3.out" }, 0.12);
      tl.from(".chat-title", { opacity: 0, y: 26, duration: 0.56, ease: "expo.out" }, 0.34);
      tl.from(".eyebrow", { opacity: 0, x: -18, duration: 0.44, ease: "power2.out" }, 0.28);
      for (let i = 0; i < count; i++) {
        const side = document.querySelector("#bubble-" + i)?.classList.contains("right") ? 1 : -1;
        const at = 0.78 + i * step;
        tl.fromTo("#bubble-" + i, { opacity: 0, y: 34, x: side * 24, scale: 0.94 }, { opacity: 1, y: 0, x: 0, scale: 1, duration: 0.52, ease: "back.out(1.45)" }, at);
      }
      tl.to(".typing span", { y: -10, duration: 0.34, yoyo: true, repeat: Math.max(1, Math.ceil(duration / 0.68) - 1), stagger: 0.11, ease: "sine.inOut" }, 0.8);
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`;
}

function hyperframesPodcastHtml({ title, audioName, backgroundName, backgroundColor, width, height, duration, audioLevels }) {
  const safeTitle = escapeHtml(title);
  const safeDuration = Math.max(0.1, Number(duration) || 1).toFixed(3);
  const safeAudio = escapeHtml(`assets/${audioName}`);
  const safeBackground = backgroundName ? escapeHtml(`assets/${backgroundName}`) : "";
  const bars = Array.from({ length: 72 }, (_, index) => {
    const phase = index * 0.53;
    const idle = 10 + Math.round(Math.abs(Math.sin(phase)) * 14 + Math.abs(Math.sin(phase * 0.37)) * 9);
    return `<span class="bar" style="--idle:${idle}px"></span>`;
  }).join("");
  const safeColor = normalizeHexColor(backgroundColor, "#050506");
  const compactLevels = audioLevels && Array.isArray(audioLevels.levels)
    ? {
        step: audioLevels.step,
        levels: audioLevels.levels.map((value) => Number(value.toFixed(3)))
      }
    : { step: 0.05, levels: [] };
  const backgroundMarkup = safeBackground
    ? `<img class="bg-image" src="${safeBackground}" alt="" />`
    : `<div class="bg-fallback"></div>`;

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: #050506; }
      body { font-family: "Microsoft YaHei", "PingFang SC", "Inter", sans-serif; color: #fff; }
      #root { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: #050506; }
      .bg-image, .bg-fallback { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .bg-fallback { background: ${safeColor}; }
      .shade { position: absolute; inset: 0; background: rgba(0, 0, 0, ${safeBackground ? "0.52" : "0"}); }
      .content { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; padding: ${Math.round(height * 0.09)}px ${Math.round(width * 0.075)}px ${Math.round(height * 0.08)}px; }
      .title { width: 100%; margin-top: ${Math.round(height * 0.04)}px; font-size: ${Math.round(height * 0.036)}px; line-height: 1.18; font-weight: 900; text-align: left; text-shadow: 0 4px 18px rgba(0,0,0,.65); }
      .wave-wrap { margin-top: auto; margin-bottom: ${Math.round(height * 0.18)}px; width: min(${Math.round(width * 0.82)}px, 920px); height: ${Math.round(height * 0.15)}px; display: flex; align-items: center; justify-content: center; gap: ${Math.max(5, Math.round(width * 0.008))}px; filter: drop-shadow(0 0 15px rgba(255,255,255,.58)); }
      .bar { width: ${Math.max(4, Math.round(width * 0.006))}px; height: var(--idle); border-radius: 999px; background: rgba(255,255,255,.95); transform-origin: 50% 50%; box-shadow: 0 0 12px rgba(255,255,255,.34); }
      audio { display: none; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${safeDuration}" data-width="${width}" data-height="${height}">
      ${backgroundMarkup}
      <div class="shade"></div>
      <div id="visual" data-start="0" data-duration="${safeDuration}" data-track-index="1" class="content">
        <div class="title">${safeTitle}</div>
        <div class="wave-wrap">${bars}</div>
      </div>
      <audio id="audio" data-start="0" data-duration="${safeDuration}" data-track-index="2" src="${safeAudio}" data-volume="1"></audio>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const duration = ${safeDuration};
      const audioData = ${JSON.stringify(compactLevels)};
      const bars = Array.from(document.querySelectorAll(".bar"));
      const center = (bars.length - 1) / 2;
      const maxHeight = ${Math.round(height * 0.135)};
      const minHeight = ${Math.max(8, Math.round(height * 0.006))};
      const getAudioLevel = (time) => {
        const levels = audioData.levels || [];
        const step = audioData.step || 0.05;
        if (!levels.length || step <= 0) return 0.08;
        const position = Math.max(0, time) / step;
        const leftIndex = Math.floor(position);
        const rightIndex = Math.min(levels.length - 1, leftIndex + 1);
        const left = levels[Math.min(levels.length - 1, leftIndex)] || 0;
        const right = levels[rightIndex] || left;
        const mix = position - leftIndex;
        return Math.max(0, Math.min(1, left + (right - left) * mix));
      };
      const updateWave = (time) => {
        const current = getAudioLevel(time);
        const recent = getAudioLevel(Math.max(0, time - 0.1));
        const velocity = Math.max(0, current - recent);
        bars.forEach((bar, index) => {
          const distance = Math.abs(index - center) / center;
          const sideDelay = distance * 0.16;
          const side = getAudioLevel(Math.max(0, time - sideDelay));
          const neighbor = getAudioLevel(Math.max(0, time + (index - center) * 0.008));
          const voice = Math.max(current, side * 0.9, neighbor * 0.82);
          const pulse = 0.62 + 0.38 * Math.abs(Math.sin(index * 0.7 + time * 16));
          const spark = Math.pow(Math.abs(Math.sin(index * 1.13 + time * 8.5)), 8) * Math.min(1, voice * 1.9 + velocity * 3.2);
          const focus = Math.max(0.56, 1 - distance * 0.26);
          const nextHeight = minHeight + Math.min(1, voice * pulse + spark * 0.55) * (maxHeight - minHeight) * focus;
          bar.style.height = nextHeight.toFixed(1) + "px";
          bar.style.opacity = String(0.72 + Math.min(0.28, voice * 0.32 + spark * 0.18));
        });
      };
      updateWave(0);
      const tl = gsap.timeline({ paused: true });
      tl.from(".title", { opacity: 0, y: 44, duration: 0.7, ease: "power3.out" }, 0);
      tl.from(".bar", { scaleY: 0.18, opacity: 0.2, duration: 0.7, stagger: { each: 0.012, from: "center" }, ease: "power3.out" }, 0.25);
      const driver = { time: 0 };
      tl.to(driver, { time: duration, duration, ease: "none", onUpdate: () => updateWave(driver.time) }, 0);
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>`;
}

function analyzeAudioLevels(audioPath, duration) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner",
    "-v",
    "error",
    "-i",
    audioPath,
    "-ac",
    "1",
    "-ar",
    "16000",
    "-f",
    "s16le",
    "pipe:1"
  ], { encoding: null, maxBuffer: 256 * 1024 * 1024 });

  if (result.status !== 0) {
    return null;
  }

  const pcm = result.stdout;
  if (!Buffer.isBuffer(pcm) || pcm.length < 4) return null;

  const sampleRate = 16000;
  const step = 0.05;
  const windowSize = Math.max(1, Math.round(sampleRate * step));
  const totalSamples = Math.floor(pcm.length / 2);
  const count = Math.max(1, Math.ceil(totalSamples / windowSize));
  const rmsValues = [];

  for (let bin = 0; bin < count; bin++) {
    const start = bin * windowSize;
    const end = Math.min(totalSamples, start + windowSize);
    let sum = 0;
    for (let sample = start; sample < end; sample++) {
      const value = pcm.readInt16LE(sample * 2) / 32768;
      sum += value * value;
    }
    const rms = Math.sqrt(sum / Math.max(1, end - start));
    rmsValues.push(rms);
  }

  const sorted = [...rmsValues].sort((a, b) => a - b);
  const quiet = percentile(sorted, 0.18);
  const loud = Math.max(quiet + 0.015, percentile(sorted, 0.94));
  const levels = rmsValues.map((rms) => {
    const normalized = Math.max(0, Math.min(1, (rms - quiet) / (loud - quiet)));
    return Math.pow(normalized, 0.68);
  });

  for (let i = 1; i < levels.length; i++) {
    levels[i] = Math.max(levels[i], levels[i - 1] * 0.48);
  }
  for (let i = levels.length - 2; i >= 0; i--) {
    levels[i] = Math.max(levels[i], levels[i + 1] * 0.24);
  }

  return {
    step,
    levels: levels.map((value) => Number(value.toFixed(4)))
  };
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * ratio)));
  return sorted[index];
}

function renderFastJournalVideo({ root, config, title, audioPath, backgroundPath, backgroundColor, outputPath, duration, id }) {
  const { workDir } = resolveStorageDirs(root, config);
  const width = numberOr(config.width, 1080);
  const height = numberOr(config.height, 1920);
  const fps = numberOr(config.fps, 30);
  const propsPath = path.join(workDir, `${id}.journal-still-props.json`);
  const stillPath = path.join(workDir, `${id}.journal-base.png`);
  const assetDir = path.join(root, "public", "remotion-assets");
  ensureDir(assetDir);

  const audioAssetName = `${id}.audio${path.extname(audioPath) || ".mp3"}`;
  fs.copyFileSync(audioPath, path.join(assetDir, audioAssetName));

  let backgroundAssetName = "";
  if (backgroundPath) {
    backgroundAssetName = `${id}.background${path.extname(backgroundPath) || ".png"}`;
    fs.copyFileSync(backgroundPath, path.join(assetDir, backgroundAssetName));
  }

  const props = {
    title,
    template: "minimal-wave",
    width,
    height,
    duration,
    audioSrc: `remotion-assets/${audioAssetName}`,
    backgroundSrc: backgroundAssetName ? `remotion-assets/${backgroundAssetName}` : "",
    backgroundColor: normalizeHexColor(backgroundColor || config.background || "#347d95", "#347d95"),
    fastStill: true
  };
  fs.writeFileSync(propsPath, JSON.stringify(props, null, 2), "utf8");

  const command = process.platform === "win32" ? "npx.cmd" : "npx";
  run(command, [
    "remotion",
    "still",
    cliPath(path.relative(root, path.join(root, "remotion", "index.jsx"))),
    "PodcastVideo",
    cliPath(path.relative(root, stillPath)),
    "--props",
    cliPath(path.relative(root, propsPath)),
    "--frame",
    "0",
    "--overwrite"
  ]);

  const leftX = Math.round(width * 0.062);
  const progressX = leftX;
  const progressY = Math.round(height * 0.44);
  const progressWidth = Math.round(width * 0.876);
  const progressHeight = 12;
  const progressKnob = Math.max(16, Math.round(width * 0.018));
  const timeY = Math.round(height * 0.44 + progressHeight + 30);
  const timeSize = 40;
  const safeDuration = Math.max(duration, 0.001).toFixed(3);
  const progressLayerHeight = progressHeight + 4;
  const fillRight = `max(0\\,min(${progressWidth}\\,${progressWidth}*T/${safeDuration}))`;
  const knobLeft = `max(0\\,min(${progressWidth - progressKnob}\\,${progressWidth}*T/${safeDuration}))`;
  const font = ffPath(config.fontFile || "C:/Windows/Fonts/msyh.ttc");
  const elapsedTime = elapsedDrawText();
  const progressAlpha = [
    "if(",
    `gte(X\\,0)*lte(X\\,${fillRight})*gte(Y\\,2)*lte(Y\\,${progressHeight + 2})`,
    "+",
    `gte(X\\,${knobLeft})*lte(X\\,${knobLeft}+${progressKnob})*gte(Y\\,0)*lte(Y\\,${progressLayerHeight})`,
    "\\,242\\,0)"
  ].join("");

  const filters = [
    "[0:v]format=rgba[base]",
    `nullsrc=s=${progressWidth}x${progressLayerHeight}:r=${fps}:d=${duration},format=rgba,geq=r='229':g='245':b='251':a='${progressAlpha}'[progressLayer]`,
    `[base][progressLayer]overlay=${progressX}:${progressY - 2}:format=auto[progress]`,
    `[progress]drawtext=fontfile='${font}':text='${elapsedTime}':x=${leftX}:y=${timeY}:fontsize=${timeSize}:fontcolor=def2f8@0.82[v]`
  ].join(";");

  const args = [
    "-y",
    "-hide_banner",
    "-loop",
    "1",
    "-t",
    String(duration),
    "-i",
    stillPath,
    "-i",
    audioPath,
    "-filter_complex",
    filters,
    "-map",
    "[v]",
    "-map",
    "1:a:0",
    "-shortest",
    "-c:v",
    config.videoCodec || "libx264",
    "-preset",
    config.fastPreset || "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-c:a",
    config.audioCodec || "aac",
    "-b:a",
    "192k",
    outputPath
  ];

  run("ffmpeg", args);
}

function cliPath(value) {
  return String(value).replace(/\\/g, "/");
}

function journalTemplateFilters({ baseSource, font, controlFont, title, elapsedTime, totalTime, duration, width, height, layout, hasBackground, backgroundColor }) {
  const titleColor = "f3fbff";
  const muted = "b9d8e2";
  const track = "8ab4c1@0.75";
  const fill = "d7edf5@0.95";
  const safeDuration = Math.max(duration, 0.001).toFixed(3);
  const progressWidth = `max(0\\,min(${layout.progressWidth}\\,${layout.progressWidth}*t/${safeDuration}))`;
  const progressX = `${layout.progressX}+${layout.progressWidth}*t/${safeDuration}`;
  const backgroundOverlay = hasBackground ? "000000@0.42" : `${backgroundColor}@1`;

  return [
    baseSource,
    `[base]drawbox=x=0:y=0:w=${width}:h=${height}:color=${backgroundOverlay}:t=fill[journalBg]`,
    `[journalBg]drawtext=fontfile='${font}':text='${title}':x=${layout.leftX}:y=${layout.titleY}:fontsize=${layout.titleSize}:fontcolor=${titleColor}:borderw=2:bordercolor=2f7288[title]`,
    `[title]drawbox=x=${layout.progressX}:y=${layout.progressY}:w=${layout.progressWidth}:h=${layout.progressHeight}:color=${track}:t=fill[track]`,
    `[track]drawbox=x=${layout.progressX}:y=${layout.progressY}:w='${progressWidth}':h=${layout.progressHeight}:color=${fill}:t=fill[progress]`,
    `[progress]drawbox=x='${progressX}':y=${layout.progressY - 2}:w=${layout.progressKnob}:h=${layout.progressHeight + 4}:color=${fill}:t=fill[knob]`,
    `[knob]drawtext=fontfile='${font}':text='${elapsedTime}':x=${layout.leftX}:y=${layout.timeY}:fontsize=${layout.timeSize}:fontcolor=${muted}[elapsed]`,
    `[elapsed]drawtext=fontfile='${font}':text='${totalTime}':x=${layout.rightX}:y=${layout.timeY}:fontsize=${layout.timeSize}:fontcolor=${muted}[total]`,
    `[total]drawtext=fontfile='${font}':text='1.25x':x=${layout.speedTextX}:y=${layout.speedTextY}:fontsize=${layout.smallControlSize}:fontcolor=${titleColor}[speed]`,
    `[speed]drawtext=fontfile='${controlFont}':text='鈮?:x=${layout.speedIconX}:y=${layout.controlsIconY}:fontsize=${layout.iconSize}:fontcolor=${titleColor}[speedIcon]`,
    `[speedIcon]drawtext=fontfile='${controlFont}':text='鈼?:x=${layout.backCircleX}:y=${layout.circleY}:fontsize=${layout.circleSize}:fontcolor=${titleColor}[backCircle]`,
    `[backCircle]drawtext=fontfile='${font}':text='15':x=${layout.backTextX}:y=${layout.numberY}:fontsize=${layout.numberSize}:fontcolor=${titleColor}:borderw=2:bordercolor=347d95[backNum]`,
    `[backNum]drawbox=x=${layout.pauseX1}:y=${layout.pauseY}:w=${layout.pauseWidth}:h=${layout.pauseHeight}:color=${titleColor}:t=fill[pause1]`,
    `[pause1]drawbox=x=${layout.pauseX2}:y=${layout.pauseY}:w=${layout.pauseWidth}:h=${layout.pauseHeight}:color=${titleColor}:t=fill[pause]`,
    `[pause]drawtext=fontfile='${controlFont}':text='鈼?:x=${layout.forwardCircleX}:y=${layout.circleY}:fontsize=${layout.circleSize}:fontcolor=${titleColor}[forwardCircle]`,
    `[forwardCircle]drawtext=fontfile='${font}':text='30':x=${layout.forwardTextX}:y=${layout.numberY}:fontsize=${layout.numberSize}:fontcolor=${titleColor}:borderw=2:bordercolor=347d95[v]`
  ].join(";");
}

function dynamicWaveSource({ color, fps, duration, waveWidth, waveHeight }) {
  const rgb = hexToRgb(color);
  const baseline = Math.round(waveHeight * 0.8);
  const column = "floor(X/10)";
  const peak = Math.max(28, Math.round(waveHeight * 0.56));
  const height = [
    "4+",
    peak,
    "*",
    `abs(sin(T*(3.6+mod(${column},7)*0.41)+${column}*1.73))*`,
    `abs(sin(T*(3.6+mod(${column},7)*0.41)+${column}*1.73))*`,
    "(0.18+0.82*",
    `abs(sin(T*(1.2+mod(${column},5)*0.33)+${column}*0.67))*`,
    `abs(sin(T*(2.4+mod(${column},11)*0.21)+${column}*2.13))`,
    ")"
  ].join("");
  const alphaExpr = [
    "if(",
    `lte(abs(Y-${baseline}),1)*lt(mod(X,10),6),`,
    "185,",
    "if(",
    "lt(mod(X,10),6)*",
    `gte(Y,${baseline}-(${height}))*lte(Y,${baseline}),`,
    "235,0))"
  ].join("");

  return [
    `nullsrc=s=${waveWidth}x${waveHeight}:r=${fps}:d=${duration},format=rgba`,
    `geq=r='${rgb.r}':g='${rgb.g}':b='${rgb.b}':a='${alphaExpr}'[wave]`
  ].join(",");
}

function audioWaveSource({ color, fps, waveWidth, waveHeight, style = "player" }) {
  if (style === "center") {
    const rgb = hexToRgb(color);
    const baseline = Math.round(waveHeight / 2);
    const dotWidth = Math.max(3, Math.round(waveWidth * 0.004));
    const gap = Math.max(9, Math.round(waveWidth * 0.012));
    const sourceWidth = Math.max(120, Math.round(waveWidth / 6));
    return [
      `[0:a]showwaves=s=${sourceWidth}x${waveHeight}:mode=point:colors=${color}@0.95:rate=${fps}:scale=sqrt:draw=full,scale=${waveWidth}:${waveHeight}:flags=neighbor,dilation,format=rgba[voicewave]`,
      `nullsrc=s=${waveWidth}x${waveHeight}:r=${fps},format=rgba,geq=r='${rgb.r}':g='${rgb.g}':b='${rgb.b}':a='if(lte(abs(Y-${baseline})\\,1)*lt(mod(X\\,${gap})\\,${dotWidth})\\,235\\,0)'[dots]`,
      "[dots][voicewave]overlay=0:0:format=auto[wave]"
    ].join(";");
  }

  return [
    `[0:a]showwaves=s=${waveWidth}x${waveHeight * 2}:mode=line:colors=${color}@0.95:rate=${fps}:scale=sqrt:draw=full`,
    `crop=${waveWidth}:${waveHeight}:0:0`,
    "format=rgba[wave]"
  ].join(",");
}

function makeLayout({ width, height, template }) {
  if (template === "center-wave") {
    return {
      kind: "waveform",
      showTime: false,
      showControls: false,
      waveStyle: "center",
      titleY: Math.round(height * 0.1),
      waveY: Math.round(height * 0.48),
      waveWidth: Math.min(Math.round(width * 0.64), 980),
      waveHeight: Math.max(96, Math.round(height * 0.095))
    };
  }

  if (template === "minimal-wave") {
    const leftX = Math.round(width * 0.062);
    const progressX = leftX;
    const progressWidth = Math.round(width * 0.876);
    return {
      kind: "journal",
      showTime: false,
      showControls: false,
      titleY: Math.round(height * 0.185),
      nameY: Math.round(height * 0.3),
      titleSize: Math.max(38, Math.round(height * 0.052)),
      nameSize: Math.max(32, Math.round(height * 0.04)),
      leftX,
      rightX: progressX + progressWidth - Math.round(width * 0.08),
      progressX,
      progressY: Math.round(height * 0.44),
      progressWidth,
      progressHeight: Math.max(8, Math.round(height * 0.012)),
      progressKnob: Math.max(16, Math.round(width * 0.018)),
      timeY: Math.round(height * 0.49),
      timeSize: Math.max(30, Math.round(height * 0.035)),
      controlsIconY: Math.round(height * 0.64),
      controlsTextY: Math.round(height * 0.69),
      speedIconX: Math.round(width * 0.079),
      speedTextX: Math.round(width * 0.121),
      speedTextY: Math.round(height * 0.665),
      backCircleX: Math.round(width * 0.259),
      backTextX: Math.round(width * 0.272),
      circleY: Math.round(height * 0.62),
      numberY: Math.round(height * 0.648),
      pauseX1: Math.round(width * 0.442),
      pauseX2: Math.round(width * 0.51),
      pauseY: Math.round(height * 0.653),
      forwardCircleX: Math.round(width * 0.644),
      forwardTextX: Math.round(width * 0.656),
      iconSize: Math.max(46, Math.round(height * 0.058)),
      circleSize: Math.max(68, Math.round(height * 0.083)),
      numberSize: Math.max(34, Math.round(height * 0.044)),
      smallControlSize: Math.max(24, Math.round(height * 0.03)),
      pauseWidth: Math.max(26, Math.round(width * 0.032)),
      pauseHeight: Math.max(92, Math.round(height * 0.102)),
      footerY: Math.round(height * 0.885),
      footerSize: Math.max(36, Math.round(height * 0.047))
    };
  }

  return {
    kind: "waveform",
    showTime: true,
    showControls: true,
    waveStyle: "player",
    titleY: Math.round(height * 0.048),
    timeY: Math.round(height * 0.396),
    leftX: Math.round(width * 0.081),
    rightX: Math.round(width * 0.081),
    waveY: Math.round(height * 0.633),
    controlsY: Math.round(height * 0.787),
    heartX: Math.round(width * 0.139),
    backX: Math.round(width * 0.31),
    pauseX1: Math.round(width * 0.47),
    pauseX2: Math.round(width * 0.519),
    forwardX: Math.round(width * 0.611),
    menuX: Math.round(width * 0.81),
    pauseWidth: Math.max(18, Math.round(width * 0.026)),
    pauseHeight: Math.max(56, Math.round(height * 0.046)),
    waveWidth: Math.min(680, Math.round(width * 0.63)),
    waveHeight: Math.max(100, Math.round(height * 0.073))
  };
}

function probeDuration(filePath, fallback) {
  const result = spawnSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath
  ], { encoding: "utf8" });
  if (result.status !== 0) return fallback;
  return Number.parseFloat(result.stdout.trim());
}

function countdownDrawText(duration) {
  const safeDuration = Math.max(0, Number(duration) || 0).toFixed(3);
  return `%{eif\\:floor(max(round(${safeDuration})-floor(t)\\,0)/60)\\:d\\:2}\\:%{eif\\:mod(max(round(${safeDuration})-floor(t)\\,0)\\,60)\\:d\\:2}`;
}

function elapsedDrawText() {
  return "%{eif\\:floor(floor(t)/60)\\:d\\:2}\\:%{eif\\:mod(floor(t)\\,60)\\:d\\:2}";
}

function fixedDurationText(duration) {
  const total = Math.max(0, Math.round(Number(duration) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}\\:${String(seconds).padStart(2, "0")}`;
}

function firstMeaningfulLine(value) {
  return String(value).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function parseStoryLines(scriptText, title, maxLines = 5) {
  const lines = String(scriptText || "")
    .split(/\r?\n+/)
    .map((line) => line.trim().replace(/^([^:：]{1,12})[:：]\s*/, ""))
    .filter(Boolean);
  const fallback = [
    title || "她以为那只是一次普通的重逢。",
    "直到那个人说出第一句话，她才知道一切都没有结束。",
    "屏幕另一端沉默了很久。",
    "而真正的答案，藏在最后一条消息里。"
  ];
  return (lines.length ? lines : fallback).slice(0, maxLines).map((line) => clampStoryText(line));
}

function buildDanmuComments(scriptText, title, count = 16) {
  const storyLines = parseStoryLines(scriptText, title, 8);
  const reactions = [
    "这个开头有点狠",
    "后面肯定反转",
    "别告诉我他才是幕后的人",
    "这个细节不对劲",
    "女主终于清醒了",
    "这句话太戳了",
    "我已经开始紧张了",
    "等一下，这里有伏笔",
    "这不就是爽文名场面",
    "他怎么现在才发现",
    "继续看，别停",
    "这段太适合追更了",
    "感觉下一秒要摊牌",
    "这关系越来越乱了",
    "她真的太会忍了",
    "这个人绝对不简单"
  ];
  const extracted = storyLines
    .map((line) => line.replace(/[，。！？、,.!?]/g, " ").split(/\s+/).find((part) => part.length >= 4))
    .filter(Boolean)
    .map((part) => `“${clampStoryText(part).slice(0, 16)}”是伏笔吗`);
  const pool = [...extracted, ...reactions];
  return Array.from({ length: count }, (_, index) => pool[index % pool.length]);
}

function buildDanmuMarkup(comments, width, height, minRatio, maxRatio) {
  const minTop = Math.round(height * minRatio);
  const maxTop = Math.round(height * maxRatio);
  const span = Math.max(1, maxTop - minTop);
  return comments.map((comment, index) => {
    const top = minTop + Math.round(((index * 73) % span));
    const tone = index % 5 === 0 ? "hot" : index % 3 === 0 ? "soft" : "";
    const left = width + 60 + (index % 4) * 160;
    return `<div id="danmu-${index}" class="danmu ${tone}" style="top:${top}px;left:${left}px">${escapeHtml(comment)}</div>`;
  }).join("");
}

function clampStoryText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 72 ? `${text.slice(0, 70)}...` : text;
}

function parseChatMessages(scriptText, title) {
  const rawLines = String(scriptText || "")
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lines = rawLines.length ? rawLines : [
    title || "A story you need to hear",
    "I thought I had already moved on.",
    "But every quiet moment brought the same feeling back.",
    "Maybe the hardest part was never the ending.",
    "It was learning how to stop waiting for an answer."
  ];
  const compact = lines.slice(0, 10).map((line, index) => {
    const match = line.match(/^([^:：]{1,12})[:：]\s*(.+)$/);
    if (match) {
      const name = match[1].trim();
      const isSelf = /^(我|me|self|a|host)$/i.test(name);
      return {
        side: isSelf ? "right" : "left",
        sender: name,
        text: clampChatText(match[2])
      };
    }
    return {
      side: index % 2 === 0 ? "left" : "right",
      sender: index % 2 === 0 ? "对方" : "我",
      text: clampChatText(line)
    };
  });
  return compact.length ? compact : [{ side: "left", sender: "瀵规柟", text: clampChatText(title || "Untitled") }];
}

function clampChatText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 96 ? `${text.slice(0, 94)}...` : text;
}

function escapeDrawText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/%/g, "\\%");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ffPath(value) {
  return String(value).replace(/\\/g, "/").replace(/:/g, "\\:");
}

function normalizeHexColor(value, fallback = "#000000") {
  const raw = String(value || fallback).trim();
  const match = raw.match(/^#?([0-9a-fA-F]{6})$/);
  if (match) return `#${match[1].toLowerCase()}`;
  const fallbackMatch = String(fallback).match(/^#?([0-9a-fA-F]{6})$/);
  return fallbackMatch ? `#${fallbackMatch[1].toLowerCase()}` : "#000000";
}

function cleanHex(value, fallback) {
  return normalizeHexColor(value, `#${String(fallback || "000000").replace(/^#/, "")}`).slice(1);
}

function hexToRgb(value) {
  const hex = cleanHex(value, "ffffff").padEnd(6, "f").slice(0, 6);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16)
  };
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) {
    const output = String(result.stderr || result.stdout || "").trim();
    const tail = output.slice(-1800);
    throw new Error(`${command} failed with exit code ${result.status || 1}${tail ? `: ${tail}` : ""}`);
  }
}


