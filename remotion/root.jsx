import React from "react";
import { Composition } from "remotion";
import { PodcastVideo } from "./podcast-video.jsx";
import { PsychologyLandscape } from "./psychology-landscape.jsx";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="PodcastVideo"
        component={PodcastVideo}
        fps={30}
        width={1080}
        height={1920}
        durationInFrames={150}
        defaultProps={{
          title: "Podcast",
          template: "center-wave",
          width: 1080,
          height: 1920,
          duration: 5,
          audioSrc: "",
          backgroundSrc: "",
        }}
        calculateMetadata={({ props }) => {
          const fps = 30;
          return {
            fps,
            width: props.width || 1080,
            height: props.height || 1920,
            durationInFrames: Math.max(1, Math.ceil((props.duration || 5) * fps)),
            props,
          };
        }}
      />
      <Composition
        id="PsychologyLandscape"
        component={PsychologyLandscape}
        fps={30}
        width={1920}
        height={1080}
        durationInFrames={300}
        defaultProps={{
          title: "你下意识选择的位置，藏着你的防备心有多强",
          credit: "一知心理课 一场心灵旅",
          layout: "choices-6",
          quizType: "position-choice",
          choiceLabels: ["A", "B", "C", "D", "E", "F"],
          captions: [
            { zh: "你会下意识站在哪", en: "Where would you stand first?" },
            { zh: "把选项扣在评论区", en: "Comment your choice below." },
          ],
          imageSrc: "",
          audioSrc: "",
          duration: 16,
        }}
        calculateMetadata={({ props }) => {
          const fps = 30;
          return {
            fps,
            width: 1920,
            height: 1080,
            durationInFrames: Math.max(1, Math.ceil((props.duration || 14) * fps)),
            props,
          };
        }}
      />
    </>
  );
};
