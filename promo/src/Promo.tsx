import React from 'react';
import {AbsoluteFill, Sequence} from 'remotion';
import {Background} from './Background';
import {Bench} from './Bench';
import {Features} from './Features';
import {Intro} from './Intro';
import {Outro} from './Outro';
import {Scene} from './Scene';
import {Terminal} from './Terminal';
import {SCENES} from './timing';

export const Promo: React.FC = () => (
  <AbsoluteFill>
    <Background />
    <Sequence from={SCENES.intro.from} durationInFrames={SCENES.intro.duration}>
      <Scene duration={SCENES.intro.duration} fadeIn={false}>
        <Intro />
      </Scene>
    </Sequence>
    <Sequence from={SCENES.terminal.from} durationInFrames={SCENES.terminal.duration}>
      <Scene duration={SCENES.terminal.duration}>
        <Terminal />
      </Scene>
    </Sequence>
    <Sequence from={SCENES.bench.from} durationInFrames={SCENES.bench.duration}>
      <Scene duration={SCENES.bench.duration}>
        <Bench />
      </Scene>
    </Sequence>
    <Sequence from={SCENES.features.from} durationInFrames={SCENES.features.duration}>
      <Scene duration={SCENES.features.duration}>
        <Features />
      </Scene>
    </Sequence>
    <Sequence from={SCENES.outro.from} durationInFrames={SCENES.outro.duration}>
      <Scene duration={SCENES.outro.duration}>
        <Outro />
      </Scene>
    </Sequence>
  </AbsoluteFill>
);
