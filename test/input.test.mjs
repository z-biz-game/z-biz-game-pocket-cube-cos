// The one §2 judgement on this repo that no earlier suite covered: which input API actually moves
// the cube. js/view.js shipped `pointerdown` and nothing else, so on any engine without Pointer
// Events the board is a picture you cannot turn — and a string grep for "pointerdown" still says
// "触摸输入 ✓". These tests ask the behaviour, not the string.
//
// What is pinned here:
//   1. exactly one flavour is bound, so a press is never billed twice;
//   2. the touch and mouse fallbacks reach the same commit as the pointer path, same pixels in;
//   3. coordinates are read in CSS pixels against getBoundingClientRect, so a canvas whose backing
//      store is 3x its box still turns the layer under the finger. That is the "点 A 打 B" bug;
//   4. a mouse released off-canvas ends the stroke (the window binding is not decoration);
//   5. a touchend with an empty `touches` list still knows which finger lifted.
//
// What is NOT here: real browser event dispatch. A synthetic TouchEvent is shaped by hand, exactly
// as the browser shapes it — clientX lives on the touch, not the event — and if a future engine
// reshapes that, this file goes red rather than the player going silently broken.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { solvedState } from '../js/core/cube.js';
import { MOVES } from '../js/core/geom.js';
import { createView } from '../js/view.js';
import { createCanvasStub, createImageStub, createRafQueue, createWindowStub } from './fake-canvas.mjs';

function installDom() {
  const queue = createRafQueue();
  globalThis.requestAnimationFrame = queue.requestAnimationFrame;
  globalThis.cancelAnimationFrame = queue.cancelAnimationFrame;
  globalThis.Image = createImageStub().Image;
  globalThis.matchMedia = () => ({
    matches: false, media: '', addEventListener() {}, removeEventListener() {},
  });
  return { queue };
}

// A board ready to be pressed, at an explicit CSS box and device pixel ratio. `measure()` is what
// turns those into `w`/`h`, so the box and the backing store are set independently on purpose.
function board({ rect, dpr = 1, pointer = false } = {}) {
  installDom();
  const win = createWindowStub();
  globalThis.window = win;
  globalThis.devicePixelRatio = dpr;
  if (pointer) globalThis.PointerEvent = function PointerEvent() {};
  else delete globalThis.PointerEvent;
  const canvas = createCanvasStub({ width: Math.round(rect.width * dpr), height: Math.round(rect.height * dpr), rect });
  const seen = [];
  const view = createView(canvas, { onCommit: (move, g) => seen.push({ move, g }) });
  view.measure();
  view.attach({ state: solvedState(), view: { yaw: 0.62, pitch: 0.42 } });
  return { canvas, win, view, seen };
}

const SQ = { left: 0, top: 0, width: 320, height: 320 };

// One full gesture through whichever API the page is limited to: press `from`, slide to `to`,
// release. Touch events carry their coordinates on `touches`, and a release carries none.
function press(canvas, kind, from, to, pointerId = 1) {
  if (kind === 'pointer') {
    canvas.dispatch('pointerdown', { clientX: from.x, clientY: from.y, pointerId });
    canvas.dispatch('pointermove', { clientX: to.x, clientY: to.y, pointerId });
    canvas.dispatch('pointerup', { clientX: to.x, clientY: to.y, pointerId });
    return;
  }
  const touch = (x, y) => [{ clientX: x, clientY: y, identifier: 0 }];
  canvas.dispatch('touchstart', { touches: touch(from.x, from.y), changedTouches: touch(from.x, from.y) });
  canvas.dispatch('touchmove', { touches: touch(to.x, to.y), changedTouches: touch(to.x, to.y) });
  // A real touchend reports `touches` empty and names the departed finger in changedTouches only.
  canvas.dispatch('touchend', { touches: [], changedTouches: touch(to.x, to.y) });
}

// ----------------------------------------------------------------------------------------------

test('Pointer Events are preferred, and nothing else is bound alongside them', () => {
  const { canvas, win } = board({ rect: SQ, pointer: true });
  eq(canvas.listenerCount('pointerdown'), 1, 'pointerdown is not bound');
  eq(canvas.listenerCount('pointermove'), 1, 'pointermove is not bound');
  eq(canvas.listenerCount('pointerup') + canvas.listenerCount('pointercancel'), 2, 'pointer up/cancel missing');
  // The whole point of the either/or: a browser that fires both would turn a layer twice per tap.
  for (const t of ['touchstart', 'touchmove', 'touchend']) eq(canvas.listenerCount(t), 0, `${t} bound next to Pointer Events`);
  for (const t of ['mousedown', 'mousemove', 'mouseup']) {
    eq(canvas.listenerCount(t), 0, `canvas ${t} bound next to Pointer Events`);
    eq(win.listenerCount(t), 0, `window ${t} bound next to Pointer Events`);
  }
});

test('without Pointer Events the touch and mouse fallbacks take over', () => {
  const { canvas, win } = board({ rect: SQ, pointer: false });
  eq(canvas.listenerCount('pointerdown'), 0, 'a pointer binding was installed on an engine that has none');
  for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'mousedown']) {
    eq(canvas.listenerCount(t), 1, `${t} is not bound`);
  }
  eq(win.listenerCount('mousemove'), 1, 'mousemove is not on the window');
  eq(win.listenerCount('mouseup'), 1, 'mouseup is not on the window');
  // passive:false, or the browser keeps the gesture for scrolling and preventDefault is ignored.
  const b = canvas.binding('touchstart');
  ok(b && b.options && b.options.passive === false, 'touchstart is not bound non-passively');
  const m = canvas.binding('touchmove');
  ok(m && m.options && m.options.passive === false, 'touchmove is not bound non-passively');
});

