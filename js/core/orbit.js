// The quotient BFS: the exact distance of every reachable cube *up to whole-cube rotation*,
// computed once at build time. Two jobs, neither of which js/core/fullsweep.js does: this is the
// cheap one (a third of a second, 3.67 MB instead of eight seconds and 84 MB), and the number it
// returns is a provably admissible lower bound on a real par, which is what makes it useful to a
// searcher. It is deliberately NOT the source of a shipped par: identifying the 24 rotations of a
// cube is a different equivalence relation from this game's win condition, which charges for
// re-aiming the cube. See the header of js/core/fullsweep.js.
//
// Why a sweep exists next to js/core/bfs.js and js/core/ida.js: both of those answer one state
// per call, so neither can be asked "how many states are there" or "is the printed 11 really
// the worst case". A breadth-first sweep can, and the sweep is cheap once the space is indexed
// densely — provided the space is small enough to index at all. The whole group is
// 8! * 3^7 = 88,179,840 states, which is not.
//
// The trick that makes it fit: a whole-cube rotation is not a move (see the metric note in
// js/core/cube.js), it is a symmetry. It maps the cube group onto itself, it fixes the solved
// cube, and it carries the twelve quarter turns into each other — so it is an isometry of the
// Cayley graph that preserves distance *from solved*, so all 24 members of a rotation orbit
// share one quotient distance. 88,179,840 / 24 = 3,674,160 orbits, and the division is exact
// because the action is free: a non-identity rotation moves corner 0 somewhere else. That shared
// number is a *lower bound* on this game's par, and equal to it unless a shortest route
// happens to finish facing a different way than cube.isSolved wants: measured on 20,000 uniform
// cubes the two models disagree on 12 of them (0.06%), always in this direction, worst gap 2
// turns. test/orbit.test.mjs asserts all three facts against js/core/fullsweep.js.
//
// One member of each orbit is canonical: the one with corner 0 in slot 0, untwisted. The search
// runs over 3,674,160 cells of a Uint8Array keyed by
//
//   index = lehmerRank(perm) * 729 + tritCode(twist[1..6])
//
// with perm[0] === 0 and twist[0] === 0 — the eighth trit being the one the invariant pins down
// — a dense bijection onto [0, 7! * 3^6).
//
// The neighbour map is then a pair of lookup tables, and the reason it splits that way is worth
// spelling out, because it is the one place a shortcut could quietly corrupt every number:
// starting from a *canonical* state, a turn g leaves corner 0 in slot g.to[0] with twist
// g.delta[g.to[0]] — two numbers that depend on g alone and never on the rest of the cube. So
// the rotation that restores canonicity is a function of the move, the composition is again
// "permute the slots, add these trits", and that separates into a permutation-only table and a
// twist-only table:
//
//   PT[g][rank]  canonicalised permutation, over the 5,040 with corner 0 home
//   TT[g][code]  canonicalised trits,            over the 729 with corner 0 flat
//
// Metric: this file answers for the alphabet it is handed. QTM (twelve quarter turns) is the
// game's metric and its measured quotient diameter is 14; adding the six half turns gives HTM,
// whose quotient diameter is 11. Both match the published values, which is the cross-check this
// file is for; the numbers this repo prints as par come from js/core/fullsweep.js.
// All of it is asserted in test/orbit.test.mjs against hard-coded expectations.
//
// Pure module: no window, no DOM. Build-time and test-time only — js/main.js does not import it,
// because the browser must not search.

import { MOVES, permRank, permUnrank, validate } from './cube.js';
import { SLOT_COORD, twistOf } from './geom.js';

export const PERM_HOME_COUNT = 5040; // 7!, permutations with corner 0 in slot 0
export const TRIT_FREE_COUNT = 729; // 3^6, twist vectors with corner 0 flat
export const ORBIT_COUNT = PERM_HOME_COUNT * TRIT_FREE_COUNT; // 3,674,160 = 8! * 3^7 / 24

// ---- transforms ------------------------------------------------------------------------
//
// The common shape of everything that moves a cube: a face turn, a whole-cube rotation and a
// composition of both all act as
//
//   new.perm[t]  = old.perm[from[t]]
//   new.twist[t] = (old.twist[from[t]] + delta[t]) % 3
//
// which is exactly what js/core/geom.js derives for the twelve turns, so nothing is re-derived
// loosely here.

