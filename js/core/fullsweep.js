// The exhaustive sweep of the *whole* group: 8! x 3^7 = 88,179,840 cubes, one byte each, and
// the exact distance of every one of them from the solved cube. This is the only thing in the
// repo that can hand out a shipped `par` without a search, and the only run whose output has to
// be taken on trust from a single build.
//
// Why the quotient table in js/core/orbit.js is not enough, which is a measured objection and
// not a taste: that table answers "how few turns would this take if a final whole-cube
// reorientation were free", because it identifies the 24 rotations of a cube. This game's win
// condition is not free: js/core/cube.js isSolved() wants the reference orientation, and aiming
// the cube back at it costs turns. The quotient number is therefore a *lower bound* on the
// shipped par — measured on 20,000 uniform cubes it is below the true par on 12 of them (0.06%),
// never above, with a worst gap of 2 turns. A par printed on screen has to be the true one, so
// the sweep runs over the full 88M and the quotient sweep keeps its own job: an admissible
// heuristic, and a second indexing of the same geometry.
//
// The full sweep is also the external anchor. Published counts for the 2x2x2 are tabulated per
// distance over exactly this 88,179,840-position model — Korf's half-turn distribution and Jow's
// quarter-turn distribution — so the histogram below can be compared line by line with numbers
// this repo did not write. It is, in test/fullsweep.test.mjs, and it matches: QTM diameter 14 with
// 6,624 cubes at the top, HTM diameter 11 with 64,736, and every intermediate count identical to
// the published table. That is why this file, and not a guess, is the source of a shipped par.
//
// What the full sweep buys:
//
//   * the par of any cube is one array read, so tools/bake.mjs never asks a searcher for a
//     number it can look up, and the certified route comes out of the same array,
//   * the group order 8! x 3^7 stops being arithmetic and becomes a count: the sweep reaches
//     every cube it should and no other, which is also the proof that the turn tables generate
//     exactly the reachable component and nothing larger,
//   * the full par histogram, which is what decides the difficulty bands instead of a sample.
//
// Cost, measured on the machine this repo was built on (see DESIGN.md): the distance array is
// one byte per cube and it is the only large allocation. The sweep rescans the array once per
// depth instead of carrying a frontier queue, which trades a couple of seconds of scanning for
// 352 MB of queue that no caller needs — resident cost stays near ninety MB, so the sweep cannot
// be the thing that makes another build on this machine fall over.
//
// The transitions factor into two tables, because a turn permutes the slots and adds trits
// independently of the rest of the cube:
//
//   PT[a][permRank]  the Lehmer rank after the turn's slot permutation
//   TT[a][tritCode]  the seven-trit code after the turn's twist deltas
//
// so a neighbour is `PT[a][pr] * 2187 + TT[a][tc]`, which is the same arithmetic cube.encode
// does, and the index is dense because the eighth trit is the one the invariant pins down.
//
// Truncation is exact, not approximate: breadth-first assignment means a cell written during a
// capped run still holds its true distance, so `nodeCap`/`deadlineMs` can only turn an answer
// into -1, never into a wrong number.
//
// Pure module: no window, no DOM. Build-time and test-time only — js/main.js must not import it,
// because the browser does not search.

import { GROUP_ORDER, PERM_COUNT, TRIT_COUNT, encode, permRank, permUnrank, validate } from './cube.js';
import { alphabetOf } from './orbit.js';

const UNVISITED = 255;
const MAX_DEPTH = 60; // a 2x2x2 needs far fewer than this; exceeding it is a non-terminating bug

