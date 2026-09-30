import React from 'react';

// The app icon (studio/build/icon.svg): a "D" cut out of a rounded gradient tile.
export const Logo: React.FC<{size: number; id?: string}> = ({size, id = 'lg'}) => (
  <svg width={size} height={size} viewBox="0 0 1024 1024" style={{display: 'block'}}>
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#1fb6c9" />
        <stop offset="1" stopColor="#3b3fc4" />
      </linearGradient>
    </defs>
    <rect x="32" y="32" width="960" height="960" rx="216" fill={`url(#${id})`} />
    <path
      fill="#fff"
      fillRule="evenodd"
      d="M300 250 H460 A262 262 0 0 1 460 774 H300 Z M420 370 V654 H460 A142 142 0 0 0 460 370 Z"
    />
  </svg>
);
