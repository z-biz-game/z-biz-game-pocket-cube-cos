// js/view.js promises that time in this game is simulated rather than observed: `frame(ts)` turns
// a wall-clock delta into a debt and pays it in whole SIM_STEP increments. That is exactly the kind
// of promise that looks fine on a 60 Hz laptop and is a different game on a 30 Hz phone, and no
// other suite in this repo can see it because none of them runs the loop at all.
//
// So this file *is* the frame-rate comparison the polish brief asks for, run in node against the
// real module: one scripted turn (a layer animation, a hint, a particle splash) is pumped at 30,
// 60, 120 and 144 Hz from a sandbox clock starting at 1000 ms, and the sim's own fields are
// snapshotted at identical step counts and diffed field by field. 144 Hz is in the set on purpose:
// its frame is not a whole multiple of the 1/120 s step, so it is the cadence that would catch an
// integrator that merely looks fixed.
//
// The negative control is not here, because it has to be done to a copy of the module: replacing
// the whole-step drain with `step(elapsed)` is a mutation of the shipped file, so it lives in the
// throwaway probe the brief prescribes, and that probe must come back red for this file to mean
// anything. What *is* here is the proof that the comparison can go red at all: `frames` is excluded
// from the diff and asserted to differ, so a loop that never ran could not pass.
//
// What is NOT here: pixels. test/fake-canvas.mjs counts draw calls and nothing else, so "the cube
// looks right" stays the browser scenario's job.

import { test, run, ok, eq } from '../tools/harness.mjs';
import { solvedState } from '../js/core/cube.js';
import { createView } from '../js/view.js';
import { createCanvasStub, createImageStub, createRafQueue } from './fake-canvas.mjs';

// view.js's private step, re-declared rather than imported: if the module changes it, the
// checkpoint arithmetic below stops landing on identical step counts and these tests go red
// instead of quietly comparing two different moments in the simulation.
const SIM_STEP = 1 / 120;
const STEP_MS = SIM_STEP * 1000;
// A frame of exactly k steps would leave the accumulator sitting on the step boundary every single
// frame, where a 1e-16 rounding difference decides whether it pays k or k-1. That is a fight with
// floating point, not a test of the game, so each whole-step frame carries a microsecond of slack:
// far below one step over a whole run, far above the noise in a wall-clock timestamp.
const SLACK_MS = 0.001;
const RATES = [
  { hz: 30, stepsPerFrame: 4 },
  { hz: 60, stepsPerFrame: 2 },
  { hz: 120, stepsPerFrame: 1 },
  { hz: 144, stepsPerFrame: null }, // 0.83 steps a frame: crosses every boundary, grazes none
];
// Step counts every rate can be observed at. Multiples of 4, because 30 Hz pays four steps a frame.
// 12 is mid-animation; 60 is a falling splash with a still-live hint; 96 is 0.8 s — past the hint's
// expiry at 84 steps, before the last particle dies at 1.1 s, so the splash is still being compared.
const CHECKPOINTS = [12, 60, 96];

function installDom({ reduce = false } = {}) {
  const queue = createRafQueue();
  const images = createImageStub();
  const queries = [];
  globalThis.requestAnimationFrame = queue.requestAnimationFrame;
  globalThis.cancelAnimationFrame = queue.cancelAnimationFrame;
  globalThis.Image = images.Image;
  globalThis.matchMedia = (media) => {
    const m = {
      media,
      matches: reduce && media.includes('reduced-motion'),
      handlers: {},
      addEventListener(type, fn) { this.handlers[type] = fn; },
      removeEventListener() {},
    };
    queries.push(m);
    return m;
  };
  return { queue, images, queries };
}

const frameMs = ({ stepsPerFrame, hz }) =>
  (stepsPerFrame ? stepsPerFrame * STEP_MS + SLACK_MS : 1000 / hz);

// One scripted eight-tenths of a second of play at a chosen display rate: the same three events,
// the same clock origin, a different cadence. Returns the sim snapshot taken at each checkpoint.
function play({ rate, checkpoints = CHECKPOINTS, seedBurst = 40 } = {}) {
  const dom = installDom();
  const canvas = createCanvasStub();
  const view = createView(canvas, { onCommit: () => {} });
  view.attach({ state: solvedState(), view: { yaw: 0.62, pitch: 0.42 } });
  view.start();
  view.animate(3);
  view.showHint(5, 700);
  const born = view.burst(seedBurst);
  const ms = frameMs(rate);
  let ts = 1000; // the sandbox clock starts at 1000 ms, never at 0: a 0-seeded clock hides a seed
  const hit = new Map();
  let frames = 0;
  while (frames < 5000) {
    frames += 1;
    ts += ms;
    dom.queue.pump(ts);
    const sim = view.sim;
    for (const c of checkpoints) if (!hit.has(c) && sim.steps >= c) hit.set(c, { ...sim, at: frames });
    if (hit.size === checkpoints.length) break;
  }
  return { rate, view, dom, canvas, hit, frames, born, sim: view.sim };
}

