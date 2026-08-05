import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const colors = {
  ink: '#111917',
  green: '#0b8f7f',
  greenSoft: '#79b7ad',
  cream: '#f6efcd',
  mint: '#dceee7',
  paper: '#fbfcf7',
  red: '#ed1c24',
};

const backgroundThemes = {
  mint: {
    base: 'linear-gradient(180deg, #f7efca 0%, #eff0d7 42%, #dceee7 100%)',
    wash: 'linear-gradient(105deg, rgba(255,255,255,0.18), transparent 38%, rgba(112,190,174,0.08))',
  },
  sky: {
    base: 'linear-gradient(180deg, #f3f8ff 0%, #e4f2f7 48%, #d8ebe9 100%)',
    wash: 'linear-gradient(120deg, rgba(255,255,255,0.42), transparent 42%, rgba(75,151,196,0.10))',
  },
  lavender: {
    base: 'linear-gradient(180deg, #f8f4fb 0%, #eee9f4 46%, #dde8ee 100%)',
    wash: 'linear-gradient(110deg, rgba(255,255,255,0.32), transparent 38%, rgba(130,105,175,0.09))',
  },
  peach: {
    base: 'linear-gradient(180deg, #fff4df 0%, #f6e8d8 48%, #e5eee4 100%)',
    wash: 'linear-gradient(120deg, rgba(255,255,255,0.34), transparent 44%, rgba(216,132,92,0.09))',
  },
  paper: {
    base: 'linear-gradient(180deg, #fffef8 0%, #f5f3e9 52%, #e8efec 100%)',
    wash: 'linear-gradient(105deg, rgba(255,255,255,0.48), transparent 40%, rgba(80,125,116,0.06))',
  },
};

const ringLayouts = {
  classic: [
    {count: 6, inner: 0, outer: 138, numberRadius: 88, fontSize: 37, offset: 30},
    {count: 12, inner: 138, outer: 228, numberRadius: 184, fontSize: 35, offset: 15},
    {count: 18, inner: 228, outer: 302, numberRadius: 266, fontSize: 34, offset: 10},
  ],
  balanced: [
    {count: 8, inner: 0, outer: 145, numberRadius: 94, fontSize: 35, offset: 22.5},
    {count: 12, inner: 145, outer: 232, numberRadius: 188, fontSize: 34, offset: 15},
    {count: 16, inner: 232, outer: 302, numberRadius: 269, fontSize: 33, offset: 11.25},
  ],
  focus: [
    {count: 6, inner: 0, outer: 128, numberRadius: 82, fontSize: 37, offset: 30},
    {count: 10, inner: 128, outer: 214, numberRadius: 171, fontSize: 35, offset: 18},
    {count: 20, inner: 214, outer: 302, numberRadius: 261, fontSize: 32, offset: 9},
  ],
};

const seededShuffle = (count, seed) => {
  const values = Array.from({length: count}, (_, index) => index + 1);
  let state = seed >>> 0;

  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };

  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }

  return values;
};

const buildTrainingValues = (seed, mode) => {
  const values = Array.from({length: 36}, (_, index) => index + 1);
  const target = (Math.abs(Number(seed) || 0) % 36) + 1;

  if (mode === 'missing') {
    values[target - 1] = '';
  } else if (mode === 'duplicate') {
    const replaceIndex = target % 36;
    values[replaceIndex] = target;
  }

  const order = seededShuffle(36, seed + 7919);
  return order.map((position) => values[position - 1]);
};

const padTime = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};

const pointOnCircle = (radius, angle) => {
  const radians = ((angle - 90) * Math.PI) / 180;
  return {
    x: 360 + Math.cos(radians) * radius,
    y: 648 + Math.sin(radians) * radius,
  };
};

const lineForAngle = (innerRadius, outerRadius, angle, key) => {
  const start = pointOnCircle(innerRadius, angle);
  const end = pointOnCircle(outerRadius, angle);
  return (
    <line
      key={key}
      x1={start.x}
      y1={start.y}
      x2={end.x}
      y2={end.y}
      stroke={colors.greenSoft}
      strokeWidth={2.4}
    />
  );
};
const RingLines = ({count, innerRadius, outerRadius, rotation}) => {
  return (
    <>
      {Array.from({length: count}, (_, index) =>
        lineForAngle(
          innerRadius,
          outerRadius,
          (index * 360) / count + rotation,
          `${count}-${index}`,
        ),
      )}
    </>
  );
};

