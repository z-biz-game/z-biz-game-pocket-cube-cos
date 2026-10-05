#!/usr/bin/env node
// Regenerate every bitmap this game ships, using the geometry the game itself renders with.
//
// Why drawn rather than authored: js/view.js already owns the camera (CAM_DEFAULT yaw 0.62 /
// pitch 0.42), the six sticker colours, the plastic colour, the sticker inset and the lift. This
// file imports all of them, so an app icon and a live canvas frame cannot disagree about which
// face the player is looking at — the failure mode of a hand-traced logo redrawn "close to" the
// game. Run `node assets/gen/make-art.mjs` and every file listed at the bottom comes back
// byte-identical, because the only randomness here is the seeded hash in ./noise.mjs and the only
// floating point is Math.cos/sin, which IEEE-754 pins down.
//
// Dependencies: node stdlib plus ./png.mjs (a zlib-backed PNG encoder) and a software rasterizer.
// No Pillow, no canvas, no browser, no network.
//
// The motif:
//   favicon 16-64   one corner cubie. A 2x2x2 at 16px is mud; the atom of the puzzle still reads,
//                   and it is the only piece type a 2x2 has.
//   96 and up       the assembled 2x2x2, same camera as the board.
//   og card         cube on the left, wordmark and the one verifiable claim on the right.
//   blueprint       tileable page-ground texture: hairline grid, film grain, cyan nodes.
//   spark           soft dot the win splash paints its particles from.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { solvedState } from '../../js/core/cube.js';
import { SLOT_COORD } from '../../js/core/geom.js';
import {
  CAM_DEFAULT, FACE_COLOR, PLASTIC, STICKER_LIFT, STICKER_SIZE, quadPoints, stickerFaces, toViewPoint,
} from '../../js/view.js';
import {
  blendPixel, createCanvas, downsample, encodePng, fillPoly, fillRect, hex, readPng, rgba, shade, writePng,
} from './png.mjs';
import { readIcns, readIco, writeIcns, writeIco } from './containers.mjs';
import { drawText, textWidth } from './font5x7.mjs';
import { grain } from './noise.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Straight from the stylesheet and the renderer, not re-invented here.
const BG = hex('#0f1217'); // css --bg
const BG2 = hex('#161a21'); // css --bg-2
const TILE = hex('#101318'); // <meta name="theme-color">
const AMBER = hex('#e0a63c'); // css --amber
const CYAN = hex('#78dcff'); // css --cyan
const INK = hex('#e6e9ef'); // css --ink
const DIM = hex('#8f98a8'); // css --ink-dim
const PLASTIC_RGB = hex(PLASTIC);

const STICKER_RGB = Object.fromEntries(Object.entries(FACE_COLOR).map(([f, h]) => [f, hex(h)]));

// Light in model space: +y is U, so a large y is a top light; +x and +z pick up the two side
// faces this camera shows. Normalised once.
const LIGHT = (() => {
  const v = [0.52, 0.80, 0.34];
  const l = Math.hypot(v[0], v[1], v[2]);
  return v.map((a) => a / l);
})();

const SOLVED = solvedState();
const ALL_SLOTS = SLOT_COORD.map((_, i) => i);
const SINGLE_SLOT = [7]; // SLOT_COORD[7] = [+1, +1, +1] = the R/U/F corner, the one this camera faces
const SINGLE_OFFSET = [0.5, 0.5, 0.5];

const AXIS = (i) => [0, 1, 2].map((j) => (i === j ? 1 : 0));
const neg = (v) => v.map((a) => -a);
const slotNormals = (slot) => SLOT_COORD[slot].map((s, i) => (s > 0 ? AXIS(i) : neg(AXIS(i))));

// ---- the cube ------------------------------------------------------------------------

