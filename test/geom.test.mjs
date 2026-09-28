// The geometry layer: the twelve turn tables, the twist definition, and the two models that
// have to agree about them. This suite is the reason `par` is a measurement of a cube and not
// a measurement of a typo.

import { test, run, ok, eq } from '../tools/harness.mjs';
import {
  MOVES, MOVE_COUNT, SLOT_COORD, AXIS_LABEL, FACES, homeStickers, rotationMatrix, twistOf,
  cwTurnOf, movingSlots, physicalSolved, physicalTurn, project, stickerCensus, stickerDirections,
  stickersOf, cross, dot,
} from '../js/core/geom.js';
import { apply, applySeq, isSolved, solvedState, twistSum, validate } from '../js/core/cube.js';

const NAMES = MOVES.map((m) => m.name);

test('the alphabet is twelve quarter turns of six faces, clockwise first', () => {
  eq(MOVE_COUNT, 12, 'QTM has twelve quarter turns');
  eq(NAMES.join(' '), "U U' D D' R R' L L' F F' B B'");
  eq(MOVES.map((m) => m.face).join(''), 'UUDDRRLLFFBB');
  eq(MOVES.map((m) => m.dir).join(''), '1,-1,1,-1,1,-1,1,-1,1,-1,1,-1'.split(',').join(''));
});

test('a clockwise face turn is a right-handed -90 degrees about the outward normal', () => {
  // The single convention every table in this repo is derived from, written out for U where it
  // has a hand-checkable consequence: hold the cube with F toward you and turn the top layer
  // clockwise as seen from above. The corner at up-front-left (slot 6, coords -1,1,1) travels
  // to up-back-left (slot 2), and nothing outside the top layer moves.
  eq(MOVES[0].to.join(','), '0,1,3,7,4,5,2,6', 'U: 6->2->3->7->6');
  eq(MOVES[0].from.join(','), '0,1,6,2,4,5,7,3', 'from is the inverse of to');
  eq(project(physicalTurn(physicalSolved(), 0)).perm.join(','), '0,1,6,2,4,5,7,3', 'the pieces land where the slot map says');
  // The same statement in the language of matrices: +z goes to -x under U, and the axis stays.
  const m = rotationMatrix([0, 1, 0], -1);
  eq([m[0][2], m[1][2], m[2][2]].join(','), '-1,0,0');
  eq([m[0][1], m[1][1], m[2][1]].join(','), '0,1,0');
  // D has the opposite normal, so seen from above the bottom layer runs the other way:
  // down-back-left (slot 0, -1,-1,-1) travels to down-front-left (slot 4, -1,-1,1).
  eq(MOVES[2].to.join(','), '4,0,2,3,5,1,6,7', 'D: 0->4->5->1->0');
  const dm = rotationMatrix([0, -1, 0], -1);
  eq([dm[0][2], dm[1][2], dm[2][2]].join(','), '1,0,0');
  // R: down-back-right (slot 1) to down-front-right (slot 5) to up-front-right (7) to
  // up-back-right (3), i.e. clockwise when you look at the right-hand face.
  eq(MOVES[4].to.join(','), '0,5,2,1,4,7,6,3', 'R: 1->5->7->3->1');
});

test('a half turn never twists a corner, because 180 degrees maps the U/D axis onto itself', () => {
  // Hand-provable and easy to get wrong: the U/D sticker of a corner in the turned layer ends
  // up pointing along +/-y again, so twistOf reads 0 for all four arrivals.
  for (let i = 0; i < MOVE_COUNT; i++) {
    const twice = applySeq(solvedState(), [i, i]);
    eq(twice.twist.join(','), '0,0,0,0,0,0,0,0', `${MOVES[i].name}${MOVES[i].name} leaves no twist`);
    eq(twistSum(twice), 0);
    // four quarter turns are the identity, which is why this metric calls a half turn two
    eq(applySeq(solvedState(), [i, i, i, i]).perm.join(','), '0,1,2,3,4,5,6,7', `${MOVES[i].name}^4`);
  }
});

test('a quarter turn of a side face does twist, and the twists add to nothing', () => {
  // R moves a corner whose U/D sticker pointed along y to one where it points along z, which
  // is precisely a twisted corner. The total residue is what the invariant protects.
  const r = apply(solvedState(), 4);
  ok(r.twist.some((t) => t !== 0), 'R twists at least one corner');
  eq(twistSum(r), 0, 'and the residue is still 0');
  eq(r.twist.reduce((a, b) => a + b, 0) % 3, 0);
  // U and D cannot twist anything: their layer corners keep their U/D sticker on the y axis.
  eq(apply(solvedState(), 0).twist.join(','), '0,0,0,0,0,0,0,0', 'U twists nothing');
  eq(apply(solvedState(), 2).twist.join(','), '0,0,0,0,0,0,0,0', 'D twists nothing');
});

