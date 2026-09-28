// The save file, on both of its paths.
//
// storage.js has one rule with real consequences: a best score only ever goes down, and a
// number that is not a number never reaches the panel that calls it the player's history. Both
// halves need a browser-shaped environment to be worth anything, and `cache` is module state, so
// each scenario below gets its own instance (`?fresh=<name>`) and the `window` global it is
// supposed to see, installed *before* the import:
//
//   A  no `window` at all          -> the node / file:// degradation the header promises
//   B  a write that throws         -> the private-window and webview path
//   C  a read that throws          -> a frame that refuses storage outright
//   D  a save that is already there -> the read-back, the corrupt file, the junk records
//
// `store.reset()` is what the browser suites call between scenarios; row B2 pins that it also
// drops the stored raw, or a "cleared" save would come back on the next reload.

import { test, run, ok, eq } from '../tools/harness.mjs';

const KEY = 'pocketcube.save.v1';

function fakeStorage(seed) {
  const map = new Map(seed ? Object.entries(seed) : []);
  return {
    map,
    get: 0,
    set: 0,
    removed: 0,
    throwOnWrite: false,
    throwOnRead: false,
    getItem(k) {
      this.get++;
      if (this.throwOnRead) throw new Error('SecurityError: access denied');
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      this.set++;
      if (this.throwOnWrite) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem(k) {
      this.removed++;
      map.delete(k);
    },
  };
}

// A. the bare node path: there is no window, so every storage call must be caught.
const A = await import('../js/core/storage.js?fresh=A');

test('A1 with no window the store still plays, on memory', () => {
  eq(typeof globalThis.window, 'undefined', 'this is the path storage.js:28-34 plans for');
  const s = A.store.snapshot();
  eq(s.records, {});
  eq(s.unlocked, 1);
  eq(s.stats, { solves: 0, turns: 0, perfect: 0, hints: 0 });
  const r = A.store.solve('cube-01', { turns: 6, par: 6, hints: 0 });
  eq(r.solved, true);
  eq(A.store.record('cube-01').best, 6);
  eq(A.store.record('cube-01').perfect, true);
  eq(A.SAVE_KEY, KEY, 'one key, versioned in its name');
});

test('A2 a best score only ever goes down, and plays count up', () => {
  A.store.reset();
  A.store.solve('cube-02', { turns: 9, par: 8 });
  eq(A.store.record('cube-02').best, 9);
  eq(A.store.record('cube-02').perfect, false, '9 against a par of 8 is not perfect');
  A.store.solve('cube-02', { turns: 8, par: 8 });
  eq(A.store.record('cube-02').best, 8, 'the better run took the record down');
  eq(A.store.record('cube-02').perfect, true);
  A.store.solve('cube-02', { turns: 14, par: 8 });
  const rec = A.store.record('cube-02');
  eq(rec.best, 8, 'a worse run cannot raise it');
  eq(rec.plays, 3);
  eq(rec.perfect, true, 'one perfect run is enough to own the flag');
});

test('A3 a run that needed help is a solve, but not a perfect one', () => {
  A.store.reset();
  eq(A.store.solve('cube-03', { turns: 6, par: 6, hints: 1 }).perfect, false);
  eq(A.store.stats.perfect, 0);
  eq(A.store.stats.solves, 1, 'it is still a solve and still counts as one');
  eq(A.store.stats.turns, 6);
  eq(A.store.solve('cube-03', { turns: 6, par: 6, hints: 0 }).perfect, true);
  eq(A.store.stats.perfect, 1, 'a clean run later earns it');
  eq(A.store.record('cube-03').perfect, true, 'and the flag is sticky in the record too');
});

test('A4 a turn count that is not a count is refused before it can become a score', () => {
  A.store.reset();
  for (const bad of [undefined, -1, 'six', NaN, 1.5, null]) {
    const r = A.store.solve('cube-04', { turns: bad, par: 6 });
    eq(r.solved, false, `refused turns=${String(bad)}`);
    eq(r.error, 'turns must be a count');
  }
  eq(A.store.record('cube-04'), null, 'and nothing was written');
  eq(A.store.stats.solves, 0, 'nor billed');
});

test('A5 unlocking is monotone and the daily mark is keyed by date', () => {
  A.store.reset();
  eq(A.store.unlock(7), 7);
  eq(A.store.unlock(3), 7, 'finishing level 3 must never hide level 8 again');
  eq(A.store.unlock('x'), 7, 'a junk unlock changes nothing');
  eq(A.store.unlock(-2), 7);
  eq(A.store.dailyDone('2026-09-28'), null);
  eq(A.store.markDaily('2026-09-28', 'cube-11').id, 'cube-11');
  eq(A.store.dailyDone('2026-09-28').id, 'cube-11');
  eq(A.store.dailyDone('2026-09-27'), null, 'yesterday is not today');
  eq(A.store.countHint(), 1);
  eq(A.store.countHint(), 2);
  eq(A.store.stats.hints, 2);
});

test('A6 wipe writes an empty table rather than deleting the key', () => {
  A.store.solve('cube-05', { turns: 4, par: 4 });
  A.store.unlock(4);
  const s = A.store.wipe();
  eq(s.records, {});
  eq(s.unlocked, 1);
  eq(s.stats, { solves: 0, turns: 0, perfect: 0, hints: 0 });
  eq(Object.keys(A.store.records).length, 0);
});

// B. a frame with working storage that says no to writes.
const bLs = fakeStorage();
globalThis.window = { localStorage: bLs };
bLs.throwOnWrite = true;
const B = await import('../js/core/storage.js?fresh=B');

test('B1 a refused write is a fallback, not a lost run', () => {
  const r = B.store.solve('cube-06', { turns: 7, par: 8 });
  eq(r.solved, true, 'the solve still happened');
  eq(B.store.record('cube-06').best, 7);
  eq(bLs.set, 1, 'the write was attempted');
  eq(bLs.map.size, 0, 'and nothing reached the frame');
  B.store.solve('cube-06', { turns: 6, par: 8 });
  eq(B.store.record('cube-06').best, 6, 'the rules are the same with no disk under them');
  eq(B.store.stats.turns, 13);
});

// B2 gets its own instance and its own *writable* frame, because reset() has to have something
// on disk to remove.
const b2Ls = fakeStorage();
globalThis.window = { localStorage: b2Ls };
const B2 = await import('../js/core/storage.js?fresh=B2');

test('B2 reset drops the stored raw as well as the cache', () => {
  B2.store.solve('cube-09', { turns: 6, par: 6 });
  eq(b2Ls.map.has(KEY), true, 'a solve is on disk');
  B2.store.reset();
  ok(b2Ls.removed >= 1, 'reset called removeItem');
  eq(b2Ls.map.has(KEY), false, 'so a reload cannot bring the old scores back');
  eq(Object.keys(B2.store.records).length, 0);
});

// C. a frame that throws on read as well.
const cLs = fakeStorage({ [KEY]: JSON.stringify({ unlocked: 9, records: { 'cube-01': { best: 3 } } }) });
globalThis.window = { localStorage: cLs };
cLs.throwOnRead = true;
const C = await import('../js/core/storage.js?fresh=C');

test('C3 a read that throws comes back empty rather than fatal', () => {
  const s = C.store.snapshot();
  eq(s.unlocked, 1, 'the file said 9 and the frame said no');
  eq(Object.keys(s.records).length, 0);
  eq(cLs.get >= 1, true, 'it did try to read');
  eq(C.store.solve('cube-08', { turns: 3, par: 99 }).perfect, true, 'and the game keeps billing');
});

// D. a save that is already there, read by a module that has never seen it.
const seedGood = {
  records: { 'cube-01': { best: 6, plays: 2, perfect: true, at: 1 }, 'cube-02': { best: 9, plays: 1, perfect: false, at: 2 } },
  daily: { '2026-09-27': { id: 'cube-05', at: 3 } },
  unlocked: 5,
  stats: { solves: 2, turns: 15, perfect: 1, hints: 3 },
};
const dLs = fakeStorage({ [KEY]: JSON.stringify(seedGood) });
globalThis.window = { localStorage: dLs };
const D = await import('../js/core/storage.js?fresh=D');

test('D1 a save on disk is read back, not restarted', () => {
  eq(D.store.unlocked, 5);
  eq(D.store.record('cube-01').best, 6);
  eq(D.store.record('cube-01').perfect, true);
  eq(D.store.record('cube-02').perfect, false);
  eq(D.store.stats.hints, 3);
  eq(D.store.stats.turns, 15);
  eq(D.store.dailyDone('2026-09-27').id, 'cube-05');
  eq(Object.keys(D.store.records).length, 2);
  eq(dLs.get, 1, 'and it was read from the frame, not recomputed');
});

test('D2 a new solve on top of an old save keeps the old rows', () => {
  D.store.solve('cube-03', { turns: 10, par: 10 });
  eq(Object.keys(D.store.records).length, 3);
  eq(D.store.record('cube-01').best, 6, 'the history is not rewritten');
  eq(D.store.stats.solves, 3, 'solves accumulate across sessions');
  eq(D.store.unlocked, 5, 'and a save at level 5 does not fall back to 1');
  const raw = JSON.parse(dLs.map.get(KEY));
  eq(raw.records['cube-03'].best, 10, 'the write carried the whole table');
  eq(Object.keys(raw.records).length, 3);
});

const junkRaw = ['{', 'null', '[]', '"a string"', '0', ''];
const junkNames = ['brace', 'null', 'array', 'string', 'zero', 'empty'];
// storage.js reads `window` when a method is *called*, not when the module is imported, so each
// case takes its snapshot while its own frame is still installed. Awaiting the import and the
// read together is the only way a cached module instance sees the file it is supposed to have
// found on disk.
const JUNK = [];
for (let i = 0; i < junkRaw.length; i++) {
  globalThis.window = { localStorage: fakeStorage({ [KEY]: junkRaw[i] }) };
  const m = await import(`../js/core/storage.js?fresh=junk-${junkNames[i]}`);
  JUNK.push({ text: junkRaw[i], snap: m.store.snapshot() });
}
globalThis.window = { localStorage: dLs };

test('D3 a corrupt file starts clean instead of crashing the shell', () => {
  for (const j of JUNK) {
    const label = j.text || '(empty)';
    eq(j.snap.records, {}, `${label} -> empty records`);
    eq(j.snap.unlocked, 1, `${label} -> level one`);
    eq(j.snap.stats.turns, 0, `${label} -> nothing billed`);
    eq(j.snap.daily, {}, `${label} -> no daily marks`);
  }
});

const junkSeed = {
  records: {
    good: { best: 7, plays: 3, perfect: true },
    'no-best': { plays: 2 },
    neg: { best: -4 },
    nan: { best: 'seven' },
    null: null,
    string: 'hello',
    'junk-plays': { best: 4, plays: -9, perfect: 'yes' },
  },
  unlocked: 'nine',
  stats: { solves: -3, turns: 'many', perfect: 2.5, hints: 4 },
  daily: 'not an object',
};
globalThis.window = { localStorage: fakeStorage({ [KEY]: JSON.stringify(junkSeed) }) };
const E = await import('../js/core/storage.js?fresh=E');
const eSnap = E.store.snapshot(); // read before the frame changes underneath the module
globalThis.window = { localStorage: dLs };

test('D4 a record that is not a record is dropped, and a bad number becomes zero', () => {
  eq(Object.keys(eSnap.records).sort().join(','), 'good,junk-plays', 'the five unusable rows are gone');
  eq(eSnap.records.good.best, 7);
  eq(eSnap.records['junk-plays'].plays, 1, 'a negative play count is unreadable, so it is one play');
  eq(eSnap.records['junk-plays'].perfect, false, 'a truthy string is not the boolean');
  eq(eSnap.unlocked, 1, 'unlocked: "nine" is not a level');
  eq(eSnap.stats, { solves: 0, turns: 0, perfect: 0, hints: 4 }, 'every stat that is not a count is zero');
  eq(eSnap.daily, {}, 'daily is an object even when the file said otherwise');
  eq(E.store.solve('brand-new', { turns: 2, par: 99 }).best, 2, 'and writing still works afterwards');
});

// The shell's own view of the rule: par is a claim about the bake, and a save must not be able
// to make a number look better than the table said it was.
test('D5 a par that never got measured cannot flatter the run', () => {
  E.store.reset();
  eq(E.store.solve('custom', { turns: 4, par: 4, hints: 0 }).perfect, true);
  E.store.reset();
  eq(E.store.solve('custom', { turns: 4, par: null, hints: 0 }).perfect, false, 'no par, no perfect flag');
  eq(E.store.record('custom').best, 4, 'but the solve and its count are still kept');
  eq(E.store.stats.perfect, 0, 'and the 完美 tally does not move for an unmeasured cube');
  eq(E.store.stats.solves, 1, 'the solve does');
  E.store.reset();
  eq(E.store.solve('custom', { turns: 4, par: undefined, hints: 0 }).perfect, false, 'undefined is the same answer');
  E.store.reset();
  eq(E.store.solve('custom', { turns: 4, par: -1, hints: 0 }).perfect, false, 'a negative par is not a par');
  E.store.reset();
  eq(E.store.solve('measured', { turns: 4, par: 4, hints: 0 }).perfect, true, 'a measured one still is');
  eq(E.store.stats.perfect, 1);
});

run();
