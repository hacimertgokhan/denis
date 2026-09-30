import React from 'react';
import {AbsoluteFill, Easing, interpolate, Sequence, useCurrentFrame} from 'remotion';
import {FADE} from './timing';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/**
 * Soft dip transition. Scenes overlap by FADE frames, but the outgoing one is gone
 * before the incoming one appears, so their text never ghosts over each other; the
 * aurora background carries the eye across the gap.
 * The scene's own animations start when it becomes visible (not at frame 0).
 */
export const Scene: React.FC<{duration: number; children: React.ReactNode; fadeIn?: boolean}> = ({
  duration,
  children,
  fadeIn = true,
}) => {
  const frame = useCurrentFrame();
  const enter = FADE - 2;
  const inP = fadeIn
    ? interpolate(frame, [enter, enter + 18], [0, 1], {...clamp, easing: Easing.out(Easing.cubic)})
    : 1;
  const outP = interpolate(frame, [duration - FADE + 4, duration - 2], [0, 1], {
    ...clamp,
    easing: Easing.in(Easing.cubic),
  });
  const opacity = Math.min(inP, 1 - outP);
  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `translateY(${(1 - inP) * 18 - outP * 12}px) scale(${0.985 + 0.015 * inP + outP * 0.008})`,
        filter: `blur(${(1 - inP) * 8 + outP * 6}px)`,
      }}
    >
      {fadeIn ? (
        <Sequence from={enter} layout="none">
          {children}
        </Sequence>
      ) : (
        children
      )}
    </AbsoluteFill>
  );
};
