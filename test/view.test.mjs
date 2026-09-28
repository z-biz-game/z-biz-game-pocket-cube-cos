// js/view.js puts its head comment where its promise is: the one geometry question the view
// answers — "the finger went that way, so which face turns?" — is `dragTurn`, and it says that
// function is "a pure function of js/core/geom.js and is asserted in node (test/view.test.mjs)
// rather than only in a browser, because a sign error in it is invisible on screen and obvious
// in a test". This file is that assertion. Until now the named suite did not exist, so the only
// thing standing between a flipped sign and a shipped game was a player's thumb.
//
// The anchor is geom.js's *physical* sticker model, which is the independent half of this repo:
// it holds, per slot, a corner piece and the current direction of each of that piece's three
// home stickers, and it reads none of the tables above it. So "the sticker the finger pushed
// along ends up pointing where the finger pushed it" is checked against a moving cube, not
// against another vector identity the same file wrote.
//
// What is NOT here, because it needs a canvas: the projection, the hit test, and the fact that
// a sticker's centre can be painted over by a nearer cubie (js/view.js's `pressable`). That
// lives in the @pointer browser scenario, which drags the real page over CDP.

import { test, run, ok, eq, fail } from '../tools/harness.mjs';
import {
  MOVES, SLOT_COORD, applyMat, cross, dot, homeStickers, physicalSolved, physicalTurn,
  rotationMatrix, sameVec,
} from '../js/core/geom.js';
import { dragTurn } from '../js/view.js';

const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const neg = (v) => [-v[0], -v[1], -v[2]];
const axisIndexOf = (v) => (v[0] !== 0 ? 0 : v[1] !== 0 ? 1 : 2);

// The view's own generators, re-declared from the conventions they must agree with: the three
// outward normals of a corner are the signed axes through it, and the four slides of a sticker
// are the two in-plane axes in both directions. If view.js changes either, the triples below
// change with it and the assertions stop describing the same object — which is the point of
// spelling them out rather than importing private helpers.
const slotNormals = (slot) => SLOT_COORD[slot].map((s, i) => (s > 0 ? AXES[i].slice() : neg(AXES[i])));
const inPlaneDirs = (n) => {
  const i = axisIndexOf(n);
  const out = [];
  for (let a = 0; a < 3; a++) {
    if (a === i) continue;
    out.push(AXES[a].slice(), neg(AXES[a]));
  }
  return out;
};

const TRIPLES = [];
for (let slot = 0; slot < 8; slot++) {
  for (const n of slotNormals(slot)) {
    for (const u of inPlaneDirs(n)) TRIPLES.push({ slot, n, u });
  }
}

test('dragTurn answers every (corner, face, slide) triple with one of the twelve quarter turns', () => {
  eq(TRIPLES.length, 96, '8 corners x 3 faces x 4 slides');
  const bad = [];
  for (const t of TRIPLES) {
    const m = dragTurn(t.slot, t.n, t.u);
    if (!(Number.isInteger(m) && m >= 0 && m < MOVES.length)) bad.push({ slot: t.slot, n: t.n, u: t.u, got: m });
  }
  eq(bad, [], 'a gesture that returns -1 is the view silently dropping a legal drag');
});

