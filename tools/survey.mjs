// Measurement, not configuration: the par histogram that decides the four difficulty bands.
//
// Run it before touching js/data/lots.js — `node tools/survey.mjs` is the single command that
// every number in the "how was the pool built" section of deliverable.md quotes.
//
//   1. the par histogram of uniformly random cubes (the group's own distribution),
//   2. the par histogram of k-step random walks for the k the generator might use,
//   3. the acceptance rate each candidate band gets from each source,
//   4. wall time and search size per solve, because a band you cannot fill in reasonable time
//      is not a band.
//
// The reference solver (js/core/bfs.js) does all of it, so the histogram is the same quantity
// the shipped `par` values are. IDA* is deliberately not used here: it is the cross-check, and
// a survey that disagreed with the bake would then have two possible culprits.
//
// Cost: the uniform-cube histogram is 5000 bidirectional searches, which is minutes of CPU.
// One process at a time is fine but slow, so shard it across workers, each taking a disjoint
// slice of the sample space:
//
//   node tools/survey.mjs --workers=4
//
// A single shard can also be run on its own: `--from=0 --to=1250`.
//
// The band list it prints its acceptance table against lives in js/core/make.js and is
// provisional until this file says otherwise — that is the whole point of running it before
// baking. Nothing here runs in CI; test/solve.test.mjs uses a few hundred states instead.

import { GROUP_ORDER, isReachable, stateFromSeed } from '../js/core/cube.js';
import { solveBfs } from '../js/core/bfs.js';
import { BANDS, walkCandidate } from '../js/core/make.js';
import { rngFrom } from '../js/core/rng.js';
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));

const N = Number(args.n || 5000);
const WALKS = String(args.walks || '4,6,8,9,10,12,14,16').split(',').map(Number);
const WALK_N = Number(args.walkn || 400);
const LIMIT = Number(args.limit || 12000000);
const DEADLINE = Number(args.deadline || 90000);

// One contiguous slice of the sample space per process: a shard never re-draws what another
// shard already drew, so merging the parts is the same histogram one big loop would give.
function histogram(from, to) {
  const hist = {};
  let ms = 0;
  let maxMs = 0;
  let maxExplored = 0;
  let unknown = 0;
  let done = 0;
  const t0 = Date.now();
  for (let i = from; i < to; i++) {
    // A uniform draw over 8! * 3^7 — the reachable set — and deliberately *not*
    // stateFromSeed(i): the low ranks are one corner of the group (near-identity permutations
    // with tiny twist codes) and a histogram of them measures nothing. decode() derives the
    // eighth trit from the invariant instead of drawing it, so every sample here satisfies the
    // criterion by construction.
    const rank = rngFrom(`rank|${i}`).int(GROUP_ORDER);
    const state = stateFromSeed(rank);
    if (!isReachable(state)) throw new Error(`sample ${i} (rank ${rank}) breaks the invariant`);
    const t = Date.now();
    const r = solveBfs(state, { limit: LIMIT, deadlineMs: DEADLINE });
    const dt = Date.now() - t;
    ms += dt;
    done++;
    if (dt > maxMs) maxMs = dt;
    if (!r.ok) { unknown++; continue; }
    if (r.explored > maxExplored) maxExplored = r.explored;
    hist[r.moves] = (hist[r.moves] || 0) + 1;
    if (args.verbose) process.stderr.write(`\r  ${done}/${to - from}`);
  }
  if (args.verbose) process.stderr.write('\n');
  return { n: done, hist, unknown, ms, maxMs, maxExplored, wallMs: Date.now() - t0 };
}

function walkSurveys() {
  const out = [];
  for (const k of WALKS) {
    const hist = {};
    let ms = 0;
    let maxExplored = 0;
    for (let i = 0; i < WALK_N; i++) {
      const cand = walkCandidate(rngFrom(`walk|${k}|${i}`), k);
      const t = Date.now();
      const r = solveBfs(cand.state, { limit: LIMIT, deadlineMs: DEADLINE });
      ms += Date.now() - t;
      if (!r.ok) continue;
      if (r.explored > maxExplored) maxExplored = r.explored;
      hist[r.moves] = (hist[r.moves] || 0) + 1;
    }
    const pars = Object.entries(hist).map(([p, n]) => [Number(p), n]);
    const med = medianOf(pars);
    out.push({ k, n: WALK_N, hist, med, meanPars: meanOf(pars), maxExplored, msPerSolve: ms / WALK_N });
  }
  return out;
}

function meanOf(pars) {
  let s = 0;
  let n = 0;
  for (const [p, c] of pars) { s += p * c; n += c; }
  return n ? Math.round((s / n) * 100) / 100 : null;
}

function medianOf(pars) {
  pars.sort((a, b) => a[0] - b[0]);
  let n = 0;
  for (const [, c] of pars) n += c;
  let acc = 0;
  for (const [p, c] of pars) {
    acc += c;
    if (acc * 2 >= n) return p;
  }
  return null;
}

