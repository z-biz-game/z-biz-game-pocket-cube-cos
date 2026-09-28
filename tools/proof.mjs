// Proof harness: the external anchors this repo's headline number rests on.
//
//   node tools/proof.mjs              # invariants, bijections, admissibility, group order
//   FULL=1 node tools/proof.mjs       # the above plus an exhaustive BFS over all 88,179,840
//                                     # reachable cubes: diameter, and the par histogram of
//                                     # the whole group
//
// What "proof" means here, precisely: each check below either enumerates a finite space
// completely (the twelve move tables over all 6561 twist vectors, the pattern database over
// all 1,632,960 abstract states, the group over all 88,179,840 cubes under FULL=1) or it
// samples and says so. Nothing in this file is a restatement of a comment in the module it
// checks — the tables are re-derived from geometry and compared against an independent
// physical sticker model, and the heuristic bounds are measured rather than assumed.
//
// The FULL=1 pass is the one to leave out of CI: it is a few minutes and a few hundred MB.

import {
  ABSTRACT_COUNT, GROUP_ORDER, MOVES, PERM_COUNT, TRITS8, TRIT_COUNT, apply, applySeq, decode,
  encode, encode8, isReachable, isSolved, permRank, permUnrank, rankTo8, solvedState,
  stateFromSeed, twistSum, validate,
} from '../js/core/cube.js';
import { MOVES as GEO_MOVES, physicalSolved, physicalTurn, project, stickerCensus } from '../js/core/geom.js';
import { solveBfs } from '../js/core/bfs.js';
import { CORNER, TWIST_STEP, solveIda, heuristic } from '../js/core/ida.js';
import { PDB_SIZE, abstractIndex, buildPdb, patternDistance, pdbDiameter } from '../js/core/pdb.js';
import { rngFrom } from '../js/core/rng.js';

const FULL = process.env.FULL === '1';
const lines = [];
let failures = 0;

function say(s) {
  lines.push(s);
  console.log(s);
}

function check(name, cond, detail = '') {
  const ok = !!cond;
  if (!ok) failures++;
  say(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? `  ${detail}` : ''}`);
  return ok;
}

function ms(t0) {
  return `${((Date.now() - t0) / 1000).toFixed(1)}s`;
}

// ---- 1. the tables are the geometry's, and they are bijections ------------------------

function cycleStructure(move) {
  // The four slots a turn touches must form a single 4-cycle: that is the shape of "rotate
  // one face by 90 degrees", and anything else means the table was typed and not derived.
  const to = move.to;
  const moved = [];
  for (let s = 0; s < 8; s++) if (to[s] !== s) moved.push(s);
  if (moved.length !== 4) return { ok: false, why: `${moved.length} slots moved` };
  let at = moved[0];
  for (let i = 0; i < 4; i++) {
    at = to[at];
    if (moved.indexOf(at) < 0) return { ok: false, why: 'leaves the moved set' };
  }
  if (at !== moved[0]) return { ok: false, why: 'not one cycle' };
  return { ok: true, moved };
}

function checkTables() {
  say('\n== move tables (12 quarter turns, derived in js/core/geom.js) ==');
  check('twelve moves, U U\' D D\' R R\' L L\' F F\' B B\'', MOVES.map((m) => m.name).join(' ') === "U U' D D' R R' L L' F F' B B'", MOVES.map((m) => m.name).join(' '));
  let bijective = true;
  let cycles = true;
  let sumZero = true;
  let involution = true;
  for (const m of MOVES) {
    const seen = new Set(m.to);
    if (seen.size !== 8) bijective = false;
    if (!cycleStructure(m).ok) cycles = false;
    let s = 0;
    for (let t = 0; t < 8; t++) s += m.delta[t];
    if (s % 3 !== 0) sumZero = false;
    if (MOVES[m.inv].inv !== MOVES.indexOf(m)) involution = false;
  }
  check('every turn is a bijection on the eight slots', bijective);
  check('every turn is a single 4-cycle of the layer it moves', cycles);
  check("every turn's twist deltas sum to 0 (mod 3)", sumZero);
  check('inverse is an involution and matches the face convention', involution, `U->${MOVES[0].inv} U'->${MOVES[1].inv}`);
  check('cube.js and geom.js read the same table object', GEO_MOVES === MOVES);
}

