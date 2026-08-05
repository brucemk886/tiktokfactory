import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const INTRO_SECONDS = 3;
const REVEAL_SECONDS = 4;
const BALL_COUNT = 10;
const BALL_RADIUS = 24;
const CONTENT_OFFSET_Y = 64;
const BOARD = {
  left: 52,
  top: 262 + CONTENT_OFFSET_Y,
  width: 616,
  height: 706,
};

const trackingBackgrounds = {
  forest: {
    page: '#071812',
    glow: 'rgba(35, 111, 82, 0.40)',
    board: 'rgba(3, 18, 14, 0.58)',
    grid: 'rgba(49, 113, 94, 0.15)',
    line: 'rgba(123, 192, 171, 0.45)',
  },
  navy: {
    page: '#07131f',
    glow: 'rgba(36, 102, 165, 0.42)',
    board: 'rgba(5, 18, 34, 0.64)',
    grid: 'rgba(67, 132, 190, 0.16)',
    line: 'rgba(105, 172, 224, 0.46)',
  },
  violet: {
    page: '#140d20',
    glow: 'rgba(119, 69, 170, 0.38)',
    board: 'rgba(20, 10, 34, 0.64)',
    grid: 'rgba(145, 91, 190, 0.16)',
    line: 'rgba(180, 129, 222, 0.46)',
  },
  graphite: {
    page: '#101315',
    glow: 'rgba(108, 128, 135, 0.30)',
    board: 'rgba(12, 16, 18, 0.72)',
    grid: 'rgba(128, 148, 154, 0.13)',
    line: 'rgba(156, 178, 184, 0.40)',
  },
  amber: {
    page: '#1b1208',
    glow: 'rgba(175, 103, 34, 0.34)',
    board: 'rgba(30, 17, 6, 0.65)',
    grid: 'rgba(188, 119, 54, 0.15)',
    line: 'rgba(223, 160, 92, 0.43)',
  },
};

const seededValues = (seed, count) => {
  let state = seed >>> 0;
  const values = [];
  for (let index = 0; index < count; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    values.push(state / 4294967296);
  }
  return values;
};

const seededShuffle = (count, seed) => {
  const values = Array.from({length: count}, (_, index) => index + 1);
  const randomValues = seededValues(seed, count * 2);
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(randomValues[index] * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  return values;
};

const reflect = (value, min, max) => {
  const span = max - min;
  const wrapped = ((value - min) % (span * 2) + span * 2) % (span * 2);
  return min + (wrapped <= span ? wrapped : span * 2 - wrapped);
};

const padTime = (seconds) => {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  return `00:${String(safeSeconds).padStart(2, '0')}`;
};

const getPrompt = (seconds, isEnglish) => {
  const prompts = isEnglish
    ? [
        [0, 1.1, 'Visual Ball Tracking'],
        [1.2, INTRO_SECONDS, 'Track the Yellow Ball'],
      ]
    : [
        [0, 1.1, '小球视觉追踪'],
        [1.2, INTRO_SECONDS, '盯住黄色小球'],
      ];

  const active = prompts.find(([start, end]) => seconds >= start && seconds < end);
  if (!active) return '';
  const [start, end, text] = active;
  const visibleLength = Math.min(
    text.length,
    Math.max(0, Math.ceil(((seconds - start) / (end - start)) * (text.length + 1))),
  );
  const showCursor = Math.floor((seconds - start) * 4) % 2 === 0;
  return `${text.slice(0, visibleLength)}${showCursor ? '│' : ''}`;
};

const makeBallConfigs = (seed, speedMultiplier) => {
  const random = seededValues(seed + 9107, BALL_COUNT * 5);
  return Array.from({length: BALL_COUNT}, (_, index) => {
    const column = index % 5;
    const row = Math.floor(index / 5);
    const initialX = BOARD.left + 100 + column * 104;
    const initialY = BOARD.top + 285 + row * 112;
    const speed = (72 + random[index * 5] * 58) * speedMultiplier;
    const angle = random[index * 5 + 1] * Math.PI * 2;
    return {
      initialX,
      initialY,
      velocityX: Math.cos(angle) * speed,
      velocityY: Math.sin(angle) * speed * (0.82 + random[index * 5 + 2] * 0.36),
    };
  });
};

const getBallPosition = (config, motionSeconds) => {
  const minX = BOARD.left + BALL_RADIUS + 10;
  const maxX = BOARD.left + BOARD.width - BALL_RADIUS - 10;
  const minY = BOARD.top + BALL_RADIUS + 10;
  const maxY = BOARD.top + BOARD.height - BALL_RADIUS - 10;
  return {
    x: reflect(config.initialX + config.velocityX * motionSeconds, minX, maxX),
    y: reflect(config.initialY + config.velocityY * motionSeconds, minY, maxY),
  };
};

const TrackingBall = ({
  position,
  target,
  targetVisibility,
  label,
  showLabel,
  revealTarget,
}) => {
  const orangeOpacity = target ? Math.max(targetVisibility, revealTarget ? 1 : 0) : 0;
  const greenOpacity = 1 - orangeOpacity;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: BALL_RADIUS * 2,
        height: BALL_RADIUS * 2,
        transform: `translate3d(${position.x - BALL_RADIUS}px, ${position.y - BALL_RADIUS}px, 0)`,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: target && (targetVisibility > 0 || revealTarget) ? -13 : -4,
          borderRadius: '50%',
          border: `2px solid rgba(255, 157, 30, ${orangeOpacity * 0.72})`,
          boxShadow: `0 0 18px rgba(255, 157, 30, ${orangeOpacity * 0.72})`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 34% 28%, #f2fff4 0%, #54f27d 24%, #15d957 48%, #078e39 78%, #035923 100%)',
          border: '2px solid rgba(134,255,161,0.45)',
          boxShadow: '0 0 13px rgba(35,238,104,0.6)',
          opacity: greenOpacity,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 34% 28%, #fff8dc 0%, #ffc24a 24%, #ff9d1e 50%, #ef6508 80%, #ad3300 100%)',
          border: '2px solid rgba(255,221,132,0.9)',
          boxShadow: `0 0 18px rgba(255,157,30,${0.7 * orangeOpacity})`,
          opacity: orangeOpacity,
        }}
      />
      {showLabel ? (
        <span
          style={{
            position: 'relative',
            zIndex: 2,
            width: 34,
            height: 34,
            display: 'grid',
            placeItems: 'center',
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.62)',
            background: 'rgba(2,18,15,0.84)',
            color: '#fff',
            fontFamily: 'Arial, sans-serif',
            fontWeight: 900,
            fontSize: label >= 10 ? 18 : 21,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            WebkitTextStroke: '0.35px rgba(255,255,255,0.72)',
            textShadow: '0 2px 4px rgba(0,0,0,0.95)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.34)',
          }}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
};

