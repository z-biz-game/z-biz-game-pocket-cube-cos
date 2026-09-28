// tools/bake.mjs — the build-time generator. This is the only place in the repo where a `par`
// is *decided*, and it does not run in the browser and not on a click: it sweeps the whole
// 8! x 3^7 = 88,179,840-cube group once, reads pars out of that array, fills each difficulty
// band until it is happy, then re-solves every finished lot with two searches that never saw the
// array, and only then writes js/data/lots.js.
//
// Everything it prints is a measurement, because the bands are meant to be chosen from data and
// not from taste:
//
//   * the sweep: per-depth counts, wall time, resident memory, diameter, and the whole
//     per-distance histogram compared line by line with OEIS A080630 — a table this repo did not
//     write, which is the external anchor under every shipped number,
//   * per band: how many cubes were tried, how many accepted, the acceptance rate, the par range
//     that actually came out, the share of the group the band covers, timings, and every
//     rejection reason with its count,
//   * per lot: the two independent re-solves that reproduce the printed par from the scramble
//     alone.
//
// It refuses to write when anything fails: a truncated sweep, a histogram that disagrees with
// A080630, a lot whose route does not replay, a lot the reference search contradicts or could not
// finish inside its budget.
//
// Usage: node tools/bake.mjs [--per=N] [--only=band,band] [--strategy=walk|rank]
//                            [--nonce=STR] [--dry-run] [--no-verify]
//                            [--bfs-max-par=N] [--check-deadline=MS] [--sweep-deadline=MS]
//
// Budgets: node caps and wall-clock deadlines everywhere, because this runs next to other builds
// on the same machine. Hitting one is reported, never papered over, and js/core/fullsweep.js
// stays exact under a cap: a cap can only turn an answer into "unknown", never into a wrong
// number. Bidirectional BFS is the memory-hungry checker (~150 bytes/node), so it is switched off
// above a depth that would ask for hundreds of megabytes and IDA* — which needs almost none —
// carries the deep ones.

import { GROUP_ORDER, applySeq, compactSeq, encode, isSolved, parseSeq, qtmCost, solvedState, validate } from '../js/core/cube.js';
import { BANDS, makeBand, verifyLot } from '../js/core/make.js';
import { buildGroupTable, groupDistance, routeFromTable } from '../js/core/fullsweep.js';
import { orbitDistance, orbitStats } from '../js/core/orbit.js';
import { solveBfs } from '../js/core/bfs.js';
import { solveIda } from '../js/core/ida.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'js', 'data', 'lots.js');
const MB = (n) => Math.round(n / 1048576);
const rss = () => MB(process.memoryUsage().rss);
const pct = (x) => `${(x * 100).toFixed(3)}%`;
const r4 = (x) => Number(x.toFixed(4));

// OEIS A080630 (N. J. A. Sloane): "Consider 3 X 3 X 3 Rubik cube, but consider only positions of
// corners; sequence gives number of positions that are exactly n moves from the start", with the
// comment "Total number of positions = 88179840. Here a half-turn is counted as two moves." That
// is this repo's model exactly — the fixed-orientation group under QTM — so the sweep has to
// reproduce all fifteen numbers, not merely the diameter.
const PUBLISHED_QTM_HIST = [1, 12, 114, 924, 6539, 39528, 199926, 806136, 2761740, 8656152,
  22334112, 32420448, 18780864, 2166720, 6624];

const fail = (msg) => {
  console.error(`\nbake: REFUSING TO WRITE — ${msg}`);
  process.exit(1);
};