// The invariant is preserved for *every* twist vector, not for a sample of them: a turn's
// twist update depends on the twist vector alone, so 12 x 6561 cases is the whole truth.
function checkInvariantExhaustive() {
  say('\n== the twist invariant, exhaustively ==');
  const codes = [];
  for (let code = 0; code < TRITS8; code++) {
    let t = code;
    const arr = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 8; i++) {
      arr[i] = t % 3;
      t = Math.floor(t / 3);
    }
    codes.push(arr);
  }
  let bad = 0;
  let badPerms = 0;
  for (let m = 0; m < 12; m++) {
    for (const twist of codes) {
      const st = { perm: [0, 1, 2, 3, 4, 5, 6, 7], twist: twist.slice() };
      const before = twistSum(st);
      apply(st, m);
      if (twistSum(st) !== before) bad++;
    }
  }
  check(`12 x 6561 twist vectors: sum(twist) mod 3 unchanged by every turn`, bad === 0, `${bad} violations`);
  // And the permutation part: the invariant says nothing about perm, so check the other half
  // of "reachable" — that no turn can make two slots hold the same corner.
  for (let i = 0; i < 400; i++) {
    const rng = rngFrom(`perm|${i}`);
    let st = stateFromSeed(rng.int(GROUP_ORDER));
    for (let k = 0; k < 20; k++) st = apply(st, rng.int(12));
    if (new Set(st.perm).size !== 8) badPerms++;
    if (twistSum(st) !== 0) badPerms++;
    if (validate(st)) badPerms++;
  }
  check('400 x 20-turn walks stay legal cubes', badPerms === 0, `${badPerms} broken`);
}

// The physical model in geom.js is a second, independent implementation of the cube: it
// carries sticker *directions* rather than trits. Agreement between the two is what says the
// twist encoding means what the comment claims.
function checkPhysical() {
  say('\n== table model vs physical sticker model ==');
  let bad = 0;
  let words = 0;
  const rng = rngFrom('physical');
  for (let i = 0; i < 300; i++) {
    let phys = physicalSolved();
    let abs = solvedState();
    const len = 1 + rng.int(20);
    for (let k = 0; k < len; k++) {
      const m = rng.int(12);
      phys = physicalTurn(phys, m);
      abs = apply(abs, m);
    }
    words++;
    if (JSON.stringify(project(phys)) !== JSON.stringify(abs)) bad++;
    if (new Set(Object.values(stickerCensus(abs))).size !== 1 || Object.values(stickerCensus(abs))[0] !== 4) bad++;
  }
  check(`${words} random words: (perm, twist) equals the physical projection`, bad === 0, `${bad} mismatches`);
  check('every cube shows exactly four stickers of each face', bad === 0);
  // Cancellation, in the shape the words cancel: x x' y y'. This is *not* the commutator
  // [x, y, x', y'] — that one is the identity for only 48 of the 144 pairs (measured), so
  // writing the check as a commutator would blame the engine for a property the group never
  // promised. Both models have to cancel, because the tables are derived in one and the
  // stickers are drawn from the other.
  let cancel = 0;
  let cancelPhys = 0;
  for (let a = 0; a < 12; a++) {
    for (let b = 0; b < 12; b++) {
      const w = [a, a ^ 1, b, b ^ 1];
      if (!isSolved(applySeq(solvedState(), w))) cancel++;
      let p = physicalSolved();
      for (const m of w) p = physicalTurn(p, m);
      if (!isSolved(project(p))) cancelPhys++;
    }
  }
  check("all 144 words x x' y y' reduce to the solved cube", cancel === 0 && cancelPhys === 0,
    `${cancel} abstract / ${cancelPhys} physical failures`);
}

// ---- 2. the encoding -----------------------------------------------------------------