// The load-bearing row. Sliding the sticker that points along `n` toward `u` is the right-handed
// quarter turn about a = n x u, because that rotation carries n onto u:
//     R(a, +1) n = a x n = (n x u) x n = u (n . n) - n (n . u) = u
// with n a unit vector ⟂ u. So on the physical cube the very sticker that was pointing along n
// must finish pointing along u, in the corner that R(a, +1) puts the whole corner at. A dragTurn
// that returned the *inverse* turn would put it along -u instead — which is exactly the sign this
// file exists to pin.
test('the sticker follows the finger: all 96 triples land where the physical cube says', () => {
  const bad = [];
  for (const { slot, n, u } of TRIPLES) {
    const move = dragTurn(slot, n, u);
    if (move < 0) { bad.push({ slot, n, u, why: 'no turn' }); continue; }
    const a = cross(n, u);
    const centre = SLOT_COORD[slot].slice();
    const destCoord = applyMat(rotationMatrix(a, 1), centre);
    const dest = (destCoord[0] > 0 ? 1 : 0) | (destCoord[1] > 0 ? 2 : 0) | (destCoord[2] > 0 ? 4 : 0);
    const phys = physicalTurn(physicalSolved(), move);
    const home = homeStickers(slot);
    let j = -1;
    for (let k = 0; k < 3; k++) if (sameVec(home[k], n)) j = k;
    if (j < 0) fail(`homeStickers(${slot}) does not contain its own normal [${n}]`);
    const landed = phys.slots[dest];
    if (landed.piece !== slot) {
      bad.push({ slot, n, u, move, why: `piece ${landed.piece} landed at ${dest}, expected ${slot}` });
      continue;
    }
    if (!sameVec(landed.dirs[j], u)) {
      bad.push({ slot, n, u, move, why: `the pushed sticker points [${landed.dirs[j]}], expected [${u}]` });
      continue;
    }
    // The two claims must be about the same corner: the table the engine and the animation both
    // use sends this slot to that destination.
    if (MOVES[move].to[slot] !== dest) {
      bad.push({ slot, n, u, move, why: `MOVES[].to says ${MOVES[move].to[slot]}, the cube says ${dest}` });
    }
  }
  eq(bad, [], 'a drag that turns the wrong way still moves something on screen');
});

test('dragging the other way is the inverse turn, for all 48 opposite pairs', () => {
  const bad = [];
  for (let slot = 0; slot < 8; slot++) {
    for (const n of slotNormals(slot)) {
      for (const u of [AXES.filter((_, i) => i !== axisIndexOf(n))[0].slice(), AXES.filter((_, i) => i !== axisIndexOf(n))[1].slice()]) {
        const fwd = dragTurn(slot, n, u);
        const back = dragTurn(slot, n, neg(u));
        // MOVES is (face cw, face ccw) pairs, so an inverse is index ^ 1.
        if (back !== (fwd ^ 1)) bad.push({ slot, n: n.join(), u: u.join(), fwd, back });
      }
    }
  }
  eq(bad, [], 'a reverse drag must undo, not merely differ');
});

// The four slides of one sticker are the four quarter turns of the *two faces that sticker
// borders*. Anything else means inPlaneDirs and dragTurn disagree about the plane, and the
// symptom on screen is a corner that turns on a drag that looks like it should do nothing.
test('one sticker has exactly four drags: the two neighbouring faces, both ways', () => {
  const bad = [];
  for (let slot = 0; slot < 8; slot++) {
    for (const n of slotNormals(slot)) {
      const moves = inPlaneDirs(n).map((u) => dragTurn(slot, n, u));
      const uniq = new Set(moves);
      const faces = new Set(moves.map((m) => m >> 1));
      if (uniq.size !== 4 || faces.size !== 2) bad.push({ slot, n: n.join(), moves: [...uniq], faces: [...faces] });
      // both directions of both faces: cw and ccw are the ^1 pair of each other
      for (const m of uniq) if (!uniq.has(m ^ 1)) bad.push({ slot, n: n.join(), missing: m ^ 1 });
    }
  }
  eq(bad, [], 'the four slides of a sticker are not four arbitrary turns');
});

// dragTurn's answer must be the turn of a layer this corner is actually in: the axis it rotates
// about is n x u, and the moving layer is the one on the corner's own side of that axis.
test('the gesture turns the layer that contains the corner, never the far one', () => {
  const bad = [];
  for (const { slot, n, u } of TRIPLES) {
    const move = dragTurn(slot, n, u);
    const m = MOVES[move];
    if (dot(m.normal, SLOT_COORD[slot]) <= 0) bad.push({ slot, n: n.join(), u: u.join(), move, normal: m.normal });
    if (m.to[slot] === slot) bad.push({ slot, move, why: 'the corner it is standing on does not move' });
  }
  eq(bad, [], 'a drag on the back layer would turn four corners the player never touched');
});

run();
