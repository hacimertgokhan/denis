#!/usr/bin/env node
"use strict";

/**
 * Generates the application icons without any image library:
 *
 *   build/icon.svg          vector source (same geometry as below)
 *   build/icon.png          1024x1024
 *   build/icons/NxN.png     16 ... 1024 (Linux)
 *   build/icon.ico          16, 24, 32, 48, 64, 128, 256 (PNG-compressed entries)
 *   build/icon.icns         ic07-ic14 (PNG-compressed entries, macOS 10.7+)
 *   src/renderer/assets/icon.png, logo.svg  (window icon, in-app logo)
 *
 * The icon is a rounded square with a teal-to-indigo gradient and a white
 * "D". Each size is rendered directly with 4x4 supersampling.
 *
 * Usage: node scripts/make-icons.js
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "build");
const ASSETS = path.join(ROOT, "src", "renderer", "assets");

// geometry in a 1024 unit square
const G = {
  inset: 32,
  radius: 216,
  top: [0x1f, 0xb6, 0xc9],
  bottom: [0x3b, 0x3f, 0xc4],
  // outer D: bar from x=300, y 250..774, bowl centred (460,512) r=262
  // inner hole: x from 420, y 370..654, bowl r=142
  d: { left: 300, top: 250, bottom: 774, cx: 460, cy: 512, r: 262, stroke: 120 },
};

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1fb6c9"/>
      <stop offset="1" stop-color="#3b3fc4"/>
    </linearGradient>
  </defs>
  <rect x="32" y="32" width="960" height="960" rx="216" fill="url(#g)"/>
  <path fill="#ffffff" fill-rule="evenodd" d="M300 250 H460 A262 262 0 0 1 460 774 H300 Z M420 370 V654 H460 A142 142 0 0 0 460 370 Z"/>
</svg>
`;

function insideRoundedRect(x, y) {
  const a = G.inset;
  const b = 1024 - G.inset;
  if (x < a || x > b || y < a || y > b) return false;
  const r = G.radius;
  const cx = x < a + r ? a + r : x > b - r ? b - r : x;
  const cy = y < a + r ? a + r : y > b - r ? b - r : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideD(x, y) {
  const d = G.d;
  const inOuter = (x >= d.left && x <= d.cx && y >= d.top && y <= d.bottom) || (x > d.cx && (x - d.cx) ** 2 + (y - d.cy) ** 2 <= d.r * d.r);
  if (!inOuter) return false;
  const ir = d.r - d.stroke;
  const inner = (x >= d.left + d.stroke && x <= d.cx && y >= d.top + d.stroke && y <= d.bottom - d.stroke) || (x > d.cx && (x - d.cx) ** 2 + (y - d.cy) ** 2 <= ir * ir);
  return !inner;
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const scale = 1024 / size;
  const S = 4;
  for (let py = 0; py < size; py++) {
    for (let pxX = 0; pxX < size; pxX++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (pxX + (sx + 0.5) / S) * scale;
          const y = (py + (sy + 0.5) / S) * scale;
          if (insideRoundedRect(x, y)) {
            bg++;
            if (insideD(x, y)) fg++;
          }
        }
      }
      const cover = bg / (S * S);
      const white = bg ? fg / bg : 0;
      const t = (py + 0.5) / size;
      const i = (py * size + pxX) * 4;
      for (let c = 0; c < 3; c++) {
        const grad = G.top[c] + (G.bottom[c] - G.top[c]) * t;
        px[i + c] = Math.round(grad * (1 - white) + 255 * white);
      }
      px[i + 3] = Math.round(cover * 255);
    }
  }
  return px;
}

// ------------------------------------------------------------------ PNG

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([header, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ------------------------------------------------------------------ ICO / ICNS

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir[o] = size >= 256 ? 0 : size;
    dir[o + 1] = size >= 256 ? 0 : size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bpp
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

function encodeIcns(entries) {
  const parts = entries.map(({ type, png }) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, "ascii");
    h.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([h, png]);
  });
  const body = Buffer.concat(parts);
  const h = Buffer.alloc(8);
  h.write("icns", 0, "ascii");
  h.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([h, body]);
}

// ------------------------------------------------------------------ main

function main() {
  fs.mkdirSync(path.join(BUILD, "icons"), { recursive: true });
  fs.mkdirSync(ASSETS, { recursive: true });
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  const png = {};
  for (const s of sizes) {
    png[s] = encodePng(s, render(s));
    process.stdout.write(`rendered ${s}x${s}\n`);
  }
  fs.writeFileSync(path.join(BUILD, "icon.svg"), SVG);
  fs.writeFileSync(path.join(BUILD, "icon.png"), png[1024]);
  for (const s of [16, 32, 48, 64, 128, 256, 512, 1024]) fs.writeFileSync(path.join(BUILD, "icons", `${s}x${s}.png`), png[s]);
  fs.writeFileSync(path.join(BUILD, "icon.ico"), encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: png[size] }))));
  fs.writeFileSync(
    path.join(BUILD, "icon.icns"),
    encodeIcns([
      { type: "ic11", png: png[32] }, // 16@2x
      { type: "ic12", png: png[64] }, // 32@2x
      { type: "ic07", png: png[128] },
      { type: "ic13", png: png[256] }, // 128@2x
      { type: "ic08", png: png[256] },
      { type: "ic14", png: png[512] }, // 256@2x
      { type: "ic09", png: png[512] },
      { type: "ic10", png: png[1024] }, // 512@2x
    ]),
  );
  fs.writeFileSync(path.join(ASSETS, "icon.png"), png[256]);
  fs.writeFileSync(path.join(ASSETS, "logo.svg"), SVG);
  process.stdout.write("icons written to build/ and src/renderer/assets/\n");
}

if (require.main === module) main();

module.exports = { encodePng, encodeIco, encodeIcns, crc32, render, SVG };