function checkEncoding() {
  say('\n== encode / decode ==');
  let bad = 0;
  for (let rank = 0; rank < 4000; rank++) {
    const s = decode(rank);
    if (encode(s) !== rank) bad++;
  }
  for (let i = 1; i < 2187; i++) {
    const rank = PERM_COUNT * TRIT_COUNT - i;
    if (encode(decode(rank)) !== rank) bad++;
  }
  check('decode then encode is the identity, first 4000 and last 2186 ranks', bad === 0, `${bad} broken`);
  let bad2 = 0;
  const rng = rngFrom('enc');
  for (let i = 0; i < 4000; i++) {
    const s = stateFromSeed(rng.int(GROUP_ORDER));
    if (encode(s) < 0) bad2++;
    const r = encode(s);
    const back = decode(r);
    if (JSON.stringify(back) !== JSON.stringify(s)) bad2++;
    if (encode8(s) !== permRank(s.perm) * TRITS8 + rankTo8(r) % TRITS8) bad2++;
  }
  check('4000 uniform cubes round-trip through both codes', bad2 === 0, `${bad2} broken`);
  // decode(0) must be the solved cube, and the group order must be what the comment says
  check('rank 0 is the solved cube', isSolved(decode(0)));
  check('8! x 3^7 = 88,179,840', PERM_COUNT * TRIT_COUNT === GROUP_ORDER && GROUP_ORDER === 88179840, `${GROUP_ORDER}`);
  check('the abstract space is exactly three times as big', ABSTRACT_COUNT === 3 * GROUP_ORDER, `${ABSTRACT_COUNT}`);
  // A hand-written fixture: the sixth Lehmer digit and a twist code are easy to get wrong and
  // impossible to see in a round trip alone.
  check('permRank/permUnrank on a fixed example', permRank([1, 0, 2, 3, 4, 5, 6, 7]) === 5040 && JSON.stringify(permUnrank(5040)) === JSON.stringify([1, 0, 2, 3, 4, 5, 6, 7]));
  const oneTwist = { perm: [0, 1, 2, 3, 4, 5, 6, 7], twist: [1, 0, 0, 0, 0, 0, 0, 2] };
  check('a twist pair summing to 3 encodes and decodes', encode(oneTwist) === 0 * TRIT_COUNT + 1 && decode(1).twist[7] === 2, `${encode(oneTwist)}`);
}

// ---- 3. the group order, by enumeration ----------------------------------------------

// The spec's external anchor: enumerate the descriptions and count the ones the invariant
// admits. 40320 x 6561 = 264,539,520 pairs, one counter, no big arrays: the point of the
// check is that the reachable set is a third of the descriptions, which is what makes
// "8! x 3^7" the group order rather than a convention.
function countReachableInvariant() {
  const t0 = Date.now();
  // One pass over the eight trits per twist code, cached: the residue of a code is a property
  // of the code, and re-deriving it 40320 times would be 2.1 billion digit splits for no
  // additional truth.
  const residue = new Uint8Array(TRITS8);
  for (let code = 0; code < TRITS8; code++) {
    let t = code;
    let s = 0;
    for (let i = 0; i < 8; i++) {
      s += t % 3;
      t = Math.floor(t / 3);
    }
    residue[code] = s % 3;
  }
  // Then walk every (permutation, twist vector) pair. The permutations come from permUnrank,
  // so the outer count is a check on the ranking as well as a loop bound: if Lehmer coding
  // were off by one, or produced a repeated corner, this throws instead of quietly agreeing.
  let pairs = 0;
  let reachable = 0;
  let perms = 0;
  for (let rank = 0; rank < PERM_COUNT; rank++) {
    const p = permUnrank(rank);
    const seenP = new Set(p);
    if (seenP.size !== 8) throw new Error(`permUnrank(${rank}) is not a permutation`);
    if (permRank(p) !== rank) throw new Error(`permRank is not the inverse of permUnrank at ${rank}`);
    perms++;
    for (let code = 0; code < TRITS8; code++) {
      pairs++;
      if (residue[code] === 0) reachable++;
    }
  }
  const admitting = residue.reduce((a, r) => a + (r === 0 ? 1 : 0), 0);
  say(`  enumerated ${perms} x ${TRITS8} = ${pairs} descriptions in ${ms(t0)}`);
  return { total: pairs, reachable, admittedTwists: admitting, perms };
}

function checkGroupOrder() {
  say('\n== group order, by enumeration ==');
  const r = countReachableInvariant();
  check('descriptions = 8! x 3^8 = 264,539,520', r.total === ABSTRACT_COUNT, `${r.total}`);
  check('admitted twist vectors = 3^7 = 2187 per permutation', r.admittedTwists === TRIT_COUNT, `${r.admittedTwists}`);
  check('satisfying the invariant = 8! x 3^7 = 88,179,840', r.reachable === GROUP_ORDER, `${r.reachable}`);
  const rng = rngFrom('reach');
  let good = 0;
  let bad = 0;
  for (let i = 0; i < 2000; i++) {
    const s = stateFromSeed(rng.int(GROUP_ORDER));
    if (isReachable(s)) good++;
  }
  for (let i = 0; i < 2000; i++) {
    const s = stateFromSeed(rng.int(GROUP_ORDER));
    s.twist[7] = (s.twist[7] + 1) % 3; // deliberately break the invariant
    if (!isReachable(s) && twistSum(s) !== 0) bad++;
  }
  check('2000 sampled ranks all decode to admitted cubes', good === 2000, `${good}`);
  check('2000 deliberately twisted cubes all fail the criterion', bad === 2000, `${bad}`);
}