function applyTransform(state, tr) {
  const perm = [0, 0, 0, 0, 0, 0, 0, 0];
  const twist = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let t = 0; t < 8; t++) {
    const s = tr.from[t];
    perm[t] = state.perm[s];
    twist[t] = (state.twist[s] + tr.delta[t]) % 3;
  }
  return { perm, twist };
}

// `a after b`: b is applied first, then a.
function compose(a, b) {
  const from = [0, 0, 0, 0, 0, 0, 0, 0];
  const delta = [0, 0, 0, 0, 0, 0, 0, 0];
  const to = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let t = 0; t < 8; t++) {
    from[t] = b.from[a.from[t]];
    delta[t] = (a.delta[t] + b.delta[a.from[t]]) % 3;
  }
  for (let s = 0; s < 8; s++) to[s] = a.to[b.to[s]];
  return { from, delta, to, name: `${a.name || 'rot'}∘${b.name || 'move'}` };
}

const slotOfCoord = (v) => (v[0] > 0 ? 1 : 0) | (v[1] > 0 ? 2 : 0) | (v[2] > 0 ? 4 : 0);

// The 24 whole-cube rotations, derived rather than copied: every 3x3 signed permutation matrix
// with determinant +1 is a rotation of the cube, and there are exactly 24 of them. For each, the
// slot map is the matrix acting on the eight corner coordinates and the twist delta is
// js/core/geom.js twistOf read at the arrival slot — the identical derivation MOVES went
// through, with all eight slots in the layer instead of four.
export const ROTATIONS = (() => {
  const axisPerms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const basis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const out = [];
  for (const p of axisPerms) {
    for (let signCode = 0; signCode < 8; signCode++) {
      const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let j = 0; j < 3; j++) {
        const s = signCode & (1 << j) ? -1 : 1;
        for (let i = 0; i < 3; i++) m[i][j] = s * basis[p[j]][i];
      }
      const det =
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
        m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
        m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      if (det !== 1) continue; // the other 24 are reflections, and a cube cannot be moved into one
      const from = [0, 0, 0, 0, 0, 0, 0, 0];
      const delta = [0, 0, 0, 0, 0, 0, 0, 0];
      const to = [0, 0, 0, 0, 0, 0, 0, 0];
      for (let s = 0; s < 8; s++) {
        const c = SLOT_COORD[s];
        const v = [
          m[0][0] * c[0] + m[0][1] * c[1] + m[0][2] * c[2],
          m[1][0] * c[0] + m[1][1] * c[1] + m[1][2] * c[2],
          m[2][0] * c[0] + m[2][1] * c[1] + m[2][2] * c[2],
        ];
        const t = slotOfCoord(v);
        to[s] = t;
        from[t] = s;
        // where the U/D sticker of an untilted corner in s went, read at the corner it arrives at
        delta[t] = twistOf(t, [m[0][1] * c[1], m[1][1] * c[1], m[2][1] * c[1]]);
      }
      out.push({ from, delta, to, matrix: m, name: `rot${out.length}` });
    }
  }
  return out;
})();

// CANON[s][v]: the rotation that brings a corner sitting in slot s with twist v back to
// slot 0, untwisted. Well defined because the stabiliser of a slot has three elements and they
// add 0, 1 and 2 at the destination respectively, so exactly one of the 24 clears any v.
const CANON = (() => {
  const table = [];
  for (let s = 0; s < 8; s++) {
    table.push([null, null, null]);
    for (let v = 0; v < 3; v++) {
      const hit = ROTATIONS.filter((r) => r.to[s] === 0 && (v + r.delta[0]) % 3 === 0);
      if (hit.length !== 1) {
        throw new Error(`orbit.js: ${hit.length} rotations canonise corner 0 at slot ${s} twist ${v}`);
      }
      table[s][v] = hit[0];
    }
  }
  return table;
})();

// ---- alphabets -------------------------------------------------------------------------
//
// QTM: the twelve quarter turns, straight out of geom.js. HTM: the same twelve plus the six
// half turns, each half turn being the quarter turn composed with itself — derived, so the
// cross-metric check compares two alphabets over one geometry.
export const QTM_ALPHABET = MOVES.map((m, i) => ({ ...m, slot: i, label: m.name }));
export const HTM_ALPHABET = (() => {
  const out = QTM_ALPHABET.map((m) => ({ ...m }));
  for (let i = 0; i < MOVES.length; i += 2) {
    const twice = compose(MOVES[i], MOVES[i]);
    out.push({ ...twice, slot: i, label: `${MOVES[i].face}2`, half: true });
  }
  return out;
})();

