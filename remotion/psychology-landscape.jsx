import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Audio } from "@remotion/media";

const resolveAsset = (value) => {
  const src = String(value || "").trim();
  if (!src) return "";
  if (/^(https?:|data:|blob:)/.test(src)) return src;
  return staticFile(src);
};

const splitSubtitle = (value) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  if (/[\u3400-\u9fff]/.test(text)) {
    return text.split(/(?<=[，。！？,.!?])/).map((item) => item.trim()).filter(Boolean);
  }
  const words = text.split(" ");
  const chunkCount = Math.max(1, Math.ceil(words.length / 6));
  const chunkSize = Math.ceil(words.length / chunkCount);
  const chunks = [];
  for (let index = 0; index < words.length; index += chunkSize) {
    chunks.push(words.slice(index, index + chunkSize).join(" "));
  }
  return chunks;
};

const PlayMark = () => (
  <div style={{ position: "absolute", left: 50, top: 36, width: 52, height: 52, borderRadius: "50%", background: "#9aa0a6", boxShadow: "0 2px 9px rgba(0,0,0,.18)" }}>
    <div style={{ marginLeft: 20, marginTop: 14, width: 0, height: 0, borderTop: "12px solid transparent", borderBottom: "12px solid transparent", borderLeft: "18px solid white" }} />
  </div>
);

const WaterDrop = ({ frame, fps }) => {
  const fallEnd = Math.round(fps * 0.58);
  const y = interpolate(frame, [0, fallEnd], [108, 525], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.quad),
  });
  const dropOpacity = interpolate(frame, [0, 4, fallEnd - 2, fallEnd + 3], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const ringProgress = interpolate(frame, [fallEnd, fallEnd + fps * 0.8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <>
      <div style={{ position: "absolute", zIndex: 20, left: 952, top: y, width: 18, height: 27, opacity: dropOpacity, borderRadius: "55% 55% 58% 58% / 38% 38% 70% 70%", background: "#68b7df", transform: "rotate(45deg)", boxShadow: "0 2px 8px rgba(66,153,205,.4)" }} />
      {[0, 0.18].map((delay) => {
        const progress = Math.max(0, Math.min(1, (ringProgress - delay) / (1 - delay)));
        return (
          <div
            key={delay}
            style={{
              position: "absolute",
              zIndex: 19,
              left: 960,
              top: 548,
              width: 420 * progress,
              height: 70 * progress,
              border: "4px solid rgba(84,172,215,.75)",
              borderRadius: "50%",
              opacity: (1 - progress) * 0.9,
              transform: "translate(-50%, -50%)",
            }}
          />
        );
      })}
    </>
  );
};

const ChoicePanel = ({ index, imageSrc, frame, fps }) => {
  const entrance = spring({
    frame: frame - index * 3,
    fps,
    config: { damping: 18, stiffness: 120, mass: 0.75 },
    durationInFrames: Math.round(fps * 0.8),
  });
  const blur = interpolate(entrance, [0, 1], [24, 0]);
  const stretch = interpolate(entrance, [0, 1], [1.18, 1]);
  const shift = interpolate(entrance, [0, 1], [34 * (index % 2 ? 1 : -1), 0]);
  const breathe = 1.018 + Math.sin((frame / fps) * 1.1 + index * 0.7) * 0.012;

  return (
    <div style={{ position: "relative", overflow: "hidden", height: 610, background: "#ececec", borderRight: index < 3 ? "5px solid white" : "none", opacity: interpolate(entrance, [0, 0.2, 1], [0, 0.75, 1]), transform: `translateX(${shift}px) scaleY(${stretch})`, transformOrigin: "center", filter: `blur(${blur}px)` }}>
      <Img
        src={imageSrc}
        style={{
          position: "absolute",
          height: "100%",
          width: "400%",
          maxWidth: "none",
          left: `${index * -100}%`,
          objectFit: "cover",
          transform: `scale(${breathe})`,
          transformOrigin: `${12.5 + index * 25}% center`,
        }}
      />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 112, background: "linear-gradient(transparent, rgba(0,0,0,.35))" }} />
      <div style={{ position: "absolute", left: "50%", bottom: 18, transform: "translateX(-50%)", color: "#4b9ed1", fontSize: 70, fontWeight: 800, lineHeight: 1, textShadow: "0 2px 4px rgba(0,0,0,.4)" }}>
        {String.fromCharCode(65 + index)}
      </div>
    </div>
  );
};

export const PsychologyLandscape = ({
  title = "Which one feels most like you?",
  subtitle = "",
  imageSrc = "",
  audioSrc = "",
  duration = 10,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const resolvedImage = resolveAsset(imageSrc);
  const resolvedAudio = resolveAsset(audioSrc);
  const chunks = splitSubtitle(subtitle);
  const activeIndex = chunks.length
    ? Math.min(chunks.length - 1, Math.floor((frame / Math.max(1, duration * fps)) * chunks.length))
    : -1;
  const chunkFrames = chunks.length ? (duration * fps) / chunks.length : 1;
  const subtitleProgress = activeIndex >= 0 ? frame - activeIndex * chunkFrames : 0;
  const subtitleOpacity = interpolate(subtitleProgress, [0, 4, 8], [0, 0.75, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: "white", color: "#111", fontFamily: "Arial, 'Microsoft YaHei', sans-serif" }}>
      {resolvedAudio ? <Audio src={resolvedAudio} /> : null}
      <PlayMark />
      <div style={{ position: "absolute", zIndex: 10, left: 128, top: 35, width: 1640, fontSize: 44, fontWeight: 800, lineHeight: 1.12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {title}
      </div>

      <div style={{ position: "absolute", left: 108, right: 108, top: 142, height: 610, display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", overflow: "hidden" }}>
        {[0, 1, 2, 3].map((index) => (
          <ChoicePanel key={index} index={index} imageSrc={resolvedImage} frame={frame} fps={fps} />
        ))}
      </div>

      <WaterDrop frame={frame} fps={fps} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 822, height: 8, background: "#111" }} />
      <div style={{ position: "absolute", left: 120, right: 120, bottom: 48, height: 178, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontSize: 47, fontWeight: 700, lineHeight: 1.18, opacity: subtitleOpacity, transform: `translateY(${interpolate(subtitleOpacity, [0, 1], [12, 0])}px)` }}>
        {activeIndex >= 0 ? chunks[activeIndex] : ""}
      </div>
    </AbsoluteFill>
  );
};
