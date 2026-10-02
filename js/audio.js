// Sound. Everything here is synthesised — no audio files, so there is nothing to download, nothing
// to fail to decode, and the whole palette is these constants.
//
// Two promises the shell relies on, both of which are easy to fake and hard to mean:
//
// 1. Mute is real. `setMuted(true)` suspends the AudioContext itself, so the graph stops running
//    rather than being turned down, and no oscillator is ever created while muted — a muted game
//    allocates nothing per event. On resume the suspended clock continues, so no backlog of
//    scheduled tones fires at once.
// 2. Nothing is built at import. `cos_load_sweep` runs this module in a shim that has an
//    AudioContext without `suspend`, and no user has necessarily interacted yet (the browser
//    would refuse it anyway). The context appears on the first gesture, via unlock(), and every
//    entry point checks for it instead of assuming one.

const MASTER_GAIN = 0.16;
// Seconds. Two turns faster than this are one click to the ear, and stacking plucks only makes a
// buzz. Measured in seconds because the clock it is compared against is `performance.now()`, which
// is wall-clock and has nothing to do with the simulation in js/view.js.
const TURN_COOLDOWN_S = 0.045;

// The five-note ground the whole kit is cut from: a minor pentatonic on A, so any two of these can
// sound together without arguing.
const SCALE = [220, 261.63, 293.66, 349.23, 440, 523.25];

export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;
  let lastTurn = -1;
  let lastTurnAt = 0;
  // The graph exists only after a gesture has been honoured. Building it inside a tone would
  // hand a suspended context to the browser and lose the note anyway, and it would make the
  // module allocate the moment a test imported it.
  let armed = false;

  function canConstruct() {
    return typeof globalThis.AudioContext === 'function' || typeof globalThis.webkitAudioContext === 'function';
  }

  function build() {
    if (ctx || !canConstruct()) return ctx;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    try {
      ctx = new Ctor();
    } catch (err) {
      void err; // no audio device, or refused before a gesture: the game is silent and fine
      ctx = null;
      return null;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_GAIN;
    master.connect(ctx.destination);
    return ctx;
  }

  // Called from a real input event. An existing suspended context is only resumed if the player is
  // not muted — otherwise the first tap would defeat the mute they set.
  function unlock() {
    const c = build();
    if (!c) return false;
    armed = true;
    if (c.state === 'suspended' && !muted && typeof c.resume === 'function') return c.resume().then(() => true, () => false);
    return Promise.resolve(true);
  }

  // One struck note: a fast attack, an exponential decay, and a lowpass that closes as the note
  // dies, which is what makes it read as plastic clicking rather than as a beep.
  function tone({ freq = 440, dur = 0.12, type = 'triangle', at = 0, peak = 1, sweep = 0 } = {}) {
    // Two reasons to allocate nothing: muted, or no gesture yet. Both return before any node.
    if (muted || !armed) return false;
    const c = build();
    if (!c || c.state === 'closed' || !master) return false;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t0 + dur);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const shape = c.createBiquadFilter();
    shape.type = 'lowpass';
    shape.frequency.setValueAtTime(2600, t0);
    shape.frequency.exponentialRampToValueAtTime(700, t0 + dur);
    osc.connect(shape).connect(gain).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    return true;
  }

  return {
    unlock,
    // A committed turn. The pitch follows the move's axis, so three drags on the same face are one
    // note and a scramble has a shape to it. The cooldown is a floor on the interval, not a queue.
    turn(move) {
      const now = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000;
      if (move === lastTurn && now - lastTurnAt < TURN_COOLDOWN_S) return false;
      lastTurn = move;
      lastTurnAt = now;
      const axis = ((move >> 1) % SCALE.length + SCALE.length) % SCALE.length;
      const up = (move & 1) === 0;
      return tone({ freq: SCALE[axis] * (up ? 1 : 0.75), dur: 0.1, type: 'triangle', peak: 0.9, sweep: 0.55 });
    },
    hint() {
      return tone({ freq: SCALE[5], dur: 0.2, type: 'sine', peak: 0.5, sweep: 1.4 });
    },
    // Undo deliberately sounds like `turn` run backwards: same axis pitch, descending.
    undo() {
      return tone({ freq: SCALE[1], dur: 0.09, type: 'triangle', peak: 0.6, sweep: 0.6 });
    },
    win(onPar) {
      // A solved cube is an arpeggio; hitting par is the same arpeggio resolving up a fourth.
      const notes = onPar ? [0, 2, 4, 5] : [0, 2, 4];
      return notes.reduce((any, step, i) => tone({ freq: SCALE[step], dur: 0.26, type: 'sine', at: i * 0.09, peak: 0.75 }) || any, false);
    },
    setMuted(v) {
      muted = !!v;
      if (!ctx) return muted; // nothing built yet: the flag alone is the whole state
      // The point of the exercise: the graph is suspended, not merely quiet. A shim without
      // suspend() (cos_load_sweep) falls back to gain, which is a worse mute but not a crash.
      if (muted) {
        if (master) master.gain.value = 0;
        if (typeof ctx.suspend === 'function') ctx.suspend().catch(() => {});
      } else {
        if (master) master.gain.value = MASTER_GAIN;
        if (typeof ctx.resume === 'function') ctx.resume().catch(() => {});
      }
      return muted;
    },
    get muted() {
      return muted;
    },
    // Read by the shell's test hook: whether audio could exist at all, and what the graph says
    // about being muted. `state === 'suspended'` while muted is the proof the promise was kept.
    info() {
      return { available: canConstruct(), built: !!ctx, state: ctx ? ctx.state : 'none', muted, master: master ? master.gain.value : 0 };
    },
  };
}