const RingNumbers = ({
  values,
  radius,
  rotation,
  fontSize,
  opacity,
}) => {
  return (
    <>
      {values.map((value, index) => {
        const point = pointOnCircle(
          radius,
          (index * 360) / values.length + rotation,
        );

        return (
          <text
            key={`${index}-${value}`}
            x={point.x}
            y={point.y}
            textAnchor="middle"
            dominantBaseline="central"
            fill={colors.ink}
            opacity={opacity}
            fontFamily='"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif'
            fontSize={fontSize}
            fontWeight="800"
            style={{
              fontVariantNumeric: 'tabular-nums',
              textRendering: 'geometricPrecision',
            }}
          >
            {value}
          </text>
        );
      })}
    </>
  );
};

const Intro = ({day, headline, mainTitle, instructionLanguage}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const isEnglish = instructionLanguage === 'en';
  const safeHeadline = isEnglish && /[\u3400-\u9fff]/.test(String(headline || ''))
    ? 'Focus Improvement Program'
    : String(headline || (isEnglish ? 'Focus Improvement Program' : '专注力改造计划')).slice(0, 24);
  const safeMainTitle = isEnglish && /[\u3400-\u9fff]/.test(String(mainTitle || ''))
    ? 'Daily Prefrontal Training'
    : String(mainTitle || (isEnglish ? 'Daily Prefrontal Training' : '每日前额叶训练')).slice(0, 24);
  const headlineFontSize = safeHeadline.length > 18 ? 23 : safeHeadline.length > 12 ? 27 : 31;
  const mainTitleFontSize =
    safeMainTitle.length <= 8 ? 62 : safeMainTitle.length <= 12 ? 52 : 43;
  const entrance = spring({
    frame,
    fps,
    config: {damping: 16, stiffness: 95, mass: 0.8},
  });
  const exit = interpolate(frame, [52, 68], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = interpolate(entrance, [0, 1], [0.88, 1]);
  const haloRotation = frame * 0.35;

  return (
    <AbsoluteFill
      style={{
        opacity: exit,
        transform: `scale(${scale})`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 120,
          left: 78,
          width: 350,
          padding: '24px 28px 22px',
          backgroundColor: 'rgba(255,255,255,0.94)',
          borderRadius: 12,
          borderLeft: `8px solid ${colors.green}`,
          boxShadow: '0 14px 34px rgba(71, 104, 95, 0.12)',
          fontFamily:
            '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif',
        }}
      >
        <div style={{fontSize: headlineFontSize, fontWeight: 800, color: colors.ink}}>
          {safeHeadline}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 41,
            lineHeight: 1,
            fontWeight: 900,
            color: colors.ink,
          }}
        >
          DAY <span style={{color: colors.green}}>{day}</span>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 360,
          top: 470,
          width: 360,
          height: 360,
          transform: `translate(-50%, -50%) rotate(${haloRotation}deg)`,
        }}
      >
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            style={{
              position: 'absolute',
              inset: 34 + index * 31,
              borderRadius: '50%',
              border: `${12 - index * 1.5}px solid rgba(${
                index % 2 === 0 ? '75, 196, 183' : '151, 130, 232'
              }, ${0.23 + index * 0.06})`,
              transform: `rotate(${index * 22}deg) scaleX(${1.1 - index * 0.04})`,
              boxShadow:
                index === 0
                  ? '0 0 54px rgba(74, 199, 185, 0.35)'
                  : 'none',
            }}
          />
        ))}
        <div
          style={{
            position: 'absolute',
            left: 135,
            top: 134,
            width: 90,
            height: 90,
            borderRadius: '50%',
            background:
              'radial-gradient(circle at 35% 30%, #ffffff, #65cabd 45%, #9c83e8)',
            boxShadow: '0 0 58px rgba(108, 184, 211, 0.62)',
          }}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          left: 42,
          right: 42,
          top: 610,
          textAlign: 'center',
          whiteSpace: 'nowrap',
          fontFamily:
            '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif',
          fontSize: mainTitleFontSize,
          fontWeight: 900,
          color: colors.ink,
          WebkitTextStroke: '8px white',
          paintOrder: 'stroke fill',
        }}
      >
        {safeMainTitle}
      </div>
    </AbsoluteFill>
  );
};

