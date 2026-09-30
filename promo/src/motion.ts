import {Easing, interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

// Soft, non-bouncy spring (damping 200 = critically damped) — the base of all motion here.
export const useSoft = (delay = 0, stiffness = 90, mass = 1) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({frame: frame - delay, fps, config: {damping: 200, stiffness, mass}});
};

export const ease = Easing.bezier(0.22, 1, 0.36, 1);

/** 0 -> 1 between `start` and `start + dur`, eased out. */
export const useReveal = (start: number, dur = 24) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease,
  });
};
