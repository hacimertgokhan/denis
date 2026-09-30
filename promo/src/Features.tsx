import React from 'react';
import {AbsoluteFill, interpolate} from 'remotion';
import {features} from './data';
import {useReveal, useSoft} from './motion';
import {brandGradient, c, sans, textGradient} from './theme';

// Minimal line icons, one per feature (24x24 grid).
const icons: Record<string, React.ReactNode> = {
  shield: <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z M9 12l2 2 4-4" />,
  table: <path d="M4 5h16v14H4z M4 10h16 M10 5v14" />,
  bolt: <path d="M13 3L5 13h6l-1 8 8-10h-6l1-8z" />,
  spark: <path d="M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6 6l2.5 2.5 M15.5 15.5L18 18 M18 6l-2.5 2.5 M8.5 15.5L6 18" />,
  window: <path d="M3 5h18v14H3z M3 9h18 M6.5 7h.01 M9.5 7h.01" />,
  box: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z M4 7.5l8 4.5 8-4.5 M12 12v9" />,
};

export const Features: React.FC = () => {
  const head = useReveal(0, 26);
  return (
    <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center', fontFamily: sans, padding: '0 150px'}}>
      <div style={{textAlign: 'center', marginBottom: 56, opacity: head, transform: `translateY(${(1 - head) * 18}px)`}}>
        <div style={{fontSize: 30, fontWeight: 600, letterSpacing: 4, textTransform: 'uppercase', color: c.cyan}}>Everything in the box</div>
        <div
          style={{
            marginTop: 12,
            fontSize: 74,
            fontWeight: 800,
            letterSpacing: -2,
            backgroundImage: textGradient,
            WebkitBackgroundClip: 'text',
            color: 'transparent',
          }}
        >
          Small to run. Serious about data.
        </div>
      </div>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 28, width: '100%'}}>
        {features.map((f, i) => (
          <Card key={f.title} index={i} {...f} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Card: React.FC<{index: number; icon: string; title: string; text: string}> = ({index, icon, title, text}) => {
  const p = useSoft(10 + index * 6, 70);
  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${(1 - p) * 34}px) scale(${interpolate(p, [0, 1], [0.97, 1])})`,
        padding: '30px 34px',
        borderRadius: 24,
        background: 'linear-gradient(180deg, rgba(22,31,50,0.85) 0%, rgba(12,18,32,0.9) 100%)',
        border: `1px solid ${c.line}`,
        boxShadow: '0 30px 70px rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        gap: 26,
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          background: brandGradient,
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          boxShadow: '0 12px 30px rgba(31,182,201,0.35)',
        }}
      >
        <svg width={38} height={38} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          {icons[icon]}
        </svg>
      </div>
      <div>
        <div style={{fontSize: 32, fontWeight: 700, color: c.text}}>{title}</div>
        <div style={{marginTop: 4, fontSize: 24, color: c.muted, lineHeight: 1.3}}>{text}</div>
      </div>
    </div>
  );
};
