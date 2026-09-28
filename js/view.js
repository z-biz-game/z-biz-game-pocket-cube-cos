// Canvas renderer and pointer handling. This file owns pixels and gestures and decides
// nothing: it never asks whether a turn is legal, never counts a move, never solves anything.
// The one geometry question it does answer — "the finger went that way, so which face turns?" —
// is `dragTurn` below, which is a pure function of js/core/geom.js and is asserted in node
// (test/view.test.mjs) rather than only in a browser, because a sign error in it is invisible
// on screen and obvious in a test.
//
// The drawing: an orthographic projection of eight unit cubes, rotated by yaw then pitch. Each
// cubie shows three outward faces, and the colour on each of them comes from
// geom.stickersOf(state) — the same table the twist bookkeeping comes from, so the screen
// cannot disagree with the model about which sticker sits where. No images, no fonts.
//
// A committed turn animates by rendering the moved layer at (1 - progress) of the *inverse*
// rotation, so the first frame is the pre-turn picture and the last is exactly the state the
// core already holds. That ordering is deliberate: the state changes once, in game.turn(), and
// an animation can never be the reason a counter and a cube disagree.

import { MOVES, SLOT_COORD, cross, cwTurnOf, stickersOf } from './core/geom.js';

const FACE_COLOR = {
  U: '#eef1f6',
  D: '#f5d33f',
  R: '#e0524b',
  L: '#f08a35',
  F: '#41c078',
  B: '#4b8fe8',
};
const PLASTIC = '#14181f';
const PLASTIC_EDGE = 'rgba(226,232,240,0.16)';
const HINT_EDGE = '#78dcff';

const HALF = 0.5; // a cubie is a unit cube, so its slot centre sits at +/- 0.5
const STICKER_LIFT = 0.03; // stickers are drawn just off the plastic, not inside it
const STICKER_SIZE = 0.82;
const DRAG_THRESHOLD = 16; // css pixels of travel before a drag becomes a turn
const ANIM_MS = 170;

const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const axisIndexOf = (v) => (v[0] ? 0 : v[1] ? 1 : 2);
const neg = (v) => [-v[0], -v[1], -v[2]];
const SOLVED = { perm: [0, 1, 2, 3, 4, 5, 6, 7], twist: [0, 0, 0, 0, 0, 0, 0, 0] };

// The three outward normals of a slot: its own coordinates, as unit axes.
const slotNormals = (slot) => SLOT_COORD[slot].map((s, i) => (s > 0 ? AXES[i].slice() : neg(AXES[i])));

// The four slide directions available on the face whose outward normal is `n`.
function inPlaneDirs(n) {
  const i = axisIndexOf(n);
  const out = [];
  for (let a = 0; a < 3; a++) {
    if (a === i) continue;
    out.push(AXES[a].slice());
    out.push(neg(AXES[a]));
  }
  return out;
}

// Which of the twelve quarter turns is "slide the sticker pointing along `n`, on the corner in
// `slot`, toward `u`"?
//
// The slide is the rotation taking n onto u, and a right-handed quarter turn about `a` sends v
// to a x v, so the axis is a = n x u. The layer that moves is the slice perpendicular to a that
// contains this corner; call its outward normal m. geom.js names the *clockwise* turn of a face
// the right-handed minus ninety degrees about that face's outward normal, so when a and m point
// the same way the gesture is the inverse of m's clockwise turn, and when they point apart it is
// that turn. All 48 (corner, face, slide) triples are checked against geom's independent
// physical sticker model in test/view.test.mjs.
export function dragTurn(slot, n, u) {
  const a = cross(n, u);
  const i = axisIndexOf(a);
  const e = SLOT_COORD[slot][i] > 0 ? 1 : -1;
  const m = [0, 0, 0];
  m[i] = e;
  const cw = cwTurnOf(m);
  if (cw < 0) return -1;
  return a[i] === e ? cw ^ 1 : cw;
}

