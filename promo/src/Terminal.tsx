import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {terminalScript} from './data';
import {useReveal, useSoft} from './motion';
import {c, monoFont, sans, textGradient} from './theme';

const CHARS_PER_FRAME = 3;

export const Terminal: React.FC = () => {
  const frame = useCurrentFrame();
  const card = useSoft(0, 70);
  const head1 = useReveal(6, 28);
  const head2 = useReveal(16, 28);
  const blurb = useReveal(30, 30);

  // Lay the commands out on a timeline: type, short beat, reply appears, next command.
  let t = 8;
  const rows = terminalScript.map((step) => {
    const start = t;
    const typeFrames = Math.ceil(step.cmd.length / CHARS_PER_FRAME);
    const replyAt = start + typeFrames + 5;
    t = replyAt + 6;
    return {...step, start, typeFrames, replyAt};
  });
  const active = rows.findIndex((r) => frame < r.start + r.typeFrames);
  const cursorOn = Math.floor(frame / 15) % 2 === 0;

  return (
    <AbsoluteFill style={{flexDirection: 'row', alignItems: 'center', padding: '0 130px', fontFamily: sans}}>
      <div style={{width: 560, flexShrink: 0}}>
        <div style={{fontSize: 78, fontWeight: 800, lineHeight: 1.06, letterSpacing: -2, color: c.text, opacity: head1, transform: `translateY(${(1 - head1) * 22}px)`}}>
          Keys <span style={{color: c.muted}}>and</span>
        </div>
        <div
          style={{
            fontSize: 78,
            fontWeight: 800,
            lineHeight: 1.06,
            letterSpacing: -2,
            opacity: head2,
            transform: `translateY(${(1 - head2) * 22}px)`,
            backgroundImage: textGradient,
            WebkitBackgroundClip: 'text',
            color: 'transparent',
          }}
        >
          SQL, one line at a time.
        </div>
        <div style={{marginTop: 26, fontSize: 30, color: c.muted, lineHeight: 1.4, opacity: blurb}}>
          One line in, one line out. Write to the cache, or add{' '}
          <span style={{fontFamily: monoFont, color: c.cyan}}>-&amp;save</span> to make it durable.
        </div>
      </div>

      <div
        style={{
          flex: 1,
          marginLeft: 60,
          opacity: card,
          transform: `translateY(${(1 - card) * 40}px) scale(${interpolate(card, [0, 1], [0.97, 1])})`,
          borderRadius: 26,
          background: 'linear-gradient(180deg, rgba(20,28,45,0.92) 0%, rgba(11,17,30,0.94) 100%)',
          border: `1px solid ${c.line}`,
          boxShadow: '0 50px 120px rgba(0,0,0,0.55), 0 0 90px rgba(31,182,201,0.10)',
          overflow: 'hidden',
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', gap: 10, padding: '20px 26px', borderBottom: `1px solid ${c.line}`}}>
          {['#ff6b6b', '#fbbf6a', '#5eead4'].map((col) => (
            <div key={col} style={{width: 14, height: 14, borderRadius: 7, background: col, opacity: 0.85}} />
          ))}
          <div style={{marginLeft: 16, fontFamily: monoFont, fontSize: 20, color: c.faint}}>denis cli shell</div>
        </div>
        <div style={{padding: '30px 36px 36px', fontFamily: monoFont, fontSize: 25, lineHeight: 1.5, minHeight: 540}}>
          {rows.map((r, i) => {
            if (frame < r.start) return null;
            const typed = Math.min(r.cmd.length, Math.floor((frame - r.start) * CHARS_PER_FRAME));
            const reply = interpolate(frame, [r.replyAt, r.replyAt + 10], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
            return (
              <div key={i} style={{marginBottom: 14}}>
                <div style={{color: c.text, whiteSpace: 'pre'}}>
                  <span style={{color: c.cyan}}>{'> '}</span>
                  {r.cmd.slice(0, typed)}
                  {i === active && cursorOn ? <span style={{background: c.cyan, color: c.cyan}}>_</span> : null}
                </div>
                {reply > 0 && (
                  <div
                    style={{
                      color: r.table ? c.text : c.green,
                      whiteSpace: 'pre',
                      opacity: reply,
                      transform: `translateY(${(1 - reply) * 6}px)`,
                      paddingLeft: 26,
                    }}
                  >
                    {r.reply}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