test('slot coordinates are the eight corners of the cube', () => {
  eq(SLOT_COORD.length, 8);
  const seen = new Set(SLOT_COORD.map((c) => c.join(',')));
  eq(seen.size, 8, 'eight distinct corners');
  for (const c of SLOT_COORD) for (const v of c) ok(v === 1 || v === -1, 'signed unit coordinates');
  // The repo's bit convention: i&1 -> x, i&2 -> y, i&4 -> z.
  eq(SLOT_COORD[0].join(','), '-1,-1,-1');
  eq(SLOT_COORD[7].join(','), '1,1,1');
  eq(SLOT_COORD[1].join(','), '1,-1,-1');
  eq(SLOT_COORD[6].join(','), '-1,1,1');
  eq(AXIS_LABEL.join(''), 'xyz');
});

test('rotationMatrix gives integer rotations that preserve length and handedness', () => {
  for (const u of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, -1, 0]]) {
    for (const q of [-1, 1]) {
      const m = rotationMatrix(u, q);
      // the axis is fixed: M.u = u, checked as a vector and not as one row of a dot product
      const mu = [0, 1, 2].map((i) => m[i][0] * u[0] + m[i][1] * u[1] + m[i][2] * u[2]);
      eq(mu.join(','), u.join(','), 'axis fixed');
      // columns stay orthonormal
      for (const col of [0, 1, 2]) {
        const v = [m[0][col], m[1][col], m[2][col]];
        eq(dot(v, v), 1, 'unit length');
      }
      // det = +1: a rotation, not a reflection
      const det =
        m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
        m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
        m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      eq(det, 1, 'determinant +1');
      // four quarters is a full turn
      let v = [0, 0, 1];
      for (let i = 0; i < 4; i++) {
        v = [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
      }
      eq(v.join(','), '0,0,1', 'quarter turns compose to the identity');
    }
  }
});

test('each turn moves exactly its own layer, as one 4-cycle of slots', () => {
  for (let i = 0; i < MOVE_COUNT; i++) {
    const m = MOVES[i];
    const moved = movingSlots(i);
    eq(moved.length, 4, `${m.name} moves four corners`);
    // one cycle: starting anywhere and following `to` visits all four then returns
    let at = moved[0];
    for (let k = 0; k < 4; k++) at = m.to[at];
    eq(at, moved[0], `${m.name} closes its cycle`);
    const visited = new Set();
    let w = moved[0];
    for (let k = 0; k < 4; k++) {
      ok(!visited.has(w), `${m.name} has no shorter cycle`);
      visited.add(w);
      w = m.to[w];
    }
    eq(visited.size, 4);
    // the layer is exactly the side of the plane the normal points at
    for (let s = 0; s < 8; s++) {
      const inLayer = dot(m.normal, SLOT_COORD[s]) > 0;
      eq(moved.includes(s), inLayer, `${m.name} slot ${s} layer membership`);
    }
    // the four destinations are the same set as the four sources
    eq(new Set(moved.map((s) => m.to[s])).size, 4);
  }
});

test('every turn is a bijection on the eight slots and its own inverse pairs up', () => {
  for (let i = 0; i < MOVE_COUNT; i++) {
    const m = MOVES[i];
    eq(new Set(m.to).size, 8, `${m.name} is a permutation`);
    eq(m.inv, i ^ 1, `${m.name} inverse index`);
    eq(MOVES[m.inv].name, m.name === m.face ? `${m.face}'` : m.face, `${m.name} inverse name`);
    // `from` is the inverse of `to`
    for (let s = 0; s < 8; s++) eq(m.from[m.to[s]], s, `${m.name} from/to agree at ${s}`);
    // and the table really is `state.perm[t] = old.perm[from[t]]`
    eq(applySeq(solvedState(), [i, m.inv]).perm.join(','), '0,1,2,3,4,5,6,7', `${m.name} then ${MOVES[m.inv].name} is identity`);
    eq(applySeq(solvedState(), [i, m.inv]).twist.join(','), '0,0,0,0,0,0,0,0');
  }
});