// `frames` is paint count and `accum` is unpaid wall-clock debt: both are properties of the
// cadence, not of the simulation, so a faster display legitimately reports different numbers and
// comparing them would make this file red for the wrong reason. Everything else must match.
const compared = (snap) => {
  const { frames, at, accum, ...rest } = snap;
  return rest;
};

test('the same sim steps run identically at 30, 60, 120 and 144 Hz', () => {
  const runs = RATES.map((rate) => play({ rate }));
  const bad = [];
  const clockAt = (c) => Math.round(c * SIM_STEP * 1e4) / 1e4;
  for (const c of CHECKPOINTS) {
    const ref = runs[0].hit.get(c);
    ok(ref, `30 Hz never reached step ${c}`);
    if (ref.clock !== clockAt(c)) bad.push({ c, hz: 30, clock: ref.clock, expected: clockAt(c) });
    for (const r of runs.slice(1)) {
      const got = r.hit.get(c);
      if (!got) { bad.push({ c, hz: r.rate.hz, why: 'never reached' }); continue; }
      const a = JSON.stringify(compared(ref));
      const b = JSON.stringify(compared(got));
      if (a !== b) bad.push({ c, hz: r.rate.hz, ref: compared(ref), got: compared(got) });
    }
  }
  eq(bad, [], 'a field moved with the frame rate, or the sim clock slipped off the step counter');
});

// Two guards against a vacuous pass: the loop must actually have run at each cadence (so the
// identical snapshots above are not four reads of a never-advanced zero), and the debt it holds
// must stay smaller than one step (so `accum` is a remainder, not a second time source).
test('the cadences really differed, and the accumulator stayed a remainder', () => {
  const runs = RATES.map((rate) => play({ rate }));
  const last = CHECKPOINTS[CHECKPOINTS.length - 1];
  const painted = runs.map((r) => r.hit.get(last).at);
  // Reaching the same step count takes more frames the slower the display: 4 steps a frame, then
  // 2, then 1, then 0.83. If these numbers were equal the loop had not run and the diff above was
  // four reads of the same untouched zero.
  for (let i = 1; i < painted.length; i++) {
    ok(painted[i] > painted[i - 1], `${RATES[i].hz} Hz painted ${painted[i]} frames after ${RATES[i - 1].hz} needed ${painted[i - 1]}: the cadences did not differ`);
  }
  for (const r of runs) {
    ok(r.sim.accum >= 0 && r.sim.accum < SIM_STEP + 1e-9, `${r.rate.hz} Hz carries ${r.sim.accum} of debt`);
  }
});

test('particles are alive, falling and reproducible — not an empty array compared with itself', () => {
  const run = play({ rate: RATES[1] });
  const early = run.hit.get(12);
  const mid = run.hit.get(60);
  const late = run.hit.get(96);
  ok(early.sparks > 0, 'burst() spawned nothing');
  ok(early.sparks <= 90, `burst() overshot the cap: ${early.sparks}`);
  ok(mid.sparkSumY > early.sparkSumY, 'gravity should drag the mean y down (canvas y grows downward)');
  ok(late.sparkSumLife < mid.sparkSumLife, 'lives should be draining');
  ok(late.sparks < mid.sparks && late.sparks > 0, 'the splash never drained, or drained too early');
  eq([early.animMove, early.hintMove], [3, 5], 'neither the animation nor the hint was running at 0.1 s');
  eq([mid.animMove, mid.hintMove], [-1, 5], 'the turn animation outlived its own budget');
  eq([late.animMove, late.hintMove], [-1, -1], 'the hint did not expire on the sim clock');
  const other = play({ rate: RATES[3] });
  eq(compared(other.hit.get(96)), compared(late), '144 Hz disagrees about the drained splash');
});

test('pause stops the simulation and keeps the paint loop alive', () => {
  const dom = installDom();
  const canvas = createCanvasStub();
  const view = createView(canvas, { onCommit: () => {} });
  view.attach({ state: solvedState(), view: { yaw: 0.62, pitch: 0.42 } });
  view.start();
  view.animate(3);
  view.showHint(5, 700);
  view.burst(40);
  const ms = frameMs(RATES[1]);
  let ts = 1000;
  for (let i = 0; i < 6; i++) { ts += ms; dom.queue.pump(ts); }
  const before = view.sim;
  ok(before.steps > 0 && before.sparks > 0 && before.animT > 0, 'nothing had run before the pause');
  ok(view.setPaused(true), 'setPaused did not stick');
  for (let i = 0; i < 600; i++) { ts += ms; dom.queue.pump(ts); } // ten wall-clock seconds
  const during = view.sim;
  eq([during.steps, during.clock], [before.steps, before.clock], 'sim time advanced while paused');
  eq([during.sparkSumY, during.animT, during.hintT], [before.sparkSumY, before.animT, before.hintT], 'state moved while paused');
  ok(dom.queue.armed === 1, 'the loop stopped re-arming: pause killed rAF instead of the sim');
  view.setPaused(false);
  for (let i = 0; i < 24; i++) { ts += ms; dom.queue.pump(ts); }
  ok(view.sim.steps > during.steps, 'unpausing did not resume the sim');
  ok(view.sim.steps - during.steps <= 48, `the ten paused seconds were billed on release: +${view.sim.steps - during.steps} steps`);
});

