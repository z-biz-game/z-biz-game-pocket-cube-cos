// The 2x2x2 state model: eight corners, each described by *which* corner is in *which*
// slot and how it is twisted. This is the only place the rules of the cube live; the
// view never decides whether a turn is legal and the searchers never re-derive a table.
//
//   state = { perm: [8 corner ids by slot], twist: [8 trits by slot] }
//
// twist[s] is the twist of whichever corner currently sits in slot s, as derived by
// js/core/geom.js from the corner's own geometry. The invariant this repo's whole claim
// rests on is
//
//   reachable from solved  <=>  sum(twist) == 0 (mod 3)
//
// and the direction that makes `par` trustworthy — "a state that breaks it has NO
// solution" — is proved by checking the twelve move tables, not by asserting it: the sum
// of the twist deltas of a turn is 0 mod 3 for every turn, independently of the state, so
// no move sequence can ever change the residue. See tools/proof.mjs.
//
// Metric: quarter-turn metric (QTM). The alphabet is the twelve quarter turns in
// js/core/geom.js; a half turn costs two, and a whole-cube rotation is not a move at all.
// Change the metric and every number in this repo changes with it, which is why the name
// is written down everywhere it matters.
//
// Pure module: no window, no DOM.

import { MOVES, MOVE_COUNT, twistOf } from './geom.js';

export { MOVES, MOVE_COUNT };
export { moveByName } from './geom.js';

export const PERM_COUNT = 40320; // 8!
export const TRIT_COUNT = 2187; // 3^7
export const GROUP_ORDER = PERM_COUNT * TRIT_COUNT; // 88,179,840 = 8! * 3^7
export const TRITS8 = 6561; // 3^8, the full abstract twist space
export const ABSTRACT_COUNT = PERM_COUNT * TRITS8; // 264,539,520 states, only a third reachable

export function solvedState() {
  return { perm: [0, 1, 2, 3, 4, 5, 6, 7], twist: [0, 0, 0, 0, 0, 0, 0, 0] };
}

export function clone(state) {
  return { perm: state.perm.slice(), twist: state.twist.slice() };
}

export function isSolved(state) {
  for (let i = 0; i < 8; i++) {
    if (state.perm[i] !== i || state.twist[i] !== 0) return false;
  }
  return true;
}

export function twistSum(state) {
  let s = 0;
  for (let i = 0; i < 8; i++) s += state.twist[i];
  return s % 3;
}

// Structural legality only: is this even a description of a cube? Deliberately does *not*
// check the twist invariant, because "illegal cube" and "cube that cannot be solved" are
// two different failures and the UI has to say which one happened.
export function validate(state) {
  if (!state || typeof state !== 'object') return 'not a state';
  if (!Array.isArray(state.perm) || state.perm.length !== 8) return 'perm must hold 8 slots';
  if (!Array.isArray(state.twist) || state.twist.length !== 8) return 'twist must hold 8 trits';
  const seen = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 8; i++) {
    const p = state.perm[i];
    if (!Number.isInteger(p) || p < 0 || p > 7) return `perm[${i}] is not a corner id`;
    if (seen[p]) return `corner ${p} appears twice`;
    seen[p] = 1;
    const t = state.twist[i];
    if (!Number.isInteger(t) || t < 0 || t > 2) return `twist[${i}] is not a trit`;
  }
  return null;
}

export function isReachable(state) {
  return validate(state) === null && twistSum(state) === 0;
}

// ---- moving ------------------------------------------------------------------------

// Pure: returns a new state, leaves the argument alone (there is a test for that).
export function apply(state, move) {
  const next = clone(state);
  applyInto(next, move);
  return next;
}

// In-place, for the searchers: 88M-state searches cannot afford allocations.
export function applyInto(state, move) {
  const m = MOVES[move];
  const perm = state.perm;
  const twist = state.twist;
  const np = [0, 1, 2, 3, 4, 5, 6, 7];
  const nt = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let t = 0; t < 8; t++) {
    const s = m.from[t];
    np[t] = perm[s];
    nt[t] = (twist[s] + m.delta[t]) % 3;
  }
  state.perm = np;
  state.twist = nt;
  return state;
}

export function applySeq(state, moves) {
  let s = clone(state);
  for (const m of moves) s = apply(s, m);
  return s;
}

// Applying a turn and its inverse is the identity — used by the tests, and by the view to
// label a drag as "the reverse turn".
export function inverseMove(move) {
  return move ^ 1;
}

export function invertSeq(moves) {
  const out = [];
  for (let i = moves.length - 1; i >= 0; i--) out.push(moves[i] ^ 1);
  return out;
}

export function formatSeq(moves) {
  return moves.map((m) => MOVES[m].name).join(' ');
}