export const SchulteTracking = ({
  day,
  seed,
  trackingSeconds,
  ballSpeed,
  headline,
  backgroundMusicEnabled,
  backgroundMusicVolume,
  backgroundMusicFile,
  trackingMode = 'single',
  trackingBackground = 'forest',
  instructionLanguage = 'zh',
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const seconds = frame / fps;
  const safeTrackingSeconds = Math.max(10, Math.min(90, Number(trackingSeconds) || 30));
  const motionSeconds = Math.max(
    0,
    Math.min(safeTrackingSeconds, seconds - INTRO_SECONDS),
  );
  const trackingElapsed = seconds - INTRO_SECONDS;
  const trackingFinishedAt = INTRO_SECONDS + safeTrackingSeconds;
  const revealElapsed = seconds - trackingFinishedAt;
  const showLabels = revealElapsed >= 0.38;
  const revealTarget = revealElapsed >= 3.15;
  const speed = Math.max(0.5, Math.min(3, Number(ballSpeed) || 1));
  const safeMode = ['single', 'dual', 'triple'].includes(trackingMode)
    ? trackingMode
    : 'single';
  const isEnglish = instructionLanguage === 'en';
  const displayHeadline = String(headline || '').trim().slice(0, 24);
  const theme = trackingBackgrounds[trackingBackground] || trackingBackgrounds.forest;
  const targetIndex = Math.abs(Math.round(Number(seed) || 4602)) % BALL_COUNT;
  const secondaryTargetIndex = (targetIndex + 3 + Math.abs(Number(seed) || 0) % 4) % BALL_COUNT;
  let tertiaryTargetIndex = (
    secondaryTargetIndex + 3 + Math.abs(Number(seed) || 0) % 4
  ) % BALL_COUNT;
  while ([targetIndex, secondaryTargetIndex].includes(tertiaryTargetIndex)) {
    tertiaryTargetIndex = (tertiaryTargetIndex + 1) % BALL_COUNT;
  }
  const labels = seededShuffle(BALL_COUNT, (Number(seed) || 4602) + 41);
  const ballConfigs = makeBallConfigs(Number(seed) || 4602, speed);
  const targetVisibility = interpolate(
    trackingElapsed,
    [0, 2.5, 4.6],
    [1, 1, 0],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.quad),
    },
  );
  const finalTargetIndexes = safeMode === 'triple'
    ? [targetIndex, secondaryTargetIndex, tertiaryTargetIndex]
    : safeMode === 'dual'
      ? [targetIndex, secondaryTargetIndex]
      : [targetIndex];
  const answer = finalTargetIndexes.map((index) => labels[index]).join(' · ');
  const prompt = seconds < INTRO_SECONDS
    ? getPrompt(seconds, isEnglish)
    : '';
  const countdown =
    revealElapsed >= 0 && revealElapsed < 3
      ? Math.max(1, 3 - Math.floor(revealElapsed))
      : null;
  const fadeOut = interpolate(
    seconds,
    [INTRO_SECONDS + safeTrackingSeconds + REVEAL_SECONDS - 0.45,
      INTRO_SECONDS + safeTrackingSeconds + REVEAL_SECONDS],
    [1, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'},
  );

  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        opacity: fadeOut,
        background:
          `radial-gradient(circle at 78% 28%, ${theme.glow}, transparent 35%), radial-gradient(circle at 12% 72%, ${theme.glow}, transparent 42%), ${theme.page}`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(110deg, rgba(0,0,0,0.18), transparent 45%, rgba(35,86,68,0.14))',
        }}
      />

      {displayHeadline ? (
        <div
          style={{
            position: 'absolute',
            top: 180,
            left: '50%',
            width: 'calc(100% - 76px)',
            transform: 'translateX(-50%)',
            minHeight: 62,
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            color: '#f5fbff',
            fontFamily:
              '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif',
            fontSize: displayHeadline.length > 20
              ? 32
              : displayHeadline.length > 16
                ? 42
                : 46,
            lineHeight: 1.12,
            fontWeight: 900,
            textShadow: '0 4px 18px rgba(0,0,0,0.62)',
          }}
        >
          {displayHeadline}
        </div>
      ) : null}

      <div
        style={{
          position: 'absolute',
          top: 204 + CONTENT_OFFSET_Y,
          left: 34,
          right: 34,
          minHeight: 64,
          textAlign: 'center',
          color: '#ff7917',
          fontFamily:
            '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif',
          fontSize: 38,
          fontWeight: 900,
          letterSpacing: 0,
          textShadow: '0 3px 12px rgba(255,100,0,0.18)',
        }}
      >
        {prompt}
      </div>

      {seconds >= INTRO_SECONDS ? (
        <div
          style={{
            position: 'absolute',
            top: 204 + CONTENT_OFFSET_Y,
            left: '50%',
            minWidth: 150,
            height: 55,
            padding: '0 22px',
            transform: 'translateX(-50%)',
            display: 'grid',
            placeItems: 'center',
            borderRadius: 28,
            border: '2px solid rgba(90,205,184,0.7)',
            background: 'rgba(4,20,18,0.82)',
            color: '#fff',
            fontFamily: 'Arial, sans-serif',
            fontSize: 31,
            fontWeight: 800,
            fontVariantNumeric: 'tabular-nums',
            opacity: revealTarget ? 0 : 1,
          }}
        >
          {trackingElapsed <= safeTrackingSeconds
            ? padTime(safeTrackingSeconds - trackingElapsed)
            : ''}
        </div>
      ) : null}

      <div
        style={{
          position: 'absolute',
          left: BOARD.left,
          top: BOARD.top,
          width: BOARD.width,
          height: BOARD.height,
          overflow: 'hidden',
          border: `2px solid ${theme.line}`,
          borderRadius: 11,
          backgroundColor: theme.board,
          backgroundImage:
            `linear-gradient(${theme.grid} 1px, transparent 1px), linear-gradient(90deg, ${theme.grid} 1px, transparent 1px), radial-gradient(circle at 82% 18%, ${theme.glow}, transparent 32%)`,
          backgroundSize: '27px 27px, 27px 27px, 100% 100%',
          boxShadow: 'inset 0 0 46px rgba(0,0,0,0.36), 0 24px 50px rgba(0,0,0,0.14)',
        }}
      />

      {ballConfigs.map((config, index) => {
        const position = getBallPosition(config, motionSeconds);
        const initialTarget = index === targetIndex;
        const secondaryTarget = index === secondaryTargetIndex;
        const tertiaryTarget = index === tertiaryTargetIndex;
        const target = safeMode === 'triple'
          ? initialTarget || secondaryTarget || tertiaryTarget
          : safeMode === 'dual'
            ? initialTarget || secondaryTarget
            : initialTarget;
        return (
          <TrackingBall
            key={index}
            position={position}
            target={target}
            targetVisibility={seconds < trackingFinishedAt ? targetVisibility : 0}
            label={labels[index]}
            showLabel={showLabels}
            revealTarget={finalTargetIndexes.includes(index) && revealTarget}
          />
        );
      })}

      {revealElapsed >= 0 ? (
        <div
          style={{
            position: 'absolute',
            top: 204 + CONTENT_OFFSET_Y,
            left: 0,
            right: 0,
            textAlign: 'center',
            color: '#fff',
            fontFamily: 'Arial, sans-serif',
            fontSize: revealTarget ? 66 : 58,
            fontWeight: 900,
            textShadow: '0 4px 16px rgba(0,0,0,0.72)',
          }}
        >
          {revealTarget ? answer : countdown}
        </div>
      ) : null}

      <div
        style={{
          position: 'absolute',
          left: 28,
          bottom: 28,
          color: 'rgba(123,187,167,0.38)',
          fontFamily: 'Arial, sans-serif',
          fontSize: 16,
          fontWeight: 700,
        }}
      >
        DAY {day}
      </div>

      {backgroundMusicEnabled !== false ? (
        <Audio
          src={staticFile(backgroundMusicFile || 'focus-ambient.wav')}
          volume={Math.max(0, Math.min(1, Number(backgroundMusicVolume) || 0.35))}
          loop
        />
      ) : null}
    </AbsoluteFill>
  );
};
