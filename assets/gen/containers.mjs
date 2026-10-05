// The two icon containers a desktop shell actually asks for, written from the PNGs this repo
// already generates — no iconutil, no ImageMagick, no network.
//
// Both are thin: an .ico is a table of offsets over a payload per size, and an .icns is a magic
// word, a length, and one `type` + length + payload per size. The payloads stay PNGs in both
// cases, which is what Vista-and-later Windows and every macOS release in support of this game
// read. A decoder sits next to each writer so the generator can audit the bytes it landed rather
// than the list it meant to write.

import fs from 'node:fs';
import path from 'node:path';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(buf) {
  if (buf.subarray(0, 8).equals(PNG_SIG) === false) throw new Error('icon payload is not a PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// ---- .ico (Windows: taskbar, alt-tab, installed app) --------------------------------------------
// One directory entry per size; Windows picks the closest one and never resizes a 16px bitmap up.
// A 256 edge does not fit in the one-byte width field, so it is written as 0 — the convention every
// reader implements, and the one a hand-rolled writer gets wrong most often.

export function writeIco(file, entries) {
  // Canonical layout: header, then the whole directory, then the payloads. Declaring offsets for a
  // blocked directory while interleaving the payloads instead is the one way an ICO reader can be
  // sent into the middle of a PNG, and `file` will still print a plausible-looking line for it.
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(1, 2); // resource type 1 = icon (0 is a cursor)
  dir.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const heads = [];
  const payloads = [];
  for (const { png } of entries) {
    const { w, h } = pngSize(png);
    const head = Buffer.alloc(16);
    head[0] = w >= 256 ? 0 : w;
    head[1] = h >= 256 ? 0 : h;
    head.writeUInt16LE(1, 4); // planes, fixed by the format
    head.writeUInt16LE(32, 6); // bits per pixel
    head.writeUInt32LE(png.length, 8);
    head.writeUInt32LE(offset, 12);
    offset += png.length;
    heads.push(head);
    payloads.push(png);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([dir, ...heads, ...payloads]));
  return readIco(file);
}

export function readIco(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error(`${file}: not an ICO`);
  const count = buf.readUInt16LE(4);
  const sizes = [];
  const pngs = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + 16 * i;
    const w = buf[at] || 256;
    const h = buf[at + 1] || 256;
    const len = buf.readUInt32LE(at + 8);
    const off = buf.readUInt32LE(at + 12);
    const png = buf.subarray(off, off + len);
    if (!png.subarray(0, 8).equals(PNG_SIG)) throw new Error(`${file}: entry ${i} is not a PNG payload`);
    const real = pngSize(png);
    if (real.w !== w || real.h !== h) throw new Error(`${file}: entry ${i} says ${w}x${h}, payload is ${real.w}x${real.h}`);
    sizes.push(w);
    pngs.push(Buffer.from(png));
  }
  return { count, sizes, pngs };
}

// ---- .icns (macOS: Finder, Dock, Cmd-Tab) -------------------------------------------------------
// Apple's modern types, cross-checked against what `iconutil -c icns` writes on this machine:
// ic11=32, ic12=64, ic07=128, ic08=256, ic13=256 (the 128 @2x), ic09=512, ic14=512 (the 256 @2x),
// ic10=1024. The legacy ic04/ic05 are raw ARGB rather than PNG, so the 16px step is left out and
// the system downsamples the 32px one instead of us inventing a second pixel format.
export const ICNS_TYPES = { 32: 'ic11', 64: 'ic12', 128: 'ic07', 256: ['ic08', 'ic13'], 512: ['ic09', 'ic14'], 1024: 'ic10' };

export function writeIcns(file, entries) {
  const body = [];
  for (const { side, png } of entries) {
    const t = ICNS_TYPES[side];
    if (!t) throw new Error(`no icns type for ${side}px`);
    for (const type of Array.isArray(t) ? t : [t]) {
      const head = Buffer.alloc(8);
      head.write(type, 0, 4, 'ascii');
      head.writeUInt32BE(8 + png.length, 4);
      body.push(head, png);
    }
  }
  const payload = Buffer.concat(body);
  const magic = Buffer.alloc(8);
  magic.write('icns', 0, 4, 'ascii');
  magic.writeUInt32BE(8 + payload.length, 4);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([magic, payload]));
  return readIcns(file);
}

export function readIcns(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'icns') throw new Error(`${file}: not an ICNS`);
  if (buf.readUInt32BE(4) !== buf.length) throw new Error(`${file}: header length ${buf.readUInt32BE(4)} != file ${buf.length}`);
  const icons = [];
  let p = 8;
  while (p + 8 <= buf.length) {
    const type = buf.toString('ascii', p, p + 4);
    const len = buf.readUInt32BE(p + 4);
    if (len < 8) throw new Error(`${file}: ${type} claims length ${len}`);
    const png = buf.subarray(p + 8, p + len);
    // `info` is Apple's own plist chunk and only iconutil writes it; PNG payloads are everything else.
    if (type !== 'info') {
      if (!png.subarray(0, 8).equals(PNG_SIG)) throw new Error(`${file}: ${type} is not a PNG payload`);
      const { w } = pngSize(png);
      icons.push({ type, side: w, png: Buffer.from(png) });
    }
    p += len;
  }
  return { icons };
}