// Accepts "R U R' U'", "RU R'U'", "r u r' u'" and the same with x2 for a half turn.
// Returns { ok, moves, error }. A half turn is two quarter turns, because this is QTM.
export function parseSeq(text) {
  const out = [];
  const tokens = String(text).toUpperCase().replace(/\s+/g, '');
  let i = 0;
  while (i < tokens.length) {
    const face = tokens[i++];
    let dir = 1;
    if (tokens[i] === "'") { dir = -1; i++; }
    else if (tokens[i] === '2') { dir = 2; i++; }
    let found = -1;
    for (let m = 0; m < MOVE_COUNT; m++) {
      if (MOVES[m].face === face) { found = m; break; }
    }
    if (found < 0) return { ok: false, moves: out, error: `unknown face "${face}"` };
    if (dir === 2) {
      out.push(found, found);
    } else {
      out.push(dir === 1 ? found : found ^ 1);
    }
  }
  return { ok: true, moves: out, error: null };
}

// The QTM cost of a notation string, which is *not* its token count: "F2" is one symbol and
// two quarter turns. Anything the parser rejects costs NaN, so a caller cannot mistake "I
// could not read this" for "this is cheap".
export function qtmCost(text) {
  const p = parseSeq(text);
  return p.ok ? p.moves.length : NaN;
}

// Compact a quarter-turn list back into notation: two same-face turns in a row become "F2".
// A half turn cannot be shortened to one symbol *and* stay a quarter-turn count, so the cost
// is preserved by construction and the round trip is checked in the tests.
export function compactSeq(moves) {
  const out = [];
  let i = 0;
  while (i < moves.length) {
    const same = i + 1 < moves.length && moves[i] === moves[i + 1];
    if (same) {
      // Only two *identical* turns collapse into "F2". U U' is the identity and must stay two
      // symbols, or the printed scramble would stop meaning what it says.
      out.push(`${MOVES[moves[i]].face}2`);
      i += 2;
    } else {
      out.push(MOVES[moves[i]].name);
      i += 1;
    }
  }
  return out.join(' ');
}

// ---- ranking -----------------------------------------------------------------------

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040]; // (7-i)! for digit i of the Lehmer code

export function permRank(perm) {
  let rank = 0;
  for (let i = 0; i < 8; i++) {
    let lesser = 0;
    for (let j = i + 1; j < 8; j++) if (perm[j] < perm[i]) lesser++;
    rank += lesser * FACT[7 - i];
  }
  return rank;
}

export function permUnrank(rank) {
  const pool = [0, 1, 2, 3, 4, 5, 6, 7];
  const perm = [0, 0, 0, 0, 0, 0, 0, 0];
  let r = rank;
  for (let i = 0; i < 8; i++) {
    const f = FACT[7 - i];
    const digit = Math.floor(r / f);
    r -= digit * f;
    perm[i] = pool.splice(digit, 1)[0];
  }
  return perm;
}

function tritCode(twist, n) {
  let t = 0;
  let w = 1;
  for (let i = 0; i < n; i++) {
    t += twist[i] * w;
    w *= 3;
  }
  return t;
}

// rank in [0, 40320 * 2187): Lehmer over the permutation, the first seven trits over the
// twist. The eighth trit is *not* stored — it is the one the invariant pins down, which is
// exactly why this space has size 8! * 3^7 and not 8! * 3^8.
export function encode(state) {
  const err = validate(state);
  if (err) return -1;
  if (twistSum(state) !== 0) return -1;
  return permRank(state.perm) * TRIT_COUNT + tritCode(state.twist, 7);
}

export function decode(rank) {
  if (!Number.isInteger(rank) || rank < 0 || rank >= GROUP_ORDER) return null;
  const pr = Math.floor(rank / TRIT_COUNT);
  let t = rank % TRIT_COUNT;
  const twist = [0, 0, 0, 0, 0, 0, 0, 0];
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    twist[i] = t % 3;
    sum += twist[i];
    t = Math.floor(t / 3);
  }
  twist[7] = (3 - (sum % 3)) % 3;
  return { perm: permUnrank(pr), twist };
}

// The full abstract space, eighth trit included: every state has a code here whether or
// not the cube could ever reach it. This is the key the searchers use, and the reason a
// solver can be *asked* about an unsolvable cube instead of never seeing one.
export function encode8(state) {
  const err = validate(state);
  if (err) return -1;
  return permRank(state.perm) * TRITS8 + tritCode(state.twist, 8);
}

export function decode8(rank8) {
  if (!Number.isInteger(rank8) || rank8 < 0 || rank8 >= ABSTRACT_COUNT) return null;
  const pr = Math.floor(rank8 / TRITS8);
  let t = rank8 % TRITS8;
  const twist = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 8; i++) {
    twist[i] = t % 3;
    t = Math.floor(t / 3);
  }
  return { perm: permUnrank(pr), twist };
}

export function rankTo8(rank) {
  const s = decode(rank);
  return encode8(s);
}

// A random-looking but reproducible legal state, from a plain integer: pick a permutation
// and seven trits, then let the invariant decide the last one. Nothing can come out of
// here that the cube cannot be in.
export function stateFromSeed(n) {
  const k = (n >>> 0) % GROUP_ORDER;
  return decode(k);
}

export { twistOf };
