import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif';

const clamp = {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
};

const containsCjk = (value) => /[\u3400-\u9fff]/.test(String(value || ''));

const seededRandom = (seed) => {
  let state = Math.max(1, Math.floor(Number(seed) || 1)) % 2147483647;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
};

const shuffledIndexes = (length, seed) => {
  const values = Array.from({length}, (_, index) => index);
  const random = seededRandom(seed);
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  return values;
};

const BackgroundMusic = ({
  enabled = true,
  file = 'focus-ambient.wav',
  volume = 0.35,
}) => enabled && file ? (
  <Audio src={staticFile(file)} volume={Math.max(0, Math.min(1, Number(volume) || 0))} loop />
) : null;

const Header = ({number, title, subtitle, dark = false}) => (
  <div style={{position: 'absolute', top: 64, left: 48, right: 48}}>
    <div
      style={{
        display: 'inline-flex',
        padding: '7px 10px',
        border: `1px solid ${dark ? 'rgba(255,255,255,.32)' : 'rgba(22,35,38,.28)'}`,
        borderRadius: 5,
        color: dark ? 'rgba(255,255,255,.74)' : '#526064',
        fontFamily: FONT,
        fontSize: 15,
        fontWeight: 800,
      }}
    >
      FOCUS TEST · {number}
    </div>
    <div
      style={{
        marginTop: 20,
        color: dark ? '#fff' : '#152126',
        fontFamily: FONT,
        fontSize: 43,
        fontWeight: 900,
        lineHeight: 1.14,
      }}
    >
      {title}
    </div>
    <div
      style={{
        marginTop: 10,
        color: dark ? 'rgba(255,255,255,.62)' : '#708086',
        fontFamily: FONT,
        fontSize: 19,
        fontWeight: 600,
      }}
    >
      {subtitle}
    </div>
  </div>
);

const Footer = ({day = 1, dark = false}) => (
  <div
    style={{
      position: 'absolute',
      left: 48,
      right: 48,
      bottom: 34,
      display: 'flex',
      justifyContent: 'space-between',
      color: dark ? 'rgba(255,255,255,.35)' : 'rgba(31,49,54,.42)',
      fontFamily: 'Arial, sans-serif',
      fontSize: 15,
      fontWeight: 800,
    }}
  >
    <span>DAILY PREFRONTAL TRAINING</span>
    <span>DAY {day}</span>
  </div>
);

const stroopRounds = [
  [
    {word: 'RED', color: '#2489e8'},
    {word: 'BLUE', color: '#ef424b'},
    {word: 'GREEN', color: '#efb62f'},
    {word: 'YELLOW', color: '#27aa72'},
  ],
  [
    {word: 'GREEN', color: '#ef424b'},
    {word: 'YELLOW', color: '#2489e8'},
    {word: 'BLUE', color: '#27aa72'},
    {word: 'RED', color: '#efb62f'},
  ],
  [
    {word: 'YELLOW', color: '#27aa72'},
    {word: 'RED', color: '#efb62f'},
    {word: 'GREEN', color: '#2489e8'},
    {word: 'BLUE', color: '#ef424b'},
  ],
];

