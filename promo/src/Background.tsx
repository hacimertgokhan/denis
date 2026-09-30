import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {c} from './theme';

// A slowly drifting aurora on a deep navy base. It lives outside the scenes,
// so it never cuts: the whole video breathes with the same light.
const Blob: React.FC<{x: number; y: number; size: number; color: string; alpha: number; phase: number}> = ({
  x,
  y,
  size,
  color,
  alpha,
  phase,
}) => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const dx = Math.sin(t * 0.45 + phase) * 90;
  const dy = Math.cos(t * 0.38 + phase * 1.7) * 70;
  return (
    <div
      style={{
        position: 'absolute',
        left: x + dx - size / 2,
        top: y + dy - size / 2,
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color}${Math.round(alpha * 255)
          .toString(16)
          .padStart(2, '0')} 0%, transparent 68%)`,
      }}
    />
  );
};

export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: `radial-gradient(120% 90% at 50% 0%, ${c.bg1} 0%, ${c.bg0} 70%)`}}>
      <Blob x={360} y={260} size={980} color={c.cyan} alpha={0.2} phase={0} />
      <Blob x={1560} y={820} size={1100} color={c.indigo} alpha={0.32} phase={2.1} />
      <Blob x={1050} y={-40} size={760} color={c.violet} alpha={0.12} phase={4.2} />
      {/* fine dot grid, drifting a few pixels so the frame never feels static */}
      <AbsoluteFill
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.07) 1.2px, transparent 1.4px)',
          backgroundSize: '48px 48px',
          backgroundPosition: `${frame * 0.12}px ${frame * 0.07}px`,
          maskImage: 'radial-gradient(70% 70% at 50% 50%, #000 0%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(70% 70% at 50% 50%, #000 0%, transparent 100%)',
        }}
      />
    </AbsoluteFill>
  );
};
