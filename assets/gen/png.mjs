// A PNG encoder and a tiny software rasterizer, on node's stdlib alone.
//
// Why this file exists: the shipped icons are product assets and they have to be regenerable by
// anyone who clones the repo, with no PIL, no canvas, no headless browser, and no network. zlib
// already gives us the one hard part of PNG (the IDAT stream is a zlib deflate), so the rest is
// a 256-entry CRC table and three chunk headers.
//
// The rasterizer only needs what this game's own renderer needs: convex quads with a fill colour
// and an optional alpha, painted back-to-front. So `fillQuad` is an even-odd scanline over the
// edge list, which is exact for a convex polygon and needs no floating-point framebuffer.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([head, t, data, tail]);
}

// colour type 6 (RGBA), 8 bits per channel, no interlace, filter 0 on every scanline.
export function encodePng(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const row = y * (stride + 1);
    raw[row] = 0;
    for (let x = 0; x < stride; x++) raw[row + 1 + x] = rgba[y * stride + x];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function writePng(file, w, h, rgba) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(w, h, rgba));
  return file;
}

// The read side of this file's own format, so an audit can look at the bytes that landed on disk
// rather than at the buffer that was handed to the encoder. Only what `encodePng` can produce is
// accepted: 8-bit, colour type 6, non-interlaced. Anything else throws, because a decoder that
// quietly guesses turns the audit into a lie.
export function readPng(file) {
  const buf = typeof file === 'string' ? fs.readFileSync(file) : file;
  if (buf.length < 8 || buf.toString('latin1', 0, 8) !== '\x89PNG\r\n\x1a\n') throw new Error('not a PNG');
  let p = 8;
  let w = 0;
  let h = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new Error(`unsupported PNG: depth ${body[8]} ctype ${body[9]} interlace ${body[12]}`);
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const out = Buffer.alloc(w * h * 4);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos];
    pos += 1;
    const line = Buffer.from(raw.subarray(pos, pos + stride));
    pos += stride;
    // Deliberately only what `encodePng` writes: filter 0 on every scanline. The day this encoder
    // starts picking filters, this line becomes the error that says so, not a silent misread.
    if (filter !== 0) throw new Error(`PNG filter ${filter} is not what encodePng writes`);
    line.copy(out, y * stride);
  }
  return { w, h, data: out };
}

export function createCanvas(w, h, bg = [0, 0, 0, 0]) {
  const data = Buffer.alloc(w * h * 4);
  // Colours in this file carry alpha as a 0..1 float (that is what rgba() emits and what
  // blendPixel consumes), while the framebuffer stores a 0..255 byte. Writing bg[3] raw made
  // `createCanvas(N, N, rgba(TILE, 1))` a 0.4%-opaque field, which is how the maskable icon
  // shipped 81% transparent — a maskable tile has to be full-bleed or the launcher's own
  // backdrop shows through the mask.
  const bgA = Math.round(bg[3] * 255);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = bg[0];
    data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = bgA;
  }
  return { w, h, data };
}

// Even-odd scanline fill of a convex polygon in pixel coordinates.
export function fillPoly(cv, pts, color, coverage = 1) {
  const { w, h, data } = cv;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(h - 1, Math.ceil(maxY));
  const xs = [];
  const n = pts.length;
  for (let y = y0; y <= y1; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (a.y === b.y) continue;
      if (sy >= Math.min(a.y, b.y) && sy < Math.max(a.y, b.y)) {
        xs.push(a.x + ((sy - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.round(xs[k]));
      const xb = Math.min(w, Math.round(xs[k + 1]));
      for (let x = xa; x < xb; x++) blendPixel(cv, x, y, color, coverage);
    }
  }
}

export function fillRect(cv, x, y, w2, h2, color, coverage = 1) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(cv.w, Math.round(x + w2));
  const y1 = Math.min(cv.h, Math.round(y + h2));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) blendPixel(cv, xx, yy, color, coverage);
}

// source-over, so a shadow or a glow can be painted without touching the framebuffer format.
export function blendPixel(cv, x, y, color, coverage = 1) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
  const i = (y * cv.w + x) * 4;
  const sa = (color[3] === undefined ? 1 : color[3]) * coverage;
  if (sa <= 0) return;
  const d = cv.data;
  const da = d[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  for (let c = 0; c < 3; c++) {
    const s = color[c] * sa;
    const dd = d[i + c] * da;
    d[i + c] = oa > 0 ? Math.round((s + dd * (1 - sa)) / oa) : 0;
  }
  d[i + 3] = Math.round(oa * 255);
}

// Box filter downsample; `ss` is the supersample factor the scene was rendered at. With ss = 3
// a 3072 master becomes a 1024 icon whose edges are genuinely anti-aliased rather than stair-stepped.
export function downsample(cv, ss) {
  const w = Math.round(cv.w / ss);
  const h = Math.round(cv.h / ss);
  const out = Buffer.alloc(w * h * 4);
  const cell = ss * ss;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let dy = 0; dy < ss; dy++) {
        for (let dx = 0; dx < ss; dx++) {
          const i = ((y * ss + dy) * cv.w + x * ss + dx) * 4;
          a += cv.data[i + 3];
          // premultiply so a transparent pixel does not drag its (unset) colour into the average
          const f = cv.data[i + 3] / 255;
          r += cv.data[i] * f;
          g += cv.data[i + 1] * f;
          b += cv.data[i + 2] * f;
        }
      }
      const o = (y * w + x) * 4;
      const aa = a / cell;
      out[o + 3] = Math.round(aa);
      if (aa > 0) {
        out[o] = Math.round((r / cell) / (aa / 255));
        out[o + 1] = Math.round((g / cell) / (aa / 255));
        out[o + 2] = Math.round((b / cell) / (aa / 255));
      }
    }
  }
  return { w, h, data: out };
}

export const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

export const rgba = (c, a = 1) => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), a];

export const shade = (c, f) => [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
