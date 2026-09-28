// The geometry layer. Every turn table in this repo is *derived* here, from 3x3 integer
// rotation matrices acting on the eight corner slots of a 2x2x2 cube.
//
// Why this file exists at all: a hand-copied corner table would make the printed `par`
// a claim about whoever typed the table. So instead the repo asks geometry two questions
// and takes the answer as ground truth:
//
//   1. where does a slot go under a 90-degree turn of a face?  -> the slot map
//   2. which sticker of the corner that lands here now points at the U/D axis?
//                                                          -> the twist delta
//
// A "clockwise" face turn is by definition the rotation that *looks* clockwise from
// outside that face, i.e. a right-handed rotation about the outward normal by -90 deg.
// That single convention fixes U, D, R, L, F, B and their inverses; nothing is memorised.
//
// Pure module: no window, no DOM, importable by `node --test`.

export const SLOT_COORD = [];
for (let i = 0; i < 8; i++) {
  SLOT_COORD.push([(i & 1) ? 1 : -1, (i & 2) ? 1 : -1, (i & 4) ? 1 : -1]);
}

// Axis index of a slot's coordinate: 0 = x (L/R), 1 = y (D/U), 2 = z (B/F).
export const AXIS_LABEL = ['x', 'y', 'z'];

// A corner's home sticker list, in a fixed order: index 1 is always the U/D sticker,
// which is the reference used to define twist.
export function homeStickers(slot) {
  const [sx, sy, sz] = SLOT_COORD[slot];
  return [[sx, 0, 0], [0, sy, 0], [0, 0, sz]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// Exported for js/view.js: the gesture maths is the same cross/dot as the table derivation,
// and a second private copy of it in the view is how sign bugs are born.
export { cross, dot, sameVec, applyMat };

function slotOf(coord) {
  return (coord[0] > 0 ? 1 : 0) | (coord[1] > 0 ? 2 : 0) | (coord[2] > 0 ? 4 : 0);
}

function applyMat(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

// Right-handed rotation by quarter * 90 degrees about the unit axis `u` (a signed basis
// vector), as an integer matrix: R(v) = q*(u x v) + u*(u . v), which is Rodrigues' formula
// with cos = 0 and sin = q.
export function rotationMatrix(u, quarter) {
  const rows = [];
  for (let i = 0; i < 3; i++) {
    const row = [];
    for (let j = 0; j < 3; j++) {
      const e = [j === 0 ? 1 : 0, j === 1 ? 1 : 0, j === 2 ? 1 : 0];
      const c = cross(u, e);
      row.push(quarter * c[i] + u[i] * dot(u, e));
    }
    rows.push(row);
  }
  return rows;
}

// The three sticker directions of a slot, listed in the order a right-handed 120-degree
// turn about the slot's outward diagonal carries them (a -> b -> c -> a). That order is
// what makes "one twist" mean the same thing at all eight corners, and it is what makes
// the twist bookkeeping additive: a rotation either preserves this order or reverses it,
// and it preserves it exactly when the corner's stickers are right-handed about its own
// diagonal. Whether they are is one scalar: (dx x dy) . diagonal = sx*sy*sz.
function twistCycle(slot) {
  const [sx, sy, sz] = SLOT_COORD[slot];
  const dx = [sx, 0, 0];
  const dy = [0, sy, 0];
  const dz = [0, 0, sz];
  return sx * sy * sz > 0 ? [dx, dy, dz] : [dx, dz, dy];
}

function sameVec(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

// Twist of the corner sitting in `slot` whose reference (U/D) sticker currently points
// along `ref`: the number of right-handed 120-degree twists about this slot's outward
// diagonal that brings `ref` onto the U/D axis. 0 means "already home".
//
// The sign choice here is free — negating every twist leaves "sum == 0 (mod 3)" alone —
// so it is fixed by geometry rather than by taste, and tools/proof.mjs re-checks that the
// twelve move tables really do preserve the sum.
export function twistOf(slot, ref) {
  const cycle = twistCycle(slot);
  const sy = SLOT_COORD[slot][1];
  let at = -1;
  let home = -1;
  for (let i = 0; i < 3; i++) {
    if (cycle[i][1] === sy) home = i; // the slot's own U/D sticker: where twist 0 puts the reference
    if (sameVec(cycle[i], ref)) at = i;
  }
  if (at < 0) throw new Error(`twistOf: ${JSON.stringify(ref)} is not a sticker of slot ${slot}`);
  return (home - at + 3) % 3;
}

const FACES = [
  { name: 'U', normal: [0, 1, 0] },
  { name: 'D', normal: [0, -1, 0] },
  { name: 'R', normal: [1, 0, 0] },
  { name: 'L', normal: [-1, 0, 0] },
  { name: 'F', normal: [0, 0, 1] },
  { name: 'B', normal: [0, 0, -1] },
];

export { FACES };

// MOVES: the twelve quarter turns, i.e. the whole move alphabet of the quarter-turn metric
// (QTM). Ordering is per face, clockwise first, so `inv` is just `i ^ 1`.
//
//   to[slot]   slot -> slot the corner travels to
//   from[t]    t    -> the slot that feeds t          (inverse of `to`)
//   delta[t]   twist added to the corner arriving at t (read off the geometry, see above)
export const MOVES = (() => {
  const out = [];
  for (let f = 0; f < FACES.length; f++) {
    const face = FACES[f];
    for (let k = 0; k < 2; k++) {
      const dir = k === 0 ? 1 : -1; // 1 = clockwise seen from outside
      const m = rotationMatrix(face.normal, dir === 1 ? -1 : 1);
      const to = [0, 1, 2, 3, 4, 5, 6, 7];
      const from = [0, 1, 2, 3, 4, 5, 6, 7];
      const delta = [0, 0, 0, 0, 0, 0, 0, 0];
      const layer = [];
      for (let s = 0; s < 8; s++) {
        if (dot(face.normal, SLOT_COORD[s]) <= 0) continue;
        const t = slotOf(applyMat(m, SLOT_COORD[s]));
        to[s] = t;
        from[t] = s;
        layer.push(s);
      }
      for (let t = 0; t < 8; t++) {
        const s = from[t];
        if (to[s] !== t) throw new Error('move is not a bijection on slots');
        if (dot(face.normal, SLOT_COORD[s]) <= 0) continue; // a slot this turn does not touch
        const ref = applyMat(m, [0, SLOT_COORD[s][1], 0]); // where this corner's U/D sticker went
        delta[t] = twistOf(t, ref);
      }
      // The four (source slot -> target slot, twist added) pairs, as a flat list: the
      // searchers rewrite exactly these twelve numbers per node and nothing else.
      const edges = layer.map((s) => [s, to[s], delta[to[s]]]);
      out.push({
        name: dir === 1 ? face.name : `${face.name}'`,
        face: face.name,
        dir,
        axis: face.normal[0] ? 0 : face.normal[1] ? 1 : 2,
        sign: face.normal[0] || face.normal[1] || face.normal[2],
        normal: face.normal.slice(),
        matrix: m,
        layer: layer.map((s) => to[s]),
        edges,
        to,
        from,
        delta,
        inv: (out.length & 1) ? out.length - 1 : out.length + 1,
      });
    }
  }
  return out;
})();

export const MOVE_COUNT = MOVES.length;

export function moveByName(name) {
  for (let i = 0; i < MOVES.length; i++) if (MOVES[i].name === name) return i;
  return -1;
}

// ---- the independent physical model -------------------------------------------------
//
// A state here is a *cube*, not an encoding: per slot it holds a piece and the current
// direction of that piece's three home stickers. Nothing in this section reads the tables
// above, so the agreement test between the two is a real cross-check and not a tautology.

export function physicalSolved() {
  const slots = [];
  for (let s = 0; s < 8; s++) slots.push({ piece: s, dirs: homeStickers(s) });
  return { slots, turns: 0 };
}

export function physicalTurn(phys, moveIndex) {
  const m = MOVES[moveIndex];
  const next = phys.slots.map((s) => ({ piece: s.piece, dirs: s.dirs.map((d) => d.slice()) }));
  for (let s = 0; s < 8; s++) {
    if (dot(m.normal, SLOT_COORD[s]) <= 0) continue;
    const t = m.to[s];
    next[t] = { piece: phys.slots[s].piece, dirs: phys.slots[s].dirs.map((d) => applyMat(m.matrix, d)) };
  }
  return { slots: next, turns: phys.turns + 1 };
}

// Read the abstract (perm, twist) pair off a physical configuration.
export function project(phys) {
  const perm = [0, 1, 2, 3, 4, 5, 6, 7];
  const twist = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let s = 0; s < 8; s++) {
    perm[s] = phys.slots[s].piece;
    twist[s] = twistOf(s, phys.slots[s].dirs[1]); // dirs[1] is the U/D sticker of the piece
  }
  return { perm, twist };
}

// ---- which colour sits where ---------------------------------------------------------
//
// The view has to paint a sticker, and a sticker is a *face of the original cube* that now
// points somewhere. (perm, twist) says which corner is in which slot and how far it is
// turned, so the remaining question is only "which of this corner's three home faces points
// along this slot's x / y / z". That is answered here, from the same twist cycles that define
// the twist, and nowhere else in the repo.
//
// The argument: twistCycle(p) and twistCycle(s) are both "the order a right-handed 120-degree
// turn about the outward diagonal carries the three stickers". A proper rotation preserves
// that cyclic order, so the map from the corner's home cycle to the slot's cycle is a shift,
// no reflection — and the twist is exactly the amount the reference (U/D) sticker is off,
// which pins the shift down. Verified in test/geom.test.mjs two ways: the solved cube maps
// every sticker to its own face, and the physical model above agrees on random cubes.
export function stickerDirections(piece, slot, twist) {
  const cp = twistCycle(piece);
  const cs = twistCycle(slot);
  let iyPiece = -1;
  let iySlot = -1;
  for (let j = 0; j < 3; j++) {
    if (cp[j][1] !== 0) iyPiece = j;
    if (cs[j][1] !== 0) iySlot = j;
  }
  // twistOf(slot, ref) = (iySlot - at + 3) % 3, so the U/D sticker of `piece` sits at index
  // (iySlot - twist) mod 3 of the slot's cycle; the rest follow with the same offset.
  const shift = (((iySlot - twist) % 3) + 3 - iyPiece) % 3;
  const out = [];
  for (let j = 0; j < 3; j++) {
    const home = cp[j];
    out.push({
      dir: cs[(j + shift) % 3],
      face: home[0] !== 0 ? (home[0] > 0 ? 'R' : 'L')
        : home[1] !== 0 ? (home[1] > 0 ? 'U' : 'D')
          : (home[2] > 0 ? 'F' : 'B'),
    });
  }
  return out;
}

// Per slot, the three stickers that sit on it: {dir, face}. The face labels of a whole cube
// are always four of each — a turn permutes them, it never creates one — and that invariant
// is checked in the tests, independently of everything else in this file.
export function stickersOf(state) {
  const out = [];
  for (let s = 0; s < 8; s++) out.push(stickerDirections(state.perm[s], s, state.twist[s]));
  return out;
}

export function stickerCensus(state) {
  const census = { U: 0, D: 0, R: 0, L: 0, F: 0, B: 0 };
  for (const st of stickersOf(state)) for (const k of st) census[k.face]++;
  return census;
}

// The clockwise turn whose outward normal is `normal`, i.e. the one-finger answer to "which
// face am I looking at". -1 when `normal` is not a face normal.
export function cwTurnOf(normal) {
  for (let i = 0; i < MOVES.length; i += 2) {
    if (sameVec(MOVES[i].normal, normal)) return i;
  }
  return -1;
}

// The four slot positions that physically travel under a turn — the *starting* positions,
// which is what an animation needs; MOVES[i].layer holds the destinations.
export function movingSlots(move) {
  const m = MOVES[move];
  const out = [];
  for (let s = 0; s < 8; s++) if (m.to[s] !== s) out.push(s);
  return out;
}