function args(argv) {
  const out = {
    per: 0, only: null, strategy: null, nonce: 'bake-v1', dry: false, verify: true,
    bfsMaxPar: 13, checkDeadline: 60000, checkLimit: 3000000, sweepDeadline: 600000,
  };
  for (const a of argv) {
    const [k, v] = a.replace(/^--/, '').split('=');
    if (k === 'per') out.per = Number(v);
    else if (k === 'only') out.only = String(v).split(',');
    else if (k === 'strategy') out.strategy = v;
    else if (k === 'nonce') out.nonce = String(v);
    else if (k === 'dry-run' || k === 'dry') out.dry = true;
    else if (k === 'no-verify') out.verify = false;
    else if (k === 'bfs-max-par') out.bfsMaxPar = Number(v);
    else if (k === 'check-deadline') out.checkDeadline = Number(v);
    else if (k === 'check-limit') out.checkLimit = Number(v);
    else if (k === 'sweep-deadline') out.sweepDeadline = Number(v);
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

// ---- the oracle ------------------------------------------------------------------------

// Par and certificate, both read out of one sweep. `states` is the number of cubes whose
// distance the sweep had to establish before it could certify a par this deep — the honest
// "what backed this number" figure, which a table lookup otherwise hides.
function sweepOracle(table) {
  const cum = [];
  let run = 0;
  for (const n of table.hist) {
    run += n;
    cum.push(run);
  }
  return {
    name: 'fullsweep:QTM',
    cum,
    solve(state) {
      const err = validate(state);
      if (err) return { par: -1, states: 0, reason: `invalid:${err}` };
      if (encode(state) < 0) return { par: -1, states: 0, reason: 'twist-invariant' };
      const par = groupDistance(state, 'QTM');
      if (par < 0) return { par: -1, states: 0, reason: 'unreached-by-sweep' };
      if (par === 0) return { par: 0, route: [], states: cum[0] };
      const r = routeFromTable(state, 'QTM');
      if (!r || !r.moves.length) return { par: -1, states: 0, reason: 'no-route-in-table' };
      if (r.moves.length !== par) return { par: -1, states: 0, reason: 'route-length-not-par' };
      return { par, route: r.moves, states: cum[par] };
    },
  };
}

// An independent re-solve of one finished cube, from its scramble alone. js/core/bfs.js is the
// reference (bidirectional BFS), js/core/ida.js is the second opinion (IDA* over a pattern
// database). Both must land on the printed par *and* replay to the solved cube, and a timeout is
// reported as a failure rather than as agreement.
function independentCheck(start, par, opts) {
  const out = [];
  if (par <= opts.bfsMaxPar) {
    const t = Date.now();
    const r = solveBfs(start, { limit: opts.checkLimit, deadlineMs: opts.checkDeadline });
    out.push({
      solver: 'bfs', par: r.ok ? r.moves : -1, states: r.explored, ms: Date.now() - t,
      truncated: !!r.truncated,
      agrees: !!r.ok && r.moves === par && isSolved(applySeq(start, r.path)),
      route: r.ok ? compactSeq(r.path) : null,
    });
  }
  const t = Date.now();
  const r = solveIda(start, { limit: opts.checkLimit * 4, deadlineMs: opts.checkDeadline });
  out.push({
    solver: 'ida', par: r.ok ? r.moves : -1, states: r.explored, ms: Date.now() - t,
    truncated: !!r.truncated,
    agrees: !!r.ok && r.moves === par && isSolved(applySeq(start, r.path)),
    route: r.ok ? compactSeq(r.path) : null,
  });
  return out;
}

// ---- main ------------------------------------------------------------------------------

function main() {
  const opts = args(process.argv.slice(2));
  const t0 = Date.now();
  console.log(`bake: node ${process.version}, pid ${process.pid}, rss ${rss()} MB`);
  console.log(`bake: options ${JSON.stringify(opts)}`);

  // 1. the sweep ------------------------------------------------------------------------
  console.log('\n== sweep: 8! x 3^7 = 88,179,840 cubes, QTM, one byte each ==');
  const table = buildGroupTable({
    metric: 'QTM',
    deadlineMs: opts.sweepDeadline,
    nodeCap: GROUP_ORDER,
    force: true,
    onLevel: (l) => console.log(`  depth ${String(l.depth).padStart(2)}  new ${String(l.levelCount).padStart(9)}  total ${String(l.reached).padStart(9)}  +${String(l.ms).padStart(5)}ms  rss ${rss()}MB`),
  });
  if (table.truncated) {
    fail(`the sweep stopped early at depth ${table.stoppedAt} after ${table.ms} ms (reached ${table.reached} of ${GROUP_ORDER}); every par below would be a guess`);
  }
  if (table.reached !== GROUP_ORDER) fail(`the sweep reached ${table.reached} cubes, not ${GROUP_ORDER}`);
  const hist = table.hist;
  console.log(`  diameter ${table.diameter}, antipodes ${hist[table.diameter]}, wall ${table.ms} ms (transition tables ${table.tableMs} ms), distance array ${(table.bytes / 1048576).toFixed(1)} MB, rss now ${rss()} MB`);
  let mismatch = 0;
  for (let d = 0; d < Math.max(hist.length, PUBLISHED_QTM_HIST.length); d++) {
    const mine = hist[d] || 0;
    const theirs = PUBLISHED_QTM_HIST[d] || 0;
    if (mine !== theirs) {
      mismatch++;
      console.log(`    ${String(d).padStart(2)}: ${String(mine).padStart(9)} != published ${String(theirs).padStart(9)}  MISMATCH`);
    }
  }
  if (mismatch) fail(`${mismatch} per-distance counts disagree with OEIS A080630`);
  const sum = hist.reduce((a, b) => a + b, 0);
  if (sum !== GROUP_ORDER) fail(`the published histogram sums to ${sum}, not ${GROUP_ORDER}`);
  console.log(`  all ${hist.length} per-distance counts match OEIS A080630, and they sum to ${sum}`);

  const qb = orbitStats('QTM');
  console.log(`  quotient sweep for comparison: ${qb.states} orbits, diameter ${qb.diameter}, ${qb.ms} ms, ${MB(qb.bytes)} MB (a lower bound on par, see js/core/orbit.js)`);

  const oracle = sweepOracle(table);
  const shareOf = (min, max) => {
    let s = 0;
    for (let d = min; d <= max; d++) s += hist[d] || 0;
    return s / GROUP_ORDER;
  };

  // 2. the bands, decided by the histogram ----------------------------------------------
  console.log('\n== band shares, measured over the whole group (this is what sets the ranges) ==');
  for (const b of BANDS) {
    const s = shareOf(b.min, b.max);
    console.log(`  ${b.key.padEnd(7)} par ${b.min}-${b.max}  ${pct(s)} of all cubes  `
      + `walk ${Array.isArray(b.walk) ? b.walk.join('/') : b.walk} turns  `
      + `(a uniform — "rank" — draw would land in this band ${pct(s)} of the time)`);
  }

  const bands = opts.only ? BANDS.filter((b) => opts.only.includes(b.key)) : BANDS;
  if (!bands.length) fail(`--only matched no band (known: ${BANDS.map((b) => b.key).join(', ')})`);

  // 3. fill the bands -------------------------------------------------------------------
  const seen = new Set();
  const rows = [];
  const bandStats = [];
  const rejectTotal = {};
  for (const band of bands) {
    const strategy = opts.strategy || 'walk';
    const count = opts.per || band.per;
    console.log(`\n== band ${band.key} (par ${band.min}-${band.max}, ${count} cubes, ${strategy} candidates, oracle ${oracle.name}) ==`);
    const { lots, stats } = makeBand(band, {
      seed: `${band.key}|${opts.nonce}`, strategy, count, seen, oracle,
      cap: Math.max(4000, count * 400),
    });
    console.log(`  tried ${stats.tried}  accepted ${stats.accepted}  rate ${pct(stats.rate)}  oracle ms mean ${stats.meanMs.toFixed(3)} max ${stats.maxMs}`);
    console.log(`  pars accepted: ${lots.map((l) => l.par).join(',')}`);
    console.log(`  rejections: ${Object.keys(stats.byReason).length ? JSON.stringify(stats.byReason) : 'none'}`);
    console.log(`  scramble lengths: ${lots.map((l) => l.scrCost).join(',')}`);
    if (stats.truncated) fail(`band ${band.key} ran out of budget after ${stats.tried} tries with ${stats.accepted}/${count} cubes`);
    for (const [k, v] of Object.entries(stats.byReason)) rejectTotal[k] = (rejectTotal[k] || 0) + v;
    bandStats.push({ band, stats, lots });
    // Not a copy: the verify pass below writes `q` onto these very objects.
    for (const l of lots) {
      l.band = band.key;
      rows.push(l);
    }
  }

  // 4. re-verify every shipped cube ------------------------------------------------------
  const checks = [];
  if (opts.verify) {
    console.log('\n== independent re-solve of every cube (bfs + ida, neither one saw the table) ==');
    solveIda(applySeq(solvedState(), [0, 2, 4]), { limit: 200 }); // build the pattern database once
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const start = applySeq(solvedState(), row.scr);
      const res = independentCheck(start, row.par, opts);
      const bad = res.filter((r) => !r.agrees);
      console.log(`  ${String(i + 1).padStart(2)} ${row.band.padEnd(7)} par ${String(row.par).padStart(2)} scr ${String(row.scrCost).padStart(2)}  `
        + res.map((r) => `${r.solver} ${r.par} ${r.agrees ? 'agrees' : 'DISAGREES'} ${r.states}n ${r.ms}ms${r.truncated ? ' TRUNCATED' : ''}`).join(' | '));
      if (bad.length) fail(`${row.band} cube "${row.scrText}" (par ${row.par}) was not confirmed: ${bad.map((b) => b.solver).join(', ')}`);
      checks.push(res);
      row.q = orbitDistance(start, 'QTM');
      if (row.q > row.par) fail(`${row.band} cube: the quotient lower bound ${row.q} exceeds the par ${row.par}`);
      const again = groupDistance(start, 'QTM');
      if (again !== row.par) fail(`${row.band} cube: the table now says ${again}, it said ${row.par}`);
    }
    console.log(`  all ${rows.length} cubes confirmed by searches that never read the table`);
  } else {
    console.log('\n--verify was passed: the shipped pars are NOT independently re-solved');
    for (const row of rows) row.q = orbitDistance(applySeq(solvedState(), row.scr), 'QTM');
  }

  // 5. the shapes this file promises the browser ------------------------------------------
  for (const row of rows) {
    const bad = verifyLot(row);
    if (bad) fail(`verifyLot rejected a shipped cube: ${bad}`);
    if (row.route.length !== row.par) fail('route length drifted');
    if (!isSolved(applySeq(applySeq(solvedState(), row.scr), row.route))) fail('route stopped solving');
    if (qtmCost(row.routeText) !== row.par) fail('route notation cost drifted');
    if (!parseSeq(row.scrText).ok) fail('scramble notation does not parse');
  }

  // 6. id the rows and build the tier table -----------------------------------------------
  const tiers = [];
  const lotsOut = [];
  let gi = 0;
  for (const { band, stats, lots } of bandStats) {
    const pars = lots.map((l) => l.par).sort((a, b) => a - b);
    const ms = checks.slice(gi, gi + lots.length).flat().map((c) => c.ms).sort((a, b) => a - b);
    const med = (arr) => (arr.length ? arr[arr.length >> 1] : null);
    tiers.push({
      key: band.key,
      label: band.label,
      blurb: band.blurb,
      min: band.min,
      max: band.max,
      n: lots.length,
      seen: `${pars[0]}-${pars[pars.length - 1]}`,
      med: med(pars),
      share: r4(shareOf(band.min, band.max)),
      strategy: stats.strategy,
      walk: band.walk,
      tried: stats.tried,
      rate: r4(stats.rate),
      oracle: stats.oracle,
      meanOracleMs: r4(stats.meanMs),
      checkMedMs: med(ms),
      checkMaxMs: ms.length ? ms[ms.length - 1] : null,
    });
    for (const l of lots) {
      const i = gi++;
      lotsOut.push({
        id: `cube-${String(lotsOut.length + 1).padStart(2, '0')}`,
        tier: band.key,
        par: l.par,
        q: opts.verify ? l.q : null,
        states: l.states,
        ms: l.ms,
        via: l.via,
        scrCost: l.scrCost,
        scr: l.scr,
        route: l.route,
        scrText: l.scrText,
        routeText: l.routeText,
        check: opts.verify ? checks[i].map((c) => ({ solver: c.solver, par: c.par, states: c.states, ms: c.ms })) : null,
      });
    }
  }

  // 7. write -----------------------------------------------------------------------------
  const body = render({ table, hist, qb, tiers, lots: lotsOut, opts, rejectTotal, elapsed: Date.now() - t0 });
  if (opts.dry) console.log(`\n--dry-run: nothing written. Payload would be ${Buffer.byteLength(body)} bytes.`);
  else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, body, 'utf8');
    console.log(`\nwrote ${OUT} (${Buffer.byteLength(body)} bytes, ${lotsOut.length} cubes) in ${Date.now() - t0} ms, rss ${rss()} MB`);
  }

  // 8. what the docs quote ----------------------------------------------------------------
  console.log('\n== summary for DESIGN.md ==');
  console.log(`  sweep ${table.ms} ms, ${(table.bytes / 1048576).toFixed(1)} MB, diameter ${table.diameter}, antipodes ${hist[table.diameter]}, OEIS A080630 matched exactly`);
  for (const t of tiers) {
    console.log(`  ${t.key.padEnd(7)} n ${t.n} par ${t.min}-${t.max} (saw ${t.seen}) share ${pct(t.share)} acceptance ${pct(t.rate)} after ${t.tried} tries, median re-solve ${t.checkMedMs} ms, max ${t.checkMaxMs} ms`);
  }
  console.log(`  rejections across the run: ${JSON.stringify(rejectTotal)}`);
  const gap = lotsOut.reduce((m, l) => Math.max(m, l.par - (l.q || 0)), 0);
  console.log(`  largest (par - quotient lower bound) among the shipped cubes: ${gap}`);
  console.log(`  slowest single re-solve: ${Math.max(0, ...checks.flat().map((c) => c.ms))} ms; peak rss ${rss()} MB; total ${Date.now() - t0} ms`);
}

