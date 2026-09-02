import React from "react";
import { Composition } from "remotion";
import { QuizPaper } from "./QuizPaper.jsx";

const defaults = {
  language: "en",
  title: "Geography Quiz",
  hook: "Which questions can you solve before the red marker reveals every answer?",
  cta: "What was your score? Comment below",
  seed: 2609,
  secondsPerQuestion: 8,
  introSeconds: 0.8,
  outroSeconds: 4.2,
  durationSeconds: 61,
  backgroundMusicEnabled: false,
  backgroundMusicVolume: 0.18,
  questions: [
    { prompt: "Which mountain is the highest above sea level?", options: ["K2", "Mount Everest", "Kangchenjunga"], answerIndex: 1, illustration: "mountain" },
    { prompt: "Which is the largest ocean on Earth?", options: ["Atlantic Ocean", "Indian Ocean", "Pacific Ocean"], answerIndex: 2, illustration: "ocean" },
    { prompt: "Which is the largest hot desert?", options: ["Sahara Desert", "Gobi Desert", "Arabian Desert"], answerIndex: 0, illustration: "desert" },
    { prompt: "Which is the smallest country by area?", options: ["Monaco", "Vatican City", "San Marino"], answerIndex: 1, illustration: "landmark" },
    { prompt: "Which is the longest river in South America?", options: ["Amazon River", "Paraná River", "Orinoco River"], answerIndex: 0, illustration: "river" },
    { prompt: "Which is the largest continent by area?", options: ["Africa", "North America", "Asia"], answerIndex: 2, illustration: "globe" },
    { prompt: "Which country is famously shaped like a boot?", options: ["Greece", "Italy", "Portugal"], answerIndex: 1, illustration: "boot" }
  ]
};

export const Root = () => (
  <Composition
    id="QuizPaper"
    component={QuizPaper}
    durationInFrames={Math.ceil(defaults.durationSeconds * 30)}
    fps={30}
    width={720}
    height={1280}
    defaultProps={defaults}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.ceil(Math.max(15, Number(props.durationSeconds) || defaults.durationSeconds) * 30)
    })}
  />
);
