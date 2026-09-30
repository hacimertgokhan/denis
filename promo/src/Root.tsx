import React from 'react';
import {Composition} from 'remotion';
import {Promo} from './Promo';
import {FPS, TOTAL_FRAMES} from './timing';

export const Root: React.FC = () => (
  <Composition
    id="Promo"
    component={Promo}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