// One transition row pair per generator, each covering the full 40,320 x 2,187 space.
function buildTransitions(metric) {
  const alphabet = alphabetOf(metric);
  const PT = [];
  const TT = [];
  const eight = [0, 0, 0, 0, 0, 0, 0, 0];
  const next = [0, 0, 0, 0, 0, 0, 0, 0];
  const tmp = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const g of alphabet) {
    const pt = new Int32Array(PERM_COUNT);
    for (let rank = 0; rank < PERM_COUNT; rank++) {
      const perm = permUnrank(rank);
      for (let t = 0; t < 8; t++) tmp[t] = perm[g.from[t]];
      pt[rank] = permRank(tmp);
    }
    const tt = new Int32Array(TRIT_COUNT);
    for (let code = 0; code < TRIT_COUNT; code++) {
      let c = code;
      let sum = 0;
      for (let i = 0; i < 7; i++) {
        eight[i] = c % 3;
        sum += eight[i];
        c = (c - eight[i]) / 3;
      }
      eight[7] = (3 - (sum % 3)) % 3;
      for (let t = 0; t < 8; t++) next[t] = (eight[g.from[t]] + g.delta[t]) % 3;
      // the invariant survives the turn: that is the entire content of "this cube can be
      // solved", so a break here means a broken table and not a slow run
      let check = 0;
      for (let i = 0; i < 8; i++) check += next[i];
      if (check % 3 !== 0) throw new Error(`fullsweep: ${g.label || 'turn'} breaks the twist invariant`);
      let cd = 0;
      let w = 1;
      for (let i = 0; i < 7; i++) {
        cd += next[i] * w;
        w *= 3;
      }
      tt[code] = cd;
    }
    PT.push(pt);
    TT.push(tt);
  }
  // flattened: the inner loop wants one array per generator at a fixed stride
  const ttFlat = new Int32Array(TT.length * TRIT_COUNT);
  TT.forEach((row, a) => ttFlat.set(row, a * TRIT_COUNT));
  return { PT, ttFlat, alphabet };
}

const CACHE = new Map();

// buildGroupTable({ metric, nodeCap, deadlineMs, onLevel, force }) ->
//   { dist, reached, diameter, hist, ms, metric, alphabet, truncated }
//
// `nodeCap` bounds how many cubes may be pulled out of the solved position, `deadlineMs` the
// wall clock, `MAX_DEPTH` the depth itself. Hitting any of them sets `truncated`, keeps the table
// out of the cache and shows up in `groupDistance` as -1 for whatever was never reached.
// `onLevel` fires once per depth with the running counts — the mid-run statistics a rerun reads.
export function buildGroupTable(opts = {}) {
  const metric = opts.metric || 'QTM';
  if (!opts.force && CACHE.has(metric)) return CACHE.get(metric);
  const t0 = Date.now();
  const { PT, ttFlat, alphabet } = buildTransitions(metric);
  const tableMs = Date.now() - t0;
  const nA = alphabet.length;
  const dist = new Uint8Array(GROUP_ORDER).fill(UNVISITED);
  dist[0] = 0; // rank 0 is the identity permutation with all trits zero: the solved cube
  const nodeCap = opts.nodeCap || GROUP_ORDER;
  const deadline = opts.deadlineMs ? Date.now() + opts.deadlineMs : 0;
  const hist = new Array(MAX_DEPTH + 2).fill(0);
  hist[0] = 1;
  let reached = 1;
  let maxDist = 0;
  let truncated = false;
  let stoppedAt = 0;
  const pt = new Int32Array(nA); // this slice's permutation targets, refilled once per permutation

  outer: for (let d = 0; ; d++) {
    let levelCount = 0;
    const nd = d + 1;
    for (let pr = 0; pr < PERM_COUNT; pr++) {
      const base = pr * TRIT_COUNT;
      // the permutation halves of this slice's neighbours, hoisted out of the trit loop
      for (let a = 0; a < nA; a++) pt[a] = PT[a][pr] * TRIT_COUNT;
      for (let tc = 0; tc < TRIT_COUNT; tc++) {
        const key = base + tc;
        if (dist[key] !== d) continue;
        levelCount++;
        for (let a = 0; a < nA; a++) {
          const nk = pt[a] + ttFlat[a * TRIT_COUNT + tc];
          if (dist[nk] === UNVISITED) {
            dist[nk] = nd;
            hist[nd]++;
            reached++;
            if (nd > maxDist) maxDist = nd;
          }
        }
        if (reached > nodeCap) {
          truncated = true;
          stoppedAt = nd;
          break outer;
        }
      }
      if (deadline && (pr & 255) === 0 && Date.now() > deadline) {
        truncated = true;
        stoppedAt = nd;
        break outer;
      }
    }
    if (typeof opts.onLevel === 'function') {
      opts.onLevel({ depth: d, levelCount, reached, ms: Date.now() - t0 });
    }
    if (!levelCount) break;
    if (d >= MAX_DEPTH) throw new Error(`fullsweep: the search was still growing at depth ${d}`);
  }

  const table = {
    metric,
    alphabet: nA,
    dist,
    reached,
    diameter: maxDist,
    hist: hist.slice(0, maxDist + 1),
    ms: Date.now() - t0,
    tableMs,
    truncated,
    stoppedAt,
    bytes: dist.byteLength,
  };
  if (!truncated) CACHE.set(metric, table);
  return table;
}

