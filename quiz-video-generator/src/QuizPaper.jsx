import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

const RED = "#e12822";
const BLUE = "#139bd2";
const GREEN = "#24b34b";
const INK = "#111315";
const HEADER_HEIGHT = 154;
const QUESTION_HEIGHT = 250;
const LETTERS = ["A", "B", "C"];
const HAND_ENTER_START_SECONDS = 0.2;
const UNDERLINE_START_SECONDS = 0.45;
const UNDERLINE_END_SECONDS = 1.45;
const HAND_EXIT_END_SECONDS = 2;
const COUNTDOWN_START_SECONDS = 1.7;
const COUNTDOWN_SECONDS = 5;
const REVEAL_DELAY_SECONDS = 0.12;

export function QuizPaper(props) {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const questions = Array.isArray(props.questions) ? props.questions : [];
  const introFrames = Math.round((Number(props.introSeconds) || 0.8) * fps);
  const questionFrames = Math.round((Number(props.secondsPerQuestion) || 8) * fps);
  const outroStart = introFrames + questions.length * questionFrames;
  const contentHeight = HEADER_HEIGHT + questions.length * QUESTION_HEIGHT + 158;
  const maxScroll = Math.max(0, contentHeight - height + 28);
  const activeIndex = clamp(Math.floor((frame - introFrames) / questionFrames), 0, Math.max(0, questions.length - 1));
  const activeStart = introFrames + activeIndex * questionFrames;
  const localFrame = frame - activeStart;
  const previousScroll = scrollTarget(activeIndex - 1, height, maxScroll);
  const activeScroll = scrollTarget(activeIndex, height, maxScroll);
  const scrollProgress = interpolate(localFrame, [0, Math.round(0.36 * fps)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const regularScroll = lerp(previousScroll, activeScroll, easeOutCubic(scrollProgress));
  const outroProgress = interpolate(frame, [outroStart, outroStart + Math.round(0.45 * fps)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const scrollY = frame < introFrames
    ? 0
    : frame >= outroStart
      ? lerp(regularScroll, maxScroll, easeOutCubic(outroProgress))
      : regularScroll;
  const intro = spring({ frame, fps, config: { damping: 22, stiffness: 210, mass: 0.55 } });
  const activeTop = HEADER_HEIGHT + activeIndex * QUESTION_HEIGHT - scrollY;
  const markerVisible = frame >= introFrames && frame < outroStart && Boolean(questions[activeIndex]);

  return (
    <AbsoluteFill style={styles.canvas}>
      {props.backgroundMusicEnabled ? (
        <Audio src={staticFile(props.backgroundMusicFile || "focus-ambient.wav")} volume={Number(props.backgroundMusicVolume) || 0.18} loop />
      ) : null}
      {props.soundEffectsEnabled !== false ? (
        <QuizSoundEffects questions={questions} introFrames={introFrames} questionFrames={questionFrames} fps={fps} />
      ) : null}
      <div style={{ ...styles.content, height: contentHeight, transform: `translateY(${-scrollY}px)`, opacity: clamp(intro, 0, 1) }}>
        <QuizHeader title={props.title} hook={props.hook} />
        {questions.map((item, index) => (
          <Question
            key={`${item.prompt}-${index}`}
            item={item}
            index={index}
            frame={frame}
            startFrame={introFrames + index * questionFrames}
            questionFrames={questionFrames}
            fps={fps}
          />
        ))}
        <div style={styles.cta}>
          <strong>{props.cta}</strong>
          <span>FOLLOW FOR MORE QUICK QUIZZES</span>
        </div>
      </div>
      {markerVisible ? (
        <MarkerHand localFrame={localFrame} fps={fps} questionTop={activeTop} />
      ) : null}
      <div style={styles.edgeFadeTop} />
      <div style={styles.edgeFadeBottom} />
    </AbsoluteFill>
  );
}

function QuizHeader({ title, hook }) {
  return (
    <header style={styles.header}>
      <h1 style={styles.title}>{colorTitle(title)}</h1>
      <p style={styles.hook}>{hook}</p>
      <div style={styles.headerRule}><span style={styles.headerRuleRed} /><i style={styles.headerRuleBlue} /></div>
    </header>
  );
}

function Question({ item, index, frame, startFrame, questionFrames, fps }) {
  const localFrame = frame - startFrame;
  const titleFontSize = questionTitleFontSize(item.prompt);
  const countdownStart = Math.round(COUNTDOWN_START_SECONDS * fps);
  const countdownEnd = Math.min(questionFrames - Math.round(0.85 * fps), countdownStart + COUNTDOWN_SECONDS * fps);
  const revealFrame = countdownEnd + Math.round(REVEAL_DELAY_SECONDS * fps);
  const answered = localFrame >= revealFrame;
  const reveal = spring({ frame: localFrame - revealFrame, fps, config: { damping: 12, stiffness: 240, mass: 0.45 } });
  const underline = interpolate(localFrame, [Math.round(UNDERLINE_START_SECONDS * fps), Math.round(UNDERLINE_END_SECONDS * fps)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  return (
    <section style={styles.question}>
      <h2 style={{ ...styles.questionTitle, fontSize: titleFontSize }}>
        <b style={styles.questionNumber}>{index + 1}.</b>
        <span style={styles.questionPrompt}>{item.prompt}</span>
      </h2>
      <svg style={styles.underline} viewBox="0 0 430 12" preserveAspectRatio="none" aria-hidden="true">
        <path d="M3 8 C110 4 278 9 426 5" fill="none" stroke={RED} strokeWidth="4" strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - underline} opacity={localFrame >= 0 && !answered ? 1 : 0} />
      </svg>
      <div style={styles.options}>
        {item.options.map((option, optionIndex) => (
          <div key={`${option}-${optionIndex}`} style={styles.option}>
            <span style={styles.letter}>{LETTERS[optionIndex]}.</span>
            <span>{option}</span>
            {optionIndex === item.answerIndex && answered ? (
              <span style={{ ...styles.correct, opacity: clamp(reveal, 0, 1), transform: `scale(${lerp(0.4, 1, clamp(reveal, 0, 1))}) rotate(-8deg)` }}>✓</span>
            ) : null}
          </div>
        ))}
      </div>
      <Illustration type={item.illustration} index={index} />
      <Countdown localFrame={localFrame} startFrame={countdownStart} endFrame={countdownEnd} fps={fps} answered={answered} />
    </section>
  );
}

function Countdown({ localFrame, startFrame, endFrame, fps, answered }) {
  if (localFrame < startFrame || answered) return null;
  const interval = Math.max(1, (endFrame - startFrame) / 5);
  const elapsed = clamp(localFrame - startFrame, 0, Math.max(0, endFrame - startFrame - 1));
  const step = clamp(Math.floor(elapsed / interval), 0, 4);
  const digit = 5 - step;
  const within = (elapsed - step * interval) / interval;
  const draw = interpolate(within, [0, 0.34, 1], [0.04, 1, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pulse = spring({ frame: Math.round(within * interval), fps, config: { damping: 11, stiffness: 300, mass: 0.35 } });
  return (
    <div style={{ ...styles.countdown, transform: `rotate(${step % 2 ? 4 : -4}deg) scale(${lerp(0.84, 1, clamp(pulse, 0, 1))})` }}>
      <svg viewBox="0 0 62 62" aria-hidden="true">
        <path d="M31 4 C48 3 59 15 58 31 C58 48 47 58 30 58 C13 58 4 48 4 31 C4 15 15 5 31 4Z" fill="rgba(255,255,255,.92)" stroke={RED} strokeWidth="3.3" strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - draw} />
      </svg>
      <b style={styles.countdownDigit}>{digit}</b>
    </div>
  );
}

function MarkerHand({ localFrame, fps, questionTop }) {
  const enter = interpolate(localFrame, [HAND_ENTER_START_SECONDS * fps, UNDERLINE_START_SECONDS * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const draw = interpolate(localFrame, [UNDERLINE_START_SECONDS * fps, UNDERLINE_END_SECONDS * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const leave = interpolate(localFrame, [UNDERLINE_END_SECONDS * fps, HAND_EXIT_END_SECONDS * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const exitOpacity = interpolate(localFrame, [(HAND_EXIT_END_SECONDS - 0.28) * fps, HAND_EXIT_END_SECONDS * fps], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const underlineX = lerp(126, 414, easeInOut(draw));
  const underlineY = questionTop + 51 + Math.sin(localFrame * 0.35) * 2;
  const tipX = leave > 0 ? lerp(414, 850, easeInOut(leave)) : underlineX;
  const tipY = leave > 0 ? lerp(underlineY, questionTop + 14, easeInOut(leave)) : underlineY;
  const opacity = Math.min(enter, exitOpacity);
  const offscreen = lerp(290, 0, easeOutCubic(enter));
  return (
    <Img
      src={staticFile("marker-hand-v2.png")}
      style={{
        ...styles.markerHand,
        left: tipX - 82 + offscreen,
        top: tipY - 46 + offscreen * 0.34,
        opacity,
        transform: `rotate(${lerp(4, -2, draw) + lerp(0, -5, leave)}deg)`
      }}
    />
  );
}

function QuizSoundEffects({ questions, introFrames, questionFrames, fps }) {
  const underlineOffset = Math.round(UNDERLINE_START_SECONDS * fps);
  const countdownOffset = Math.round(COUNTDOWN_START_SECONDS * fps);
  const revealOffset = countdownOffset + Math.round((COUNTDOWN_SECONDS + REVEAL_DELAY_SECONDS) * fps);
  return questions.map((_, questionIndex) => {
    const questionStart = introFrames + questionIndex * questionFrames;
    return (
      <React.Fragment key={`quiz-sfx-${questionIndex}`}>
        <Sequence from={questionStart + underlineOffset} durationInFrames={Math.round(1.15 * fps)}>
          <Audio src={staticFile("quiz-marker-scratch.wav")} volume={0.34} />
        </Sequence>
        {Array.from({ length: 5 }, (__, tickIndex) => (
          <Sequence key={`tick-${tickIndex}`} from={questionStart + countdownOffset + tickIndex * fps} durationInFrames={Math.round(0.14 * fps)}>
            <Audio src={staticFile("quiz-countdown-tick.wav")} volume={0.42} />
          </Sequence>
        ))}
        <Sequence from={questionStart + revealOffset} durationInFrames={Math.round(0.5 * fps)}>
          <Audio src={staticFile("quiz-correct-chime.wav")} volume={0.5} />
        </Sequence>
      </React.Fragment>
    );
  });
}

function Illustration({ type, index }) {
  const id = `art-${type}-${index}`;
  const line = { stroke: "#12202a", strokeWidth: 3.2, strokeLinecap: "round", strokeLinejoin: "round" };
  let art;
  if (type === "mountain") art = <><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#72c9ff"/><stop offset="1" stopColor="#eef9ff"/></linearGradient></defs><circle cx="76" cy="55" r="50" fill={`url(#${id})`} {...line}/><path d="M25 86 61 36 78 56 94 28 128 86Z" fill="#dcecf2" {...line}/><path d="m49 53 12-17 10 13 7 7 16-28 13 22" fill="#fff" {...line}/><path d="M24 86h106" fill="none" {...line}/></>;
  else if (type === "ocean") art = <><path d="M7 57c16-19 29-19 44 0 16-22 32-22 49 0 17-19 31-19 47 0v38H7Z" fill="#31b8eb" opacity=".8"/><path d="M7 57c16-19 29-19 44 0 16-22 32-22 49 0 17-19 31-19 47 0M8 78c18-17 31-17 48 0 16-18 30-18 47 0 16-16 29-16 44 0" fill="none" {...line}/><path d="m102 19 26 12-25 11-17-11Z" fill="#ffbd3f" {...line}/><circle cx="25" cy="28" r="10" fill="#80daf8"/></>;
  else if (type === "desert") art = <><circle cx="123" cy="23" r="15" fill="#ffca39"/><path d="M5 93c29-46 55-44 82 0 20-33 42-33 63 0Z" fill="#e8902e" {...line}/><path d="M45 82V34m0 20c-15 0-16-12-16-21m16 32c15 0 16-13 16-23" fill="none" stroke="#289448" strokeWidth="7" strokeLinecap="round"/><path d="M76 91 102 47l28 44" fill="#d26a31" {...line}/></>;
  else if (type === "landmark") art = <><path d="M22 95h116M35 91V42h91v49M29 42 80 13l52 29Z" fill="#ef9b37" {...line}/><path d="M47 91V53h13v38m20 0V53h13v38m20 0V53h13" fill="#4fa9d7" {...line}/><path d="M69 91V67h22v24" fill="#fff2bc" {...line}/><circle cx="80" cy="29" r="7" fill="#4fa9d7"/></>;
  else if (type === "river") art = <><path d="M3 91h148V47c-20-14-42-15-62-1-22-19-50-19-86 0Z" fill="#6fc76f" {...line}/><path d="M72 40c24 15 5 29 26 40 12 6 18 10 23 15" fill="none" stroke="#31a7e2" strokeWidth="18" strokeLinecap="round"/><path d="M72 40c24 15 5 29 26 40 12 6 18 10 23 15" fill="none" {...line}/><path d="M17 52 37 22l21 30M102 48l17-25 19 30" fill="#8b7258" {...line}/><circle cx="24" cy="25" r="12" fill="#ffcf42"/></>;
  else if (type === "boot") art = <><path d="M49 9c22 2 40 12 49 26L84 51l13 22 38 6-2 22-52-1-29-25 7-24-26-22Z" fill="#f1b93f" {...line}/><path d="m82 99 7-18 41 7" fill="none" stroke="#d88a21" strokeWidth="6" strokeLinecap="round"/></>;
  else art = <><circle cx="78" cy="54" r="49" fill="#62c9ed" {...line}/><path d="M30 54h96M78 5c-25 29-25 70 0 98M78 5c25 29 25 70 0 98M43 20c23 14 48 14 70 0M43 89c23-14 48-14 70 0" fill="none" {...line}/><path d="M47 39c8-10 15-12 23-5l-5 13-13 4Zm38 22c14-11 25-8 32 5l-13 17-18-5Z" fill="#4faf58"/></>;
  return <svg style={styles.illustration} viewBox="0 0 155 110" aria-hidden="true">{art}</svg>;
}

function colorTitle(title) {
  const words = String(title || "Geography Quiz").split(/\s+/).filter(Boolean);
  if (words.length === 1) return <span style={{ color: RED }}>{words[0]}</span>;
  return words.map((word, index) => <React.Fragment key={`${word}-${index}`}><span style={{ color: index === words.length - 1 ? BLUE : RED }}>{word}</span>{index < words.length - 1 ? " " : ""}</React.Fragment>);
}

function scrollTarget(index, viewportHeight, maxScroll) {
  if (index < 0) return 0;
  const bottom = HEADER_HEIGHT + (index + 1) * QUESTION_HEIGHT;
  return clamp(bottom - (viewportHeight - 76), 0, maxScroll);
}
function questionTitleFontSize(prompt) {
  const visualUnits = Array.from(String(prompt || "")).reduce(
    (total, character) => total + (/[㐀-鿿]/.test(character) ? 1.85 : 1),
    0
  );
  return clamp(23 - Math.max(0, visualUnits - 38) * 0.24, 14, 23);
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function lerp(from, to, progress) { return from + (to - from) * progress; }
function easeOutCubic(value) { return 1 - Math.pow(1 - clamp(value, 0, 1), 3); }
function easeInOut(value) { const x = clamp(value, 0, 1); return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }

const styles = {
  canvas: { overflow: "hidden", background: "#ffffff", color: INK, fontFamily: 'Arial,"Segoe UI","Microsoft YaHei UI",sans-serif' },
  content: { position: "absolute", inset: "0 0 auto", background: "#fff", padding: "0 44px", boxSizing: "border-box", willChange: "transform" },
  header: { height: HEADER_HEIGHT, display: "grid", alignContent: "center", justifyItems: "center", textAlign: "center" },
  title: { margin: "7px 0 8px", fontSize: 42, lineHeight: 1, letterSpacing: -2, fontWeight: 900 },
  hook: { maxWidth: 590, margin: 0, color: "#4d5358", fontSize: 15, lineHeight: 1.25, fontWeight: 700 },
  headerRule: { marginTop: 13, display: "flex", gap: 4 },
  headerRuleRed: { width: 58, height: 4, borderRadius: 2, background: RED },
  headerRuleBlue: { width: 58, height: 4, borderRadius: 2, background: BLUE },
  question: { position: "relative", height: QUESTION_HEIGHT, boxSizing: "border-box", paddingTop: 13 },
  questionTitle: { width: 632, minHeight: 42, margin: 0, display: "flex", alignItems: "center", color: INK, fontSize: 23, lineHeight: 1.16, fontWeight: 800, letterSpacing: -0.4 },
  questionNumber: { flex: "0 0 auto", marginRight: 7 },
  questionPrompt: { minWidth: 0, whiteSpace: "nowrap" },
  underline: { position: "absolute", left: 11, top: 49, width: 430, height: 12 },
  options: { marginTop: 6, display: "grid", gap: 1 },
  option: { position: "relative", height: 37, display: "flex", alignItems: "center", paddingLeft: 2, color: "#202326", fontSize: 22, lineHeight: 1, fontWeight: 500 },
  letter: { width: 35 },
  correct: { position: "absolute", left: -31, top: -1, color: GREEN, fontSize: 35, lineHeight: 1, fontFamily: '"Segoe Print","Comic Sans MS",cursive', fontWeight: 900, transformOrigin: "center" },
  countdown: { position: "absolute", left: 38, bottom: 1, width: 48, height: 48, transformOrigin: "center" },
  countdownDigit: { position: "absolute", inset: 0, display: "grid", placeItems: "center", color: RED, fontSize: 25, lineHeight: 1, fontFamily: '"Segoe Print","Comic Sans MS",cursive', fontWeight: 900 },
  illustration: { position: "absolute", right: 9, top: 76, width: 155, height: 110, overflow: "visible" },
  markerHand: { position: "absolute", width: 475, height: "auto", transformOrigin: "82px 46px", pointerEvents: "none", filter: "drop-shadow(0 8px 7px rgba(0,0,0,.2))", willChange: "left,top,transform" },
  cta: { height: 142, display: "grid", justifyItems: "center", alignContent: "center", gap: 8, borderTop: "2px solid #eef0f1", textAlign: "center" },
  edgeFadeTop: { position: "absolute", left: 0, right: 0, top: 0, height: 10, background: "linear-gradient(rgba(0,0,0,.035),transparent)" },
  edgeFadeBottom: { position: "absolute", left: 0, right: 0, bottom: 0, height: 18, background: "linear-gradient(transparent,rgba(0,0,0,.045))" }
};
