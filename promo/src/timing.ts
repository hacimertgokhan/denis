// 20 s at 30 fps. Scenes overlap by FADE frames (see Scene.tsx: out first, then in).
export const FPS = 30;
export const TOTAL_FRAMES = 600;
export const FADE = 18;

export const SCENES = {
  intro: {from: 0, duration: 108},
  terminal: {from: 90, duration: 172},
  bench: {from: 244, duration: 170},
  features: {from: 396, duration: 102},
  outro: {from: 480, duration: 120},
} as const;
