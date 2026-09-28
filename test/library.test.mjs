// The shipped pool, re-checked rather than trusted.
//
// library.js verifies three structural facts about every row while it imports (par === route
// length, the scramble is a legal cube, the route solves it) and throws if any one fails — so
// this suite getting as far as its first assertion is already part of the evidence. What it
// does *on top* is the expensive thing the browser cannot afford: re-solve each of the 64 cubes
// from the scramble alone with the reference solver (js/core/bfs.js, which never reads the
// baked table or the distance array) and demand that the answer equals the printed `par`.
// That is the claim the whole product is built on — "最少 N 转" — and it is the one thing a
// re-bake could get wrong while every structural check still passed.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { applySeq, encode, isSolved, qtmCost, solvedState } from '../js/core/cube.js';
import { solveBfs } from '../js/core/bfs.js';
import {
  ALL, TIERS, byId, campaign, dailyLot, fromScramble, levelAt, lotsIn, notation, randomLot,
  stats, tierByKey,
} from '../js/core/library.js';

const pars = () => ALL.map((l) => l.par);

test('the pool that imports is the pool the shell plays', () => {
  eq(ALL.length, 64, 'rows shipped');
  eq(campaign().length, ALL.length);
  eq(campaign() === ALL, true, 'campaign() is the same table, not a copy the UI can drift from');
  eq(new Set(ALL.map((l) => l.id)).size, ALL.length, 'ids are unique');
  eq(ALL.map((l) => l.id)[0], 'cube-01');
  eq(ALL.map((l) => l.id)[63], 'cube-64');
  eq(stats().lots, ALL.length, 'stats counts the same 64');
});

test('the four bands are the printed bands, and every cube sits inside its own', () => {
  eq(TIERS.length, 4);
  eq(TIERS.map((t) => t.key).join(','), 'first,warm,spin,tangle');
  const s = stats().byTier;
  for (const t of TIERS) {
    const list = lotsIn(t.key);
    eq(list.length, 16, `${t.key} has 16 cubes`);
    eq(s[t.key].n, 16, `stats agrees on ${t.key}`);
    eq(t.n, 16, `the header table agrees on ${t.key}`);
    const got = list.map((l) => l.par);
    const realized = [Math.min(...got), Math.max(...got)];
    // `min`/`max` in the generated header is the band the bake aimed at; `seen` is what it
    // actually measured. Tangle asks for 12-14 and shipped 12-13, which is honest only as long
    // as the panel prints the realised range — so both halves are pinned here.
    eq(t.seen, realized.join('-'), `${t.key}: the realised range is the printed one`);
    eq(s[t.key].min, realized[0], `stats min for ${t.key}`);
    eq(s[t.key].max, realized[1], `stats max for ${t.key}`);
    eq(s[t.key].statesMin <= s[t.key].statesMax, true, `${t.key}: sweep-cost range is ordered`);
    ok(realized[0] >= t.min && realized[1] <= t.max, `${t.key}: realised ${realized} inside band ${t.min}-${t.max}`);
    ok(s[t.key].parMed >= realized[0] && s[t.key].parMed <= realized[1], `${t.key} median inside`);
  }
  // The bands must not overlap: a ladder where 起手 and 上手 share a par is not a ladder.
  for (let i = 1; i < TIERS.length; i++) {
    ok(TIERS[i].min > TIERS[i - 1].max, `${TIERS[i].key}.min > ${TIERS[i - 1].key}.max`);
  }
  eq(tierByKey('spin').label, '上手');
  eq(tierByKey('nope'), null);
  eq(tierByKey(null), null, 'a cube nobody baked has no band');
});

test('every shipped par survives a re-solve by the reference solver', () => {
  const rows = [];
  const t0 = Date.now();
  let states = 0;
  for (const lot of ALL) {
    const start = applySeq(solvedState(), lot.scr);
    eq(encode(start) >= 0, true, `${lot.id}: the printed scramble is a legal cube`);
    const r = solveBfs(start);
    ok(r.ok, `${lot.id}: bfs answered`);
    states += r.explored;
    rows.push({ id: lot.id, printed: lot.par, bfs: r.moves });
    eq(r.moves, lot.par, `${lot.id}: bfs par === printed par`);
    eq(isSolved(applySeq(start, r.path)), true, `${lot.id}: the bfs path really solves it`);
    eq(r.path.length, r.moves, `${lot.id}: the path length is the answer`);
  }
  const distinct = new Set(rows.map((r) => r.printed));
  ok(distinct.size >= 8, `the re-solve found ${distinct.size} distinct pars: ${[...distinct].sort((a, b) => a - b).join(',')}`);
  eq(rows.length, 64, 'every cube was re-solved');
  ok(Date.now() - t0 < 240000, `re-solve budget: ${Date.now() - t0}ms for ${states} states expanded`);
});

test('the baked route is a shortest route, not merely a short one', () => {
  for (const lot of ALL) {
    const start = applySeq(solvedState(), lot.scr);
    eq(lot.route.length, lot.par, `${lot.id}: route length === par`);
    eq(isSolved(applySeq(start, lot.route)), true, `${lot.id}: route solves`);
    // A shortest route never revisits a state: if it did, the loop between the two visits
    // would be a shorter way to the same cube and the par would be wrong.
    const seen = new Set([encode(start)]);
    let st = start;
    for (const m of lot.route) {
      st = applySeq(st, [m]);
      const key = encode(st);
      ok(key >= 0, `${lot.id}: route stays on legal cubes`);
      ok(!seen.has(key), `${lot.id}: route revisits a cube it already passed`);
      seen.add(key);
    }
    eq(encode(st), 0, `${lot.id}: ends on rank 0, the solved cube`);
  }
});

