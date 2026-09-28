// Generation. Runs at build time (tools/bake.mjs) and in the test suites; js/main.js does not
// import it, and no browser in this repo ever generates a puzzle.
//
// Two candidate sources, and the choice between them is a measurement rather than a taste:
//
//   rank — uniform over the reachable group: draw an integer below 8! * 3^7 and decode it.
//          The invariant is satisfied by construction, so every candidate is a cube the
//          player could actually be handed. The catch is that a uniform cube is a *hard*
//          cube: measured over the whole group the par distribution peaks at 11 and 38% of
//          all cubes sit at 8..10, so a beginner band is a tail event and the acceptance rate
//          falls through the floor. tools/survey.mjs prints the exact shares, from the sweep
//          rather than from a sample.
//
//   walk — k random turns from the solved cube. Par is then at most k, which makes the low
//          bands cheap, and the walk *is* the scramble the player sees, so nothing has to be
//          reverse-engineered into notation afterwards.
//
// Either way a candidate is only accepted after the *oracle* has measured its par, and an
// oracle is a function that returns a shortest length or nothing:
//
//   bfsOracle() — js/core/bfs.js, the bidirectional reference search. One cube per call and
//     seconds for a deep one, which is why it is the cross-check and not the production line.
//     This is the default, so nothing here can quietly depend on a baked table.
//   sweepOracle() — tools/bake.mjs injects one built on js/core/fullsweep.js: one byte per cube
//     over all 88,179,840 of them, so a par is an array read and a whole band is a lookup.
//
// Rejection is per band, counted by reason, and printed. Nothing here estimates.
//
// Pure module: no window, no DOM.

import { GROUP_ORDER, MOVES, applySeq, compactSeq, encode, invertSeq, isReachable, isSolved, parseSeq, qtmCost, solvedState, stateFromSeed } from './cube.js';
import { solveBfs } from './bfs.js';
import { rngFrom } from './rng.js';

// Generation-side ladder. The display-side bands in js/data/lots.js carry the same ranges, and
// these four slices were cut out of the measured whole-group histogram (see tools/survey.mjs):
// 4..6 holds 0.28% of the group, 7..9 holds 13.86%, 10..11 holds 62.09%, 12..14 holds 23.76%.
//
// `walk` is a *pair* of lengths rather than one, and that is a measured consequence of a fact a
// random-scramble generator normally gets wrong: the twelve-turn graph is bipartite, so a walk of
// length k can only end on a cube whose par shares k's parity. One fixed length hands out a band
// of 12s and 14s and never a 13. Alternating two lengths costs a little acceptance and gives a
// band its whole range; tools/bake.mjs prints both numbers.
export const BANDS = [
  { key: 'first', label: '起手', blurb: '几步就收得掉', min: 4, max: 6, walk: [5, 6], per: 16 },
  { key: 'warm', label: '热身', blurb: '要看着块走', min: 7, max: 9, walk: [9, 10], per: 16 },
  { key: 'spin', label: '上手', blurb: '全群分布的峰顶', min: 10, max: 11, walk: [13, 14], per: 16 },
  { key: 'tangle', label: '缠绕', blurb: '最深的一档', min: 12, max: 14, walk: [21, 22], per: 16 },
];

export function bandByKey(key) {
  return BANDS.find((b) => b.key === key) || null;
}

export function walkLengthOf(band, i) {
  return Array.isArray(band.walk) ? band.walk[i % band.walk.length] : band.walk;
}

// Uniform over the reachable group. decode() derives the eighth trit from the invariant, so
// "uniform here" and "uniform subject to sum(twist) = 0 (mod 3)" are the same statement.
export function rankCandidate(n) {
  const state = stateFromSeed(n);
  if (!isReachable(state)) throw new Error('rankCandidate produced a cube that breaks the invariant');
  return { state, scr: null, via: 'rank' };
}

// k random turns from solved. Not trimmed: a walk that undoes itself is still a legal
// scramble, it just lands somewhere shallow, and the band filter is what decides.
export function walkCandidate(rng, steps) {
  const r = rngFrom(rng);
  const scr = [];
  for (let i = 0; i < steps; i++) scr.push(r.int(MOVES.length));
  return { state: applySeq(solvedState(), scr), scr, via: 'walk' };
}

// The reference oracle: a real search, one cube at a time. An unknown is reported as a
// rejection with its reason, never as a guess.
export function bfsOracle(opts = {}) {
  const budget = opts.budget || 12000000;
  const deadlineMs = opts.deadlineMs || 60000;
  return {
    name: 'bfs',
    solve(state) {
      const r = solveBfs(state, { limit: budget, deadlineMs });
      if (!r.ok) return { par: -1, states: r.explored, reason: r.truncated ? 'search-truncated' : 'no-path' };
      return { par: r.moves, route: r.path.slice(), states: r.explored };
    },
  };
}

