import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {bench} from './data';
import {ease, useReveal, useSoft} from './motion';
import {brandGradient, c, sans, textGradient} from './theme';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const Bar: React.FC<{share: number; fill: string; value: number; height: number; strong?: boolean}> = ({share, fill, value, height, strong}) => (
  <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
    <div style={{flex: 1, height, borderRadius: height / 2, background: 'rgba(255,255,255,0.05)', overflow: 'hidden'}}>
      <div style={{width: `${Math.max(share * 100, 0.6)}%`, height: '100%', borderRadius: height / 2, background: fill}} />
    </div>
    <div
      style={{
        width: 150,
        textAlign: 'right',
        fontSize: strong ? 26 : 22,
        fontWeight: strong ? 700 : 500,
        color: strong ? c.text : c.muted,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {Math.round(value).toLocaleString('en-US')}
    </div>
  </div>
);

export const Bench: React.FC = () => {
  const frame = useCurrentFrame();
  const head = useReveal(4, 26);
  const sub = useReveal(60, 26);
  const panel = useSoft(14, 60);
  const count = interpolate(frame, [10, 80], [0, bench.headline.opsPerSec], {...clamp, easing: ease});
  const max = Math.max(...bench.rows.map((r) => r.now));

  return (
    <AbsoluteFill style={{flexDirection: 'row', alignItems: 'center', padding: '0 130px', fontFamily: sans}}>
      <div style={{width: 700, flexShrink: 0}}>
        <div
          style={{
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: 4,
            textTransform: 'uppercase',
            color: c.cyan,
            opacity: head,
            transform: `translateY(${(1 - head) * 14}px)`,
          }}
        >
          Benchmarks · {bench.version}
        </div>
        <div
          style={{
            marginTop: 16,
            fontSize: 176,
            fontWeight: 800,
            letterSpacing: -6,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
            backgroundImage: textGradient,
            WebkitBackgroundClip: 'text',
            color: 'transparent',
            opacity: head,
          }}
        >
          {(count / 1e6).toFixed(2)}M
        </div>
        <div style={{fontSize: 46, fontWeight: 600, color: c.text, marginTop: 4, opacity: head}}>ops/s on one machine</div>
        <div style={{marginTop: 22, fontSize: 30, color: c.muted, lineHeight: 1.45, opacity: sub, transform: `translateY(${(1 - sub) * 14}px)`}}>
          {bench.headline.caption}
          <br />
          p99 latency <span style={{color: c.text, fontWeight: 600}}>{bench.headline.p99us} µs</span>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          marginLeft: 40,
          padding: '38px 44px 34px',
          borderRadius: 26,
          background: 'linear-gradient(180deg, rgba(20,28,45,0.85) 0%, rgba(11,17,30,0.9) 100%)',
          border: `1px solid ${c.line}`,
          boxShadow: '0 50px 120px rgba(0,0,0,0.5)',
          opacity: panel,
          transform: `translateY(${(1 - panel) * 36}px)`,
        }}
      >
        <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 22, color: c.muted, marginBottom: 26}}>
          <span>ops/s, same machine, same load generator</span>
          <span style={{display: 'flex', gap: 22}}>
            <span>
              <span style={{display: 'inline-block', width: 12, height: 12, borderRadius: 6, background: c.faint, marginRight: 8}} />
              {bench.previous}
            </span>
            <span>
              <span style={{display: 'inline-block', width: 12, height: 12, borderRadius: 6, background: c.cyan, marginRight: 8}} />
              {bench.version}
            </span>
          </span>
        </div>
        {bench.rows.map((r, i) => {
          const start = 30 + i * 12;
          const p = interpolate(frame, [start, start + 46], [0, 1], {...clamp, easing: ease});
          const badge = interpolate(frame, [start + 34, start + 52], [0, 1], {...clamp, easing: ease});
          return (
            <div key={r.label} style={{marginBottom: i === bench.rows.length - 1 ? 0 : 28}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10}}>
                <span style={{fontSize: 28, fontWeight: 600, color: c.text}}>{r.label}</span>
                <span style={{fontSize: 26, fontWeight: 700, color: c.green, opacity: badge, transform: `translateX(${(1 - badge) * 10}px)`}}>
                  {r.speedup}
                </span>
              </div>
              <Bar share={(r.before / max) * p} fill={c.faint} value={r.before * p} height={14} />
              <div style={{height: 8}} />
              <Bar share={(r.now / max) * p} fill={brandGradient} value={r.now * p} height={22} strong />
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