export const ColorInterference = ({day = 1}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const seconds = frame / fps;
  const round = Math.max(0, Math.min(2, Math.floor((seconds - 3) / 3.5)));
  const reveal = seconds >= 13;
  const pulse = 1 + Math.sin(seconds * 3.2) * 0.025;
  const entrance = spring({frame: frame - 55, fps, config: {damping: 14, stiffness: 105}});

  return (
    <AbsoluteFill style={{overflow: 'hidden', background: '#f3f0e7'}}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(rgba(31,52,59,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(31,52,59,.045) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
        }}
      />
      <Header
        number="03"
        title="颜色文字干扰"
        subtitle="不要读单词，只判断文字显示的颜色"
      />

      <div
        style={{
          position: 'absolute',
          top: 300,
          left: 46,
          right: 46,
          height: 700,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 1fr',
          gap: 16,
          opacity: interpolate(entrance, [0, 1], [0, 1]),
          transform: `scale(${interpolate(entrance, [0, 1], [0.94, 1]) * pulse})`,
        }}
      >
        {stroopRounds[round].map((item, index) => (
          <div
            key={`${round}-${item.word}`}
            style={{
              display: 'grid',
              placeItems: 'center',
              border: '1px solid rgba(24,42,48,.18)',
              borderRadius: 7,
              background: index === round ? '#fff' : 'rgba(255,255,255,.62)',
              boxShadow: index === round ? '0 18px 44px rgba(31,52,59,.12)' : 'none',
            }}
          >
            <span
              style={{
                color: item.color,
                fontFamily: 'Arial, sans-serif',
                fontSize: item.word.length > 5 ? 54 : 64,
                fontWeight: 900,
              }}
            >
              {item.word}
            </span>
          </div>
        ))}
      </div>

      <div
        style={{
          position: 'absolute',
          left: 70,
          right: 70,
          bottom: 122,
          padding: '17px 20px',
          borderRadius: 6,
          textAlign: 'center',
          background: reveal ? '#17262c' : '#d9e2df',
          color: reveal ? '#fff' : '#44545a',
          fontFamily: FONT,
          fontSize: 22,
          fontWeight: 900,
        }}
      >
        {reveal ? '你答对了几组？' : `第 ${round + 1} / 3 组`}
      </div>
      <Footer day={day} />
    </AbsoluteFill>
  );
};

const memoryBackgrounds = {
  aqua: {
    page: '#edf7f6',
    glowA: 'rgba(44, 194, 180, .22)',
    glowB: 'rgba(86, 165, 207, .14)',
    text: '#173f48',
    muted: '#567981',
    accent: '#26bbae',
    accentDark: '#176f78',
    accentSoft: '#c5e8e4',
    board: 'rgba(255, 255, 255, .74)',
    cell: '#f9fffe',
    cellPast: '#bfeee9',
    cellReveal: '#215f76',
    line: 'rgba(41, 99, 111, .28)',
    cellLine: 'rgba(62, 112, 123, .20)',
    shadow: 'rgba(45, 92, 104, .14)',
    dark: false,
  },
  navy: {
    page: '#071522',
    glowA: 'rgba(61, 166, 255, .25)',
    glowB: 'rgba(37, 220, 194, .12)',
    text: '#f5f9ff',
    muted: '#91adc3',
    accent: '#4db8ff',
    accentDark: '#2278ad',
    accentSoft: '#b9def4',
    board: 'rgba(5, 20, 37, .78)',
    cell: '#102a40',
    cellPast: '#245c78',
    cellReveal: '#4db8ff',
    line: 'rgba(98, 183, 255, .36)',
    cellLine: 'rgba(106, 185, 240, .22)',
    shadow: 'rgba(0, 0, 0, .38)',
    dark: true,
  },
  violet: {
    page: '#19132a',
    glowA: 'rgba(165, 105, 255, .26)',
    glowB: 'rgba(247, 111, 186, .14)',
    text: '#fbf7ff',
    muted: '#b8a7cf',
    accent: '#b68cff',
    accentDark: '#7651b7',
    accentSoft: '#d8c7f2',
    board: 'rgba(25, 17, 45, .80)',
    cell: '#2a2144',
    cellPast: '#594884',
    cellReveal: '#a474ef',
    line: 'rgba(190, 149, 255, .34)',
    cellLine: 'rgba(190, 149, 255, .20)',
    shadow: 'rgba(0, 0, 0, .36)',
    dark: true,
  },
  forest: {
    page: '#10251f',
    glowA: 'rgba(89, 211, 142, .24)',
    glowB: 'rgba(232, 193, 85, .12)',
    text: '#f2fbf4',
    muted: '#a2c2ae',
    accent: '#58d38c',
    accentDark: '#277a52',
    accentSoft: '#bee7cf',
    board: 'rgba(13, 40, 32, .82)',
    cell: '#1d493a',
    cellPast: '#397b5f',
    cellReveal: '#e0a93d',
    line: 'rgba(102, 218, 151, .32)',
    cellLine: 'rgba(117, 224, 164, .19)',
    shadow: 'rgba(0, 0, 0, .34)',
    dark: true,
  },
  sunset: {
    page: '#fff1df',
    glowA: 'rgba(255, 136, 78, .27)',
    glowB: 'rgba(128, 79, 184, .13)',
    text: '#542b31',
    muted: '#8d6264',
    accent: '#ef704b',
    accentDark: '#ae493d',
    accentSoft: '#f5c7b7',
    board: 'rgba(255, 250, 241, .80)',
    cell: '#fffaf2',
    cellPast: '#ffd1be',
    cellReveal: '#8f4d7e',
    line: 'rgba(174, 73, 61, .28)',
    cellLine: 'rgba(174, 73, 61, .18)',
    shadow: 'rgba(123, 68, 50, .18)',
    dark: false,
  },
  rose: {
    page: '#fff1f4',
    glowA: 'rgba(233, 101, 142, .23)',
    glowB: 'rgba(91, 157, 224, .12)',
    text: '#512b3d',
    muted: '#8c6475',
    accent: '#e15e8c',
    accentDark: '#a43d67',
    accentSoft: '#f3c5d7',
    board: 'rgba(255, 250, 252, .80)',
    cell: '#fff9fb',
    cellPast: '#f6c9da',
    cellReveal: '#466fa4',
    line: 'rgba(164, 61, 103, .27)',
    cellLine: 'rgba(164, 61, 103, .17)',
    shadow: 'rgba(106, 51, 74, .16)',
    dark: false,
  },
  graphite: {
    page: '#16191d',
    glowA: 'rgba(244, 185, 66, .20)',
    glowB: 'rgba(86, 172, 176, .11)',
    text: '#f8f5ec',
    muted: '#aaa8a0',
    accent: '#e7b64b',
    accentDark: '#a87827',
    accentSoft: '#e2d3ad',
    board: 'rgba(25, 28, 32, .84)',
    cell: '#282d32',
    cellPast: '#555e62',
    cellReveal: '#d79b34',
    line: 'rgba(232, 188, 86, .29)',
    cellLine: 'rgba(255, 255, 255, .13)',
    shadow: 'rgba(0, 0, 0, .42)',
    dark: true,
  },
};