// One candidate, measured. `accepted: false` carries the reason the band said no, and an
// unmeasured par is a rejection rather than a pass.
export function measure(candidate, band, opts = {}) {
  const oracle = opts.oracle || bfsOracle(opts);
  const t0 = Date.now();
  const r = oracle.solve(candidate.state);
  const ms = Date.now() - t0;
  const states = r.states || 0;
  if (isSolved(candidate.state)) return { accepted: false, reason: 'already-solved', ms, explored: states };
  if (!Number.isInteger(r.par) || r.par < 0) return { accepted: false, reason: r.reason || 'no-par', ms, explored: states };
  if (!r.route || !r.route.length) return { accepted: false, reason: 'no-route', ms, explored: states };
  if (r.par < band.min || r.par > band.max) return { accepted: false, reason: 'par', par: r.par, ms, explored: states };
  // A walk carries its own scramble; a uniform cube has to be given one, and the only honest
  // way to get it is to run the shortest route backwards — inverse of the whole path, in
  // reverse order, because composition is not commutative.
  const scr = candidate.scr && candidate.scr.length ? candidate.scr.slice() : invertSeq(r.route);
  const lot = {
    scr,
    route: r.route.slice(),
    par: r.par,
    scrCost: scr.length,
    states,
    ms,
    via: candidate.via,
    oracle: oracle.name,
  };
  return { accepted: true, par: r.par, lot, ms, explored: states };
}

// Self-consistency of one finished lot, checked here as well as in the test suite: applying
// the scramble must land on a cube whose certified route really does solve it in `par` turns.
export function verifyLot(lot) {
  const start = applySeq(solvedState(), lot.scr);
  if (encode(start) < 0) return 'start breaks the twist invariant';
  if (isSolved(start)) return 'start is already solved';
  if (lot.route.length !== lot.par) return 'route length is not par';
  if (!isSolved(applySeq(start, lot.route))) return 'route does not solve the cube';
  const p = parseSeq(lot.scrText);
  if (!p.ok) return `scramble does not parse: ${p.error}`;
  if (p.moves.length !== lot.scrCost) return 'scramble cost does not match the walk';
  // Compare the *cube*, not the index list. "U2" is the same turn as U U' in the group but not the
  // same pair of indices — parseSeq reads it as two clockwise turns, and the walk may have gone
  // counter-clockwise twice — so an index-list equality here would reject legal notation.
  if (encode(applySeq(solvedState(), p.moves)) !== encode(start)) return 'scramble notation is not the scramble';
  if (qtmCost(lot.routeText) !== lot.par) return 'route cost does not match par';
  if (encode(applySeq(start, parseSeq(lot.routeText).moves)) !== 0) return 'route notation does not solve the cube';
  return null;
}

// Fill one band. `strategy` is 'walk' by default — a random k-turn scramble, k from `band.walk` —
// and 'rank' for the measurement that decides whether that default is right (a uniform cube is
// what `rank` draws, and for the shallow bands almost none of them exist).
export function makeBand(band, opts = {}) {
  const rng = rngFrom(opts.seed || `${band.key}|${opts.nonce || 0}`);
  const strategy = opts.strategy || 'walk';
  const want = opts.count || band.per;
  const seen = opts.seen || new Set();
  const oracle = opts.oracle || bfsOracle(opts);
  const lots = [];
  const stats = { band: band.key, strategy, oracle: oracle.name, range: `${band.min}-${band.max}`, tried: 0, accepted: 0, ms: 0, maxMs: 0, maxExplored: 0, byReason: {}, pars: {} };
  const cap = opts.cap || Math.max(400, want * 200); // iteration discipline: never spin forever
  while (stats.accepted < want && stats.tried < cap) {
    const cand = strategy === 'rank' ? rankCandidate(rng.int(GROUP_ORDER)) : walkCandidate(rng, walkLengthOf(band, stats.tried));
    stats.tried++;
    const m = measure(cand, band, { oracle });
    stats.ms += m.ms;
    if (m.ms > stats.maxMs) stats.maxMs = m.ms;
    if (m.explored > stats.maxExplored) stats.maxExplored = m.explored;
    // Every par this band ever saw, accepted or not: this is the walk distribution that decides
    // the band ranges and the walk lengths, and tools/survey.mjs prints it.
    if (Number.isInteger(m.par)) stats.pars[m.par] = (stats.pars[m.par] || 0) + 1;
    if (!m.accepted) {
      const reason = m.reason === 'par' ? `par-out-of-band` : m.reason;
      stats.byReason[reason] = (stats.byReason[reason] || 0) + 1;
      continue;
    }
    const lot = m.lot;
    lot.scrText = compactSeq(lot.scr);
    lot.routeText = compactSeq(lot.route);
    const bad = verifyLot(lot);
    if (bad) {
      stats.byReason[`verify:${bad}`] = (stats.byReason[`verify:${bad}`] || 0) + 1;
      continue;
    }
    // Same cube twice in one pool is a bug wearing a feature: the scramble differs, the
    // puzzle does not.
    const key = encode(applySeq(solvedState(), lot.scr));
    if (seen.has(key)) {
      stats.byReason.duplicate = (stats.byReason.duplicate || 0) + 1;
      continue;
    }
    seen.add(key);
    lots.push(lot);
    stats.accepted++;
  }
  stats.rate = stats.tried ? stats.accepted / stats.tried : 0;
  stats.meanMs = stats.tried ? stats.ms / stats.tried : 0;
  stats.truncated = stats.accepted < want;
  return { lots, stats, exhaustedBudget: stats.accepted < want };
}