test('a turn conserves the twist sum, slot by slot and in total', () => {
  for (let i = 0; i < MOVE_COUNT; i++) {
    const m = MOVES[i];
    let s = 0;
    for (let t = 0; t < 8; t++) s += m.delta[t];
    eq(s % 3, 0, `${m.name} deltas sum to 0 mod 3`);
    // the slots it does not touch take no delta
    for (let t = 0; t < 8; t++) if (m.to[t] === t && movingSlots(i).indexOf(t) < 0) eq(m.delta[t], 0, `${m.name} untouched slot ${t}`);
    // and the deltas of a clockwise turn are the negatives of its counter-clockwise twin
    const twin = MOVES[m.inv];
    for (let t = 0; t < 8; t++) {
      const src = m.from[t];
      eq((m.delta[t] + twin.delta[src]) % 3, 0, `${m.name}/${twin.name} cancel at ${t}`);
    }
  }
});

test('the invariant survives: 400 random 20-turn cubes all satisfy sum(twist) = 0 mod 3', () => {
  for (let seed = 0; seed < 400; seed++) {
    let st = solvedState();
    let x = seed * 2654435761 + 1;
    for (let k = 0; k < 20; k++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      st = apply(st, x % 12);
    }
    eq(twistSum(st), 0, `seed ${seed} keeps the residue`);
    ok(!validate(st), `seed ${seed} is still a cube`);
  }
});

test('twistOf: the home corner reads 0, and the three readings are the three stickers', () => {
  for (let s = 0; s < 8; s++) {
    eq(twistOf(s, homeStickers(s)[1]), 0, `slot ${s} at home`);
    const stickers = homeStickers(s);
    const seen = new Set();
    for (let k = 0; k < 3; k++) {
      // rotating the corner about its own diagonal by 120 degrees cycles the readings
      const ref = stickers[k];
      seen.add(twistOf(s, ref));
    }
    eq(seen.size, 3, `slot ${s}: the three stickers give the three twists`);
  }
  let threw = false;
  try {
    twistOf(0, [1, 1, 0]);
  } catch (err) {
    threw = /not a sticker/.test(String(err.message));
  }
  ok(threw, 'a direction that is not a sticker of the slot is refused');
});

test('the table model and the physical sticker model agree on 300 random words', () => {
  for (let seed = 0; seed < 300; seed++) {
    let phys = physicalSolved();
    let abs = solvedState();
    let x = seed * 40503 + 7;
    const len = 1 + (seed % 17);
    for (let k = 0; k < len; k++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      const m = x % 12;
      phys = physicalTurn(phys, m);
      abs = apply(abs, m);
    }
    eq(project(phys).perm.join(','), abs.perm.join(','), `seed ${seed} permutation`);
    eq(project(phys).twist.join(','), abs.twist.join(','), `seed ${seed} twist`);
  }
});

test('stickers: a solved cube shows each face on its own side', () => {
  const st = stickersOf(solvedState());
  eq(st.length, 8);
  for (let s = 0; s < 8; s++) {
    for (const k of st[s]) {
      const expect = k.dir[0] !== 0 ? (k.dir[0] > 0 ? 'R' : 'L') : k.dir[1] !== 0 ? (k.dir[1] > 0 ? 'U' : 'D') : (k.dir[2] > 0 ? 'F' : 'B');
      eq(k.face, expect, `solved slot ${s} direction ${k.dir.join(',')}`);
    }
  }
});

test('stickers: every cube, however scrambled, has exactly four of each face', () => {
  for (let seed = 0; seed < 500; seed++) {
    let st = solvedState();
    let x = seed * 2246822519 + 3;
    for (let k = 0; k < 1 + (seed % 20); k++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      st = apply(st, x % 12);
    }
    eq(stickerCensus(st), { U: 4, D: 4, R: 4, L: 4, F: 4, B: 4 }, `seed ${seed} census`);
  }
});