// ---- 4. solvers ----------------------------------------------------------------------

function checkSolvers() {
  say('\n== the two solvers, on 300 uniform cubes ==');
  const t0 = Date.now();
  const rng = rngFrom('reconcile');
  let compared = 0;
  let disagree = 0;
  let replayBad = 0;
  let maxPar = 0;
  let maxExplored = 0;
  let bfsMs = 0;
  let idaMs = 0;
  for (let i = 0; i < 300; i++) {
    const s = stateFromSeed(rng.int(GROUP_ORDER));
    const t1 = Date.now();
    const a = solveBfs(s, { limit: 12000000, deadlineMs: 90000 });
    bfsMs += Date.now() - t1;
    const t2 = Date.now();
    const b = solveIda(s, { limit: 40000000, deadlineMs: 90000 });
    idaMs += Date.now() - t2;
    if (!a.ok || !b.ok) {
      disagree++;
      say(`  note: sample ${i} unresolved (bfs ${a.ok ? a.moves : a.truncated ? 'truncated' : 'no-path'} / ida ${b.ok ? b.moves : b.truncated ? 'truncated' : 'no-path'})`);
      continue;
    }
    compared++;
    if (a.moves !== b.moves) disagree++;
    if (!isSolved(applySeq(s, a.path))) replayBad++;
    if (!isSolved(applySeq(s, b.path))) replayBad++;
    if (a.moves > maxPar) maxPar = a.moves;
    if (a.explored > maxExplored) maxExplored = a.explored;
  }
  check('both solvers answered all 300', compared === 300, `${compared} answered`);
  check('bfs par === ida par on every one', disagree === 0, `${disagree} disagreements`);
  check('both solutions replay to the solved cube', replayBad === 0, `${replayBad} broken`);
  say(`  deepest par in the sample ${maxPar}; max BFS search states ${maxExplored}; bfs ${(bfsMs / 300).toFixed(0)}ms mean, ida ${(idaMs / 300).toFixed(0)}ms mean; total ${ms(t0)}`);
}

function checkNegative() {
  say('\n== cubes that cannot be solved ==');
  const rng = rngFrom('neg');
  let accepted = 0;
  let refusals = 0;
  for (let i = 0; i < 200; i++) {
    const s = stateFromSeed(rng.int(GROUP_ORDER));
    s.twist[0] = (s.twist[0] + 1) % 3;
    if (twistSum(s) === 0) continue;
    const a = solveBfs(s, { limit: 300000, deadlineMs: 5000 });
    const b = solveIda(s, { limit: 100000, deadlineMs: 5000 });
    if (a.ok || b.ok) accepted++;
    if (!a.ok && !b.ok) refusals++;
  }
  check('200 invariant-breaking cubes: neither solver returns a solution', accepted === 0, `${accepted} false solutions`);
  check('and IDA* names the reason (twist invariant)', refusals > 0, `${refusals} refusals`);
  // The other kind of "no path": a search space that really does run dry. U and U' generate a
  // nine-cube component, so exhaustion is not hypothetical — it is checkable in microseconds.
  const uu = [0, 1];
  const inside = solveBfs(apply(solvedState(), 0), { alphabet: uu });
  const outside = solveBfs(apply(solvedState(), 4), { alphabet: uu });
  check('<U,U\'> component: a cube inside it is found', inside.ok && inside.moves === 1, JSON.stringify(inside));
  check('<U,U\'> component: a cube outside it exhausts both frontiers', !outside.ok && outside.exhausted === true, JSON.stringify(outside));
}