test('a touch drag, a mouse drag and a pointer drag commit the same turn', () => {
  const got = {};
  for (const kind of ['pointer', 'touch', 'mouse']) {
    const { canvas, win, view, seen } = board({ rect: SQ, pointer: kind === 'pointer' });
    const drag = view.bestDragFor(7);
    ok(drag && drag.pressable, `no reachable drag on slot 7 for ${kind}`);
    // Mouse move/up are on the window in a browser; the stub dispatches wherever they were bound.
    if (kind === 'mouse') {
      canvas.dispatch('mousedown', { clientX: drag.from.x, clientY: drag.from.y });
      win.dispatch('mousemove', { clientX: drag.to.x, clientY: drag.to.y });
      win.dispatch('mouseup', { clientX: drag.to.x, clientY: drag.to.y });
    } else {
      press(canvas, kind, drag.from, drag.to);
    }
    eq(seen.length, 1, `${kind} committed ${seen.length} turns, expected exactly 1`);
    got[kind] = { move: seen[0].move, name: seen[0].g.name, slot: seen[0].g.slot, k: seen[0].g.k };
  }
  eq(got.touch, got.pointer, 'the touch fallback turns a different layer than a pointer does');
  eq(got.mouse, got.pointer, 'the mouse fallback turns a different layer than a pointer does');
  ok(MOVES[got.pointer.move], 'a gesture committed something that is not a move');
});

// The 点 A 打 B case: a 900x900 backing store painted into a 300x300 CSS box, which is what a
// retina screen plus `width: 100%` does by itself. Coordinates read off the backing store would
// land three times as far along, on a different cubie, or off the cube entirely.
test('a CSS-scaled canvas answers the finger that landed on it', () => {
  const rect = { left: 20, top: 40, width: 300, height: 300 };
  const { canvas, view, seen } = board({ rect, dpr: 3, pointer: false });
  eq([canvas.width, canvas.height], [900, 900], 'the backing store did not grow with the pixel ratio');
  eq([view.size.w, view.size.h], [300, 300], 'the projection stopped using CSS pixels');
  const drag = view.bestDragFor(7);
  ok(drag && drag.pressable, 'nothing pressable at 3x');
  press(canvas, 'touch', drag.from, drag.to);
  eq(seen.length, 1, 'a finger on the sticker turned nothing at all');
  eq(seen[0].g.slot, drag.slot, 'the touch turned a different sticker');
  eq(seen[0].g.k, drag.k, 'the touch turned a different face of that corner');
  // Same box, same device pixels, but the coordinates a backing-store reader would have used.
  const again = board({ rect, dpr: 3, pointer: false });
  const d2 = again.view.bestDragFor(7);
  const scaled = (p) => ({ x: (p.x - rect.left) * 3 + rect.left, y: (p.y - rect.top) * 3 + rect.top });
  press(again.canvas, 'touch', scaled(d2.from), scaled(d2.to));
  eq(again.seen.length, 0, 'the backing-store coordinate also hit: the scale factor is not being tested');
});

test('a drag released off the canvas ends the stroke instead of arming it', () => {
  const { canvas, win, view, seen } = board({ rect: SQ, pointer: false });
  const drag = view.bestDragFor(7);
  canvas.dispatch('mousedown', { clientX: drag.from.x, clientY: drag.from.y });
  win.dispatch('mousemove', { clientX: drag.to.x, clientY: drag.to.y });
  eq(seen.length, 1, 'the drag never committed while still inside the board');
  // Released over the panel, so the canvas never sees a mouseup of its own.
  win.dispatch('mouseup', { clientX: 900, clientY: 120 });
  win.dispatch('mousemove', { clientX: 40, clientY: 40 });
  eq(seen.length, 1, 'a released drag kept turning the cube from the panel');
});

test('a second press past the threshold is refused, and a short one is not a turn', () => {
  const { canvas, view, seen } = board({ rect: SQ, pointer: true });
  const drag = view.bestDragFor(7);
  canvas.dispatch('pointerdown', { clientX: drag.from.x, clientY: drag.from.y, pointerId: 4 });
  canvas.dispatch('pointermove', { clientX: drag.short.x, clientY: drag.short.y, pointerId: 4 });
  eq(seen.length, 0, 'a 6px jitter committed a turn');
  canvas.dispatch('pointermove', { clientX: drag.to.x, clientY: drag.to.y, pointerId: 4 });
  eq(seen.length, 1, 'the real drag did not commit');
  canvas.dispatch('pointermove', { clientX: drag.from.x, clientY: drag.from.y, pointerId: 4 });
  canvas.dispatch('pointermove', { clientX: drag.to.x, clientY: drag.to.y, pointerId: 4 });
  eq(seen.length, 1, 'one drag committed more than one turn');
  // A different pointer (a second finger) must not be mistaken for the captured one.
  canvas.dispatch('pointerup', { clientX: drag.to.x, clientY: drag.to.y, pointerId: 9 });
  canvas.dispatch('pointermove', { clientX: drag.from.x, clientY: drag.from.y, pointerId: 4 });
  eq(seen.length, 1, 'a pointer that was never pressed down is driving the board');
});

test('background drag is orbit, and it costs no move', () => {
  const { canvas, view, seen } = board({ rect: SQ, pointer: false });
  const before = view.viewAngles;
  press(canvas, 'touch', { x: 6, y: 6 }, { x: 90, y: 24 });
  eq(seen.length, 0, 'an orbit on the background committed a turn');
  const after = view.viewAngles;
  ok(after.yaw !== before.yaw || after.pitch !== before.pitch, 'the background drag did not orbit either');
});

run();