// The exact par of one cube under this repo's own goal — the solved *orientation*, which is what
// cube.isSolved demands — or -1 when the state is not a cube, when the invariant forbids it, or
// when a capped sweep never got here.
export function groupDistance(state, metric = 'QTM') {
  if (validate(state)) return -1;
  const rank = encode(state); // encode refuses a broken invariant as well as a non-cube
  if (rank < 0) return -1;
  const d = buildGroupTable({ metric }).dist[rank];
  return d === UNVISITED ? -1 : d;
}

// A shortest route, read out of the same array the par came from: from a cube at distance d,
// take any turn whose successor sits at d - 1. Par and certificate are then two readings of one
// sweep, which is the point — tools/bake.mjs still replays the route with cube.applySeq, and the
// tests still re-solve it with two searchers that never saw this table.
// For HTM a half turn costs one here, so `qtm` carries the two quarter turns it stands for.
export function routeFromTable(state, metric = 'QTM') {
  const table = buildGroupTable({ metric });
  const alphabet = alphabetOf(metric);
  const moves = [];
  const labels = [];
  let st = { perm: state.perm.slice(), twist: state.twist.slice() };
  for (let guard = 0; guard <= MAX_DEPTH; guard++) {
    const rank = encode(st);
    if (rank < 0) return null;
    const d = table.dist[rank];
    if (d === UNVISITED) return null;
    if (d === 0) return { moves, labels, metric };
    let moved = false;
    for (let a = 0; a < alphabet.length; a++) {
      const g = alphabet[a];
      const cand = { perm: [0, 0, 0, 0, 0, 0, 0, 0], twist: [0, 0, 0, 0, 0, 0, 0, 0] };
      for (let t = 0; t < 8; t++) {
        cand.perm[t] = st.perm[g.from[t]];
        cand.twist[t] = (st.twist[g.from[t]] + g.delta[t]) % 3;
      }
      const cr = validate(cand) ? -1 : encode(cand);
      if (cr >= 0 && table.dist[cr] === d - 1) {
        labels.push(g.label);
        if (g.half) {
          moves.push(g.slot, g.slot);
        } else {
          moves.push(g.slot);
        }
        st = cand;
        moved = true;
        break;
      }
    }
    if (!moved) return null;
  }
  return null; // the guard ran out; a route this long is not a shortest route
}

export function groupStats(metric = 'QTM') {
  const t = buildGroupTable({ metric });
  return {
    metric,
    alphabet: t.alphabet,
    order: GROUP_ORDER,
    reached: t.reached,
    diameter: t.diameter,
    antipodes: t.hist[t.diameter] || 0,
    hist: t.hist.slice(),
    ms: t.ms,
    tableMs: t.tableMs,
    bytes: t.bytes,
    truncated: t.truncated,
  };
}