// Paints cubies back to front (the same painter's ordering js/view.js uses) and skips any face
// whose view-space normal points away, since a raster with no z-buffer cannot over-paint its
// way to correctness the way a canvas can.
//
// `scale` is pixels per model unit: view.js uses side/3.35 for the whole 2x2, and one cubie is
// half that extent, so a favicon passes a different divisor.
export function drawCube(cv, { cx, cy, scale, slots = ALL_SLOTS, cam = CAM_DEFAULT, off = [0, 0, 0] }) {
  const proj = (v) => {
    const p = toViewPoint([v[0] - off[0], v[1] - off[1], v[2] - off[2]], cam);
    return { x: cx + p[0] * scale, y: cy - p[1] * scale };
  };
  // Directions only. `off` is a translation that recentres a single cubie on the canvas; feeding
  // it to a normal would flip the back-face test, and for the painter's sort it is a constant
  // added to every cubie's depth, so the ordering is the same with or without it.
  const depth = (v) => toViewPoint(v, cam)[2];
  const faces = stickerFaces(SOLVED);

  const order = slots
    .map((s) => ({ s, z: depth(SLOT_COORD[s].map((a) => a * 0.5)) }))
    .sort((a, b) => a.z - b.z);

  for (const item of order) {
    const s = item.s;
    const centre = SLOT_COORD[s].map((a) => a * 0.5);
    const normals = slotNormals(s);
    // The face letters come from js/view.js's own stickerFaces, so the twistCycle-to-axis
    // pairing lives in exactly one place. The first render of this file is what exposed that
    // js/view.js had been pairing stickers with normals by list index, and drew a solved cube
    // with a blue sticker on the white face.
    for (let k = 0; k < 3; k++) {
      const n = normals[k];
      if (depth(n) <= 0.02) continue; // facing away from this camera
      const e1 = normals[(k + 1) % 3];
      const e2 = normals[(k + 2) % 3];
      const lit = 0.68 + 0.52 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      fillPoly(cv, quadPoints(centre, n, e1, e2, 1, 0).map(proj), rgba(shade(PLASTIC_RGB, lit), 1));
      const base = STICKER_RGB[faces[s][k]] || DIM;
      // Two passes, one inset: the wider one in a lightened tone leaves a ring, and that ring is
      // the sticker bevel. Without it nine flat squares read as one silhouette at favicon size.
      fillPoly(cv, quadPoints(centre, n, e1, e2, STICKER_SIZE, STICKER_LIFT).map(proj),
        rgba(shade(base, Math.min(1.28, lit + 0.24)), 1));
      fillPoly(cv, quadPoints(centre, n, e1, e2, STICKER_SIZE * 0.86, STICKER_LIFT).map(proj),
        rgba(shade(base, lit), 1));
    }
  }
}

// ---- shapes --------------------------------------------------------------------------

// A rounded rect as body + two side bars + four quarter discs, so the corners come out of the
// same even-odd scanline as everything else and downsample anti-aliases them.
function fillRoundRect(cv, x, y, w, h, r, color) {
  fillRect(cv, x + r, y, w - 2 * r, h, color, 1);
  fillRect(cv, x, y + r, r, h - 2 * r, color, 1);
  fillRect(cv, x + w - r, y + r, r, h - 2 * r, color, 1);
  const R = Math.ceil(r);
  for (let dy = 0; dy <= R; dy++) {
    for (let dx = 0; dx <= R; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      for (const [qx, qy] of [[x + r - dx, y + r - dy], [x + w - r + dx, y + r - dy],
        [x + r - dx, y + h - r + dy], [x + w - r + dx, y + h - r + dy]]) {
        blendPixel(cv, Math.round(qx), Math.round(qy), color, 1);
      }
    }
  }
}

// Radial falloff, painted straight into the supersampled buffer so a glow gets the same
// downsampling as the geometry. `clip` keeps it inside a tile that has transparent corners.
function radialGlow(cv, ox, oy, radius, color, strength) {
  const r = Math.ceil(radius);
  for (let y = Math.max(0, oy - r); y < Math.min(cv.h, oy + r); y++) {
    for (let x = Math.max(0, ox - r); x < Math.min(cv.w, ox + r); x++) {
      const d = Math.hypot(x - ox, y - oy) / radius;
      if (d >= 1) continue;
      if (cv.data[(y * cv.w + x) * 4 + 3] === 0) continue;
      blendPixel(cv, x, y, rgba(color, 1), strength * Math.pow(1 - d, 2.2));
    }
  }
}

function vGradient(cv, x, y, w, h, from, to, coverage = 1) {
  for (let i = 0; i < h; i++) {
    const t = h === 1 ? 0 : i / (h - 1);
    fillRect(cv, x, y + i, w, 1, rgba([
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    ], 1), coverage);
  }
}

// ---- emit ----------------------------------------------------------------------------

const OUT = [];
const DESKTOP = [];

