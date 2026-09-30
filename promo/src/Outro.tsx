import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {Logo} from './Logo';
import {useReveal, useSoft} from './motion';
import {c, monoFont, sans, textGradient} from './theme';

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const logo = useSoft(2, 60);
  const title = useReveal(12, 28);
  const cmd = useReveal(30, 28);
  const url = useReveal(44, 28);
  const float = Math.sin(frame / 22) * 4;
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', fontFamily: sans}}>
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `translateY(${float}px)`}}>
        <div style={{opacity: logo, transform: `scale(${interpolate(logo, [0, 1], [0.85, 1])})`, filter: 'drop-shadow(0 24px 50px rgba(31,182,201,0.3))'}}>
          <Logo size={128} id="outro" />
        </div>
        <div
          style={{
            marginTop: 30,
            fontSize: 96,
            fontWeight: 800,
            letterSpacing: -3,
            opacity: title,
            transform: `translateY(${(1 - title) * 20}px)`,
            backgroundImage: textGradient,
            WebkitBackgroundClip: 'text',
            color: 'transparent',
          }}
        >
          Try Denis today
        </div>
        <div
          style={{
            marginTop: 30,
            padding: '20px 40px',
            borderRadius: 18,
            fontFamily: monoFont,
            fontSize: 32,
            color: c.text,
            background: 'rgba(255,255,255,0.05)',
            border: `1px solid ${c.line}`,
            opacity: cmd,
            transform: `translateY(${(1 - cmd) * 16}px)`,
          }}
        >
          <span style={{color: c.cyan}}>$ </span>denis server <span style={{color: c.faint}}># one jar, port 5142</span>
        </div>
        <div style={{marginTop: 30, fontSize: 38, fontWeight: 600, color: c.text, opacity: url, transform: `translateY(${(1 - url) * 14}px)`}}>
          github.com/<span style={{color: c.cyan}}>hacimertgokhan</span>/denis
        </div>
      </div>
    </AbsoluteFill>
  );
};