export const PositionMemory = ({
  day = 1,
  seed = 4001,
  headline = '网格位置记忆',
  mainTitle = '每日前额叶训练',
  memorySteps = 6,
  memoryBackground = 'aqua',
  instructionLanguage = 'zh',
  backgroundMusicEnabled = true,
  backgroundMusicVolume = 0.35,
  backgroundMusicFile = 'focus-ambient.wav',
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const seconds = frame / fps;
  const stepCount = Math.max(4, Math.min(8, Math.round(Number(memorySteps) || 6)));
  const pathForVideo = shuffledIndexes(25, seed).slice(0, stepCount);
  const theme = memoryBackgrounds[memoryBackground] || memoryBackgrounds.aqua;
  const trainingStartsAt = 3;
  const showingEndsAt = 8.5;
  const showing = seconds >= trainingStartsAt && seconds < showingEndsAt;
  const recallStartFrame = Math.round(showingEndsAt * fps);
  const recallDurationFrames = Math.round(3 * fps);
  const recallFrame = frame - recallStartFrame;
  const recalling = recallFrame >= 0 && recallFrame < recallDurationFrames;
  const reveal = frame >= recallStartFrame + recallDurationFrames;
  const isEnglish = instructionLanguage === 'en';
  const displayHeadline = isEnglish && containsCjk(headline)
    ? 'Grid Position Memory'
    : headline;
  const displayMainTitle = isEnglish && containsCjk(mainTitle)
    ? 'Daily Prefrontal Training'
    : mainTitle;
  const stepDuration = 5.2 / stepCount;
  const activeStep = Math.floor((seconds - trainingStartsAt) / stepDuration);
  const recallSecond = Math.max(1, 3 - Math.floor(recallFrame / fps));
  const recallTickFrame = ((recallFrame % fps) + fps) % fps;
  const stopwatchProgress = Math.max(0, Math.min(1, recallTickFrame / fps));
  const recallOpacity = interpolate(
    recallFrame,
    [0, 6, recallDurationFrames - 6, recallDurationFrames],
    [0, 1, 1, 0],
    clamp,
  );

  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        background: `
          radial-gradient(circle at 52% 37%, ${theme.glowA}, transparent 36%),
          radial-gradient(circle at 12% 78%, ${theme.glowB}, transparent 34%),
          ${theme.page}
        `,
      }}
    >
      <BackgroundMusic
        enabled={backgroundMusicEnabled}
        file={backgroundMusicFile}
        volume={backgroundMusicVolume}
      />
      {displayHeadline ? (
        <div
          style={{
            position: 'absolute',
            top: 92,
            left: 42,
            right: 42,
            minHeight: 72,
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            fontFamily: FONT,
            color: theme.text,
            fontSize: isEnglish ? 43 : 50,
            lineHeight: 1.12,
            fontWeight: 950,
          }}
        >
          {displayHeadline}
        </div>
      ) : null}
      <div
        style={{
          position: 'absolute',
          top: 190,
          left: 48,
          right: 48,
          minHeight: 62,
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
          color: theme.accent,
          fontFamily: FONT,
          fontSize: isEnglish ? 27 : 31,
          lineHeight: 1.18,
          fontWeight: 900,
        }}
      >
        {seconds < trainingStartsAt
          ? displayMainTitle
          : showing
            ? (isEnglish ? 'Remember the order of the highlighted squares' : '记住方块依次亮起的位置')
            : recalling
              ? (isEnglish ? 'Rebuild the path in your mind' : '在脑中复原刚才的路径')
              : (isEnglish ? 'The correct path is revealed' : '正确路径揭晓')}
      </div>
      <div
        style={{
          position: 'absolute',
          top: 320,
          left: 60,
          width: 600,
          height: 600,
          padding: 18,
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gridTemplateRows: 'repeat(5, 1fr)',
          gap: 10,
          border: `1px solid ${theme.line}`,
          borderRadius: 10,
          background: theme.board,
          boxShadow: `0 24px 70px ${theme.shadow}`,
          filter: recalling ? 'blur(2px)' : 'none',
          opacity: recalling ? 0.24 : 1,
        }}
      >
        {Array.from({length: 25}, (_, index) => {
          const sequenceIndex = pathForVideo.indexOf(index);
          const active = showing && sequenceIndex === activeStep;
          const past = showing && sequenceIndex >= 0 && sequenceIndex < activeStep;
          const visibleReveal = reveal && sequenceIndex >= 0;
          const scale = active
            ? spring({frame: frame - Math.round((trainingStartsAt + sequenceIndex * stepDuration) * fps), fps})
            : 1;
          return (
            <div
              key={index}
              style={{
                position: 'relative',
                display: 'grid',
                placeItems: 'center',
                borderRadius: 7,
                border: `1px solid ${theme.cellLine}`,
                background: active
                  ? theme.accent
                  : past
                    ? theme.cellPast
                    : visibleReveal
                      ? theme.cellReveal
                      : theme.cell,
                transform: `scale(${active ? 0.86 + scale * 0.14 : 1})`,
                boxShadow: active ? `0 0 28px ${theme.accent}` : 'none',
              }}
            >
              {visibleReveal ? (
                <span style={{color: '#fff', fontFamily: 'Arial', fontSize: 29, fontWeight: 900}}>
                  {sequenceIndex + 1}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {recalling ? (
        <div
          style={{
            position: 'absolute',
            inset: '250px 0 150px',
            zIndex: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: recallOpacity,
            fontFamily: FONT,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              marginBottom: 42,
              color: theme.text,
              fontSize: 42,
              lineHeight: 1.18,
              fontWeight: 950,
            }}
          >
            {isEnglish ? 'Close Your Eyes and Recall' : '闭眼回忆'}
            <div
              style={{
                marginTop: 10,
                color: theme.muted,
                fontSize: 24,
                fontWeight: 700,
              }}
            >
              {isEnglish ? 'Rebuild the path in your mind' : '在脑中复原刚才的路径'}
            </div>
          </div>

          <div
            style={{
              position: 'relative',
              width: 214,
              height: 226,
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 82,
                width: 50,
                height: 22,
                borderRadius: 7,
                background: theme.accentDark,
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: 18,
                left: 98,
                width: 18,
                height: 20,
                borderRadius: 4,
                background: theme.accentDark,
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: 34,
                left: 9,
                width: 196,
                height: 196,
                padding: 9,
                borderRadius: '50%',
                background: `conic-gradient(${theme.accent} ${stopwatchProgress * 360}deg, ${theme.accentSoft} 0deg)`,
                boxShadow: `0 18px 45px ${theme.shadow}`,
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: '50%',
                  border: `7px solid ${theme.accentDark}`,
                  background: theme.cell,
                  boxShadow: `inset 0 0 0 5px ${theme.accentSoft}`,
                }}
              >
                <div
                  style={{
                    color: theme.text,
                    fontFamily: 'Arial, sans-serif',
                    fontSize: 88,
                    lineHeight: 1,
                    fontWeight: 900,
                    transform: 'translateY(2px)',
                  }}
                >
                  {recallSecond}
                </div>
              </div>
            </div>
          </div>

          <div style={{display: 'flex', gap: 12, marginTop: 34}}>
            {[3, 2, 1].map((value) => (
              <div
                key={value}
                style={{
                  width: value >= recallSecond ? 54 : 18,
                  height: 8,
                  borderRadius: 8,
                  background: value >= recallSecond ? theme.accent : theme.accentSoft,
                }}
              />
            ))}
          </div>
        </div>
      ) : (
        <div
          style={{
            position: 'absolute',
            top: 960,
            left: 70,
            right: 70,
            textAlign: 'center',
            color: theme.text,
            fontFamily: FONT,
            fontSize: 26,
            fontWeight: 900,
          }}
        >
          {seconds < trainingStartsAt
            ? (isEnglish ? 'Get ready' : '准备开始')
            : showing
              ? `${Math.max(1, Math.min(stepCount, activeStep + 1))} / ${stepCount}`
              : (isEnglish ? 'Did your sequence match?' : '你的顺序一致吗？')}
        </div>
      )}
      <Footer day={day} dark={theme.dark} />
    </AbsoluteFill>
  );
};

const peripheralPoints = [
  [118, 310],
  [585, 360],
  [95, 610],
  [610, 670],
  [165, 870],
  [540, 925],
  [350, 270],
  [350, 980],
];

export const PeripheralCapture = ({
  day = 1,
  seed = 5001,
  headline = '周边闪视捕捉',
  mainTitle = '每日前额叶训练',
  peripheralTargets = 3,
  instructionLanguage = 'zh',
  backgroundMusicEnabled = true,
  backgroundMusicVolume = 0.35,
  backgroundMusicFile = 'focus-ambient.wav',
}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const seconds = frame / fps;
  const pointOrder = shuffledIndexes(peripheralPoints.length, seed + 37);
  const isEnglish = instructionLanguage === 'en';
  const displayHeadline = isEnglish && containsCjk(headline)
    ? 'Peripheral Flash Capture'
    : headline;
  const displayMainTitle = isEnglish && containsCjk(mainTitle)
    ? 'Peripheral Vision Training'
    : mainTitle;
  const intro = seconds < 2;
  const flashStartsAt = 2;
  const flashEndsAt = 10.5;
  const revealStartsAt = 12.5;
  const targetCount = Math.max(2, Math.min(5, Math.round(Number(peripheralTargets) || 3)));
  const triangleIndexes = new Set(shuffledIndexes(peripheralPoints.length, seed + 97).slice(0, targetCount));
  const orderedFlashIndex = Math.max(0, Math.min(pointOrder.length - 1, Math.floor((seconds - flashStartsAt) / 1.05)));
  const flashIndex = pointOrder[orderedFlashIndex];
  const flashing = seconds >= flashStartsAt && seconds < flashEndsAt;
  const reveal = seconds >= revealStartsAt;
  const localFlash = ((seconds - flashStartsAt) % 1.05 + 1.05) % 1.05;
  const flashOpacity = interpolate(localFlash, [0, 0.16, 0.58, 0.92], [0, 1, 0.88, 0], {
    ...clamp,
    easing: Easing.inOut(Easing.quad),
  });
  const introOpacity = interpolate(frame, [0, 8, Math.round(1.72 * fps), 2 * fps], [0, 1, 1, 0], clamp);
  const introY = interpolate(frame, [0, 16], [18, 0], clamp);
  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        background:
          'radial-gradient(circle at 50% 50%, rgba(50,121,159,.28), transparent 28%), radial-gradient(circle at 50% 50%, #10283a, #07111c 72%)',
      }}
    >
      <BackgroundMusic
        enabled={backgroundMusicEnabled}
        file={backgroundMusicFile}
        volume={backgroundMusicVolume}
      />
      {intro ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 54px',
            opacity: introOpacity,
            transform: `translateY(${introY}px)`,
            color: '#fff',
            textAlign: 'center',
            fontFamily: FONT,
          }}
        >
          <div
            style={{
              fontSize: isEnglish ? 46 : 58,
              lineHeight: 1.12,
              fontWeight: 950,
              textShadow: '0 10px 30px rgba(0,0,0,.34)',
            }}
          >
            {displayMainTitle}
          </div>
          <div
            style={{
              width: 96,
              height: 7,
              marginTop: 26,
              borderRadius: 7,
              background: '#53d6f4',
              boxShadow: '0 0 20px rgba(83,214,244,.45)',
            }}
          />
          <div
            style={{
              marginTop: 22,
              color: 'rgba(255,255,255,.66)',
              fontSize: 23,
              fontWeight: 700,
            }}
          >
            {displayHeadline}
          </div>
        </div>
      ) : (
        <Header
          number="05"
          title={displayHeadline}
          subtitle={isEnglish
            ? 'Keep your eyes on the center and record triangles using peripheral vision'
            : '眼睛始终盯住中心，只用余光记录三角形'}
          dark
        />
      )}

      {!intro ? <div
        style={{
          position: 'absolute',
          left: 360,
          top: 625,
          width: 86,
          height: 86,
          transform: 'translate(-50%, -50%)',
          border: '1px solid rgba(116,213,255,.42)',
          borderRadius: '50%',
          boxShadow: '0 0 45px rgba(50,182,235,.20)',
        }}
      >
        <i style={{position: 'absolute', left: 41, top: 13, width: 4, height: 60, background: '#fff'}} />
        <i style={{position: 'absolute', top: 41, left: 13, height: 4, width: 60, background: '#fff'}} />
      </div> : null}

      {peripheralPoints.map(([left, top], index) => {
        const isTriangle = triangleIndexes.has(index);
        const visible = flashing && index === flashIndex;
        return (
          <div
            key={index}
            style={{
              position: 'absolute',
              left,
              top,
              width: 68,
              height: 68,
              opacity: visible ? flashOpacity : reveal && isTriangle ? 0.72 : 0,
              transform: `translate(-50%, -50%) scale(${visible ? 0.72 + flashOpacity * 0.28 : 1})`,
              transition: 'none',
            }}
          >
            {isTriangle ? (
              <div
                style={{
                  width: 0,
                  height: 0,
                  borderLeft: '34px solid transparent',
                  borderRight: '34px solid transparent',
                  borderBottom: '62px solid #ffcf4a',
                  filter: 'drop-shadow(0 0 16px rgba(255,207,74,.72))',
                }}
              />
            ) : (
              <div
                style={{
                  width: 62,
                  height: 62,
                  borderRadius: '50%',
                  background: '#53d6f4',
                  boxShadow: '0 0 20px rgba(83,214,244,.72)',
                }}
              />
            )}
          </div>
        );
      })}

      {!intro ? <div
        style={{
          position: 'absolute',
          left: 70,
          right: 70,
          bottom: 126,
          padding: '18px 20px',
          border: '1px solid rgba(122,213,255,.28)',
          borderRadius: 7,
          background: 'rgba(4,14,24,.66)',
          color: '#fff',
          textAlign: 'center',
          fontFamily: FONT,
          fontSize: 24,
          fontWeight: 900,
        }}
      >
        {seconds < flashEndsAt
          ? (isEnglish ? 'Keep looking at the center' : '保持中心注视')
          : reveal
            ? (isEnglish ? `Answer: ${targetCount} triangles` : `答案：${targetCount} 个三角形`)
            : (isEnglish ? 'How many triangles appeared?' : '刚才出现了几个三角形？')}
      </div> : null}
      <Footer day={day} dark />
    </AbsoluteFill>
  );
};
