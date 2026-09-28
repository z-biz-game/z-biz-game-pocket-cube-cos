// A game in progress: pure state plus the rules that touch it. No DOM anywhere in here,
// which is what lets test/game.test.mjs and tools/playtest.mjs drive the same object that
// the screen draws.
//
// The one design decision worth reading carefully: `hint` never searches. The browser is not
// allowed to solve a cube (js/core/bfs.js and js/core/ida.js are not imported here, and a
// test asserts that they are not reachable from this module). What it may do is look up the
// *certified* route that tools/bake.mjs measured, and say what the next turn of that route is
// — which is a table lookup, and the table is keyed by the state you are actually in, so a
// player who has followed the route exactly gets the route's next turn, and a player who has
// deviated is told the truth instead of being handed a number nobody verified.
//
// Deviation is recoverable by construction: undo walks the route back, so getting off it and
// getting back on it are both one button.

import { MOVES, apply, applySeq, clone, encode, formatSeq, inverseMove, isSolved, solvedState, validate } from './cube.js';

// A baked lot carries its scramble and its route as move indices; the start state is derived,
// not stored, because deriving it is free and storing it is one more thing that can disagree
// with the scramble.
export function startOf(lot) {
  return applySeq(solvedState(), lot.scr);
}

// rank -> the turn that keeps you on the certified route, and how many turns remain after it.
// Built once per lot and hung on the object; every game from the same lot shares it.
//
// A `#/cube/<乱序>` lot has no route, so there is no map to build and this returns null rather
// than inventing an empty one: an empty Map would read as "on a certified route, at its end".
export function routeMap(lot) {
  if (!lot.route) return null;
  if (lot.hintMap) return lot.hintMap;
  const map = new Map();
  let st = startOf(lot);
  for (let i = 0; i < lot.route.length; i++) {
    addHint(map, lot, st, lot.route[i], lot.route.length - i);
    st = apply(st, lot.route[i]);
  }
  addHint(map, lot, st, -1, 0);
  lot.hintMap = map;
  return map;
}

// `encode` returns -1 for a cube the invariant says cannot be solved, so a key collision here
// is not a bookkeeping detail: it means a baked route walked into an unsolvable state, which
// means the tables or the bake are broken. Refuse loudly rather than hint nonsense.
function addHint(map, lot, state, move, left) {
  const rank = encode(state);
  if (rank < 0) throw new Error(`lot ${lot.id}: route passes through an unsolvable cube`);
  map.set(rank, { move, left });
}

export function createGame(lot) {
  const start = startOf(lot);
  const err = validate(start);
  if (err) throw new Error(`lot ${lot.id} decodes to a non-cube: ${err}`);
  return {
    lot,
    id: lot.id,
    tier: lot.tier,
    par: lot.par,
    route: lot.route ? lot.route.slice() : null,
    start,
    state: clone(start),
    steps: [], // the turns the player has committed, in order
    moves: 0,
    hints: 0,
    done: isSolved(start),
    // Which way you are looking at the cube. Explicitly *not* state: orbiting is free, and a
    // test exists to make sure nobody ever charges a turn for it.
    view: { yaw: 0.62, pitch: 0.42 },
  };
}

export function current(game) {
  return game.state;
}

// Commit a quarter turn. Returns false (and changes nothing) for a move outside the twelve,
// for a cube that is already solved, and for a state that is not a cube at all.
//
// Note what is *not* checked: whether the turn is one you "should" want. All twelve are always
// legal on a cube, and the game's job is to count them, not to second-guess them.
export function turn(game, move) {
  if (game.done) return false;
  if (!Number.isInteger(move) || move < 0 || move >= MOVES.length) return false;
  if (validate(game.state)) return false;
  game.state = apply(game.state, move);
  game.steps.push(move);
  game.moves++;
  if (isSolved(game.state)) game.done = true;
  return true;
}

// The turn that would undo the last one. Kept next to `turn` so the sign convention lives in
// exactly one place — the view asks for it when it wants to show what a reverse drag will do.
export function undo(game) {
  const last = game.steps.pop();
  if (last === undefined) return false;
  game.state = apply(game.state, inverseMove(last));
  game.moves--;
  game.done = false;
  return true;
}

export function reset(game) {
  game.state = clone(game.start);
  game.steps = [];
  game.moves = 0;
  game.hints = 0;
  game.done = isSolved(game.start);
}

// Are you still standing on the certified route? A membership test on the state you are in,
// not a comparison of move lists: two different ways of reaching the same cube are the same
// position as far as the route cares. The certified route is a shortest one, so it never
// revisits a state and the prefix set has no ambiguity to trip over.
export function onRoute(game) {
  const map = routeMap(game.lot);
  return !!map && map.has(encode(game.state));
}

// The next turn of the certified route from wherever the player stands, or an honest refusal.
// `left` counts the turns that remain *after* taking it, which is what the panel prints as
// "还有 N 步".
export function hint(game) {
  if (game.done) return { available: false, reason: 'solved' };
  const map = routeMap(game.lot);
  game.hints++;
  if (!map) {
    return {
      available: false, reason: 'no-route', offRoute: false,
      message: '这一局没有认证路线可提示：手输的乱序不附带 par，前端也不搜索。',
    };
  }
  const entry = map.get(encode(game.state));
  if (!entry) {
    return {
      available: false, reason: 'off-route', offRoute: true,
      message: '已偏离认证路线：浏览器端不搜索，只认烘焙好的路线。撤销可以走回去，或重开本局。',
    };
  }
  if (entry.move < 0) return { available: false, reason: 'solved', offRoute: false };
  return {
    available: true,
    move: entry.move,
    name: MOVES[entry.move].name,
    face: MOVES[entry.move].face,
    left: entry.left - 1,
    offRoute: false,
  };
}

// Turns used against the certified shortest route, and the three grades the win card prints.
// Defined here rather than in the markup so the tests can assert them and the browser cannot
// disagree with node about what "完美" costs. Both are undefined when the lot carries no
// measured par: `moves - null` is `moves`, which would print the whole count as "超出".
export function grade(game) {
  if (game.par == null) return { key: 'unmeasured', label: '复原了', stars: 0, measured: false };
  const over = game.moves - game.par;
  if (over <= 0) return { key: 'perfect', label: '一手不差', stars: 3 };
  if (over <= 3) return { key: 'clean', label: '干净收口', stars: 2 };
  return { key: 'over', label: '绕了一圈', stars: 1 };
}

export function overPar(game) {
  return game.par == null ? null : Math.max(0, game.moves - game.par);
}

// The player's own turns, in quarter-turn notation. The share string is built from this, so a
// link carries a claim the listener can replay without trusting the sender.
export function moveLog(game) {
  return formatSeq(game.steps);
}

// What a link needs to reproduce this exact cube: the lot id, or — for a random or daily cube
// that is not in the pool — the scramble itself.
export function shareCode(lot) {
  return lot.scrText || formatSeq(lot.scr);
}

// The scramble as the player sees it in the panel. Pool lots carry notation; a custom cube
// derives it.
export function scrambleText(game) {
  return game.lot && game.lot.scrText ? game.lot.scrText : formatSeq(game.lot ? game.lot.scr : []);
}