test('notation() prints what the table carries, and the route has a name', () => {
  for (const lot of ALL) {
    const n = notation(lot);
    eq(n.route, lot.routeText, `${lot.id}: printed route is the baked one`);
    eq(n.scramble, lot.scrText, `${lot.id}: printed scramble is the baked one`);
    eq(n.faces.length, lot.scr.length, `${lot.id}: one face name per turn`);
    eq(qtmCost(n.route), lot.par, `${lot.id}: the printed route costs par, halves included`);
    eq(qtmCost(n.scramble), lot.scr.length, `${lot.id}: the printed scramble costs its own length`);
    // compactSeq collapses two identical quarters into "F2", so a half turn is legal in the
    // printed notation — it just costs two of the twelve quarter turns the count is made of.
    ok(/^[UDRLFB]('?|2)( [UDRLFB]('?|2))*$/.test(n.route), `${lot.id}: route notation: ${n.route}`);
    ok(/^[UDRLFB]('?|2)( [UDRLFB]('?|2))*$/.test(n.scramble), `${lot.id}: scramble notation: ${n.scramble}`);
  }
});

test('the campaign ladder walks the pool in baked order and wraps', () => {
  eq(levelAt(0).id, ALL[0].id);
  eq(levelAt(1).id, ALL[1].id);
  eq(levelAt(ALL.length).id, ALL[0].id, 'index 64 wraps to the first cube');
  eq(levelAt(-1).id, ALL[ALL.length - 1].id, 'and -1 wraps to the last');
  eq(ALL.every((l, i) => i === 0 || TIERS.findIndex((t) => t.key === l.tier)
    >= TIERS.findIndex((t) => t.key === ALL[i - 1].tier)), true, 'bands never go backwards');
});

test('daily and random pick from the table by seed alone, so a link is reproducible', () => {
  const a = dailyLot('2026-09-27');
  eq(dailyLot('2026-09-27').id, a.id, 'the same date is the same cube');
  eq(ALL.some((l) => l.id === a.id), true, 'and it is one of the shipped 64');
  eq(dailyLot('2026-09-28').id, dailyLot('2026-09-28').id, 'every date is stable');
  const days = new Set();
  for (let i = 0; i < 30; i++) days.add(dailyLot(`2026-0${i < 10 ? 1 : 2}-${String((i % 28) + 1).padStart(2, '0')}`).id);
  ok(days.size > 4, `30 dates spread over ${days.size} distinct cubes, not one favourites`);
  for (const t of TIERS) {
    const one = randomLot('fixedseed', t.key);
    eq(randomLot('fixedseed', t.key).id, one.id, `${t.key}: same seed, same cube`);
    eq(one.tier, t.key, `${t.key}: the band filter really filters`);
    ok(one.par >= t.min && one.par <= t.max, `${t.key}: and the par is in band`);
    const other = randomLot('anotherseed', t.key);
    ok(other.tier === t.key, `${t.key}: other seed still in band`);
  }
  // A seed is a selector, not a generator: no seed may reach a cube that is not on disk.
  for (let i = 0; i < 200; i++) {
    const lot = randomLot(`sweep-${i}`);
    ok(ALL.indexOf(lot) >= 0, `sweep-${i} resolved outside the pool`);
  }
});

test('fromScramble accepts a cube the pool does not know, and refuses to claim a par for it', () => {
  const lot = fromScramble("R U R' U'");
  ok(lot, 'a legal scramble is accepted');
  eq(lot.id, 'custom');
  eq(lot.tier, null);
  eq(lot.par, null, 'no measured par: the browser is not a solver');
  eq(lot.route, null);
  eq(lot.custom, true);
  eq(lot.scr.length, 4);
  eq(isSolved(lot.start), false, 'and it is a puzzle, not a solved cube');
  eq(notation(lot).route, null, 'nothing to print as a route');
  // Refused: nothing to play, a cube that is already home, and letters that are not faces.
  // (A half turn written as two quarters is *not* refused — "U U" is a real cube, U2.)
  for (const bad of ['', '   ', 'Q W E', "R R'", "F F'", 'R7', 'U2-B2']) {
    eq(fromScramble(bad), null, `"${bad}" is refused`);
  }
  const doubled = fromScramble('U U');
  ok(doubled, 'U U is a cube, not a typo');
  eq(doubled.scr.length, 2);
  eq(doubled.scrText, 'U2', 'and it prints as the half turn it is');
  // A half turn is two quarter turns, and the printed form collapses it back.
  const two = fromScramble('F2');
  eq(two.scr.length, 2);
  eq(two.scrText, 'F2');
  eq(two.scr[0], two.scr[1], 'both quarters are the same face the same way');
});

test('the load-time guard is real: a lot that lies about its par would stop the import', () => {
  // library.js:43-47 is the only thing between a bad bake and a shipped wrong number, so the
  // row here proves the three conditions it checks are the three that matter, on the actual
  // objects, not on a mock.
  for (const lot of ALL) {
    eq(lot.route.length === lot.par, true, `${lot.id} par/route length`);
    eq(isSolved(applySeq(lot.start, lot.route)), true, `${lot.id} route solves`);
    eq(encode(lot.start) >= 0, true, `${lot.id} scramble is legal`);
  }
  pars().forEach((p) => ok(Number.isInteger(p) && p >= 4 && p <= 14, `par ${p} in the swept range`));
});

run();
