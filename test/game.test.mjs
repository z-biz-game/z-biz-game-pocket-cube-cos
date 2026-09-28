// The rules layer: what a turn costs, what undo gives back, and what the hint is allowed to
// claim. js/core/game.js is the only place the twelve-turn alphabet meets a player, and it is
// the module the panel calls directly, so everything asserted here is a number the screen prints.
//
// The hint contract is the load-bearing one. game.js imports no solver (js/core/bfs.js and
// js/core/ida.js are reachable from here only through the baked table), so a hint is a lookup
// into tools/bake.mjs's certified route — which means it may only ever answer about a cube the
// route actually passes through. A suite that only checks "the hint is correct when you follow
// the route" would miss the whole point: the interesting case is the player who did not.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { MOVES, applySeq, compactSeq, encode, isSolved, parseSeq, qtmCost, solvedState } from '../js/core/cube.js';
import {
  createGame, grade, hint, onRoute, overPar, reset, routeMap, scrambleText, shareCode, startOf,
  turn, undo,
} from '../js/core/game.js';
import { ALL, fromScramble } from '../js/core/library.js';

const lot1 = ALL[0];

test('a game starts where the scramble says it starts, and is not solved', () => {
  const g = createGame(lot1);
  eq(g.moves, 0);
  eq(g.hints, 0);
  eq(g.done, false);
  eq(g.par, lot1.par);
  eq(g.route.join(','), lot1.route.join(','), 'the game carries its own copy of the route');
  eq(encode(g.state), encode(startOf(lot1)));
  ok(!isSolved(g.state), 'a baked lot is a puzzle, not a solved cube');
  // Mutating the game must not reach the pool: every level-1 load shares one lot object.
  g.route[0] = -7;
  eq(lot1.route[0] === -7, false, 'a game writes through to the shipped pool');
});

test('a turn is one move, all twelve are legal, and anything else is refused for free', () => {
  const g = createGame(lot1);
  for (let m = 0; m < MOVES.length; m++) {
    const h = createGame(lot1);
    eq(turn(h, m), true, `turn ${MOVES[m].name}`);
    eq(h.moves, 1);
    eq(h.steps.join(','), String(m));
  }
  for (const bad of [-1, 12, 1.5, NaN, undefined, 'U', null]) {
    const h = createGame(lot1);
    eq(turn(h, bad), false, `refused ${String(bad)}`);
    eq(h.moves, 0, 'a refused turn is not billed');
    eq(encode(h.state), encode(startOf(lot1)), 'a refused turn does not touch the cube');
  }
});

test('undo walks the turns back one for one and cannot go below the start', () => {
  const g = createGame(lot1);
  const ranks = [encode(g.state)];
  for (const m of [0, 3, 3, 5, 11]) {
    turn(g, m);
    ranks.push(encode(g.state));
  }
  eq(g.moves, 5);
  for (let i = ranks.length - 1; i > 0; i--) {
    eq(undo(g), true);
    eq(encode(g.state), ranks[i - 1], `undo ${i}`);
    eq(g.moves, i - 1);
  }
  eq(g.moves, 0);
  eq(undo(g), false, 'undo on the start state does nothing');
  eq(g.moves, 0, 'and never goes negative');
});

test('reset clears the count and the hints but keeps the way you were looking', () => {
  const g = createGame(lot1);
  turn(g, 2);
  turn(g, 7);
  hint(g);
  g.view.yaw = 1.25;
  g.view.pitch = -0.4;
  reset(g);
  eq(g.moves, 0);
  eq(g.hints, 0);
  eq(g.steps.length, 0);
  eq(encode(g.state), encode(startOf(lot1)));
  eq(g.done, false);
  eq([g.view.yaw, g.view.pitch], [1.25, -0.4], 'orbiting is free, so resetting cannot reset it');
});

test('the hint replays the certified route exactly, and counts down what is left', () => {
  const g = createGame(lot1);
  ok(onRoute(g), 'the start state is on the route by construction');
  for (let i = 0; i < lot1.par; i++) {
    const h = hint(g);
    ok(h.available, `hint ${i} available`);
    eq(h.move, lot1.route[i], `hint ${i} names route[${i}]`);
    eq(h.name, MOVES[lot1.route[i]].name);
    eq(h.left, lot1.par - i - 1, 'left counts the turns after this one');
    turn(g, h.move);
  }
  eq(g.done, true);
  eq(g.moves, lot1.par);
  const after = hint(g);
  eq(after.available, false);
  eq(after.reason, 'solved', 'a solved cube has no next turn to name');
});

test('off the route the hint refuses out loud, bills itself, and moves nothing', () => {
  const g = createGame(lot1);
  turn(g, lot1.route[0] ^ 1); // one turn the certified route never takes
  eq(onRoute(g), false);
  const before = encode(g.state);
  const h = hint(g);
  eq(h.available, false);
  eq(h.reason, 'off-route');
  ok(h.offRoute === true);
  ok(/不搜索/.test(h.message), 'the refusal says why: the browser is not a solver');
  eq(g.hints, 1, 'a refusal is still a hint the player asked for');
  eq(encode(g.state), before, 'and it changes nothing on the cube');
  // undo is the way back, and the route map still has the start state
  undo(g);
  ok(onRoute(g), 'undo returns to the route');
});