// Rodrigues' rotation matrix about a unit axis, right-handed by `angle` radians. geom.js's
// rotationMatrix is the integer quarter-turn version used to derive the tables; the animation
// needs a continuous one, so this is the same formula with cos/sin left in.
function rotAbout(u, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = [[0, -u[2], u[1]], [u[2], 0, -u[0]], [-u[1], u[0], 0]];
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      m[i][j] = (i === j ? c : 0) + s * k[i][j] + u[i] * u[j] * (1 - c);
    }
  }
  return m;
}

export function createView(canvas, { onCommit } = {}) {
  const ctx = canvas.getContext('2d');
  const view = { yaw: 0.62, pitch: 0.42 };
  let game = null;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let raf = 0;
  let anim = null; // { move, t0 }
  let hint = null; // { move, until }
  let drag = null; // the live pointer, see down()
  let picked = []; // sticker quads of the last drawn frame, for hit-testing
  let frames = 0;
  let dirty = false; // the camera moved since the last paint: the loop owes a redraw

  const state = () => (game ? game.state : SOLVED);

  function measure() {
    const box = canvas.getBoundingClientRect();
    dpr = Math.max(1, Math.min(3, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1));
    w = Math.max(1, Math.round(box.width));
    h = Math.max(1, Math.round(box.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    draw();
  }

  // ---- projection -------------------------------------------------------------------
  //
  // Model space: x = L/R, y = D/U, z = B/F, the axes js/core/geom.js derives its matrices on.
  // Screen space: x right, y up, z toward the viewer. Yaw about y, then pitch about x.

  const scale = () => Math.min(w, h) / 3.35;

  function applyMatrix(m, v) {
    return [
      m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
      m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
      m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ];
  }

  function toView(v, extra) {
    const p = extra ? applyMatrix(extra, v) : v;
    const cy = Math.cos(view.yaw);
    const sy = Math.sin(view.yaw);
    const x = p[0] * cy - p[2] * sy;
    const z1 = p[0] * sy + p[2] * cy;
    const cp = Math.cos(view.pitch);
    const sp = Math.sin(view.pitch);
    return [x, p[1] * cp - z1 * sp, p[1] * sp + z1 * cp];
  }

  function project(p) {
    const s = scale();
    return { x: w / 2 + p[0] * s, y: h / 2 - p[1] * s, z: p[2] };
  }

  const screenOf = (v, extra) => project(toView(v, extra));

  // The rotation still owed by the layer being animated. The move is already in the state, so
  // the frame shows it partly taken back: at progress 0 that is exactly the pre-turn cube.
  function animRotation() {
    if (!anim) return null;
    const e = Math.min(1, (performance.now() - anim.t0) / ANIM_MS);
    if (e >= 1) {
      anim = null;
      return null;
    }
    const eased = 1 - (1 - e) * (1 - e);
    const m = MOVES[anim.move];
    return rotAbout(m.normal, -m.dir * (Math.PI / 2) * (1 - eased));
  }

  const movesLayer = (move, slot) => MOVES[move].to[slot] !== slot;

  // ---- drawing ----------------------------------------------------------------------

  // The four corners of a square of side `size`, centred on `centre`, lifted `lift` along its
  // outward normal `n`, spanning the other two axes.
  function quadPoints(centre, n, e1, e2, size, lift) {
    const half = size / 2;
    const o = HALF + lift;
    const pts = [];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pts.push([
        centre[0] + n[0] * o + e1[0] * half * a + e2[0] * half * b,
        centre[1] + n[1] * o + e1[1] * half * a + e2[1] * half * b,
        centre[2] + n[2] * o + e1[2] * half * a + e2[2] * half * b,
      ]);
    }
    return pts;
  }

  function tracePath(pts, extra) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = screenOf(pts[i], extra);
      if (i) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
    }
    ctx.closePath();
  }

  function draw() {
    dirty = false;
    if (!w || !h) measure();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const stickers = stickersOf(state());
    const extra = animRotation();
    const moving = anim ? anim.move : -1;
    const hinted = hint && hint.until > performance.now() ? hint.move : -1;
    const order = [];
    for (let s = 0; s < 8; s++) {
      const centre = SLOT_COORD[s].map((v) => v * HALF);
      const mine = moving >= 0 && movesLayer(moving, s) ? extra : null;
      order.push({ s, mine, depth: toView(centre, mine)[2] });
    }
    // Painter's algorithm over eight boxes: far ones first. A corner cubie never overlaps
    // another cubie's drawn faces once sorted this way, which is why no z-buffer is needed.
    order.sort((a, b) => a.depth - b.depth);
    const list = [];
    for (const item of order) {
      const s = item.s;
      const centre = SLOT_COORD[s].map((v) => v * HALF);
      const normals = slotNormals(s);
      for (let k = 0; k < 3; k++) {
        const n = normals[k];
        const e1 = normals[(k + 1) % 3];
        const e2 = normals[(k + 2) % 3];
        tracePath(quadPoints(centre, n, e1, e2, 1, 0), item.mine);
        ctx.fillStyle = PLASTIC;
        ctx.fill();
        ctx.strokeStyle = PLASTIC_EDGE;
        ctx.lineWidth = 1;
        ctx.stroke();
        const pts = quadPoints(centre, n, e1, e2, STICKER_SIZE, STICKER_LIFT);
        tracePath(pts, item.mine);
        ctx.fillStyle = FACE_COLOR[stickers[s][k].face] || '#7a7f8a';
        ctx.fill();
        const shown = pts.map((p) => screenOf(p, item.mine));
        if (hinted >= 0 && movesLayer(hinted, s)) {
          ctx.strokeStyle = HINT_EDGE;
          ctx.lineWidth = 2.5;
        } else {
          ctx.strokeStyle = 'rgba(10,12,16,0.5)';
          ctx.lineWidth = 1;
        }
        ctx.stroke();
        list.push({ slot: s, k, face: stickers[s][k].face, pts: shown });
      }
    }
    picked = list;
    frames++;
  }

  // ---- picking ----------------------------------------------------------------------

  function pointInPoly(p, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  // The sticker under a canvas-local point, in the frame that was actually drawn. Later in the
  // painter's list means nearer, so scan backwards.
  function stickerAt(x, y) {
    for (let i = picked.length - 1; i >= 0; i--) {
      if (pointInPoly({ x, y }, picked[i].pts)) return picked[i];
    }
    return null;
  }

  const centroid = (pts) => {
    let x = 0;
    let y = 0;
    for (const p of pts) {
      x += p.x;
      y += p.y;
    }
    return { x: x / pts.length, y: y / pts.length };
  };

  // Where the screen thinks "slide this sticker that way" goes, in css pixels from the sticker's
  // centre. This is the vector a player sees, so it is the vector an automated finger uses.
  function slideVector(slot, k, u) {
    const normals = slotNormals(slot);
    const n = normals[k];
    const centre = SLOT_COORD[slot].map((v) => v * HALF);
    const here = [
      centre[0] + n[0] * (HALF + STICKER_LIFT),
      centre[1] + n[1] * (HALF + STICKER_LIFT),
      centre[2] + n[2] * (HALF + STICKER_LIFT),
    ];
    const from = screenOf(here);
    const to = screenOf([here[0] + u[0] * HALF, here[1] + u[1] * HALF, here[2] + u[2] * HALF]);
    return { dx: to.x - from.x, dy: to.y - from.y, from };
  }

  // The turn a drag of (dx, dy) screen pixels on sticker (slot, k) asks for: the in-plane slide
  // whose projection best matches the finger, refused below the threshold. Returns null rather
  // than guessing, which is what makes "a small drag commits nothing" a property of the code.
  function gestureFor(slot, k, dx, dy) {
    const len = Math.hypot(dx, dy);
    if (len < DRAG_THRESHOLD) return null;
    const n = slotNormals(slot)[k];
    let best = null;
    for (const u of inPlaneDirs(n)) {
      const sv = slideVector(slot, k, u);
      const sl = Math.hypot(sv.dx, sv.dy);
      if (sl < 0.75) continue; // projected near edge-on: not a direction the player can see
      const score = (dx * sv.dx + dy * sv.dy) / (len * sl);
      if (!best || score > best.score) best = { score, u, dx: sv.dx, dy: sv.dy };
    }
    if (!best || best.score <= 0) return null;
    const move = dragTurn(slot, n, best.u);
    if (move < 0) return null;
    return { slot, k, u: best.u, move, name: MOVES[move].name, dx: best.dx, dy: best.dy };
  }

  // A finished drag description for one named slide of one sticker, in client coordinates:
  // tools/playtest.mjs and the @pointer assertions drive these, so the rig exercises the same
  // pick() the pointer does instead of reimplementing the geometry.
  //
  // `pressable` is that promise kept: the slide vector is computed per sticker, but a press is
  // hit-tested against the *drawn* frame, where a nearer cubie's sticker can lie over this
  // one's centre. Ask the pick what it would actually see at the point we advertise, and say so
  // when it is not this sticker — otherwise a caller aiming for F commits the L' painted on top
  // of it, which is correct behaviour for a finger and a wrong answer from a model.
  function dragFor(slot, k, u) {
    const sv = slideVector(slot, k, u);
    const len = Math.hypot(sv.dx, sv.dy) || 1;
    const step = DRAG_THRESHOLD + 30;
    const move = dragTurn(slot, slotNormals(slot)[k], u);
    const box = canvas.getBoundingClientRect();
    const seen = stickerAt(sv.from.x, sv.from.y);
    return {
      slot, k, u, move,
      name: move < 0 ? null : MOVES[move].name,
      pressable: !!seen && seen.slot === slot && seen.k === k,
      under: seen ? { slot: seen.slot, k: seen.k, face: seen.face } : null,
      from: { x: box.left + sv.from.x, y: box.top + sv.from.y },
      to: { x: box.left + sv.from.x + (sv.dx / len) * step, y: box.top + sv.from.y + (sv.dy / len) * step },
      short: { x: box.left + sv.from.x + (sv.dx / len) * 6, y: box.top + sv.from.y + (sv.dy / len) * 6 },
      projected: Math.round(len),
    };
  }

  // The most readable drag available on a corner: the sticker and slide whose projection is
  // longest on screen. Used when a test wants "any turn from this cubie" without pinning the
  // view angles down.
  function bestDragFor(slot) {
    let best = null;
    for (let k = 0; k < 3; k++) {
      for (const u of inPlaneDirs(slotNormals(slot)[k])) {
        const sv = slideVector(slot, k, u);
        const len = Math.hypot(sv.dx, sv.dy);
        const move = dragTurn(slot, slotNormals(slot)[k], u);
        if (move < 0 || len < 4) continue;
        // prefer face-on stickers: a long projection is a direction the player can aim at
        if (!best || len > best.len) best = { k, u, len, move };
      }
    }
    if (!best) return null;
    const d = dragFor(slot, best.k, best.u);
    d.len = best.len;
    return d;
  }

  // ---- the pointer ------------------------------------------------------------------

  function local(ev) {
    const box = canvas.getBoundingClientRect();
    return { x: ev.clientX - box.left, y: ev.clientY - box.top };
  }

  function down(ev) {
    if (!game) return;
    const p = local(ev);
    const hit = stickerAt(p.x, p.y);
    drag = {
      id: ev.pointerId,
      x0: p.x,
      y0: p.y,
      lastX: p.x,
      lastY: p.y,
      slot: hit ? hit.slot : -1,
      k: hit ? hit.k : -1,
      orbit: !hit || ev.shiftKey === true, // nothing under the finger, or a held modifier
      done: false,
      committed: null,
    };
    if (drag.id !== undefined && canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(drag.id);
      } catch (err) {
        void err; // a synthetic pointer id: the drag still works without capture
      }
    }
    if (typeof ev.preventDefault === 'function') ev.preventDefault();
  }

  // Looking around: pixels in, angles out, and no path to the game state. game.view is written
  // so that a reset keeps the way the player was looking, and test/view.test.mjs asserts that
  // orbiting cannot change the cube or the move count.
  //
  // The `dirty` flag is not decoration: `picked`, the quads the next press hit-tests against,
  // is rebuilt inside draw(), so an orbit that scheduled no repaint would leave the finger
  // aiming at the faces where they sat before the turn.
  function orbitBy(dx, dy) {
    const lim = Math.PI / 2 - 0.08;
    view.yaw += dx * 0.008;
    view.pitch = Math.max(-lim, Math.min(lim, view.pitch + dy * 0.008));
    if (game) {
      game.view.yaw = view.yaw;
      game.view.pitch = view.pitch;
    }
    dirty = true;
  }

  function moveEv(ev) {
    if (!drag || (ev.pointerId !== undefined && drag.id !== undefined && ev.pointerId !== drag.id)) return;
    const p = local(ev);
    if (drag.orbit) {
      orbitBy(p.x - drag.lastX, p.y - drag.lastY);
      drag.lastX = p.x;
      drag.lastY = p.y;
      return;
    }
    drag.lastX = p.x;
    drag.lastY = p.y;
    if (drag.done) return; // one drag, one turn: a long never becomes a chain of them
    const g = gestureFor(drag.slot, drag.k, p.x - drag.x0, p.y - drag.y0);
    if (!g) return;
    drag.done = true;
    drag.committed = g.move;
    if (onCommit) onCommit(g.move, g);
  }

  function upEv(ev) {
    if (!drag) return;
    if (ev && ev.pointerId !== undefined && drag.id !== undefined && ev.pointerId !== drag.id) return;
    drag = null;
  }

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', moveEv);
  canvas.addEventListener('pointerup', upEv);
  canvas.addEventListener('pointercancel', upEv);

  function frame() {
    if (anim || dirty || (hint && hint.until > performance.now())) draw();
    raf = requestAnimationFrame(frame);
  }

  return {
    attach(g) {
      game = g;
      anim = null;
      hint = null;
      if (g && g.view) {
        view.yaw = g.view.yaw;
        view.pitch = g.view.pitch;
      }
      draw();
    },
    measure,
    draw,
    redraw: draw,
    get size() {
      return { w, h, dpr };
    },
    get viewAngles() {
      return { yaw: view.yaw, pitch: view.pitch };
    },
    orbit: orbitBy,
    animate(move) {
      anim = { move, t0: performance.now() };
    },
    showHint(move, ms = 1400) {
      hint = { move, until: performance.now() + ms };
    },
    clearHint() {
      hint = null;
    },
    stickerAt,
    stickerPoint(slot, k) {
      const found = picked.find((s) => s.slot === slot && s.k === k);
      if (!found) return null;
      const c = centroid(found.pts);
      const box = canvas.getBoundingClientRect();
      return { x: box.left + c.x, y: box.top + c.y, face: found.face, slot: found.slot, k: found.k };
    },
    // The four drags available on one sticker, in client coordinates.
    dragsFor(slot, k) {
      return inPlaneDirs(slotNormals(slot)[k]).map((u) => dragFor(slot, k, u));
    },
    dragFor,
    bestDragFor,
    gestureFor,
    pointAt(slot) {
      const box = canvas.getBoundingClientRect();
      const p = screenOf(SLOT_COORD[slot].map((v) => v * HALF));
      return { x: box.left + p.x, y: box.top + p.y };
    },
    cellPoint(x, y) {
      return { x, y };
    },
    start() {
      measure();
      if (!raf) raf = requestAnimationFrame(frame);
    },
    frames() {
      return frames;
    },
  };
}
