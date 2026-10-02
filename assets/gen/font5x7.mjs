// A 5x7 bitmap font, so the social card can carry words without the generator depending on a
// font file, Pillow, or a browser. Coverage is what the wordmarks actually need: A-Z, 0-9 and a
// few punctuation marks. Lowercase folds to uppercase.
//
// Every glyph is spelled out as seven rows of five characters rather than packed into one string,
// because a packed row that is one cell short shifts the whole letter sideways and a shifted "O"
// on a shipped social card is exactly the kind of defect a generator with no eyeballs makes.

import { fillRect } from './png.mjs';

const D = '.....';
const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#####', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', D, D, D],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '....#', '....#'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': [D, D, D, D, D, D, D],
  '-': [D, D, D, '#####', D, D, D],
  '.': [D, D, D, D, D, '..#..', '..#..'],
  ',': [D, D, D, D, '..#..', '..#..', '.#...'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', D],
  ':': [D, '..#..', '..#..', D, '..#..', '..#..', D],
  "'": ['..#..', '..#..', D, D, D, D, D],
};

export const GLYPH_KEYS = Object.keys(GLYPHS);

export function hasGlyph(ch) {
  return ch === ' ' || GLYPHS[ch.toUpperCase()] !== undefined;
}

// Rows whose run lengths disagree would render a lopsided letter, so the table is validated at
// load rather than silently producing a bad PNG.
for (const [k, rows] of Object.entries(GLYPHS)) {
  if (rows.length !== 7 || rows.some((r) => r.length !== 5 || /[^.#]/.test(r))) {
    throw new Error(`glyph ${JSON.stringify(k)} is malformed`);
  }
}

// `cell` is the size of one font pixel in image pixels; returns the advance width.
export function drawText(cv, x, y, text, cell, color, tracking = 1) {
  let cx = x;
  for (const ch of String(text)) {
    if (ch === ' ') {
      cx += cell * 3 + cell * tracking;
      continue;
    }
    const rows = GLYPHS[ch.toUpperCase()];
    if (!rows) {
      cx += cell * 6;
      continue;
    }
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (rows[r][c] === '#') fillRect(cv, cx + c * cell, y + r * cell, cell, cell, color, 1);
      }
    }
    cx += cell * (5 + tracking);
  }
  return cx - x;
}

export function textWidth(text, cell, tracking = 1) {
  let w = 0;
  for (const ch of String(text)) w += ch === ' ' ? cell * 4 : cell * (5 + tracking);
  return Math.max(0, w - cell * tracking);
}