// Measured from the bytes on disk, because every dimension check in the world passed while
// icons/icon-maskable-512.png was 81% transparent — the one thing a maskable tile may never be.
// `kind` says what the file is for, and the numbers come back into the self-check table.
function auditPng(rel, kind, wantW, wantH) {
  const { w, h, data } = readPng(path.join(ROOT, rel));
  const alphaAt = (x, y) => data[(y * w + x) * 4 + 3];
  let solid = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] === 255) solid++;
  const coverage = solid / (w * h);
  const corners = Math.max(alphaAt(0, 0), alphaAt(w - 1, 0), alphaAt(0, h - 1), alphaAt(w - 1, h - 1));
  const centre = alphaAt(w >> 1, h >> 1);
  // How far the motif reaches, measured against the tile's own ground. The ground is the most
  // frequent colour, not pixel (0, 0): the blueprint draws a grid line through its top-left corner,
  // and taking that as the base made every field pixel count as motif.
  const tally = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    tally.set(k, (tally.get(k) || 0) + 1);
  }
  let mode = 0;
  let seen = 0;
  for (const [k, n] of tally) if (n > seen) { seen = n; mode = k; }
  const base = [(mode >> 16) & 255, (mode >> 8) & 255, mode & 255];
  let r = 0;
  let sum = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.max(Math.abs(data[i] - base[0]), Math.abs(data[i + 1] - base[1]), Math.abs(data[i + 2] - base[2]));
      sum += d;
      if (d > 60) r = Math.max(r, Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2));
    }
  }
  const pct = (n) => `${(n * 100).toFixed(1)}%`;
  const fails = [];
  if (kind === 'fullbleed') {
    if (coverage < 0.999) fails.push(`coverage ${pct(coverage)} < 100%`);
  } else if (kind === 'plate') {
    if (corners > 0) fails.push(`corner alpha ${corners} > 0 (a plate must be masked clear)`);
    if (centre < 255) fails.push(`centre alpha ${centre} < 255`);
    if (coverage < 0.55 || coverage > 0.95) fails.push(`coverage ${pct(coverage)} off the rounded-slab band`);
  } else if (kind === 'ground') {
    if (coverage < 0.999) fails.push(`coverage ${pct(coverage)} < 100%`);
  } else if (kind === 'sprite') {
    if (corners > 0) fails.push(`corner alpha ${corners} > 0`);
    if (centre < 150) fails.push(`sprite centre alpha ${centre} too faint to read as a dot`);
    if (coverage > 0.5) fails.push(`sprite coverage ${pct(coverage)}: a splash of 90 of these must not tile solid`);
  }
  if (rel.includes('maskable')) {
    // Android masks to a circle of radius 0.4 * side; the motif has to live inside it.
    if (r > 0.4 * w) fails.push(`motif reaches ${r.toFixed(0)}px, past the ${0.4 * w}px safe radius`);
  }
  if (w !== wantW || h !== wantH) fails.push(`${w}x${h} != ${wantW}x${wantH}`);
  const activity = sum / (w * h);
  if (kind === 'ground' && activity < 6) fails.push(`texture activity ${activity.toFixed(1)} < 6: the ground reads as flat paint`);
  return { fails, coverage: pct(coverage), motifR: Math.round(r), activity: activity.toFixed(1) };
}

function emit(rel, cv, { kind = 'fullbleed', w = cv.w, h = cv.h } = {}) {
  const file = path.join(ROOT, rel);
  writePng(file, cv.w, cv.h, cv.data);
  const audit = auditPng(rel, kind, w, h);
  if (audit.fails.length) throw new Error(`${rel}: ${audit.fails.join('; ')}`);
  OUT.push({ rel, w: cv.w, h: cv.h, bytes: fs.statSync(file).size, kind, ...audit });
}

// An app tile: rounded dark slab, amber bloom, cube centred in it.
function appIcon(side, ss, { slots = ALL_SLOTS, off = [0, 0, 0], unit = 3.35, fit = 0.86, bloom = 0.13 } = {}) {
  const N = side * ss;
  const big = createCanvas(N, N, [0, 0, 0, 0]);
  const pad = Math.round(N * 0.03);
  fillRoundRect(big, pad, pad, N - 2 * pad, N - 2 * pad, N * 0.225, rgba(TILE, 1));
  radialGlow(big, N / 2, N * 0.44, N * 0.44, AMBER, bloom);
  radialGlow(big, N / 2, N * 0.44, N * 0.24, CYAN, bloom * 0.5);
  drawCube(big, { cx: N / 2, cy: N / 2, scale: (N / unit) * fit, slots, off });
  return downsample(big, ss);
}

// 1. favicons — one corner cubie, because a whole cube at 16px is unreadable
for (const [side, ss] of [[16, 4], [32, 4], [48, 4], [64, 3]]) {
  emit(`icons/favicon-${side}.png`, appIcon(side, ss, { slots: SINGLE_SLOT, off: SINGLE_OFFSET, unit: 1.74, fit: 0.92 }), { kind: 'plate' });
}