export function alphabetOf(metric) {
  if (metric === 'HTM') return HTM_ALPHABET;
  if (metric === 'QTM') return QTM_ALPHABET;
  throw new Error(`unknown metric ${metric}`);
}

// ---- canonical form --------------------------------------------------------------------

// A state as it stands -> the canonical member of its rotation orbit. Going the other way is
// free: the identity is a rotation, so canonical(s) = s whenever s is already canonical.
function canon(state) {
  const at = state.perm.indexOf(0);
  if (at < 0) throw new Error('orbit.js: perm has no corner 0');
  const out = applyTransform(state, CANON[at][state.twist[at] % 3]);
  if (out.perm[0] !== 0 || out.twist[0] !== 0) throw new Error('orbit.js: canon() did not fix corner 0');
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += out.twist[i];
  if (sum % 3 !== 0) throw new Error('orbit.js: canon() broke the twist invariant');
  return out;
}

function tritCode6(twist) {
  let code = 0;
  let w = 1;
  for (let i = 1; i <= 6; i++) {
    code += twist[i] * w;
    w *= 3;
  }
  return code;
}

function tritOf6(code, twist) {
  let t = code;
  twist[0] = 0;
  for (let i = 1; i <= 6; i++) {
    twist[i] = t % 3;
    t = (t - twist[i]) / 3;
  }
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += twist[i];
  twist[7] = (3 - (sum % 3)) % 3;
  return twist;
}

function canonicalIndexOf(state) {
  return permRank(state.perm) * TRIT_FREE_COUNT + tritCode6(state.twist);
}

// The canonicalised version of one generator: the generator followed by the rotation that puts
// corner 0 back home. A function of the generator alone — see the header.
function canonStep(g) {
  return compose(CANON[g.to[0]][g.delta[g.to[0]] % 3], g);
}

function buildTables(metric) {
  const alphabet = alphabetOf(metric);
  const steps = alphabet.map(canonStep);
  const PT = [];
  const TT = [];
  const identity = { perm: [0, 1, 2, 3, 4, 5, 6, 7], twist: [0, 0, 0, 0, 0, 0, 0, 0] };
  const scratch = [0, 0, 0, 0, 0, 0, 0, 0];
  const twist = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const step of steps) {
    // corner 0 really is home and flat after a canonicalised step, for an untilted cube...
    const probe = applyTransform(identity, step);
    if (probe.perm[0] !== 0 || probe.twist[0] !== 0) {
      throw new Error('orbit.js: a canonicalised step does not fix corner 0');
    }
    // ...and the permutation part is checked against the physical rotation for every one of the
    // 5,040 slice members, not just sampled.
    const pt = new Int32Array(PERM_HOME_COUNT);
    for (let rank = 0; rank < PERM_HOME_COUNT; rank++) {
      const perm = permUnrank(rank);
      if (perm[0] !== 0) throw new Error('orbit.js: a rank below 7! should hold corner 0 home');
      for (let t = 0; t < 8; t++) scratch[t] = perm[step.from[t]];
      const c = canon({ perm: scratch, twist: identity.twist });
      const r = permRank(c.perm);
      if (c.perm[0] !== 0 || r >= PERM_HOME_COUNT) throw new Error('orbit.js: the permutation table escaped the slice');
      pt[rank] = r;
    }
    const tt = new Int32Array(TRIT_FREE_COUNT);
    for (let code = 0; code < TRIT_FREE_COUNT; code++) {
      const src = { perm: identity.perm, twist: tritOf6(code, twist) };
      const after = applyTransform(src, step);
      if (after.perm[0] !== 0) throw new Error('orbit.js: the twist table moved corner 0');
      if (after.twist[0] !== 0) throw new Error('orbit.js: the twist table left corner 0 twisted');
      let sum = 0;
      for (let i = 0; i < 8; i++) sum += after.twist[i];
      if (sum % 3 !== 0) throw new Error('orbit.js: the twist table broke the invariant');
      tt[code] = tritCode6(after.twist);
    }
    PT.push(pt);
    TT.push(tt);
  }
  return { PT, TT, alphabet, steps };
}

// ---- the sweep -------------------------------------------------------------------------

const CACHE = new Map();