function render(o) {
  const { table, hist, qb, tiers, lots, opts, rejectTotal, elapsed } = o;
  const line = (s) => `// ${s}`;
  const head = [
    line('GENERATED by `node tools/bake.mjs` — do not edit by hand and do not hand-write rows.'),
    line(`Command: node tools/bake.mjs ${process.argv.slice(2).join(' ')}   nonce ${opts.nonce}`),
    line(''),
    line('Every `par` below was measured by an exhaustive breadth-first sweep of all'),
    line('8! x 3^7 = 88,179,840 reachable cube positions (js/core/fullsweep.js), whose per-distance'),
    line('histogram reproduces OEIS A080630 ("number of positions that are exactly n moves from'),
    line('the start", half-turn counted as two moves) line for line:'),
    line('  ' + hist.join(', ')),
    line(`Diameter ${table.diameter} in QTM, with ${hist[table.diameter]} cubes at the very top. Sweep cost ${table.ms} ms`),
    line(`and ${(table.bytes / 1048576).toFixed(1)} MB of distance array; the whole bake took ${elapsed} ms.`),
    line(`The rotation-quotient sweep (js/core/orbit.js: ${qb.states} orbits, diameter ${qb.diameter}, ${qb.ms} ms) is`),
    line('printed per cube as `q` and is a lower bound only: aiming the cube back at the reference'),
    line('orientation costs turns, and js/core/cube.js isSolved() demands that orientation.'),
    line(''),
    line('Each cube was then re-solved from its scramble alone by two searches that never read the'),
    line('table — bidirectional BFS (js/core/bfs.js) and IDA* over a pattern database'),
    line('(js/core/ida.js). bake refuses to write unless both agree with the printed par.'),
    line(`Rejections during this run: ${JSON.stringify(rejectTotal)}`),
    line(''),
    line('Fields: `scr`/`route` are indices into MOVES (QTM: a half turn is two of them). `par` is'),
    line('the fewest quarter turns to isSolved, `q` the quotient lower bound, `states` how many'),
    line('cubes the sweep had to distance before it could certify this par, `ms` the lookup cost,'),
    line('`scrCost` the printed scramble\u0027s QTM length, `check` the two independent re-solves.'),
    '',
  ].join('\n');
  const j = (x) => JSON.stringify(x);
  const tierRows = tiers.map((t) => `  ${j(t)}`).join(',\n');
  const lotRows = lots.map((l) => `  ${j(l)}`).join(',\n');
  const bake = {
    built: new Date().toISOString().slice(0, 19) + 'Z',
    generatedBy: 'tools/bake.mjs',
    metric: 'QTM',
    order: GROUP_ORDER,
    reached: table.reached,
    diameter: table.diameter,
    antipodes: hist[table.diameter],
    hist,
    publishedHist: PUBLISHED_QTM_HIST,
    publishedSource: 'OEIS A080630 (N. J. A. Sloane); Mark Longridge, God\u2019s Algorithm calculations',
    sweepMs: table.ms,
    sweepBytes: table.bytes,
    quotient: { orbits: qb.states, diameter: qb.diameter, ms: qb.ms },
    nonce: opts.nonce,
    rejected: rejectTotal,
    verified: !!opts.verify,
  };
  return `${head}export const BAKE = ${j(bake)};

/** The four difficulty bands, with the shares and acceptance rates tools/bake.mjs measured. */
export const TIERS_META = [
${tierRows},
];

/** ${lots.length} certified cubes: lowest band first, and within a band the order they were drawn. */
export const LOTS = [
${lotRows},
];
`;
}

main();
