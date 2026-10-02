// 「静音」是 sellability 清单上最容易交假账的一项：grep 到一个 `muted` 变量、或一个把 gain
// 拧到 0 的函数，都能骗过静态尺，而玩家听到的还是同一串音。js/audio.js 的承诺不是「声音变小」，
// 是 AudioContext 被 suspend()、并且静音期间一个振荡器都不建。这条只能按行为量。
//
// 所以这里造一个假 AudioContext —— 只记账，不发声 —— 问四个问题：import 时到底建了没有；
// 静音时 suspend 有没有真的被叫到；静音期间的 50 次转层有没有分配任何东西；以及当环境根本没有
// suspend（cos_load_sweep 的 shim 就是这种）时，代码是崩了还是退化成 gain=0。
//
// 假对象是刻意薄的：任何 audio.js 里新增的节点类型都会在这里露出来（未登记的 create* 直接抛），
// 这样"加了个音效但忘了它该在静音下闭嘴"会变成一次失败，而不是一次上线。

import { test, run, ok, eq } from '../tools/harness.mjs';
import { createAudio } from '../js/audio.js';

function createFakeAudioContext({ withSuspend = true } = {}) {
  const log = { contexts: 0, oscillators: 0, gains: 0, filters: 0, starts: 0, suspends: 0, resumes: 0 };
  const connectable = () => ({ connect: (d) => d });
  function FakeCtx() {
    log.contexts += 1;
    this.state = 'running';
    this.currentTime = 0;
    this.destination = connectable();
    const self = this;
    this.createGain = () => {
      log.gains += 1;
      return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d) => d };
    };
    this.createBiquadFilter = () => {
      log.filters += 1;
      return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (d) => d };
    };
    this.createOscillator = () => {
      log.oscillators += 1;
      return {
        type: '',
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect: (d) => d,
        start() { log.starts += 1; },
        stop() {},
      };
    };
    if (withSuspend) {
      this.suspend = () => { log.suspends += 1; self.state = 'suspended'; return Promise.resolve(); };
      this.resume = () => { log.resumes += 1; self.state = 'running'; return Promise.resolve(); };
    }
  }
  globalThis.AudioContext = FakeCtx;
  return log;
}

test('importing the kit builds no audio context: nothing is allocated before a gesture', () => {
  const log = createFakeAudioContext();
  const audio = createAudio();
  eq(log.contexts, 0, 'an AudioContext existed at import');
  eq(audio.info().built, false, 'info() claims a graph was built');
  // A turn before any unlock must not smuggle one in either — the browser would refuse it anyway.
  audio.turn(0);
  eq(log.contexts, 0, 'a turn created the context behind a missing gesture');
  audio.unlock();
  eq(log.contexts, 1, 'unlock did not build the graph');
});

test('mute suspends the graph, and a muted game allocates nothing per event', () => {
  const log = createFakeAudioContext();
  const audio = createAudio();
  audio.unlock();
  ok(audio.turn(2), 'a turn at full volume reported failure');
  const oscAfterOneTurn = log.oscillators;
  ok(oscAfterOneTurn > 0, 'a turn made no oscillator at all');
  ok(audio.setMuted(true), 'setMuted did not report the new state');
  eq(audio.info().muted, true, 'muted flag disagrees');
  ok(log.suspends === 1, `suspend was called ${log.suspends} times, expected exactly 1`);
  eq(audio.info().state, 'suspended', 'the context is still running while muted');
  const before = { osc: log.oscillators, gains: log.gains, filters: log.filters, starts: log.starts };
  for (let i = 0; i < 50; i++) {
    // Distinct move indices so the turn cooldown cannot be what silences these calls.
    eq(audio.turn(i % 12), false, `a muted turn still spoke (move ${i % 12})`);
    audio.hint();
    audio.undo();
    audio.win(true);
  }
  eq(log.oscillators, before.osc, `${log.oscillators - before.osc} oscillators were built while muted`);
  eq(log.gains, before.gains, 'gain nodes were built while muted');
  eq(log.filters, before.filters, 'filters were built while muted');
  eq(log.starts, before.starts, 'something was scheduled to start while muted');
  eq(audio.setMuted(false), false, 'unmuting reported still muted');
  ok(log.resumes >= 1, 'resume never ran');
  eq(audio.info().state, 'running', 'the graph stayed suspended after unmuting');
  const oscBeforeUnmuted = log.oscillators;
  audio.turn(4);
  ok(log.oscillators > oscBeforeUnmuted, 'unmuting did not let sound come back');
});

// cos_load_sweep hands out an AudioContext with no suspend at all. The honest fallback is a gain
// of zero — worse than a real suspend, but not a crash, and the promise "nothing allocated" holds
// either way.
test('a host without suspend degrades to gain=0 instead of throwing', () => {
  const log = createFakeAudioContext({ withSuspend: false });
  const audio = createAudio();
  audio.unlock();
  ok(audio.setMuted(true), 'mute refused to take effect on a thin host');
  eq(log.suspends, 0, 'suspend was somehow called on a context that has none');
  eq(audio.info().master, 0, `the fallback left gain at ${audio.info().master}`);
  eq(audio.turn(1), false, 'a muted turn still allocated on the thin host');
  eq(log.starts, 0, 'a muted thin host still scheduled a note to start');
  audio.setMuted(false);
  ok(audio.info().master > 0, 'unmuting did not restore the gain');
});

test('a host with no AudioContext at all stays playable', () => {
  delete globalThis.AudioContext;
  delete globalThis.webkitAudioContext;
  const audio = createAudio();
  eq(audio.info().available, false, 'the kit claims it can build here');
  eq(audio.unlock(), false, 'unlock pretended to succeed');
  eq(audio.turn(0), false, 'a turn reported sound with no audio device');
  eq(audio.setMuted(true), true, 'mute did not remember the player choice');
  eq(audio.info().built, false, 'something was built anyway');
});

test('repeating the same turn inside the cooldown is one click, not a buzz', () => {
  createFakeAudioContext();
  const audio = createAudio();
  audio.unlock();
  eq(audio.turn(6), true, 'the first turn was refused');
  eq(audio.turn(6), false, 'the same move inside the cooldown made a second sound');
  eq(audio.turn(7), true, 'a different move must not be swallowed by the cooldown');
});

run();