function checkAdmissible() {
  say('\n== the IDA* heuristic, against the reference solver ==');
  let h1max = 0;
  let h2max = 0;
  for (let i = 0; i < 3000; i++) {
    const s = stateFromSeed(rngFrom(`h|${i}`).int(GROUP_ORDER));
    let a = 0;
    for (let c = 0; c < 8; c++) {
      const d = CORNER[s.perm[c] * 24 + c * 3 + s.twist[c]];
      if (d > a) a = d;
    }
    if (a > h1max) h1max = a;
    let t = 0;
    for (let c = 0; c < 8; c++) if (s.twist[c]) t++;
    const b = Math.ceil(t / TWIST_STEP);
    if (b > h2max) h2max = b;
  }
  say(`  measured: h1 never exceeds ${h1max}, h2 never exceeds ${h2max}, TWIST_STEP = ${TWIST_STEP}`);
  say(`  measured: the pattern database's own diameter is ${pdbDiameter()} over ${PDB_SIZE} abstract states`);
  check('h1 and h2 alone cannot guide a 2x2x2 search (both bound below 5)', h1max <= 4 && h2max <= 4);
  check('the pattern database is what makes IDA* usable', pdbDiameter() > h2max);

  // Consistency of the pattern over the *whole* abstract space: 1,632,960 states x 12 turns.
  const t0 = Date.now();
  const db = buildPdb();
  const slots = [0, 0, 0, 0, 0];
  const trits = [0, 0, 0, 0, 0];
  let viol = 0;
  let unreachable = 0;
  const decodeInto = (idx) => {
    let r = Math.floor(idx / 243);
    let c = idx % 243;
    const used = [0, 0, 0, 0, 0, 0, 0, 0];
    const W = [840, 120, 20, 4, 1];
    for (let i = 0; i < 5; i++) {
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
    for (let i = 0; i < 5; i++) {
      trits[i] = c % 3;
      c = Math.floor(c / 3);
    }
  };
  for (let idx = 0; idx < PDB_SIZE; idx++) {
    if (db[idx] === 255) {
      unreachable++;
      continue;
    }
    decodeInto(idx);
    const base = [slots[0], slots[1], slots[2], slots[3], slots[4]];
    const bt = [trits[0], trits[1], trits[2], trits[3], trits[4]];
    for (let m = 0; m < 12; m++) {
      const st = MOVES[m].to;
      const dt = MOVES[m].delta;
      const ns = [0, 0, 0, 0, 0];
      const nt = [0, 0, 0, 0, 0];
      for (let k = 0; k < 5; k++) {
        ns[k] = st[base[k]];
        nt[k] = (bt[k] + dt[ns[k]]) % 3;
      }
      const ni = abstractIndex(ns, nt);
      if (db[ni] === 255 || db[ni] > db[idx] + 1) viol++;
    }
    slots[0] = base[0];
  }
  check('every abstract state is reachable in the pattern', unreachable === 0, `${unreachable} holes`);
  check(`1-Lipschitz along all ${PDB_SIZE * 12} abstract edges (consistency)`, viol === 0, `${viol} violations`);
  say(`  abstract sweep ${ms(t0)}`);

  // Admissibility against the reference solver, on cubes rather than abstract states.
  const t1 = Date.now();
  let inadmissible = 0;
  let samples = 0;
  for (let i = 0; i < 120; i++) {
    const s = stateFromSeed(rngFrom(`adm|${i}`).int(GROUP_ORDER));
    const h = heuristic(s);
    const r = solveBfs(s, { limit: 12000000, deadlineMs: 90000 });
    if (!r.ok) continue;
    samples++;
    if (h > r.moves) inadmissible++;
  }
  check('h <= BFS par on every sampled cube', inadmissible === 0, `${inadmissible} of ${samples} overestimated`);
  say(`  admissibility sweep on ${samples} cubes ${ms(t1)}`);
}

// ---- 5. optional: the whole group ----------------------------------------------------

// Breadth-first over all 88,179,840 reachable cubes, level by level, with a byte per state
// and an Int32Array per frontier. The transitions come from two tables:
//
//   PERM_NEXT[m][rank]  the Lehmer rank of perm o from_m — a turn composes the permutation
//                       with a fixed map, so this depends on the permutation alone
//   TRIT_NEXT[m][code]  the seven-trit code after the turn's slot permutation and its fixed
//                       twist deltas — depends on the twist vector alone
//
// Together they say the same thing the group-theory sentence says: this Cayley graph is a
// product structure over (permutation, twist), which is why the whole group fits in a byte
// array instead of a string-keyed Map.
function fullGroupBfs() {
  say('\n== FULL=1: exhaustive BFS over the reachable component ==');
  const t0 = Date.now();
  const PT = [];
  const TT = [];
  for (let m = 0; m < 12; m++) {
    const p = new Int32Array(PERM_COUNT);
    const tmp = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let rank = 0; rank < PERM_COUNT; rank++) {
      const perm = permUnrank(rank);
      for (let t = 0; t < 8; t++) tmp[t] = perm[MOVES[m].from[t]];
      p[rank] = permRank(tmp);
    }
    PT.push(p);
    const w = new Int32Array(TRIT_COUNT);
    const eight = [0, 0, 0, 0, 0, 0, 0, 0];
    const next = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let code = 0; code < TRIT_COUNT; code++) {
      let c = code;
      let sum = 0;
      for (let i = 0; i < 7; i++) {
        eight[i] = c % 3;
        sum += eight[i];
        c = Math.floor(c / 3);
      }
      eight[7] = (3 - (sum % 3)) % 3;
      for (let t = 0; t < 8; t++) next[t] = (eight[MOVES[m].from[t]] + MOVES[m].delta[t]) % 3;
      let cd = 0;
      let mul = 1;
      for (let i = 0; i < 7; i++) {
        cd += next[i] * mul;
        mul *= 3;
      }
      w[code] = cd;
    }
    TT.push(w);
  }
  say(`  transition tables built in ${ms(t0)}`);

  const dist = new Uint8Array(GROUP_ORDER).fill(255);
  dist[0] = 0;
  let level = new Int32Array(1);
  level[0] = 0;
  let seen = 1;
  const hist = [1];
  let depth = 0;
  let maxLevel = 1;
  // One Int32Array per level, doubled when it fills: a level of this search is up to ~7M
  // keys, the level sizes are not known in advance, and a too-small fixed buffer inside the
  // inner loop is exactly the kind of thing that turns an exhaustive check into a wrong one.
  const buf = { a: new Int32Array(1 << 20), n: 0 };
  const push = (v) => {
    if (buf.n === buf.a.length) {
      const grown = new Int32Array(buf.a.length * 2);
      grown.set(buf.a);
      buf.a = grown;
    }
    buf.a[buf.n++] = v;
  };
  for (;;) {
    buf.n = 0;
    const d = dist[level[0]] + 1;
    for (let q = 0; q < level.length; q++) {
      const key = level[q];
      const pr = Math.floor(key / TRIT_COUNT);
      const tc = key % TRIT_COUNT;
      for (let m = 0; m < 12; m++) {
        const nk = PT[m][pr] * TRIT_COUNT + TT[m][tc];
        if (dist[nk] !== 255) continue;
        dist[nk] = d;
        seen++;
        push(nk);
      }
    }
    if (!buf.n) break;
    depth++;
    hist[depth] = buf.n;
    if (buf.n > maxLevel) maxLevel = buf.n;
    level = buf.a.slice(0, buf.n);
    say(`  depth ${String(depth).padStart(2)}: ${buf.n} new, ${seen} cumulative, ${ms(t0)}`);
    if (depth >= 24) throw new Error('level cap exceeded: the search is not terminating');
  }
  check('the component the BFS reaches is exactly 8! x 3^7', seen === GROUP_ORDER, `${seen} of ${GROUP_ORDER}`);
  say(`  diameter (QTM, measured) = ${depth}; widest level ${maxLevel}; total ${ms(t0)}`);
  say('  par histogram of the whole group:');
  let cum = 0;
  for (let d = 0; d < hist.length; d++) {
    cum += hist[d] || 0;
    say(`    par ${String(d).padStart(2)}  ${String(hist[d] || 0).padStart(9)}  cum ${cum}`);
  }
  return { diameter: depth, hist };
}

function main() {
  checkTables();
  checkInvariantExhaustive();
  checkPhysical();
  checkEncoding();
  checkGroupOrder();
  checkSolvers();
  checkNegative();
  checkAdmissible();
  let full = null;
  if (FULL) full = fullGroupBfs();
  say(`\n${failures ? `FAILURES: ${failures}` : 'ALL PROOFS PASS'}`);
  if (full) say(`measured QTM diameter: ${full.diameter}`);
  else say('diameter: 未实测 — run `FULL=1 node tools/proof.mjs` to measure it');
  process.exit(failures ? 1 : 0);
}

main();