test('the route map is the prefix of the route plus its end, and nothing else', () => {
  const map = routeMap(lot1);
  eq(map.size, lot1.par + 1, 'par turns in, plus the solved cube');
  let st = startOf(lot1);
  for (let i = 0; i < lot1.par; i++) {
    const e = map.get(encode(st));
    ok(e, `state ${i} is keyed`);
    eq(e.move, lot1.route[i]);
    eq(e.left, lot1.par - i);
    st = applySeq(st, [lot1.route[i]]);
  }
  const end = map.get(encode(st));
  eq(end.move, -1, 'the last keyed state has no turn left to name');
  eq(end.left, 0);
  eq(isSolved(st), true);
  // The same cube reached another way is the same position: the map is keyed by state, not by
  // the move list that got there.
  ok(routeMap(lot1) === map, 'one map per lot, built once');
});

test('grade and over-par are measured against the baked par, and only against it', () => {
  const fresh = createGame(lot1);
  eq(grade(fresh).key, 'perfect', '0 turns is not over par');
  eq(grade(fresh).stars, 3);
  turn(fresh, 0);
  eq(fresh.moves, 1);
  eq(overPar(fresh), 0, 'under par prints zero, never a negative');
  eq(grade(fresh).key, 'perfect');

  // Every real over-par finish is a route with detours in front of it: a there-and-back pair
  // costs two turns and lands where it started, so par + 2k is the shape an honest player
  // actually finishes at. Setting `moves` by hand would grade a state the game cannot reach.
  const finishWith = (detours) => {
    const g = createGame(lot1);
    for (let i = 0; i < detours; i++) {
      ok(turn(g, g.route[i] ^ 1), 'detour out');
      ok(turn(g, g.route[i]), 'detour back');
    }
    for (const m of lot1.route) ok(turn(g, m), `route turn ${m} on a ${detours}-detour run`);
    eq(g.done, true);
    return g;
  };
  eq(finishWith(0).moves, lot1.par);
  eq(grade(finishWith(0)).stars, 3);
  eq(grade(finishWith(0)).label, '一手不差');
  eq(overPar(finishWith(0)), 0);
  eq(finishWith(1).moves, lot1.par + 2);
  eq(grade(finishWith(1)).key, 'clean');
  eq(grade(finishWith(1)).stars, 2);
  eq(grade(finishWith(1)).label, '干净收口');
  eq(overPar(finishWith(1)), 2);
  eq(finishWith(2).moves, lot1.par + 4);
  eq(overPar(finishWith(2)), 4);
  eq(grade(finishWith(2)).key, 'over', 'a detour pair past +3 drops to one star');
  eq(grade(finishWith(2)).stars, 1);
  eq(grade(finishWith(2)).label, '绕了一圈');
});

test('a lot with no baked route is playable and admits it, instead of throwing', () => {
  // The `#/cube/<转记法>` route. js/core/game.js used to call lot.route.slice() here and take
  // the whole shell down with a TypeError before the first frame — README's promise that a
  // hand-typed scramble "也能玩，但它印未实测" was not true of the shipped code.
  const lot = fromScramble("R U R' U'");
  ok(lot, 'the notation parses to a cube');
  eq(lot.route, null);
  eq(lot.par, null);
  const g = createGame(lot);
  eq(g.route, null);
  eq(g.par, null);
  eq(g.done, false);
  eq(onRoute(g), false, 'with no route there is no route to be on');
  eq(routeMap(lot), null, 'and no map to look up');
  eq(overPar(g), null, 'nothing to be over');
  eq(grade(g).measured, false);
  const h = hint(g);
  eq(h.available, false);
  eq(h.reason, 'no-route');
  ok(/没有认证路线/.test(h.message));
  eq(g.hints, 1, 'the refusal is still billed');
  // and it plays: twelve quarter turns are always legal on a cube
  let n = 0;
  for (let m = 0; m < 12; m++) if (turn(g, m)) n++;
  eq(n, 12);
  eq(g.moves, 12);
  // undo still works, because undo does not consult the route
  while (undo(g)) { /* walk home */ }
  eq(g.moves, 0);
  // solving it is a solve with no stars attached
  const s = createGame(lot);
  ok(turn(s, 0) === true);
  undo(s);
  for (const m of lot.scr.map((x) => x ^ 1).reverse()) turn(s, m);
  eq(s.done, true);
  eq(s.moves, lot.scr.length);
  eq(grade(s).measured, false);
});

test('share strings are notation the parser reads back, for baked and typed cubes alike', () => {
  const g = createGame(lot1);
  eq(shareCode(lot1), lot1.scrText, 'a pool lot shares the scramble it was built from');
  eq(scrambleText(g), lot1.scrText);
  eq(scrambleText(createGame(fromScramble("F2 R U'"))), "F2 R U'");
  // Read the printed code back through the parser: it has to describe the same cube. The index
  // lists themselves may differ — "U2" is U U, not U U' — which is why this compares cubes.
  for (const lot of ALL) {
    const p = parseSeq(shareCode(lot));
    ok(p.ok, `${lot.id}: printed scramble parses: ${p.error}`);
    eq(encode(applySeq(solvedState(), p.moves)), encode(startOf(lot)), `${lot.id}: prints its own cube`);
    eq(p.moves.length, qtmCost(shareCode(lot)), `${lot.id}: cost is the parsed length`);
  }
  const typed = fromScramble("F2 R U'");
  eq(typed.scr, [MOVES.findIndex((m) => m.name === 'F'), MOVES.findIndex((m) => m.name === 'F'),
    MOVES.findIndex((m) => m.name === 'R'), MOVES.findIndex((m) => m.name === "U'")]);
  eq(typed.scr.length, 4, 'a half turn is two quarter turns');
  eq(typed.scrText, compactSeq(typed.scr), 'and the printed form is the compacted list');
  eq(parseSeq(compactSeq(typed.scr)).moves, typed.scr, 'compact then parse is the identity on a typed cube');
  eq(typed.par, null);
});

run();
