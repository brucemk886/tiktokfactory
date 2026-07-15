import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Audio } from "@remotion/media";

const fitText = (value) => String(value || "").trim() || "Podcast";

export const PodcastVideo = (props) => {
  const { audioSrc, template, fastStill, includeAudio = true } = props;
  const resolvedAudio = resolveAsset(audioSrc);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0f1720", fontFamily: "'Microsoft YaHei', 'SimHei', sans-serif" }}>
      {resolvedAudio && includeAudio && !fastStill ? <Audio src={resolvedAudio} /> : null}
      {template === "minimal-wave" ? (
        <JournalTemplate {...props} audioSrc={resolvedAudio} />
      ) : template === "journal-wave" ? (
        <JournalWaveTemplate {...props} audioSrc={resolvedAudio} />
      ) : template === "player" ? (
        <PlayerTemplate {...props} audioSrc={resolvedAudio} />
      ) : (
        <CenterWaveTemplate {...props} audioSrc={resolvedAudio} />
      )}
    </AbsoluteFill>
  );
};

const resolveAsset = (src) => {
  if (!src) return "";
  if (/^(https?:|data:|blob:)/.test(src)) return src;
  return staticFile(src);
};

const Backdrop = ({ src, overlay = "rgba(0,0,0,0.52)", fallback = "#111" }) => {
  const resolvedSrc = resolveAsset(src);
  return (
    <AbsoluteFill style={{ backgroundColor: fallback, overflow: "hidden" }}>
      {resolvedSrc ? (
        <Img
          src={resolvedSrc}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      ) : null}
      {overlay ? <AbsoluteFill style={{ background: overlay }} /> : null}
    </AbsoluteFill>
  );
};

const CenterWaveTemplate = ({ title, audioSrc, backgroundSrc, backgroundColor, audioLevels }) => {
  return (
    <AbsoluteFill>
      <Backdrop src={backgroundSrc} overlay={backgroundSrc ? "rgba(0,0,0,0.58)" : ""} fallback={backgroundColor || "#050505"} />
      <div
        style={{
          position: "absolute",
          top: "12%",
          left: "5%",
          right: "5%",
          textAlign: "center",
          color: "#fff",
          fontSize: 58,
          fontWeight: 900,
          letterSpacing: 0,
          textShadow: "0 3px 8px rgba(0,0,0,0.65)",
          whiteSpace: "pre-wrap",
        }}
      >
        {fitText(title)}
      </div>
      <div
        style={{
          position: "absolute",
          top: "47%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "66%",
          height: 132,
        }}
      >
        <AudioWaveform audioSrc={audioSrc} variant="player" audioLevels={audioLevels} />
      </div>
    </AbsoluteFill>
  );
};

const PlayerTemplate = ({ title, audioSrc, backgroundSrc, backgroundColor, duration = 0, audioLevels }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsed = Math.min(duration, frame / fps);
  const remaining = Math.max(0, duration - elapsed);

  return (
    <AbsoluteFill>
      <Backdrop src={backgroundSrc} overlay={backgroundSrc ? "rgba(0,0,0,0.52)" : ""} fallback={backgroundColor || "#000"} />
      <div
        style={{
          position: "absolute",
          top: "14%",
          left: "6%",
          right: "6%",
          color: "#fff",
          textAlign: "center",
          fontSize: 78,
          fontWeight: 900,
          lineHeight: 1.12,
          textShadow: "0 3px 8px rgba(0,0,0,0.75)",
          whiteSpace: "pre-wrap",
        }}
      >
        {fitText(title)}
      </div>

      <div
        style={{
          position: "absolute",
          top: "38.5%",
          left: "8%",
          right: "8%",
          display: "flex",
          justifyContent: "space-between",
          color: "#fff",
          fontSize: 48,
          fontWeight: 800,
          textShadow: "0 2px 6px rgba(0,0,0,0.7)",
        }}
      >
        <span>{formatTime(Math.floor(elapsed))}</span>
        <span>{formatTime(Math.ceil(remaining))}</span>
      </div>

      <div
        style={{
          position: "absolute",
          top: "62%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "68%",
          height: 120,
        }}
      >
        <AudioWaveform audioSrc={audioSrc} variant="player" audioLevels={audioLevels} boosted />
      </div>

      <div
        style={{
          position: "absolute",
          left: "10%",
          right: "10%",
          top: "75.5%",
          height: 150,
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr",
          alignItems: "center",
          justifyItems: "center",
          color: "#fff",
        }}
      >
        <HeartIcon />
        <SkipIcon direction="back" />
        <PauseButton compact />
        <SkipIcon direction="forward" />
        <MenuIcon />
      </div>
    </AbsoluteFill>
  );
};