// 2. the bitmaps a store actually wants — the assembled 2x2
for (const [side, ss] of [[96, 3], [128, 3], [180, 3], [192, 3], [256, 2], [384, 2], [512, 2], [1024, 2]]) {
  const name = side === 180 ? 'apple-touch-icon.png' : `icon-${side}.png`;
  emit(`icons/${name}`, appIcon(side, ss, { fit: 0.9 }), { kind: 'plate' });
}

// 3. maskable — full-bleed square with the motif inside the 80% safe zone, because Android
//    crops the edges and a rounded tile would come out as a rounded square inside a circle.
{
  const side = 512;
  const ss = 2;
  const big = createCanvas(side * ss, side * ss, rgba(TILE, 1));
  radialGlow(big, big.w / 2, big.h / 2, big.w * 0.5, AMBER, 0.1);
  drawCube(big, { cx: big.w / 2, cy: big.h / 2, scale: (big.w / 3.35) * 0.72 });
  emit('icons/icon-maskable-512.png', downsample(big, ss), { kind: 'fullbleed' });
}

// 4. the social card, 1200x630
{
  const W = 1200;
  const H = 630;
  const ss = 2;
  const big = createCanvas(W * ss, H * ss, rgba(BG, 1));
  vGradient(big, 0, 0, big.w, big.h, BG2, BG, 1);
  fillRect(big, 0, 0, 560 * ss, big.h, rgba(TILE, 1), 1);
  vGradient(big, 0, 0, 560 * ss, big.h, shade(TILE, 1.35), TILE, 0.9);
  radialGlow(big, 300 * ss, 320 * ss, 300 * ss, AMBER, 0.17);
  radialGlow(big, 300 * ss, 320 * ss, 170 * ss, CYAN, 0.1);
  drawCube(big, { cx: 300 * ss, cy: 320 * ss, scale: (430 * ss) / 3.35 });
  const cv = downsample(big, ss);

  // hairline grid over the cube panel only, so the left half reads as a blueprint, not a photo
  for (let p = 0; p <= 560; p += 40) {
    fillRect(cv, p, 0, 1, H, rgba(INK, 1), p % 160 === 0 ? 0.05 : 0.028);
  }
  for (let p = 0; p <= H; p += 40) {
    fillRect(cv, 0, p, 560, 1, rgba(INK, 1), p % 160 === 0 ? 0.05 : 0.028);
  }
  fillRect(cv, 559, 0, 1, H, rgba(AMBER, 1), 0.34);

  // Right column is 1200-618-40 = 542px wide, and every line below is sized against that by the
  // same textWidth the layout uses, so nothing can silently run off the card.
  const X = 618;
  const RIGHT = W - 40;
  const lines = [
    [92, 'POCKET', 11, INK],
    [186, 'CUBE', 11, AMBER],
    [286, '2X2X2 RUBIKS CUBE', 5, DIM],
    [336, 'MEASURED, NOT GUESSED', 4, INK],
    [372, 'OVER 88,179,840 STATES', 4, DIM],
    [408, 'QUARTER TURN METRIC', 4, CYAN],
    [468, 'PLAY IN THE BROWSER', 4, DIM],
    [500, 'OR INSTALL IT', 4, AMBER],
  ];
  for (const [y, text, cell, color] of lines) {
    const w = textWidth(text, cell);
    if (X + w > RIGHT) throw new Error(`card line ${JSON.stringify(text)} is ${w}px, overflows ${RIGHT - X}px`);
    drawText(cv, X, y, text, cell, rgba(color, 1), 1);
  }

  // the six face colours as a band: the product's actual palette, not a decorative gradient
  let bx = X;
  for (const f of ['U', 'R', 'F', 'D', 'L', 'B']) {
    fillRect(cv, bx, 556, 64, 14, rgba(STICKER_RGB[f], 1), 1);
    bx += 70;
  }
  if (bx - 70 > RIGHT) throw new Error('face colour band overflows the card');
  emit('social/og.png', cv, { kind: 'fullbleed' });
}

// 5. tileable page ground
{
  const N = 256;
  const cv = createCanvas(N, N, rgba(BG, 1));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const g = grain(x, y);
      blendPixel(cv, x, y, rgba(g > 0 ? INK : BG2, 1), Math.abs(g) * 0.09);
    }
  }
  for (let p = 0; p < N; p += 32) {
    const major = p % 128 === 0;
    fillRect(cv, 0, p, N, 1, rgba(major ? AMBER : INK, 1), major ? 0.16 : 0.075);
    fillRect(cv, p, 0, 1, N, rgba(major ? AMBER : INK, 1), major ? 0.16 : 0.075);
  }
  for (let y = 0; y < N; y += 128) {
    for (let x = 0; x < N; x += 128) fillRect(cv, x, y, 2, 2, rgba(CYAN, 1), 0.5);
  }
  emit('assets/tex/blueprint-256.png', cv, { kind: 'ground' });
}

