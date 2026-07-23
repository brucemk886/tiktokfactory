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
          title: "Which choice feels most like you?",
          subtitle: "Look closely and choose the one that feels right.",
          imageSrc: "",
          audioSrc: "",
          duration: 10,
        }}
        calculateMetadata={({ props }) => {
          const fps = 30;
          return {
            fps,
            width: 1920,
            height: 1080,
            durationInFrames: Math.max(1, Math.ceil((props.duration || 10) * fps)),
            props,
          };
        }}
      />
    </>
  );
};
