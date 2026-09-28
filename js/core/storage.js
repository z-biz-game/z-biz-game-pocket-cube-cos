// Save file. One localStorage key, plain JSON, and a versioned shape so an old save can be
// recognised rather than mistaken for a new one.
//
// Records are keyed by lot id. The rule this file exists for is that a best score only ever
// goes down: re-playing a cube you already solved cannot make your record worse, and neither
// can a corrupt or hand-edited localStorage value — every field passes through the blank
// shape on the way in, and a number that is not a number becomes zero.
//
// Everything degrades to a memory object when localStorage is denied, which it is under
// file://, in private windows, and in some embedded webviews. It is also the path this repo's
// node suite takes, on purpose: a game that crashes when storage throws is not a game, and
// the only way to know it does not is to run it with no window at all.

const KEY = 'pocketcube.save.v1';

function blank() {
  return {
    records: {},
    daily: {},
    unlocked: 1,
    stats: { solves: 0, turns: 0, perfect: 0, hints: 0 },
  };
}

let cache = null;
let memory = null; // what persist() wrote the last time localStorage threw

function readRaw() {
  try {
    return window.localStorage.getItem(KEY);
  } catch (err) {
    return null; // ReferenceError in node, SecurityError in a blocked frame
  }
}

function writeRaw(text) {
  try {
    window.localStorage.setItem(KEY, text);
    return true;
  } catch (err) {
    memory = text;
    return false;
  }
}

function uint(v, fallback) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

function load() {
  if (cache) return cache;
  const stored = readRaw();
  const raw = stored !== null ? stored : memory;
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === 'object') {
        const base = blank();
        const out = {
          records: p.records && typeof p.records === 'object' ? p.records : base.records,
          daily: p.daily && typeof p.daily === 'object' ? p.daily : base.daily,
          unlocked: uint(p.unlocked, 0) || 1,
          stats: { ...base.stats, ...(p.stats && typeof p.stats === 'object' ? p.stats : {}) },
        };
        for (const k of Object.keys(base.stats)) out.stats[k] = uint(out.stats[k], 0);
        // A record that is not a record is dropped rather than trusted: the panel prints
        // these numbers as the player's own history.
        for (const id of Object.keys(out.records)) {
          const r = out.records[id];
          if (!r || typeof r !== 'object' || uint(r.best, -1) < 0) {
            delete out.records[id];
            continue;
          }
          r.best = uint(r.best, 0);
          r.plays = uint(r.plays, 0) || 1;
          r.perfect = r.perfect === true;
        }
        cache = out;
        return cache;
      }
    } catch (err) {
      // A corrupt save is not worth keeping; start clean rather than crash the shell.
    }
  }
  cache = blank();
  return cache;
}

function persist() {
  writeRaw(JSON.stringify(cache));
}

export const store = {
  get records() { return load().records; },
  get stats() { return load().stats; },
  get daily() { return load().daily; },
  get unlocked() { return load().unlocked; },

  record(id) {
    return load().records[id] || null;
  },

  // The only writer of a best score, and deliberately the only place the words "par" and
  // "hints" meet: a run that needed help is a solve, but it is not a perfect one, and that
  // judgement has to be made once rather than in two screens.
  solve(id, { turns, par, hints = 0 }) {
    const s = load();
    // `uint(null, -1)` is 0, because Number(null) is 0 — and a solve of no turns would then
    // beat every record on the board. turns must *be* a count, not merely fail to be negative.
    const t = turns === null || turns === undefined ? -1 : uint(turns, -1);
    if (t < 0) return { solved: false, error: 'turns must be a count' };
    // `par == null` means "nobody measured this cube", and Number(null) is 0 — so without the
    // explicit null test a hand-typed scramble would bill itself as a perfect run and raise the
    // 完美 tally with a number that has no meaning.
    const p = par === null || par === undefined ? -1 : uint(par, -1);
    const perfect = uint(hints, 0) === 0 && p >= 0 && t <= p;
    const prev = s.records[id] || null;
    const best = prev ? Math.min(prev.best, t) : t;
    s.records[id] = {
      best,
      plays: (prev ? prev.plays : 0) + 1,
      perfect: (prev && prev.perfect) || perfect,
      at: Date.now(),
    };
    s.stats.solves++;
    s.stats.turns += t;
    if (perfect) s.stats.perfect++;
    persist();
    return { solved: true, best: s.records[id].best, plays: s.records[id].plays, perfect: s.records[id].perfect };
  },

  // Unlocking is monotone by design: finishing level 7 must never hide level 8 again.
  unlock(n) {
    const s = load();
    const v = uint(n, 0);
    if (v > s.unlocked) s.unlocked = v;
    persist();
    return s.unlocked;
  },

  markDaily(dateKey, id) {
    const s = load();
    s.daily[dateKey] = { id, at: Date.now() };
    persist();
    return s.daily[dateKey];
  },

  dailyDone(dateKey) {
    return load().daily[dateKey] || null;
  },

  countHint() {
    const s = load();
    s.stats.hints++;
    persist();
    return s.stats.hints;
  },

  wipe() {
    cache = blank();
    persist();
    return cache;
  },

  // Test hook: the suites share a module instance, so each one asks for a clean file.
  // It clears the stored raw as well as the cache — a reset that only replaced the in-memory
  // object would leave the old save on disk, and the next reload would hand it back as if the
  // wipe had never happened.
  reset() {
    cache = blank();
    memory = null;
    try {
      window.localStorage.removeItem(KEY);
    } catch (err) {
      void err; // node, or a frame that will not give storage at all: memory is already clean
    }
    return cache;
  },

  snapshot() {
    return JSON.parse(JSON.stringify(load()));
  },
};

export const SAVE_KEY = KEY;
