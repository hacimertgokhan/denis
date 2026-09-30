import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {Logo} from './Logo';
import {useReveal, useSoft} from './motion';
import {c, sans, textGradient} from './theme';

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const logo = useSoft(4, 60);
  const word = useReveal(20, 30);
  const tag1 = useReveal(44, 28);
  const tag2 = useReveal(58, 28);
  const float = Math.sin(frame / 22) * 5;
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', fontFamily: sans}}>
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `translateY(${float}px)`}}>
        <div
          style={{
            transform: `scale(${interpolate(logo, [0, 1], [0.7, 1])})`,
            opacity: logo,
            filter: `drop-shadow(0 30px 60px rgba(31,182,201,${0.35 * logo}))`,
          }}
        >
          <Logo size={190} id="intro" />
        </div>
        <div
          style={{
            marginTop: 38,
            fontSize: 148,
            fontWeight: 800,
            letterSpacing: interpolate(word, [0, 1], [18, -3]),
            opacity: word,
            transform: `translateY(${(1 - word) * 24}px)`,
            backgroundImage: textGradient,
            WebkitBackgroundClip: 'text',
            color: 'transparent',
          }}
        >
          Denis
        </div>
        <div style={{marginTop: 10, fontSize: 44, fontWeight: 500, color: c.text, opacity: tag1, transform: `translateY(${(1 - tag1) * 18}px)`}}>
          Key-value and SQL, in memory.
        </div>
        <div style={{marginTop: 10, fontSize: 44, fontWeight: 500, color: c.muted, opacity: tag2, transform: `translateY(${(1 - tag2) * 18}px)`}}>
          Durable by design.
        </div>
      </div>
    </AbsoluteFill>
  );
};