test('stickers: the derived face is the physical one, sticker by sticker', () => {
  for (let seed = 0; seed < 400; seed++) {
    let phys = physicalSolved();
    let x = seed * 668265263 + 11;
    for (let k = 0; k < 1 + (seed % 12); k++) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      phys = physicalTurn(phys, x % 12);
    }
    const abs = project(phys);
    const derived = stickersOf(abs);
    for (let s = 0; s < 8; s++) {
      const home = homeStickers(phys.slots[s].piece);
      const label = (d) => (d[0] !== 0 ? (d[0] > 0 ? 'R' : 'L') : d[1] !== 0 ? (d[1] > 0 ? 'U' : 'D') : (d[2] > 0 ? 'F' : 'B'));
      for (const k of derived[s]) {
        const j = phys.slots[s].dirs.findIndex((d) => d[0] === k.dir[0] && d[1] === k.dir[1] && d[2] === k.dir[2]);
        ok(j >= 0, `slot ${s} has a sticker pointing ${k.dir.join(',')}`);
        eq(label(home[j]), k.face, `seed ${seed} slot ${s} sticker`);
      }
    }
  }
});

test('cwTurnOf answers "which face am I looking at" for all six normals and nothing else', () => {
  eq(cwTurnOf([0, 1, 0]), NAMES.indexOf('U'));
  eq(cwTurnOf([0, -1, 0]), NAMES.indexOf('D'));
  eq(cwTurnOf([1, 0, 0]), NAMES.indexOf('R'));
  eq(cwTurnOf([-1, 0, 0]), NAMES.indexOf('L'));
  eq(cwTurnOf([0, 0, 1]), NAMES.indexOf('F'));
  eq(cwTurnOf([0, 0, -1]), NAMES.indexOf('B'));
  eq(cwTurnOf([1, 1, 0]), -1, 'a diagonal is not a face normal');
  eq(cwTurnOf([0, 0, 0]), -1);
  eq(FACES.length, 6);
});

test('the gesture cross product points where the drag goes (the sign the view depends on)', () => {
  // Pressing the U sticker of the front-right-up corner and dragging it toward +x is the F
  // face turn: right-handed about -z by 90, i.e. clockwise seen from +z. The view computes
  // the axis as cross(tangent, normal); this is that one line, checked by hand.
  const normal = [0, 1, 0]; // U
  const tangent = [1, 0, 0]; // dragging toward +x
  const axis = cross(tangent, normal);
  eq(axis.join(','), '0,0,1', 'the face whose outward normal is +z, i.e. F clockwise');
  eq(cwTurnOf(axis), NAMES.indexOf('F'));
  // and the opposite drag is the other face
  eq(cwTurnOf(cross([-1, 0, 0], normal)).valueOf(), NAMES.indexOf('B'));
  // a turn is what its name says: F applied to solved moves that corner off the U face
  const after = apply(solvedState(), NAMES.indexOf('F'));
  eq(isSolved(after), false);
  eq(after.perm[5], 7, 'the up-front-right corner is the one that ends up at down-front-right');
});

test('the face cycles are the ones you get by looking at the face from outside', () => {
  // Written down by hand from the slot convention (i&1 -> x, i&2 -> y, i&4 -> z, so
  // 0=DBL 1=DBR 2=UBL 3=UBR 4=DFL 5=DFR 6=UFL 7=UFR), then checked against the derived table.
  // A clockwise face turn moves the four corners of that face clockwise as seen from outside.
  const cycles = {
    U: [6, 2, 3, 7], // UFL -> UBL -> UBR -> UFR
    D: [4, 5, 1, 0], // DFL -> DFR -> DBR -> DBL
    R: [5, 7, 3, 1], // DFR -> UFR -> UBR -> DBR
    L: [2, 6, 4, 0], // UBL -> UFL -> DFL -> DBL
    F: [7, 5, 4, 6], // UFR -> DFR -> DFL -> UFL
    B: [3, 2, 0, 1], // UBR -> UBL -> DBL -> DBR
  };
  for (const [face, cyc] of Object.entries(cycles)) {
    const m = MOVES[NAMES.indexOf(face)];
    eq(m.normal.join(','), { U: '0,1,0', D: '0,-1,0', R: '1,0,0', L: '-1,0,0', F: '0,0,1', B: '0,0,-1' }[face], `${face} normal`);
    for (let i = 0; i < 4; i++) {
      eq(m.to[cyc[i]], cyc[(i + 1) % 4], `${face}: ${cyc[i]} -> ${cyc[(i + 1) % 4]}`);
    }
    const still = [0, 1, 2, 3, 4, 5, 6, 7].filter((s) => !cyc.includes(s));
    for (const s of still) eq(m.to[s], s, `${face} leaves slot ${s} alone`);
    // the counter-clockwise twin runs the cycle backwards
    const ccw = MOVES[m.inv];
    for (let i = 0; i < 4; i++) eq(ccw.to[cyc[(i + 1) % 4]], cyc[i], `${face}' step`);
  }
});

run();
