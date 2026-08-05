import React from 'react';
import {Composition} from 'remotion';
import {SchulteFocus} from './SchulteFocus';

export const Root = () => {
  return (
    <Composition
      id="SchulteFocus"
      component={SchulteFocus}
      durationInFrames={32 * 30}
      fps={30}
      width={720}
      height={1280}
      defaultProps={{
        day: 24,
        seed: 2407,
        durationSeconds: 32,
        trainingStartsAt: 4,
        instructionStartsAt: 2,
        rotationSpeed: 1,
        trainingMode: 'sequence',
        layoutStyle: 'classic',
        backgroundStyle: 'mint',
        headline: '专注力改造计划',
        mainTitle: '每日前额叶训练',
        instructionLanguage: 'zh',
        rangeStart: 1,
        rangeEnd: 36,
        backgroundMusicEnabled: true,
        backgroundMusicVolume: 0.35,
      }}
    />
  );
};
