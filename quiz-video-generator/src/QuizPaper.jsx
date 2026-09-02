import React from "react";
import { AbsoluteFill, Audio, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

const COLORS = {
  red: "#d7352f",
  blue: "#1864a8",
  ink: "#15191d",
  muted: "#65717c",
  paper: "#fffdf8",
  desk: "#d9d1c3"
};
const HEADER_HEIGHT = 236;
const QUESTION_HEIGHT = 278;
const LETTERS = ["A", "B", "C"];

export function QuizPaper(props) {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const questions = Array.isArray(props.questions) ? props.questions : [];
  const introFrames = Math.round((Number(props.introSeconds) || 3.5) * fps);
  const questionFrames = Math.round((Number(props.secondsPerQuestion) || 7.5) * fps);
  const outroStart = introFrames + questionFrames * questions.length;
  const contentHeight = HEADER_HEIGHT + questions.length * QUESTION_HEIGHT + 210;
  const maxScroll = Math.max(0, contentHeight - height + 108);
  const activeIndex = clamp(Math.floor((frame - introFrames) / questionFrames), 0, Math.max(0, questions.length - 1));
  const currentStart = introFrames + activeIndex * questionFrames;
  const travel = interpolate(frame, [currentStart, currentStart + Math.round(questionFrames * 0.22)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const previousTarget = scrollTarget(activeIndex - 1, maxScroll);
  const nextTarget = scrollTarget(activeIndex, maxScroll);
  const regularScroll = lerp(previousTarget, nextTarget, smooth(travel));
  const outroProgress = interpolate(frame, [outroStart, outroStart + Math.round(1.2 * fps)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const scrollY = frame < introFrames
    ? 0
    : frame >= outroStart
      ? lerp(regularScroll, maxScroll, smooth(outroProgress))
      : regularScroll;
  const paperEnter = spring({ frame, fps, config: { damping: 18, stiffness: 120, mass: 0.8 } });
  const activeQuestion = questions[activeIndex];
  const markerVisible = frame >= introFrames && frame < outroStart && Boolean(activeQuestion);
  const markerLocal = frame - currentStart;
  const markerEnter = interpolate(markerLocal, [questionFrames * 0.36, questionFrames * 0.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const markerExit = interpolate(markerLocal, [questionFrames * 0.78, questionFrames * 0.93], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const markerTop = HEADER_HEIGHT + activeIndex * QUESTION_HEIGHT + 113 + (activeQuestion?.answerIndex || 0) * 44 - scrollY;
  const finalVisible = frame >= outroStart;

  return (
    <AbsoluteFill style={styles.canvas}>
      {props.backgroundMusicEnabled ? (
        <Audio src={staticFile(props.backgroundMusicFile || "focus-ambient.wav")} volume={Number(props.backgroundMusicVolume) || 0.18} loop />
      ) : null}
      <div style={styles.deskGlow} />
      <div style={{ ...styles.paper, transform: `translateY(${lerp(64, 0, paperEnter)}px)`, opacity: paperEnter }}>
        <div style={{ ...styles.paperContent, height: contentHeight, transform: `translateY(${-scrollY}px)` }}>
          <header style={styles.header}>
            <div style={styles.eyebrow}>QUICK KNOWLEDGE TEST</div>
            <h1 style={styles.title}>{colorTitle(props.title)}</h1>
            <p style={styles.hook}>{props.hook}</p>
            <div style={styles.rule}><span style={styles.ruleLine} /></div>
          </header>
          {questions.map((item, index) => (
            <Question
              key={`${item.prompt}-${index}`}
              item={item}
              index={index}
              frame={frame}
              startFrame={introFrames + index * questionFrames}
              questionFrames={questionFrames}
            />
          ))}
          <div style={styles.ctaBlock}>
            <div style={styles.ctaTick}>✓</div>
            <strong>{props.cta}</strong>
            <small>FOLLOW FOR THE NEXT QUIZ</small>
          </div>
        </div>
      </div>
      {markerVisible ? (
        <MarkerHand
          top={markerTop}
          opacity={Math.min(markerEnter, markerExit)}
          swing={Math.sin(markerLocal / 4) * 2.2}
        />
      ) : null}
      <div style={{ ...styles.scoreBug, opacity: finalVisible ? outroProgress : 0, transform: `translateY(${lerp(24, 0, outroProgress)}px)` }}>
        <b>YOUR SCORE?</b><span>__/ {questions.length}</span>
      </div>
      <div style={styles.safeTop} />
      <div style={styles.safeBottom} />
    </AbsoluteFill>
  );
}

function Question({ item, index, frame, startFrame, questionFrames }) {
  const local = frame - startFrame;
  const reveal = interpolate(local, [questionFrames * 0.48, questionFrames * 0.7], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const check = interpolate(local, [questionFrames * 0.67, questionFrames * 0.82], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  return (
    <section style={styles.question}>
      <div style={styles.number}>{index + 1}</div>
      <div style={styles.questionCopy}>
        <h2 style={styles.questionTitle}>{item.prompt}</h2>
        <div style={styles.options}>
          {item.options.map((option, optionIndex) => (
            <div key={option} style={styles.option}>
              <span style={styles.optionLetter}>{LETTERS[optionIndex]}.</span>
              <span>{option}</span>
              {optionIndex === item.answerIndex ? <AnswerCircle progress={reveal} /> : null}
            </div>
          ))}
        </div>
      </div>
      <Illustration type={item.illustration} accentIndex={index} />
      <svg style={styles.redCheck} viewBox="0 0 62 50" aria-hidden="true">
        <path d="M5 25 C15 32 20 38 25 43 C34 25 43 13 58 5" fill="none" stroke={COLORS.red} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - check} />
      </svg>
    </section>
  );
}

function AnswerCircle({ progress }) {
  return (
    <svg style={styles.answerCircle} viewBox="0 0 355 46" preserveAspectRatio="none" aria-hidden="true">
      <path d="M9 24 C15 4 86 2 176 4 C272 2 341 6 347 22 C350 37 280 43 177 42 C75 44 8 39 9 24Z" fill="none" stroke={COLORS.red} strokeWidth="4.5" strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - progress} />
    </svg>
  );
}

function MarkerHand({ top, opacity, swing }) {
  return (
    <div style={{ ...styles.markerHand, top, opacity, transform: `translateX(${lerp(180, 0, opacity)}px) rotate(${swing}deg)` }}>
      <div style={styles.glovePalm} />
      <div style={styles.gloveFinger} />
      <div style={styles.markerBar}><span /></div>
      <div style={styles.markerTip} />
    </div>
  );
}

function Illustration({ type, accentIndex }) {
  const palette = ["#62a1dd", "#f2b74e", "#70b77e", "#ef7b70", "#8b79cf"];
  const accent = palette[accentIndex % palette.length];
  const common = { fill: "none", stroke: COLORS.ink, strokeWidth: 5, strokeLinecap: "round", strokeLinejoin: "round" };
  let art;
  if (type === "mountain") art = <><path d="M8 72 48 18 76 50 94 30 126 72Z" fill={accent} stroke={COLORS.ink} strokeWidth="5"/><path d="m39 31 10-13 13 23" {...common}/><circle cx="109" cy="17" r="10" fill="#ffd15c"/></>;
  else if (type === "ocean") art = <><path d="M8 43c18-16 31 16 50 0s32 16 52 0 28 9 28 9" {...common}/><path d="M8 67c18-16 31 16 50 0s32 16 52 0 28 9 28 9" {...common}/><path d="m89 20 24 9-18 9Z" fill={accent} stroke={COLORS.ink} strokeWidth="4"/></>;
  else if (type === "desert") art = <><circle cx="110" cy="21" r="12" fill="#ffd15c"/><path d="M5 73c24-31 48-29 70 0 21-26 44-28 64 0" fill={accent} stroke={COLORS.ink} strokeWidth="5"/><path d="M44 61V25m0 15c-13 0-13-12-13-18m13 27c14 0 14-13 14-19" {...common}/></>;
  else if (type === "landmark") art = <><path d="M32 74h77M43 70V32h55v38M37 31l33-20 34 20Z" fill={accent} stroke={COLORS.ink} strokeWidth="5"/><path d="M58 70V46h24v24" {...common}/></>;
  else if (type === "river") art = <><path d="M18 12c35 15 18 34 53 40s38 17 51 26" stroke={accent} strokeWidth="17" fill="none" strokeLinecap="round"/><path d="M18 12c35 15 18 34 53 40s38 17 51 26" {...common}/><path d="M103 18c-14 6-19 13-23 23M53 56c-11 5-17 12-22 20" {...common}/></>;
  else if (type === "boot") art = <><path d="M47 9c18 2 34 10 42 22l-12 14 14 17 28 3-1 19-39 1-22-19 6-20-23-17Z" fill={accent} stroke={COLORS.ink} strokeWidth="5"/></>;
  else if (type === "planet") art = <><circle cx="72" cy="46" r="31" fill={accent} stroke={COLORS.ink} strokeWidth="5"/><path d="M14 61c24 7 70-4 112-32M22 71c36 7 80-12 105-31" {...common}/></>;
  else if (type === "leaf") art = <><path d="M25 69C29 24 63 10 112 14c-2 46-37 70-87 55Z" fill={accent} stroke={COLORS.ink} strokeWidth="5"/><path d="M25 70c25-19 49-31 76-45M61 48 55 28m20 12 19 8" {...common}/></>;
  else art = <><circle cx="70" cy="45" r="38" fill={accent} stroke={COLORS.ink} strokeWidth="5"/><path d="M32 45h76M70 7c-21 22-21 54 0 76M70 7c21 22 21 54 0 76M42 20c18 10 38 10 56 0M42 70c18-10 38-10 56 0" {...common}/></>;
  return <svg style={styles.illustration} viewBox="0 0 145 90" aria-hidden="true">{art}</svg>;
}

function colorTitle(title) {
  const words = String(title || "Quiz").split(/\s+/).filter(Boolean);
  if (words.length === 1) return <><span style={{ color: COLORS.red }}>{words[0]}</span></>;
  return words.map((word, index) => <React.Fragment key={`${word}-${index}`}><span style={{ color: index % 2 ? COLORS.blue : COLORS.red }}>{word}</span>{index < words.length - 1 ? " " : ""}</React.Fragment>);
}

function scrollTarget(index, maxScroll) {
  if (index < 1) return 0;
  return clamp(HEADER_HEIGHT + index * QUESTION_HEIGHT - 380, 0, maxScroll);
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function lerp(from, to, progress) { return from + (to - from) * progress; }
function smooth(value) { const x = clamp(value, 0, 1); return x * x * (3 - 2 * x); }

const styles = {
  canvas: { overflow: "hidden", background: COLORS.desk, fontFamily: '"Segoe UI", Arial, sans-serif', color: COLORS.ink },
  deskGlow: { position: "absolute", inset: 0, background: "radial-gradient(circle at 50% 34%, rgba(255,255,255,.7), transparent 58%), linear-gradient(115deg,#c9c0b1,#eee9df 50%,#c8beae)" },
  paper: { position: "absolute", left: 26, top: -18, width: 668, height: 1350, overflow: "hidden", background: COLORS.paper, borderRadius: 5, boxShadow: "0 16px 48px rgba(52,43,31,.34)" },
  paperContent: { position: "absolute", left: 0, right: 0, top: 0, padding: "68px 48px 0", boxSizing: "border-box", background: "linear-gradient(90deg,rgba(214,62,48,.045) 1px,transparent 1px),linear-gradient(rgba(24,100,168,.035) 1px,transparent 1px)", backgroundSize: "28px 28px" },
  header: { height: HEADER_HEIGHT - 46, textAlign: "center" },
  eyebrow: { fontSize: 15, letterSpacing: 4.2, fontWeight: 900, color: COLORS.muted },
  title: { margin: "10px 0 4px", fontSize: 58, lineHeight: 1, letterSpacing: -2.8, fontFamily: 'Georgia,"Times New Roman",serif' },
  hook: { margin: "15px 0 12px", fontSize: 19, fontWeight: 700, color: "#3c4850" },
  rule: { display: "flex", justifyContent: "center" },
  ruleLine: { width: 124, height: 5, borderRadius: 4, background: `linear-gradient(90deg,${COLORS.red} 0 48%,${COLORS.blue} 48%)` },
  question: { position: "relative", height: QUESTION_HEIGHT, borderTop: "2px solid rgba(21,25,29,.11)", boxSizing: "border-box", paddingTop: 30 },
  number: { position: "absolute", left: -3, top: 28, width: 41, height: 41, display: "grid", placeItems: "center", borderRadius: "50%", color: "#fff", background: COLORS.ink, fontSize: 22, fontWeight: 900 },
  questionCopy: { paddingLeft: 55, paddingRight: 164 },
  questionTitle: { minHeight: 54, margin: 0, display: "flex", alignItems: "center", fontSize: 20, lineHeight: 1.25, letterSpacing: -0.25 },
  options: { display: "grid", gap: 6, marginTop: 11 },
  option: { position: "relative", height: 38, display: "flex", alignItems: "center", gap: 8, padding: "0 11px", fontSize: 18, fontWeight: 650, whiteSpace: "nowrap" },
  optionLetter: { width: 22, fontWeight: 900, color: COLORS.blue },
  answerCircle: { position: "absolute", left: -2, top: -3, width: 355, height: 46, overflow: "visible", pointerEvents: "none" },
  illustration: { position: "absolute", right: 8, top: 68, width: 145, height: 90 },
  redCheck: { position: "absolute", right: 8, bottom: 18, width: 53, height: 42, transform: "rotate(-7deg)" },
  ctaBlock: { height: 170, display: "grid", placeItems: "center", alignContent: "center", gap: 8, borderTop: "2px solid rgba(21,25,29,.11)", textAlign: "center" },
  ctaTick: { width: 47, height: 47, display: "grid", placeItems: "center", borderRadius: "50%", background: COLORS.red, color: "#fff", fontSize: 28, fontWeight: 900 },
  markerHand: { position: "absolute", right: -84, width: 322, height: 184, transformOrigin: "90% 70%" },
  glovePalm: { position: "absolute", right: 0, top: 58, width: 166, height: 126, borderRadius: "55% 20% 0 0", background: "linear-gradient(135deg,#121416,#020303)", boxShadow: "inset 10px 9px 20px rgba(255,255,255,.11),0 9px 18px rgba(0,0,0,.3)" },
  gloveFinger: { position: "absolute", right: 118, top: 44, width: 125, height: 50, borderRadius: 28, background: "linear-gradient(#171a1c,#030404)", transform: "rotate(-8deg)", boxShadow: "inset 0 7px 9px rgba(255,255,255,.1)" },
  markerBar: { position: "absolute", left: 12, top: 45, width: 205, height: 31, borderRadius: 16, background: "linear-gradient(#ee3f38,#a90f0d)", transform: "rotate(-9deg)", boxShadow: "0 7px 10px rgba(0,0,0,.2)" },
  markerTip: { position: "absolute", left: -7, top: 64, width: 39, height: 18, clipPath: "polygon(0 50%,100% 0,100% 100%)", background: "#77110f", transform: "rotate(-9deg)" },
  scoreBug: { position: "absolute", left: 121, right: 121, bottom: 92, minHeight: 106, display: "flex", alignItems: "center", justifyContent: "center", gap: 18, border: "4px solid #15191d", borderRadius: 14, background: "rgba(255,253,248,.97)", boxShadow: "0 8px 26px rgba(0,0,0,.25)", fontSize: 26 },
  safeTop: { position: "absolute", left: 0, right: 0, top: 0, height: 18, background: "rgba(0,0,0,.06)" },
  safeBottom: { position: "absolute", left: 0, right: 0, bottom: 0, height: 28, background: "linear-gradient(transparent,rgba(0,0,0,.16))" }
};