const Instruction = ({
  trainingMode,
  instructionLanguage,
  rangeStart,
  rangeEnd,
  durationInFrames,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const isEnglish = instructionLanguage === 'en';
  const entrance = spring({
    frame,
    fps,
    config: {damping: 18, stiffness: 110},
  });
  const exitStart = Math.max(12, durationInFrames - 14);
  const exit = interpolate(frame, [exitStart, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const y = interpolate(entrance, [0, 1], [-28, 0]);
  const copy = isEnglish
    ? {
        sequence: ['IN ORDER', `FIND ${rangeStart} TO ${rangeEnd}`],
        reverse: ['REVERSE ORDER', `FIND ${rangeEnd} TO ${rangeStart}`],
        missing: ['MISSING NUMBER', `WHICH NUMBER FROM ${rangeStart}–${rangeEnd} IS MISSING?`],
        duplicate: ['DUPLICATE NUMBER', 'WHICH NUMBER APPEARS TWICE?'],
      }
    : {
        sequence: ['按顺序', `从 ${rangeStart} 找到 ${rangeEnd}`],
        reverse: ['倒序寻找', `从 ${rangeEnd} 找到 ${rangeStart}`],
        missing: ['寻找缺失数字', `${rangeStart}–${rangeEnd} 中，哪个数字不见了？`],
        duplicate: ['寻找重复数字', '哪个数字出现了两次？'],
      };
  const [title, detail] = copy[trainingMode] || copy.sequence;

  return (
    <div
      style={{
        position: 'absolute',
        top: 132,
        left: 0,
        right: 0,
        textAlign: 'center',
        opacity: exit,
        transform: `translateY(${y}px)`,
        fontFamily:
          '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif',
        color: colors.ink,
        fontWeight: 900,
        lineHeight: 1.12,
        textShadow: '0 4px 0 rgba(255,255,255,0.95)',
      }}
    >
      <div style={{fontSize: isEnglish ? 48 : 57}}>
        {title}
      </div>
      <div style={{fontSize: isEnglish ? 46 : 57, marginTop: 7}}>
        {detail}
      </div>
    </div>
  );
};

const Timer = ({trainingStartsAt}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const elapsed = frame / fps - trainingStartsAt;
  const opacity = interpolate(elapsed, [-0.3, 0.35], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const timerScale = spring({
    frame: Math.max(0, frame - trainingStartsAt * fps),
    fps,
    config: {damping: 16, stiffness: 130},
  });

  return (
    <div
      style={{
        position: 'absolute',
        top: 205,
        left: '50%',
        width: 202,
        height: 74,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `translateX(-50%) scale(${0.92 + timerScale * 0.08})`,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.94)',
        boxShadow: '0 12px 30px rgba(68, 112, 101, 0.12)',
        color: colors.green,
        fontFamily: 'Arial, sans-serif',
        fontSize: 43,
        fontWeight: 800,
        fontVariantNumeric: 'tabular-nums',
        opacity,
      }}
    >
      {padTime(elapsed)}
    </div>
  );
};

const SchulteBoard = ({
  seed,
  trainingStartsAt,
  rotationSpeed = 1,
  trainingMode = 'sequence',
  layoutStyle = 'classic',
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const seconds = frame / fps;
  const boardEntrance = spring({
    frame: Math.max(0, frame - 66),
    fps,
    config: {damping: 19, stiffness: 90, mass: 0.85},
  });
  const boardScale = interpolate(boardEntrance, [0, 1], [0.83, 1]);
  const boardOpacity = interpolate(boardEntrance, [0, 0.45, 1], [0, 0.75, 1]);
  const motionSeconds = Math.max(0, seconds - trainingStartsAt);
  const accelerationSeconds = 0.8;
  const motionRatio = Math.min(1, motionSeconds / accelerationSeconds);
  const easedMotionSeconds = motionSeconds < accelerationSeconds
    ? accelerationSeconds * (motionRatio ** 3 - 0.5 * motionRatio ** 4)
    : motionSeconds - accelerationSeconds / 2;
  const breathing = 1;

  const shuffled = buildTrainingValues(seed, trainingMode);
  const layout = ringLayouts[layoutStyle] || ringLayouts.classic;
  const rings = [];
  let valueOffset = 0;
  for (const config of layout) {
    rings.push({...config, values: shuffled.slice(valueOffset, valueOffset + config.count)});
    valueOffset += config.count;
  }

  const speed = Math.max(0.25, Math.min(3, Number(rotationSpeed) || 1));
  const innerRotation = easedMotionSeconds * -7.2 * speed;
  const middleRotation = easedMotionSeconds * 4.8 * speed + 6;
  const outerRotation = easedMotionSeconds * -3.6 * speed - 4;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        opacity: boardOpacity,
        transform: `scale(${boardScale * breathing})`,
        transformOrigin: '360px 648px',
      }}
    >
      <svg
        width="720"
        height="1280"
        viewBox="0 0 720 1280"
        shapeRendering="geometricPrecision"
        style={{position: 'absolute', inset: 0}}
      >
        <circle
          cx="360"
          cy="648"
          r="302"
          fill={colors.paper}
          stroke={colors.greenSoft}
          strokeWidth="4"
        />
        {layout.slice(0, -1).map((config) => (
          <circle
            key={`circle-${config.outer}`}
            cx="360"
            cy="648"
            r={config.outer}
            fill="none"
            stroke={colors.greenSoft}
            strokeWidth="3"
          />
        ))}
        {rings.map((ring, index) => {
          const rotation = [innerRotation, middleRotation, outerRotation][index];
          return (
            <React.Fragment key={`${layoutStyle}-${ring.count}-${index}`}>
              <RingLines
                count={ring.count}
                innerRadius={ring.inner}
                outerRadius={ring.outer}
                rotation={rotation}
              />
              <RingNumbers
                values={ring.values}
                radius={ring.numberRadius}
                rotation={rotation + ring.offset}
                fontSize={ring.fontSize}
                opacity={1}
              />
            </React.Fragment>
          );
        })}
      </svg>
    </div>
  );
};

export const SchulteFocus = ({
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
  instructionLanguage,
  rangeStart,
  rangeEnd,
  backgroundMusicEnabled,
  backgroundMusicVolume,
  backgroundMusicFile,
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const instructionFrom = Math.round(
    Math.max(1, Number(instructionStartsAt) || 2) * fps,
  );
  const safeInstructionStartsAt = Math.max(
    1,
    Number(instructionStartsAt) || 2,
  );
  const safeTrainingStartsAt = Math.max(
    safeInstructionStartsAt + 0.5,
    Number(trainingStartsAt) || 4,
  );
  const instructionDuration = Math.max(
    24,
    Math.round(
      (safeTrainingStartsAt - safeInstructionStartsAt + 0.2) *
        fps,
    ),
  );
  const fadeOut = interpolate(
    frame,
    [durationSeconds * fps - 18, durationSeconds * fps],
    [1, 0],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.out(Easing.quad),
    },
  );
  const theme = backgroundThemes[backgroundStyle] || backgroundThemes.mint;

  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        background: theme.base,
        opacity: fadeOut,
      }}
    >
      <AbsoluteFill
        style={{
          background: theme.wash,
        }}
      />

      <Sequence from={0} durationInFrames={72}>
        <Intro
          day={day}
          headline={headline}
          mainTitle={mainTitle}
          instructionLanguage={instructionLanguage}
        />
      </Sequence>

      <SchulteBoard
        seed={seed}
        trainingStartsAt={trainingStartsAt}
        rotationSpeed={rotationSpeed}
        trainingMode={trainingMode}
        layoutStyle={layoutStyle}
      />

      <Sequence from={instructionFrom} durationInFrames={instructionDuration}>
        <Instruction
          trainingMode={trainingMode}
          instructionLanguage={instructionLanguage}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          durationInFrames={instructionDuration}
        />
      </Sequence>

      <Timer trainingStartsAt={trainingStartsAt} />

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