// buildOrbitTable({ metric, nodeCap, deadlineMs, onLevel, force }) ->
//   { dist, filled, diameter, hist, antipodes, ms, metric, alphabet, truncated }
//
// `nodeCap` and `deadlineMs` are hard stops and hitting one is reported rather than papered
// over: a partial table answers orbitDistance with -1 for whatever it never reached, so a caller
// cannot mistake "not searched" for "very far". `onLevel` fires once per depth with the running
// counts, which is what lets tools/bake.mjs print progress on a sweep it does not want to rerun
// when it dies.
export function buildOrbitTable(opts = {}) {
  const metric = opts.metric || 'QTM';
  if (!opts.force && CACHE.has(metric)) return CACHE.get(metric);
  const t0 = Date.now();
  const { PT, TT, alphabet } = buildTables(metric);
  const tableMs = Date.now() - t0;
  const dist = new Uint8Array(ORBIT_COUNT).fill(255);
  dist[0] = 0;
  const nodeCap = opts.nodeCap || Number.MAX_SAFE_INTEGER;
  const deadline = opts.deadlineMs ? Date.now() + opts.deadlineMs : 0;
  let level = new Int32Array(1); // index 0: the solved cube
  let filled = 1;
  let diameter = 0;
  const hist = [1];
  let truncated = false;
  for (;;) {
    if (filled > nodeCap || (deadline && Date.now() > deadline)) {
      truncated = true;
      break;
    }
    // Every node found this level is unvisited at the start of it, and each of the `alphabet`
    // generators can reveal at most one, so `cap` is a bound rather than a guess: the frontier
    // can never overflow and silently drop states, which would quietly lose their descendants.
    const cap = Math.min(ORBIT_COUNT - filled, level.length * alphabet.length);
    const next = new Int32Array(Math.max(1, cap));
    let n = 0;
    const d = diameter + 1;
    for (let q = 0; q < level.length; q++) {
      const key = level[q];
      const pr = Math.floor(key / TRIT_FREE_COUNT);
      const tc = key % TRIT_FREE_COUNT;
      for (let a = 0; a < alphabet.length; a++) {
        const nk = PT[a][pr] * TRIT_FREE_COUNT + TT[a][tc];
        if (dist[nk] !== 255) continue;
        dist[nk] = d;
        if (n >= next.length) throw new Error('orbit.js: frontier bound broken');
        next[n++] = nk;
        filled++;
      }
    }
    if (!n) {
      if (filled < ORBIT_COUNT) truncated = true; // the frontier died early: never silently "done"
      break;
    }
    diameter = d;
    hist[d] = n;
    if (typeof opts.onLevel === 'function') opts.onLevel({ depth: d, found: n, filled, ms: Date.now() - t0 });
    level = n === next.length ? next : next.slice(0, n);
    if (diameter > 40) throw new Error('orbit.js: level cap exceeded, the sweep is not terminating');
  }
  const table = {
    metric,
    alphabet: alphabet.length,
    dist,
    filled,
    diameter,
    hist,
    antipodes: hist[diameter] || 0,
    ms: Date.now() - t0,
    tableMs,
    truncated,
    bytes: dist.byteLength,
  };
  if (!truncated) CACHE.set(metric, table);
  return table;
}
// The exact par of a cube: one lookup. -1 for a description that is not a cube at all, for one
// the twist invariant forbids, and for one a capped sweep never reached.
export function orbitDistance(state, metric = 'QTM') {
  if (validate(state)) return -1;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += state.twist[i];
  if (sum % 3 !== 0) return -1;
  const idx = canonicalIndexOf(canon(state));
  const d = buildOrbitTable({ metric }).dist[idx];
  return d === 255 ? -1 : d;
}

// There is deliberately no route reader here. Walking this table downhill produces a sequence
// that ends at *some* rotation of the solved cube — correct under the literature's convention,
// wrong under this game's, and the two differ by up to six turns. js/core/fullsweep.js
// routeFromTable() is the one that ends on cube.isSolved.

export function orbitStats(metric = 'QTM') {
  const t = buildOrbitTable({ metric });
  return {
    metric,
    alphabet: t.alphabet,
    states: t.filled,
    orbits: ORBIT_COUNT,
    diameter: t.diameter,
    antipodes: t.antipodes,
    hist: t.hist.slice(),
    ms: t.ms,
    tableMs: t.tableMs,
    bytes: t.bytes,
    truncated: t.truncated,
  };
}

export { applyTransform, compose, canon, canonicalIndexOf, canonStep };
