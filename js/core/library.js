// The shipped cube pool. The game picks puzzles from here; it never generates them, and that
// is a measured decision — see tools/bake.mjs and tools/survey.mjs for why the generator lives
// at build time instead of on tap.
//
// Everything below is a pure lookup over js/data/lots.js, which is why the daily puzzle and a
// shared link are reproducible without any state: the pool is fixed and the seed only chooses
// an index. The one exception is `fromScramble`, which accepts a cube the pool does not know
// about — and there the honest answer to "what is par" is "not measured here", because
// measuring it means searching, and searching does not happen in a browser.

import { LOTS, TIERS_META } from '../data/lots.js';
import { MOVES, applySeq, compactSeq, encode, formatSeq, isReachable, isSolved, parseSeq, solvedState } from './cube.js';
import { hashSeed, rngFrom } from './rng.js';

export const TIERS = TIERS_META;

const prepared = LOTS.map((row) => {
  const scr = row.scr.slice();
  const route = row.route.slice();
  const start = applySeq(solvedState(), scr);
  return {
    id: row.id,
    tier: row.tier,
    par: row.par,
    states: row.states,
    bakeMs: row.ms,
    scr,
    route,
    scrText: row.scrText,
    routeText: row.routeText,
    start,
    rank: encode(start),
  };
});

export const ALL = prepared;

// The pool is only as good as its baked numbers, and this module is the one the browser
// trusts, so the cheap structural part of the claim is re-checked on load: a row whose route
// does not solve its cube, or whose par is not the route's length, throws here rather than
// quietly shipping a wrong score line. test/library.test.mjs repeats the check through the
// reference solver, which is the part that cannot be done without searching.
for (const lot of prepared) {
  if (lot.route.length !== lot.par) throw new Error(`${lot.id}: par ${lot.par} but route has ${lot.route.length} turns`);
  if (!isReachable(lot.start)) throw new Error(`${lot.id}: scramble breaks the twist invariant`);
  if (!isSolved(applySeq(lot.start, lot.route))) throw new Error(`${lot.id}: baked route does not solve the cube`);
}

function pick(list, seed, salt) {
  if (!list.length) return null;
  return list[hashSeed(`${salt}|${seed}`) % list.length];
}

export function tierByKey(key) {
  return TIERS.find((t) => t.key === key) || null;
}

export function lotsIn(key) {
  return prepared.filter((l) => l.tier === key);
}

export function byId(id) {
  return prepared.find((l) => l.id === id) || null;
}

// The campaign: every baked cube, lowest band first and within a band shallowest first — which
// is exactly the order tools/bake.mjs wrote them in.
export function campaign() {
  return prepared;
}

export function levelAt(index) {
  return prepared[((index % prepared.length) + prepared.length) % prepared.length];
}

// Endless play in one band. A seed picks, so `#/random/<seed>` links stay honest.
export function randomLot(seed, tierKey) {
  const list = tierKey ? lotsIn(tierKey) : prepared;
  return pick(list, seed, 'random');
}

// One cube per calendar day, the same for everyone.
export function dailyLot(dateKey) {
  return pick(prepared, dateKey, 'daily');
}

// A cube from notation, for `#/cube/R U F'`. Legal, playable, and *without* a par: only the
// build-time search is allowed to claim a shortest length, and a link cannot smuggle one in.
export function fromScramble(text) {
  const p = parseSeq(text);
  if (!p.ok || !p.moves.length) return null;
  const start = applySeq(solvedState(), p.moves);
  if (!isReachable(start) || isSolved(start)) return null;
  return {
    id: `custom`,
    tier: null,
    par: null,
    scr: p.moves,
    route: null,
    scrText: compactSeq(p.moves),
    start,
    rank: encode(start),
    custom: true,
  };
}

// What the shipped pool actually contains, measured rather than claimed. The harness prints
// this so a re-bake that quietly loses difficulty shows up as a changed band. `med` is there
// for the same reason: a tier whose cubes all land on one number is one level in four
// costumes, and min/max alone cannot see that.
function median(sorted) {
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
}

export function stats() {
  const byTier = {};
  for (const l of prepared) {
    const s = byTier[l.tier] || (byTier[l.tier] = {
      n: 0, min: Infinity, max: 0, statesMin: Infinity, statesMax: 0, bakeMaxMs: 0, pars: [], states: [],
    });
    s.n++;
    if (l.par < s.min) s.min = l.par;
    if (l.par > s.max) s.max = l.par;
    if (l.states < s.statesMin) s.statesMin = l.states;
    if (l.states > s.statesMax) s.statesMax = l.states;
    if (l.bakeMs > s.bakeMaxMs) s.bakeMaxMs = l.bakeMs;
    s.pars.push(l.par);
    s.states.push(l.states);
  }
  for (const s of Object.values(byTier)) {
    s.pars.sort((a, b) => a - b);
    s.states.sort((a, b) => a - b);
    s.parMed = median(s.pars);
    s.statesMed = median(s.states);
    delete s.pars;
    delete s.states;
  }
  return { lots: prepared.length, byTier };
}

// Notation for the panel and the share line.
export function notation(lot) {
  return {
    scramble: lot.scrText || compactSeq(lot.scr),
    route: lot.routeText || (lot.route ? formatSeq(lot.route) : null),
    faces: lot.scr.map((m) => MOVES[m].name),
  };
}

export function rngFor(seed) {
  return rngFrom(seed);
}
