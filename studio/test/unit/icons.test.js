"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { encodePng, encodeIco, encodeIcns, crc32 } = require("../../scripts/make-icons");

test("crc32 matches the PNG reference value", () => {
  assert.equal(crc32(Buffer.from("IEND")), 0xae426082);
});

test("encodePng produces a decodable RGBA image", () => {
  const size = 2;
  const rgba = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 1, 2, 3, 4]);
  const png = encodePng(size, rgba);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 2);
  const idatLen = png.readUInt32BE(33);
  assert.equal(png.toString("ascii", 37, 41), "IDAT");
  const raw = zlib.inflateSync(png.subarray(41, 41 + idatLen));
  assert.equal(raw.length, 2 * (2 * 4 + 1));
  assert.deepEqual([...raw.subarray(10, 18)], [0, 0, 255, 255, 1, 2, 3, 4]);
});

test("ICO and ICNS containers have consistent headers", () => {
  const png = encodePng(1, Buffer.from([0, 0, 0, 0]));
  const ico = encodeIco([{ size: 256, png }, { size: 16, png }]);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 2);
  assert.equal(ico[6], 0, "256 is stored as 0");
  assert.equal(ico.readUInt32LE(6 + 12), 6 + 32);
  const icns = encodeIcns([{ type: "ic07", png }]);
  assert.equal(icns.toString("ascii", 0, 4), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
  assert.equal(icns.toString("ascii", 8, 12), "ic07");
});

test("generated build icons exist", () => {
  const build = path.join(__dirname, "..", "..", "build");
  for (const f of ["icon.png", "icon.ico", "icon.icns", "icon.svg", "icons/256x256.png", "icons/512x512.png"]) {
    assert.ok(fs.existsSync(path.join(build, f)), f);
  }
});
