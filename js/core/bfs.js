// Solver #1, the reference one: bidirectional breadth-first search over the twelve-turn
// graph of js/core/cube.js — forward from the scrambled cube, backward from the solved one,
// meeting in the middle. This is the implementation whose number the shipped `par` comes
// from, and it is deliberately the simple one: a BFS cannot be subtly wrong in the way a
// depth-first search driven by a heuristic can, which is why the repo keeps two solvers and
// demands that they agree (test/solve.test.mjs).
//
// It never runs in the browser. tools/bake.mjs and test/ import it; js/main.js does not.
//
// Nodes are keyed by cube.encode8(), over the *full abstract* space (8! * 3^8 = 264,539,520
// descriptions) rather than the reachable one (8! * 3^7). That costs nothing, and it is what
// lets the solver be *asked* about a cube that cannot be solved: such a state sits in a
// component the solved cube is not in, so the two frontiers simply never meet.
//
// Why `moves` is a proof and not an estimate: once the forward side has completed every
// layer up to depth a and the backward side up to depth b, any path not already witnessed
// must run through a vertex further than a from the start or further than b from the goal,
// so it has length > a + b. "Grow while a + b < best, then stop" therefore makes the number
// a shortest path, not a good-looking one.

import { MOVES, encode8, decode8, validate, solvedState, inverseMove } from './cube.js';

const ALL_MOVES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const EDGES = MOVES.map((m) => m.edges);
const SNAP_P = [0, 0, 0, 0];
const SNAP_T = [0, 0, 0, 0];

// In-place, and the reason this is not cube.applyInto: a search that allocates two arrays
// per node spends its time in the garbage collector instead of the graph.
//
// `restore` matters more than it looks. Every sibling of a node must be generated from the
// *same* base state, so a neighbour is always un-done right after its key has been taken;
// leaving the mutation in place would quietly turn the fan-out into a walk down one path and
// the search would stop being a breadth-first search.
function applyMove(st, move) {
  const e = EDGES[move];
  const perm = st.perm;
  const twist = st.twist;
  for (let i = 0; i < 4; i++) {
    SNAP_P[i] = perm[e[i][0]];
    SNAP_T[i] = twist[e[i][0]];
  }
  for (let i = 0; i < 4; i++) {
    const t = e[i][1];
    perm[t] = SNAP_P[i];
    twist[t] = (SNAP_T[i] + e[i][2]) % 3;
  }
  return st;
}

function undoMove(st, move) {
  return applyMove(st, move ^ 1); // geom.js proves turn m then turn m' is the identity
}

// One Map per side: key -> parentKey * 16 + (move + 1). The root maps to -1. A parent key
// below 264,539,520 needs 28 bits and the move 4, so the packed value stays exact.
function makeSide(root) {
  return { seen: new Map([[root, -1]]), frontier: [root], depth: 0, root };
}

function moveInto(side, key, parent, move) {
  side.seen.set(key, parent * 16 + (move + 1));
}

// The sequence of turns that carries this side's root to `key`.
function trace(side, key) {
  const out = [];
  let k = key;
  for (;;) {
    const v = side.seen.get(k);
    if (v === undefined || v < 0) break;
    out.push((v % 16) - 1);
    k = Math.floor(v / 16);
  }
  return out.reverse();
}

// Turns that carry `key` back to this side's root — the goal side's half of an answer.
function traceReversed(side, key) {
  return trace(side, key).map(inverseMove).reverse();
}

// solveBfs(state, { limit, deadlineMs, alphabet }) ->
//   { ok: true,  moves, path, explored, exhausted: false, truncated: false }
//   { ok: false, moves: -1, path: [], explored, exhausted, truncated, error? }
//
// `limit` (nodes) and `deadlineMs` are hard stops, and hitting one is reported as
// `truncated`: the solver says "I do not know" rather than guessing. `exhausted` is the real
// negative answer — both frontiers ran dry, so no path exists. Restricting `alphabet` is
// what makes exhaustion testable for real: {0, 1} is U and U' only, a component of nine
// cubes that can be searched to completion in microseconds.
export function solveBfs(state, opts = {}) {
  const err = validate(state);
  if (err) {
    return { ok: false, error: err, moves: -1, path: [], explored: 0, exhausted: false, truncated: false };
  }
  const alphabet = opts.alphabet || ALL_MOVES;
  const limit = opts.limit || 4000000;
  const deadline = opts.deadlineMs ? Date.now() + opts.deadlineMs : 0;

  const startKey = encode8(state);
  const goalKey = encode8(solvedState());
  if (startKey === goalKey) {
    return { ok: true, moves: 0, path: [], explored: 1, exhausted: false, truncated: false };
  }
  const fwd = makeSide(startKey);
  const bwd = makeSide(goalKey);
  let explored = 2;
  let best = Infinity;
  let bestPath = null;
  let truncated = false;

  const overBudget = () => {
    if (explored > limit || (deadline && Date.now() > deadline)) truncated = true;
    return truncated;
  };

  const grow = (mine, theirs, moves) => {
    const next = [];
    const queue = mine.frontier;
    for (let q = 0; q < queue.length; q++) {
      const key = queue[q];
      const st = decode8(key);
      const last = mine.seen.has(key) && mine.seen.get(key) >= 0 ? (mine.seen.get(key) % 16) - 1 : -1;
      for (let i = 0; i < moves.length; i++) {
        const move = moves[i];
        if (move === inverseMove(last)) continue; // no shortest path undoes its own last turn
        applyMove(st, move);
        const nk = encode8(st);
        undoMove(st, move);
        if (mine.seen.has(nk)) continue;
        moveInto(mine, nk, key, move);
        next.push(nk);
        explored++;
        if (theirs.seen.has(nk)) {
          const path = trace(fwd, nk).concat(traceReversed(bwd, nk));
          if (path.length < best) {
            best = path.length;
            bestPath = path;
          }
        }
        if (overBudget()) return;
      }
    }
    mine.frontier = next;
    mine.depth++;
  };

  while (!truncated && fwd.depth + bwd.depth < best) {
    if (!fwd.frontier.length && !bwd.frontier.length) break;
    const mine = !fwd.frontier.length ? bwd
      : !bwd.frontier.length ? fwd
        : fwd.depth < bwd.depth ? fwd
          : bwd.depth < fwd.depth ? bwd
            : (fwd.frontier.length <= bwd.frontier.length ? fwd : bwd);
    grow(mine, mine === fwd ? bwd : fwd, alphabet);
  }

  if (truncated) {
    return { ok: false, moves: -1, path: [], explored, exhausted: false, truncated: true };
  }
  if (bestPath === null) {
    return { ok: false, moves: -1, path: [], explored, exhausted: true, truncated: false };
  }
  return { ok: true, moves: bestPath.length, path: bestPath, explored, exhausted: false, truncated: false };
}
