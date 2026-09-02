import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Audio } from "@remotion/media";

const TYPE_LABELS = {
  "hidden-number": "隐藏数字",
  "position-choice": "位置选择",
  "character-choice": "人物选择",
  "embrace-choice": "拥抱偏好",
};

const resolveAsset = (value) => {
  const src = String(value || "").trim();
  if (!src) return "";
  if (/^(https?:|data:|blob:)/.test(src)) return src;
  return staticFile(src);
};

const IntroMark = () => (
  <div style={{ position: "absolute", left: 42, top: 37, width: 38, height: 38, display: "grid", placeItems: "center" }}>
    <div style={{ width: 0, height: 0, borderTop: "9px solid transparent", borderBottom: "9px solid transparent", borderLeft: "15px solid #1a1a1a" }} />
  </div>
);

const STICK_POSE_FILES = Array.from(
  { length: 8 },
  (_, index) => `psychology-poses/stick-${String(index + 1).padStart(2, "0")}.svg`,
);

const StickCompanion = ({ frame, fps, beatIndex, startFrame, endFrame }) => {
  if (beatIndex < 0) return null;
  const safeFps = Math.max(1, fps);
  const poseIndex = Math.max(0, beatIndex) % STICK_POSE_FILES.length;
  const localFrame = Math.max(0, frame - startFrame);
  const direction = beatIndex % 2 === 0 ? 1 : -1;
  const entrance = spring({
    frame: localFrame,
    fps: safeFps,
    config: { damping: 16, stiffness: 125, mass: 0.78 },
    durationInFrames: Math.round(safeFps * 0.38),
  });
  const exitFrames = Math.max(6, Math.round(safeFps * 0.32));
  const exitStart = Math.max(startFrame + Math.round(safeFps * 0.65), endFrame - exitFrames);
  const exit = interpolate(frame, [exitStart, endFrame], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const enterX = interpolate(entrance, [0, 1], [direction * 140, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exitX = interpolate(exit, [0, 1], [0, direction * -120], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const enterOpacity = interpolate(entrance, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rotation = interpolate(entrance, [0, 1], [direction * 5, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }) + interpolate(exit, [0, 1], [0, direction * -4], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{
      position: "absolute",
      right: 54,
      bottom: 18,
      width: 280,
      height: 430,
      transform: `translateX(${enterX + exitX}px) rotate(${rotation}deg) scale(${interpolate(exit, [0, 1], [1, 0.96])})`,
      opacity: enterOpacity * (1 - exit),
      transformOrigin: "center bottom",
      willChange: "transform, opacity",
    }}>
      {STICK_POSE_FILES.map((poseFile, index) => (
        <Img
          key={poseFile}
          src={staticFile(poseFile)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "contain",
            opacity: index === poseIndex ? 1 : 0,
          }}
        />
      ))}
    </div>
  );
};

const ChoiceLabels = ({ labels, quizType }) => {
  if (!["character-choice", "embrace-choice"].includes(quizType)) return null;
  const values = Array.isArray(labels) && labels.length === 4 ? labels : ["A", "B", "C", "D"];
  return (
    <div style={{
      position: "absolute",
      left: 10,
      right: 10,
      bottom: 4,
      display: "grid",
      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
      gap: 8,
      color: "#5aa0d4",
      fontSize: 48,
      fontWeight: 850,
      textAlign: "center",
      lineHeight: 1,
      textShadow: "0 2px 0 white, 0 0 8px white",
    }}>
      {values.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
    </div>
  );
};

export const PsychologyLandscape = ({
  title = "你下意识选择的位置，藏着你的防备心有多强",
  credit = "一知心理课 一场心灵旅",
  layout = "choices-6",
  quizType = "position-choice",
  choiceLabels = ["A", "B", "C", "D", "E", "F"],
  captions = [],
  subtitle = "",
  subtitleZh = "",
  subtitleEn = "",
  imageSrc = "",
  audioSrc = "",
  duration = 16,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const resolvedImage = resolveAsset(imageSrc);
  const resolvedAudio = resolveAsset(audioSrc);
  const resolvedQuizType = resolveQuizType(quizType, layout);
  const beats = normalizeBeats({ captions, subtitle, subtitleZh, subtitleEn });
  const activeIndex = findActiveBeat(beats, frame, fps, duration);
  const active = activeIndex >= 0 ? beats[activeIndex] : { zh: "", en: "" };
  const beatStart = beatStartFrame(beats, activeIndex, fps, duration);
  const beatEnd = beatEndFrame(beats, activeIndex, fps, duration);
  const subtitleProgress = Math.max(0, frame - beatStart);
  const subtitleOpacity = activeIndex <= 0
    ? 1
    : interpolate(subtitleProgress, [0, 5, 10], [0, 0.78, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  const imageScale = 1 + Math.sin((frame / fps) * 0.62) * 0.006;
  const compactAsset = ["hidden-number", "position-choice"].includes(resolvedQuizType);

  return (
    <AbsoluteFill style={{ background: "#f6f5ef", color: "#111", fontFamily: "'Microsoft YaHei','PingFang SC',Arial,sans-serif" }}>
      {resolvedAudio ? <Audio src={resolvedAudio} /> : null}
      <IntroMark />
      <div style={{
        position: "absolute",
        zIndex: 10,
        left: 88,
        top: 26,
        width: 1370,
        fontSize: title.length > 27 ? 35 : 40,
        fontWeight: 850,
        letterSpacing: -0.5,
        lineHeight: 1.2,
      }}>
        {title}
      </div>
      <div style={{ position: "absolute", zIndex: 10, right: 42, top: 37, maxWidth: 330, color: "#66645f", fontSize: 19, fontWeight: 650, textAlign: "right", lineHeight: 1.35 }}>
        {credit}
      </div>

      <div style={{
        position: "absolute",
        left: 48,
        right: 48,
        top: 114,
        height: 680,
        overflow: "hidden",
        background: "#fbfaf6",
      }}>
        <div style={{
          position: "absolute",
          left: compactAsset ? 112 : 28,
          right: compactAsset ? 430 : 312,
          top: compactAsset ? 18 : 32,
          bottom: compactAsset ? 18 : 42,
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
        }}>
          {resolvedImage ? (
            <Img
              src={resolvedImage}
              style={{
                width: compactAsset ? "92%" : "100%",
                height: compactAsset ? "92%" : "100%",
                objectFit: "contain",
                transform: `scale(${imageScale})`,
                transformOrigin: "center center",
              }}
            />
          ) : null}
          <ChoiceLabels labels={choiceLabels} quizType={resolvedQuizType} />
        </div>

        <div style={{
          position: "absolute",
          right: 52,
          top: 20,
          padding: "7px 12px",
          border: "2px solid #d6d3c8",
          borderRadius: 999,
          color: "#77746c",
          background: "rgba(255,255,255,.72)",
          fontSize: 15,
          fontWeight: 750,
          letterSpacing: 1,
        }}>
          目标2 · {TYPE_LABELS[resolvedQuizType] || "互动测试"}
        </div>
        <StickCompanion
          frame={frame}
          fps={fps}
          beatIndex={activeIndex}
          startFrame={beatStart}
          endFrame={beatEnd}
        />
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, top: 824, height: 5, background: "#111" }} />
      <div style={{
        position: "absolute",
        left: 118,
        right: 118,
        bottom: 29,
        height: 206,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        opacity: subtitleOpacity,
        transform: `translateY(${interpolate(subtitleOpacity, [0, 1], [10, 0])}px)`,
      }}>
        <div style={{ fontSize: active.zh.length > 18 ? 38 : 42, fontWeight: 850, lineHeight: 1.28 }}>{active.zh}</div>
        {active.en ? <div style={{ marginTop: 10, color: "#252525", fontSize: 27, fontWeight: 600, lineHeight: 1.3 }}>{active.en}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

function resolveQuizType(quizType, layout) {
  if (TYPE_LABELS[quizType]) return quizType;
  if (layout === "choices-6") return "position-choice";
  if (layout === "choices-4") return "character-choice";
  return "hidden-number";
}

function normalizeBeats({ captions, subtitle, subtitleZh, subtitleEn }) {
  const list = Array.isArray(captions) ? captions : [];
  const beats = list
    .map((item) => {
      const start = Number(item?.start);
      const end = Number(item?.end);
      return {
        zh: String(item?.zh || "").trim(),
        en: String(item?.en || "").trim(),
        ...(Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : {}),
      };
    })
    .filter((item) => item.zh);
  if (beats.length) return beats;
  const zh = String(subtitleZh || subtitle || "").trim();
  const en = String(subtitleEn || "").trim();
  return zh ? [{ zh, en }] : [];
}

function beatWeights(beats) {
  return beats.map((beat) => Math.max(8, Array.from(beat.zh || "").length));
}

function findActiveBeat(beats, frame, fps, duration) {
  if (!beats.length) return -1;
  if (beats.every(hasMeasuredTiming)) {
    const seconds = frame / Math.max(1, fps);
    const measuredIndex = beats.findIndex((beat) => seconds >= beat.start && seconds < beat.end);
    if (measuredIndex >= 0) return measuredIndex;
    return seconds < beats[0].start ? 0 : beats.length - 1;
  }
  const weights = beatWeights(beats);
  const total = weights.reduce((sum, value) => sum + value, 0);
  const progress = Math.max(0, Math.min(0.999999, frame / Math.max(1, duration * fps)));
  let cursor = 0;
  for (let index = 0; index < weights.length; index += 1) {
    cursor += weights[index] / total;
    if (progress < cursor) return index;
  }
  return weights.length - 1;
}

function beatStartFrame(beats, index, fps, duration) {
  if (index <= 0 || !beats.length) return 0;
  if (hasMeasuredTiming(beats[index])) return beats[index].start * fps;
  const weights = beatWeights(beats);
  const total = weights.reduce((sum, value) => sum + value, 0);
  const before = weights.slice(0, index).reduce((sum, value) => sum + value, 0);
  return (before / total) * duration * fps;
}

function beatEndFrame(beats, index, fps, duration) {
  if (index < 0 || !beats.length) return duration * fps;
  if (hasMeasuredTiming(beats[index])) return beats[index].end * fps;
  const weights = beatWeights(beats);
  const total = weights.reduce((sum, value) => sum + value, 0);
  const through = weights.slice(0, index + 1).reduce((sum, value) => sum + value, 0);
  return (through / total) * duration * fps;
}

function hasMeasuredTiming(beat) {
  return Number.isFinite(beat?.start) && Number.isFinite(beat?.end) && beat.end > beat.start;
}
