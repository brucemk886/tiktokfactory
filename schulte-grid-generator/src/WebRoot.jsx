import React from 'react';
import {Composition} from 'remotion';
import {SchulteFocus} from './SchulteFocus';
import {SchulteTracking} from './SchulteTracking';
import {
  ColorInterference,
  PeripheralCapture,
  PositionMemory,
} from './SchulteConcepts';

export const WebRoot = () => {
  return (
    <>
      <Composition
        id="SchulteFocusWeb"
        component={SchulteFocus}
        durationInFrames={32 * 30}
        fps={30}
        width={720}
        height={1280}
        calculateMetadata={({props}) => ({
          durationInFrames:
            Math.max(12, Math.min(180, Number(props.durationSeconds) || 32)) * 30,
        })}
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
      <Composition
        id="SchulteTrackingWeb"
        component={SchulteTracking}
        durationInFrames={37 * 30}
        fps={30}
        width={720}
        height={1280}
        calculateMetadata={({props}) => ({
          durationInFrames:
            (Math.max(10, Math.min(90, Number(props.trackingSeconds) || 30)) + 7) * 30,
        })}
        defaultProps={{
          day: 46,
          seed: 4602,
          trackingSeconds: 30,
          ballSpeed: 1,
          trackingMode: 'single',
          trackingBackground: 'forest',
          headline: '每日前额叶训练',
          instructionLanguage: 'zh',
          backgroundMusicEnabled: true,
          backgroundMusicVolume: 0.35,
        }}
      />
      <Composition
        id="SchulteConcept3"
        component={ColorInterference}
        durationInFrames={16 * 30}
        fps={30}
        width={720}
        height={1280}
        defaultProps={{day: 1}}
      />
      <Composition
        id="SchulteConcept4"
        component={PositionMemory}
        durationInFrames={16 * 30}
        fps={30}
        width={720}
        height={1280}
        defaultProps={{
          day: 1,
          seed: 4001,
          headline: '网格位置记忆',
          mainTitle: '每日前额叶训练',
          memorySteps: 6,
          memoryBackground: 'aqua',
          instructionLanguage: 'zh',
          backgroundMusicEnabled: true,
          backgroundMusicVolume: 0.35,
        }}
      />
      <Composition
        id="SchulteConcept5"
        component={PeripheralCapture}
        durationInFrames={16 * 30}
        fps={30}
        width={720}
        height={1280}
        defaultProps={{
          day: 1,
          seed: 5001,
          headline: '周边闪视捕捉',
          mainTitle: '每日前额叶训练',
          peripheralTargets: 3,
          instructionLanguage: 'zh',
          backgroundMusicEnabled: true,
          backgroundMusicVolume: 0.35,
        }}
      />
    </>
  );
};