// 6. particle sprite
{
  const N = 64;
  const cv = createCanvas(N, N, [0, 0, 0, 0]);
  // a disc stack is the cheapest way to get a smooth falloff without a float buffer
  const steps = 18;
  for (let i = steps; i >= 1; i--) {
    const t = i / steps;
    const pts = [];
    for (let a = 0; a < 40; a++) {
      const ang = (a / 40) * Math.PI * 2;
      pts.push({ x: N / 2 + Math.cos(ang) * (N / 2) * t, y: N / 2 + Math.sin(ang) * (N / 2) * t });
    }
    fillPoly(cv, pts, rgba(i > steps * 0.6 ? INK : AMBER, 1), 0.06);
  }
  fillPoly(cv, [{ x: N / 2 - 4, y: N / 2 - 4 }, { x: N / 2 + 4, y: N / 2 - 4 },
    { x: N / 2 + 4, y: N / 2 + 4 }, { x: N / 2 - 4, y: N / 2 + 4 }], rgba(INK, 1), 0.5);
  emit('assets/tex/spark-64.png', cv, { kind: 'sprite' });
}


// 7. the desktop containers: an Electron build wants build/icon.icns for macOS, build/icon.ico for
//    Windows and build/icon.png for the Linux window manager. Without them the game installs with
//    the generic Electron icon — a real product shipping with somebody else's artwork on the Dock.
//    These are the PNGs above put in a container, never a second drawing of the motif, so the
//    desktop icon and the browser tab cannot drift apart.
{
  const pngOf = (rel) => fs.readFileSync(path.join(ROOT, rel));
  const at24 = appIcon(24, 4);
  const ico = writeIco(path.join(ROOT, 'build/icon.ico'), [
    { png: pngOf('icons/favicon-16.png') },
    { png: Buffer.from(encodePng(at24.w, at24.h, at24.data)) },
    { png: pngOf('icons/favicon-32.png') },
    { png: pngOf('icons/favicon-48.png') },
    { png: pngOf('icons/favicon-64.png') },
    { png: pngOf('icons/icon-128.png') },
    { png: pngOf('icons/icon-256.png') },
  ]);
  const icns = writeIcns(path.join(ROOT, 'build/icon.icns'), [
    { side: 32, png: pngOf('icons/favicon-32.png') },
    { side: 64, png: pngOf('icons/favicon-64.png') },
    { side: 128, png: pngOf('icons/icon-128.png') },
    { side: 256, png: pngOf('icons/icon-256.png') },
    { side: 512, png: pngOf('icons/icon-512.png') },
    { side: 1024, png: pngOf('icons/icon-1024.png') },
  ]);
  fs.copyFileSync(path.join(ROOT, 'icons/icon-512.png'), path.join(ROOT, 'build/icon.png'));
  DESKTOP.push(
    { rel: 'build/icon.ico', what: `${ico.count} sizes: ${ico.sizes.join(' ')}` },
    { rel: 'build/icon.icns', what: `${icns.icons.length} chunks: ${[...new Set(icns.icons.map((i) => i.side))].join(' ')}` },
    { rel: 'build/icon.png', what: '512 (Linux window manager)' },
  );
}

// ---- self-check ----------------------------------------------------------------------

console.log('assets/gen/make-art.mjs  (camera ' + JSON.stringify(CAM_DEFAULT) + ', palette from js/view.js)');
let bad = 0;
for (const o of OUT) {
  const buf = fs.readFileSync(path.join(ROOT, o.rel));
  const sig = buf.readUInt32BE(12) === 0x49484452; // 'IHDR' length-prefixed at offset 12
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const depth = buf[24];
  const ctype = buf[25];
  const ok = sig && w === o.w && h === o.h && depth === 8 && ctype === 6 && o.bytes > 64 && buf.length > 64;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${o.rel.padEnd(32)} ${String(w)}x${String(h)}  ${String(o.bytes).padStart(7)} B  ${o.kind.padEnd(10)} solid=${o.coverage.padEnd(6)} motif_r=${String(o.motifR).padStart(4)} act=${o.activity}`);
}
for (const d of DESKTOP) {
  const buf = fs.readFileSync(path.join(ROOT, d.rel));
  const ok = buf.length > 1024;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${d.rel.padEnd(32)} ${String(buf.length).padStart(7)} B  ${d.what}`);
}
console.log(`${OUT.length + DESKTOP.length - bad}/${OUT.length + DESKTOP.length} bitmaps verified, 0 failures expected`);
if (bad) process.exitCode = 1;