const JournalTemplate = ({ title, audioSrc, backgroundSrc, backgroundColor, duration = 0, fastStill = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsed = fastStill ? 0 : Math.min(duration, frame / fps);
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0;

  return (
    <AbsoluteFill>
      <Backdrop src={backgroundSrc} overlay={backgroundSrc ? "rgba(0,0,0,0.48)" : ""} fallback={backgroundColor || "#347d95"} />
      <div style={{ position: "absolute", left: "6.2%", top: "18%", color: "#f5fbff" }}>
        <div style={{ fontSize: 56, fontWeight: 800, textShadow: "0 2px 6px rgba(0,0,0,0.22)" }}>{fitText(title)}</div>
      </div>

      <div style={{ position: "absolute", left: "6.2%", right: "6.2%", top: "44%" }}>
        <div style={{ height: 12, borderRadius: 999, background: "rgba(190,224,234,0.62)", overflow: "hidden" }}>
          {!fastStill ? <div style={{ width: `${progress * 100}%`, height: "100%", background: "#e5f5fb", borderRadius: 999 }} /> : null}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 30, color: "rgba(222,242,248,0.82)", fontSize: 40 }}>
          <span>{fastStill ? "" : formatTime(Math.floor(elapsed))}</span>
          <span>{formatTime(Math.round(duration))}</span>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: "6.2%",
          right: "6.2%",
          top: "63%",
          height: 150,
          color: "#fff",
        }}
      >
        <div style={{ position: "absolute", left: 0, top: 40 }}>
          <SpeedControl />
        </div>
        <div style={{ position: "absolute", left: "28%", top: 20, transform: "translateX(-50%)" }}>
          <CircleNumber value="15" direction="left" />
        </div>
        <div style={{ position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)" }}>
          <PauseButton />
        </div>
        <div style={{ position: "absolute", left: "72%", top: 20, transform: "translateX(-50%)" }}>
          <CircleNumber value="30" direction="right" />
        </div>
      </div>

    </AbsoluteFill>
  );
};

