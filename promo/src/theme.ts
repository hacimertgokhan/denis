import {loadFont as loadInter} from '@remotion/google-fonts/Inter';
import {loadFont as loadMono} from '@remotion/google-fonts/JetBrainsMono';

const inter = loadInter('normal', {weights: ['400', '500', '600', '700', '800'], subsets: ['latin']});
const mono = loadMono('normal', {weights: ['400', '500', '700'], subsets: ['latin']});

export const sans = `${inter.fontFamily}, 'Segoe UI', system-ui, sans-serif`;
export const monoFont = `${mono.fontFamily}, Consolas, 'SF Mono', monospace`;

// Brand: the gradient of the app icon (#1fb6c9 -> #3b3fc4) on a deep navy.
export const c = {
  bg0: '#060a11',
  bg1: '#0c1322',
  text: '#eef2f8',
  muted: '#8b97aa',
  faint: '#5b677a',
  line: 'rgba(255,255,255,0.09)',
  cyan: '#1fb6c9',
  indigo: '#3b3fc4',
  violet: '#8b7cf6',
  green: '#5eead4',
  amber: '#fbbf6a',
};

export const brandGradient = `linear-gradient(135deg, ${c.cyan} 0%, ${c.indigo} 100%)`;
export const textGradient = `linear-gradient(120deg, #7be3f0 0%, ${c.cyan} 35%, #8f93ff 100%)`;
