// Pattern database: the exact quarter-turn distance from the solved cube to every
// arrangement of *five of the eight* corners, ignoring the other three entirely.
//
// Why it exists: the spec's IDA* heuristic is "for each corner, the number of turns that
// corner itself needs" plus "how much twist is still missing", both of which top out at 3
// and 4 (measured in tools/proof.mjs — the twist bound needs four turns per unit of twist,
// so a deficit of 2 still only forces 1). Against a true par of 11..13 that heuristic is
// decoration: IDA* wanders. A pattern database is the standard cure, and five corners is
// the largest subset whose abstract space (P(8,5) * 3^5 = 1,632,960) still fits in 1.6 MB.
//
// Why it is honest: the abstraction tracks *named corners*, not named slots, so a turn
// acts on it as a plain function — the corner at slot s goes to MOVES[m].to[s] and picks up
// MOVES[m].delta[to[s]], and the three forgotten corners cannot make that ambiguous. A
// projection with that property is a graph homomorphism, which gives the two facts IDA*
// needs for free:
//
//   admissible   every real turn is also a legal abstract turn, so the abstract distance
//                can only be <= the real one
//   consistent   h(x) <= 1 + h(move(x)) because the abstract BFS distance already is a
//                shortest-path length in the abstract graph
//
// Both are re-checked against the move tables in tools/proof.mjs, over the whole abstract
// space rather than a sample, so nothing here rests on my argument above.
//
// The number is not in the literature this repo copies from: it is computed at build time
// from js/core/geom.js, so a change to the geometry changes it.
//
// Pure module: no window, no DOM. Build-time and test-time only — js/main.js never imports
// it, because the browser must not search.

import { MOVES } from './geom.js';

// Tracked corners. Any five work; 0..4 is the U layer in this repo's slot numbering, which
// makes the printed examples easy to read.
export const PDB_CORNERS = [0, 1, 2, 3, 4];
const N = PDB_CORNERS.length;

const SLOT_PERM_COUNT = 6720; // P(8,5): ordered choices of 5 distinct slots out of 8
const TRIT_CODE_COUNT = 243; // 3^5
export const PDB_SIZE = SLOT_PERM_COUNT * TRIT_CODE_COUNT; // 1,632,960

// Falling-factorial weights of a 5-digit Lehmer code over 8 slots.
const W = [840, 120, 20, 4, 1];
const POW3 = [1, 3, 9, 27, 81];

// Where slot s travels under move m, and the twist picked up on arrival. `to` is the
// identity outside the turned layer and `delta` is 0 outside it, so both are total.
const SLOT_TO = MOVES.map((m) => m.to);
const SLOT_DT = MOVES.map((m) => m.delta);

// slots[0..4] -> index, the five entries distinct by construction.
function rankSlots(slots) {
  let rank = 0;
  for (let i = 0; i < N; i++) {
    let lesser = 0;
    for (let j = 0; j < i; j++) if (slots[j] < slots[i]) lesser++;
    rank += (slots[i] - lesser) * W[i];
  }
  return rank;
}

// index -> slots, the inverse of rankSlots.
function unrankSlots(rank, slots) {
  const used = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // 8 slots, 1 = already taken
  let r = rank;
  for (let i = 0; i < N; i++) {
    const f = W[i];
    const digit = Math.floor(r / f);
    r -= digit * f;
    let need = digit;
    let s = 0;
    for (;;) {
      if (!used[s]) {
        if (need === 0) break;
        need--;
      }
      s++;
    }
    used[s] = 1;
    slots[i] = s;
  }
  return slots;
}

function tritCode(trits) {
  return trits[0] + trits[1] * 3 + trits[2] * 9 + trits[3] * 27 + trits[4] * 81;
}

function untritCode(code, trits) {
  let t = code;
  for (let i = 0; i < N; i++) {
    trits[i] = t % 3;
    t = (t - trits[i]) / 3;
  }
  return trits;
}

export function abstractIndex(slots, trits) {
  return rankSlots(slots) * TRIT_CODE_COUNT + tritCode(trits);
}

// The database itself: dist[i] is the exact QTM length that brings the five tracked corners
// from the solved arrangement to abstract state i, or 255 if no turn sequence can (none
// can't — every abstract state here is reachable, which tools/proof.mjs also checks).
let DB = null;
let DB_BUILT_MS = 0;
let DB_NODES = 0;

export function buildPdb() {
  if (DB) return DB;
  const t0 = Date.now();
  const dist = new Uint8Array(PDB_SIZE).fill(255);
  const slots = [0, 0, 0, 0, 0];
  const trits = [0, 0, 0, 0, 0];
  const ns = [0, 0, 0, 0, 0];
  dist[0] = 0; // tracked corner k home in slot k, no twist: rankSlots([0,1,2,3,4]) === 0
  let frontier = new Int32Array([0]);
  let depth = 0;
  let count = 1;
  for (;;) {
    const next = [];
    for (let q = 0; q < frontier.length; q++) {
      const idx = frontier[q];
      unrankSlots(Math.floor(idx / TRIT_CODE_COUNT), slots);
      untritCode(idx % TRIT_CODE_COUNT, trits);
      const d = dist[idx] + 1;
      for (let m = 0; m < 12; m++) {
        const st = SLOT_TO[m];
        const dt = SLOT_DT[m];
        let code = 0;
        for (let k = 0; k < N; k++) {
          const t = st[slots[k]];
          ns[k] = t;
          code += ((trits[k] + dt[t]) % 3) * POW3[k];
        }
        const ni = rankSlots(ns) * TRIT_CODE_COUNT + code;
        if (dist[ni] === 255) {
          dist[ni] = d;
          count++;
          next.push(ni);
        }
      }
    }
    if (!next.length) break;
    frontier = Int32Array.from(next);
    depth++;
    if (depth > 30) break; // time discipline: the abstract diameter is far below this
  }
  DB = dist;
  DB_BUILT_MS = Date.now() - t0;
  DB_NODES = count;
  return DB;
}

export function pdbBuildStats() {
  buildPdb();
  return { ms: DB_BUILT_MS, filled: DB_NODES, size: PDB_SIZE };
}

// h(x) for a concrete state. Returns 255 for anything that is not a cube at all; a state
// whose twist sum breaks the invariant is fine here — the pattern cannot see the invariant
// and simply reports what the tracked corners need.
const SLOT_OF = [-1, -1, -1, -1, -1];
const TRIT_OF = [0, 0, 0, 0, 0];

// The array form, for IDA*, which keeps perm and twist live and must not allocate per node.
// Single-threaded by construction: the scratch is filled, used and dropped inside one call.
export function patternDistance(perm, twist) {
  const dist = buildPdb();
  for (let k = 0; k < N; k++) {
    SLOT_OF[k] = -1;
    TRIT_OF[k] = 0;
  }
  for (let s = 0; s < 8; s++) {
    const c = perm[s];
    if (c < N) {
      SLOT_OF[c] = s;
      TRIT_OF[c] = twist[s];
    }
  }
  return dist[abstractIndex(SLOT_OF, TRIT_OF)];
}

export function pdbDistance(state) {
  return patternDistance(state.perm, state.twist);
}

// Max value actually attained, i.e. the pattern's own diameter — measured, not assumed,
// because the printed bound has to be the one the data supports.
export function pdbDiameter() {
  const dist = buildPdb();
  let max = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] > max) max = dist[i];
  return max;
}

export { POW3 as PDB_POW3 };