const JournalWaveTemplate = ({ title, audioSrc, backgroundSrc, backgroundColor, duration = 0, audioLevels }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const elapsed = Math.min(duration, frame / fps);
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0;

  return (
    <AbsoluteFill>
      <Backdrop src={backgroundSrc} overlay={backgroundSrc ? "rgba(0,0,0,0.48)" : ""} fallback={backgroundColor || "#347d95"} />
      <div style={{ position: "absolute", left: "6.2%", top: "15.5%", color: "#f5fbff" }}>
        <div style={{ fontSize: 58, fontWeight: 850, lineHeight: 1.16, textShadow: "0 3px 8px rgba(0,0,0,0.36)", whiteSpace: "pre-wrap" }}>
          {fitText(title)}
        </div>
      </div>

      <div style={{ position: "absolute", left: "6.2%", right: "6.2%", top: "38.5%" }}>
        <div style={{ height: 12, borderRadius: 999, background: "rgba(211,231,238,0.5)", overflow: "hidden" }}>
          <div style={{ width: `${progress * 100}%`, height: "100%", background: "#f2fbff", borderRadius: 999 }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28, color: "rgba(238,250,255,0.84)", fontSize: 38 }}>
          <span>{formatTime(Math.floor(elapsed))}</span>
          <span>{formatTime(Math.round(duration))}</span>
        </div>
      </div>

      <div style={{ position: "absolute", top: "53.5%", left: "50%", transform: "translateX(-50%)", width: "72%", height: 118 }}>
        <AudioWaveform audioSrc={audioSrc} variant="player" audioLevels={audioLevels} />
      </div>

      <div
        style={{
          position: "absolute",
          left: "50%",
          width: "88%",
          transform: "translateX(-50%)",
          top: "66.5%",
          height: 150,
          display: "grid",
          gridTemplateColumns: "1.15fr 1fr 1.35fr 1fr",
          alignItems: "center",
          justifyItems: "center",
          color: "#fff",
        }}
      >
        <div style={{ transform: "scale(0.82)", transformOrigin: "center" }}>
          <SpeedControl />
        </div>
        <div>
          <CircleNumber value="15" direction="left" />
        </div>
        <div>
          <PauseButton />
        </div>
        <div>
          <CircleNumber value="30" direction="right" />
        </div>
      </div>
    </AbsoluteFill>
  );
};
const AudioWaveform = ({ audioSrc, variant = "center", audioLevels, boosted = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const isPlayer = variant === "player";
  const samples = isPlayer ? 78 : 96;
  const hasPrecomputedLevels = Array.isArray(audioLevels?.levels) && audioLevels.levels.length > 1;
  const rawWaveform = new Array(samples).fill(0);

  const currentTime = frame / fps;
  const currentLevel = hasPrecomputedLevels ? getAudioLevel(audioLevels, currentTime) : 0;
  const recentLevel = hasPrecomputedLevels ? getAudioLevel(audioLevels, Math.max(0, currentTime - 0.12)) : currentLevel;
  const levelVelocity = Math.max(0, currentLevel - recentLevel);
  const absWaveform = rawWaveform.map((value) => Math.abs(value));
  const peak = Math.max(0.0001, ...absWaveform, currentLevel);
  const energy = hasPrecomputedLevels
    ? currentLevel
    : absWaveform.reduce((sum, value) => sum + value, 0) / Math.max(1, absWaveform.length);
  const normalizedEnergy = hasPrecomputedLevels ? currentLevel : Math.min(1, energy / peak);
  const center = (samples - 1) / 2;
  const waveform = isPlayer
    ? rawWaveform.map((value, i) => {
        const distance = Math.abs(i - center) / center;
        const centerBias = boosted ? Math.max(0.62, 1 - distance * 0.24) : Math.max(0.46, 1 - distance * 0.38);
        const sideDelay = distance * (boosted ? 0.11 : 0.18);
        const sideLevel = hasPrecomputedLevels
          ? getAudioLevel(audioLevels, Math.max(0, currentTime - sideDelay))
          : 0;
        const neighborTime = Math.max(0, currentTime + (i - center) * (boosted ? 0.012 : 0.006));
        const neighborLevel = hasPrecomputedLevels ? getAudioLevel(audioLevels, neighborTime) : 0;
        const local = hasPrecomputedLevels
          ? Math.max(
              currentLevel * (boosted ? 1.04 : 1),
              sideLevel * (boosted ? 1 : 0.92),
              neighborLevel * (boosted ? 0.92 : 0.82)
            )
          : Math.abs(value) / peak;
        const breathing = boosted
          ? 0.48 + 0.52 * Math.abs(Math.sin(i * 0.66 + frame * 0.16))
          : 0.58 + 0.42 * Math.abs(Math.sin(i * 0.43 + frame * 0.1));
        const fineWave = boosted
          ? 0.58 + 0.42 * Math.abs(Math.sin(i * 1.45 - frame * 0.12))
          : 0.72 + 0.28 * Math.abs(Math.sin(i * 1.17 - frame * 0.07));
        const spikeSeed = Math.pow(Math.abs(Math.sin(i * 0.74 + frame * 0.07)), boosted ? 6 : 10);
        const activeLevel = boosted ? Math.max(0, local - 0.045) / 0.955 : Math.max(0, local - 0.1) / 0.9;
        const spike = spikeSeed * Math.min(1, activeLevel * (boosted ? 2.4 : 1.7) + levelVelocity * (boosted ? 4.2 : 2.8));
        const voicePulse = Math.pow(
          Math.min(1, activeLevel * (boosted ? 1.65 : 1.22) + normalizedEnergy * (boosted ? 0.36 : 0.26)),
          boosted ? 0.72 : 0.9
        );
        const silenceFloor = hasPrecomputedLevels ? (boosted ? 0.012 : 0.025) : 0.14;
        return (silenceFloor + voicePulse * breathing * fineWave + spike * (boosted ? 1.05 : 0.78)) * centerBias;
      })
    : rawWaveform.map((_, i) => {
        const distance = Math.abs(i - center) / center;
        const localTime = Math.max(0, currentTime + (i - center) * 0.018);
        const localLevel = hasPrecomputedLevels ? getAudioLevel(audioLevels, localTime) : 0.08;
        const ripple = 0.62 + 0.38 * Math.abs(Math.sin(i * 0.48 - frame * 0.075));
        return (0.04 + localLevel * ripple) * Math.max(0.55, 1 - distance * 0.28);
      });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        style={{
          position: "absolute",
          left: isPlayer ? 4 : 0,
          right: isPlayer ? 4 : 0,
          top: "50%",
          height: isPlayer ? 5 : 4,
          display: "grid",
          gridTemplateColumns: `repeat(${isPlayer ? samples * 2 : samples}, 1fr)`,
          gap: isPlayer ? 6 : 5,
          transform: "translateY(-50%)",
        }}
      >
        {new Array(isPlayer ? samples * 2 : samples).fill(0).map((_, i) => (
          <div key={i} style={{ height: isPlayer ? 5 : 4, borderRadius: 999, background: "rgba(255,255,255,0.88)" }} />
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          gridTemplateColumns: `repeat(${samples}, 1fr)`,
          gap: isPlayer ? 7 : 5,
          alignItems: "center",
        }}
      >
        {waveform.map((v, i) => {
          const height = isPlayer
            ? Math.max(5, Math.min(boosted ? 118 : 112, 5 + Math.abs(v) * (boosted ? 126 : 112)))
            : Math.max(5, Math.min(118, 8 + Math.abs(v) * 260));
          return (
            <div
              key={i}
              style={{
                height,
                borderRadius: 999,
                background: "#fff",
                boxShadow: "0 0 8px rgba(255,255,255,0.24)",
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

const getAudioLevel = (audioLevels, time) => {
  const levels = audioLevels?.levels;
  const step = audioLevels?.step || 0.05;
  if (!Array.isArray(levels) || levels.length === 0 || step <= 0) return 0;

  const position = Math.max(0, time) / step;
  const leftIndex = Math.floor(position);
  const rightIndex = Math.min(levels.length - 1, leftIndex + 1);
  const left = levels[Math.min(levels.length - 1, leftIndex)] || 0;
  const right = levels[rightIndex] || left;
  const mix = position - leftIndex;
  return Math.max(0, Math.min(1, left + (right - left) * mix));
};

const HeartIcon = () => (
  <div
    style={{
      width: 76,
      height: 76,
      position: "relative",
      transform: "rotate(-45deg)",
      background: "#fff",
      borderRadius: "12px 0 0 0",
    }}
  >
    <div
      style={{
        position: "absolute",
        width: 76,
        height: 76,
        left: 38,
        top: 0,
        background: "#fff",
        borderRadius: "50%",
      }}
    />
    <div
      style={{
        position: "absolute",
        width: 76,
        height: 76,
        left: 0,
        top: -38,
        background: "#fff",
        borderRadius: "50%",
      }}
    />
  </div>
);

const SkipIcon = ({ direction = "forward" }) => {
  const flip = direction === "back" ? "scaleX(-1)" : "none";
  return (
    <div style={{ width: 114, height: 86, position: "relative", transform: flip }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 5,
          width: 0,
          height: 0,
          borderTop: "38px solid transparent",
          borderBottom: "38px solid transparent",
          borderLeft: "54px solid #fff",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 46,
          top: 5,
          width: 0,
          height: 0,
          borderTop: "38px solid transparent",
          borderBottom: "38px solid transparent",
          borderLeft: "54px solid #fff",
        }}
      />
    </div>
  );
};

const MenuIcon = () => (
  <div style={{ width: 82, height: 76, position: "relative" }}>
    {[0, 1, 2].map((index) => (
      <div
        key={index}
        style={{
          position: "absolute",
          left: 10,
          right: 0,
          top: 8 + index * 28,
          height: 10,
          borderRadius: 999,
          background: "#fff",
        }}
      />
    ))}
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        borderTop: "18px solid transparent",
        borderBottom: "18px solid transparent",
        borderLeft: "28px solid #fff",
      }}
    />
  </div>
);

const PauseButton = ({ compact = false }) => {
  const width = compact ? 92 : 132;
  const height = compact ? 96 : 134;
  const barWidth = compact ? 28 : 42;
  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: compact ? 18 : 28,
      }}
    >
      <div style={{ width: barWidth, height, borderRadius: 16, background: "#fff" }} />
      <div style={{ width: barWidth, height, borderRadius: 16, background: "#fff" }} />
    </div>
  );
};

const SpeedControl = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 16, color: "#fff" }}>
    <div style={{ width: 64, height: 46, position: "relative" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 8, height: 6, borderRadius: 999, background: "#fff" }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 32, height: 6, borderRadius: 999, background: "#fff" }} />
      <div style={{ position: "absolute", left: 36, top: 0, width: 16, height: 16, border: "6px solid #fff", borderRadius: "50%", background: "transparent" }} />
      <div style={{ position: "absolute", left: 10, top: 24, width: 16, height: 16, border: "6px solid #fff", borderRadius: "50%", background: "transparent" }} />
    </div>
    <div style={{ fontSize: 30, fontWeight: 700 }}>1.25x</div>
  </div>
);

const CircleNumber = ({ value, direction = "right" }) => {
  const openSide = direction === "left" ? "left" : "right";
  const arrowLeft = openSide === "left" ? 0 : 58;
  return (
    <div style={{ width: 94, height: 94, position: "relative", color: "#fff" }}>
      <div
        style={{
          position: "absolute",
          inset: 10,
          border: "8px solid #fff",
          borderRadius: "50%",
          clipPath: openSide === "left" ? "inset(0 0 0 18px)" : "inset(0 18px 0 0)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: arrowLeft,
          top: 9,
          width: 0,
          height: 0,
          borderLeft: "10px solid transparent",
          borderRight: "10px solid transparent",
          borderTop: "18px solid #fff",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 38,
          fontWeight: 900,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
};

const formatTime = (seconds) => {
  const safe = Math.max(0, Number(seconds) || 0);
  const min = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};