// Acceptance rate per band per source, measured against the same histogram the bands come from.
function acceptance(hist, bands) {
  const total = Object.values(hist).reduce((a, b) => a + b, 0);
  if (!total) return [];
  return bands.map((b) => {
    let inBand = 0;
    for (let p = b.min; p <= b.max; p++) inBand += hist[p] || 0;
    return { band: b.key, range: `${b.min}-${b.max}`, share: Math.round((inBand / total) * 10000) / 100 };
  });
}

function main() {
  if (args.workers || args.resume) {
    const w = Number(args.workers || 0);
    const step = Math.ceil(N / (w || 1));
    const parts = [];
    if (args.resume) {
      const marker = 'SURVEY_JSON ';
      for (const l of readFileSync(String(args.resume), 'utf8').split('\n')) {
        if (l.startsWith(marker)) parts.push(JSON.parse(l.slice(marker.length)));
      }
    }
    for (let i = 0; i < w; i++) {
      const r = spawnSync(process.execPath, [
        new URL(import.meta.url).pathname, `--from=${i * step}`, `--to=${Math.min(N, (i + 1) * step)}`, '--quiet',
      ], {
        // Each worker holds two Maps of the frontier it is growing, and a deep cube wants a few
        // million entries. The default heap is enough for one worker, not for four on one box.
        encoding: 'utf8',
        maxBuffer: 1 << 26,
        env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=2048`.trim() },
      });
      // 'SURVEY_JSON ' is 12 characters; slicing at a hard-coded offset that disagrees with the
      // prefix drops the leading '{' and the JSON.parse blows up on a perfectly good worker.
      const marker = 'SURVEY_JSON ';
      const line = (r.stdout || '').split('\n').filter((l) => l.startsWith(marker)).map((l) => l.slice(marker.length))[0];
      if (!line) {
        process.stdout.write(r.stdout || '');
        process.stderr.write(r.stderr || '');
        throw new Error(`worker ${i} printed no result`);
      }
      parts.push(JSON.parse(line));
      // Minutes of CPU per worker; a crash after the last one must not throw that away.
      if (args.parts) appendFileSync(String(args.parts), line + '\n');
    }
    const hist = {};
    let unknown = 0;
    let ms = 0;
    let maxMs = 0;
    let maxExplored = 0;
    for (const p of parts) {
      for (const [k, n] of Object.entries(p.hist)) hist[k] = (hist[k] || 0) + n;
      unknown += p.unknown;
      ms += p.ms;
      if (p.maxMs > maxMs) maxMs = p.maxMs;
      if (p.maxExplored > maxExplored) maxExplored = p.maxExplored;
    }
    const merged = { n: parts.reduce((a, p) => a + p.n, 0), hist, unknown, ms, maxMs, maxExplored, workers: parts.length };
    report(merged, args.skipwalks ? [] : walkSurveys());
    return;
  }

  const from = Number(args.from || 0);
  const to = Number(args.to || from + N);
  const h = histogram(from, to);
  if (args.quiet) {
    console.log(`SURVEY_JSON ${JSON.stringify(h)}`);
    return;
  }
  report(h, walkSurveys());
}

function report(h, walks) {
  console.log(`\n== uniform random cubes (${h.n} solved by the reference BFS) ==`);
  const pars = Object.entries(h.hist).map(([p, n]) => [Number(p), n]).sort((a, b) => a[0] - b[0]);
  const total = pars.reduce((a, [, n]) => a + n, 0);
  let cum = 0;
  for (const [p, n] of pars) {
    cum += n;
    console.log(`  par ${String(p).padStart(2)}  ${String(n).padStart(5)}  ${(n / total * 100).toFixed(2).padStart(6)}%  cum ${(cum / total * 100).toFixed(1)}%`);
  }
  console.log(`  median par ${medianOf(pars)}   mean ${meanOf(pars)}   unknown(budget) ${h.unknown}`);
  console.log(`  bfs ms total ${(h.ms / 1000).toFixed(1)}s  mean ${(h.ms / total).toFixed(0)}ms  max ${h.maxMs}ms  max search states ${h.maxExplored}`);

  console.log('\n== k-step random walks ==');
  for (const w of walks) {
    console.log(`  k=${String(w.k).padStart(2)}  median par ${String(w.med).padStart(2)}  mean ${String(w.meanPars).padStart(5)}  max search states ${w.maxExplored}  ${w.msPerSolve.toFixed(0)}ms per solve`);
  }

  console.log('\n== share of each candidate band, from the two sources ==');
  for (const w of walks) {
    const rows = acceptance(w.hist, BANDS);
    console.log(`  walk k=${String(w.k).padStart(2)}: ${rows.map((r) => `${r.band}[${r.range}] ${r.share}%`).join('  ')}`);
  }
  const rankRows = acceptance(h.hist, BANDS.map((b) => ({ key: b.key, min: b.min, max: b.max })));
  console.log(`  rank:      ${rankRows.map((r) => `${r.band}[${r.range}] ${r.share}%`).join('  ')}`);
  console.log('\nBANDS_JSON ' + JSON.stringify(BANDS));
}

main();