test('attach (a restart) hands back a clean simulation', () => {
  const run = play({ rate: RATES[1] });
  ok(run.sim.steps > 0 && run.sim.sparkSumLife > 0, 'precondition: the run left a live splash behind');
  run.view.attach({ state: solvedState(), view: { yaw: 1.1, pitch: 0.3 } });
  const fresh = run.view.sim;
  eq([fresh.steps, fresh.clock, fresh.accum], [0, 0, 0], 'sim time survived a restart');
  eq(fresh.sparks, 0, 'particles survived a restart');
  eq([fresh.animMove, fresh.hintMove], [-1, -1], 'a half-played animation or hint survived a restart');
  eq(fresh.paused, false, 'pause survived a restart');
  // The splash rng is reseeded too, so a restart's first burst is particle-for-particle the first
  // game's first burst — the same shapes, not merely the same count of them.
  run.view.burst(40);
  const afterRestart = run.view.sim;
  const virgin = (() => {
    installDom();
    const v = createView(createCanvasStub(), { onCommit: () => {} });
    v.attach({ state: solvedState(), view: { yaw: 0.62, pitch: 0.42 } });
    v.burst(40);
    return v.sim;
  })();
  eq(afterRestart.spark0, virgin.spark0, 'the splash rng kept its position across a restart');
  eq(afterRestart.sparkSumLife, virgin.sparkSumLife, 'a restart replayed the splash from a different rng offset');
  eq(afterRestart.sparkSumX, virgin.sparkSumX, 'a restart replayed the splash from a different rng offset');
});

test('reduced motion is a real branch: no tween, no particles', () => {
  const dom = installDom({ reduce: true });
  const canvas = createCanvasStub();
  const view = createView(canvas, { onCommit: () => {} });
  ok(dom.queries.some((q) => q.media.includes('prefers-reduced-motion')), 'matchMedia was never asked');
  ok(dom.queries.some((q) => q.media.includes('prefers-reduced-motion') && q.matches), 'the answer was ignored');
  view.attach({ state: solvedState(), view: { yaw: 0.62, pitch: 0.42 } });
  view.start();
  eq(view.reducedMotion(), true, 'the flag did not come from the media query');
  eq(view.burst(40), 0, 'particles were spawned under reduced motion');
  view.animate(3);
  let ts = 1000;
  for (let i = 0; i < 30; i++) { ts += frameMs(RATES[1]); dom.queue.pump(ts); }
  eq([view.sim.animMove, view.sim.sparks], [-1, 0], 'a tween or a splash was queued anyway');
  ok(canvas.__ops.fill > 0, 'the snap path never painted');
  // Flipping the flag mid-flight must clear what is already in the air, not merely refuse new work.
  const live = play({ rate: RATES[1], checkpoints: [12] });
  ok(live.view.sim.sparks > 0, 'precondition: particles are falling');
  live.view.setReducedMotion(true);
  eq([live.view.sim.sparks, live.view.reducedMotion()], [0, true], 'the in-flight splash kept falling');
});

// The one row about the asset rather than the arithmetic: if assets/tex/spark-64.png were wired to
// nothing, every test above would still pass.
test('the particle sprite is drawn when it arrives, and the arc only stands in before it does', () => {
  const dom = installDom();
  const canvas = createCanvasStub();
  const view = createView(canvas, { onCommit: () => {} });
  view.attach({ state: solvedState(), view: { yaw: 0.62, pitch: 0.42 } });
  view.start();
  let ts = 1000;
  const pump = (n) => { for (let i = 0; i < n; i++) { ts += frameMs(RATES[1]); dom.queue.pump(ts); } };
  pump(2);
  eq(dom.images.live.length, 0, 'a sprite was requested before anything was burst');
  view.burst(20);
  eq(dom.images.live.length, 1, 'burst did not ask for the sprite');
  eq(dom.images.live[0].src, 'assets/tex/spark-64.png', 'burst asked for the wrong path');
  pump(4);
  ok(canvas.__ops.arc > 0, 'the fallback never drew while the sprite was loading');
  eq(canvas.__ops.drawImage, 0, 'drawImage ran with nothing loaded');
  const arcs = canvas.__ops.arc;
  dom.images.loadAll();
  canvas.__ops.arc = 0;
  canvas.__ops.drawImage = 0;
  pump(4);
  ok(canvas.__ops.drawImage >= arcs, `sprite loaded but only ${canvas.__ops.drawImage} drawImage calls`);
  eq(canvas.__ops.arc, 0, 'the fallback still ran after the sprite arrived');
  ok(view.sim.sparks > 0, 'the splash drained during the swap');
});

run();
