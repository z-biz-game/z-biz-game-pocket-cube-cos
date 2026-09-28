// The layering gate, run by tools/verify.sh between the suites and the browser.
//
//   node tools/check.mjs
//
// Nothing here needs a browser, which is the point: the module graph of a page is only visible
// in a browser *as a blank screen*, and a core module that grew a dependency on `document` is
// only visible as a suite that cannot import it. These are the two claims this repo would
// otherwise keep asserting in comments without anyone measuring them.
//
//   1. every relative specifier in js/, tools/ and test/ names a file that exists;
//   2. no js/core module reaches for the DOM — with the one documented exception below;
//   3. nothing in js/core imports the shell it is supposed to be usable without.
//
// Exit 0 with every row printed, exit 1 with the failures listed first.

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const rows = [];
const rec = (name, pass, detail) => {
  rows.push({ test: name, pass: !!pass, detail: pass ? null : detail });
  return !!pass;
};

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = resolve(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js') || p.endsWith('.mjs') || p.endsWith('.cjs')) out.push(p);
  }
  return out;
}

const files = [...walk(resolve(ROOT, 'js')), ...walk(resolve(ROOT, 'tools')), ...walk(resolve(ROOT, 'test'))];

// A comment that says "does not touch window" must not be read as a use of window.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

// ---- 1. the module graph resolves ------------------------------------------------------

const SPEC = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const missing = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  let m;
  SPEC.lastIndex = 0;
  while ((m = SPEC.exec(src))) {
    const spec = m[1] || m[2];
    if (!spec) continue;
    // A `?fresh=A` suffix is a module-cache bust, not a different file: test/storage.test.mjs
    // imports the same save file six times to get six independent module instances.
    const bare = spec.split('?')[0];
    const target = resolve(dirname(f), bare);
    if (!existsSync(target)) missing.push(`${f.slice(ROOT.length + 1)} -> ${spec}`);
  }
}
rec(`${files.length} sources: every relative import names a file that exists`, missing.length === 0, missing);

// ---- 2. no DOM inside the core --------------------------------------------------------

// storage.js is the documented exception, and the only one: it is the save file, it reads
// `window.localStorage` inside a try/catch, and test/storage.test.mjs runs it with no window at
// all to prove the fallback is the design rather than an accident. `document` is still refused
// there, because a save file has no business painting.
const DOM = /\bdocument\.|\bwindow\.|localStorage|getElementById|requestAnimationFrame\b/;
const offenders = [];
for (const f of walk(resolve(ROOT, 'js/core'))) {
  const body = stripComments(readFileSync(f, 'utf8'));
  const hits = DOM.test(body) ? body.split('\n').filter((l) => DOM.test(l)).map((l) => l.trim().slice(0, 90)) : [];
  if (!hits.length) continue;
  if (f.endsWith('storage.js')) {
    if (/\bdocument\.|getElementById|requestAnimationFrame\b/.test(body)) {
      offenders.push(`${f.slice(ROOT.length + 1)}: storage.js may only reach for window.localStorage`);
    }
  } else {
    offenders.push(`${f.slice(ROOT.length + 1)}: ${hits.slice(0, 3).join(' | ')}`);
  }
}
rec('no js/core module reaches for the DOM (js/core/storage.js excepted, and only for localStorage)',
  offenders.length === 0, offenders);

// ---- 3. the core does not import the shell -------------------------------------------

const up = [];
for (const f of walk(resolve(ROOT, 'js/core'))) {
  const src = stripComments(readFileSync(f, 'utf8'));
  if (/from\s*['"]\.\.\/(main|view)\.js/.test(src) || /from\s*['"]\.\.\/\.\.\/js\/(main|view)\.js/.test(src)) {
    up.push(f.slice(ROOT.length + 1));
  }
}
rec('nothing in js/core imports js/main.js or js/view.js', up.length === 0, up);

// ---- 4. what the page can actually reach -------------------------------------------

// This repo's one hard architectural rule is that *generation* never reaches the browser:
// js/core/fullsweep.js wants an 84 MB distance array, and the two searchers want seconds of CPU
// per cube (measured: 4.6 s for one par-13 cube in js/core/bfs.js). Until now the rule was
// guarded by a grep and a comment at the head of js/main.js, which is not a gate — an import
// added five minutes before a push is exactly the mistake a gate is for.
//
// So: walk the module graph from the page's own entry point and require every core module it
// lands on to be in the list below. Transitively, because the way a searcher reaches a player is
// a one-line "convenience" added to js/core/library.js, not to js/main.js.
const ALLOWED = new Set([
  'js/core/cube.js', // the rule: twelve turns, encoding, solved test
  'js/core/game.js', // one run: turn/undo/hint/grade, hint only reads the baked route
  'js/core/library.js', // lookups into the baked table
  'js/core/rng.js', // seeds, so a link reproduces a cube
  'js/core/storage.js', // the save file, with its no-window fallback
  'js/core/geom.js', // the projection and the gesture signs the view needs
  'js/data/lots.js', // the table itself: measurements, not code
  'js/main.js',
  'js/view.js',
]);
const FROM = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
function reachable(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    const key = f.slice(ROOT.length + 1);
    if (seen.has(key)) continue;
    seen.add(key);
    const src = stripComments(readFileSync(f, 'utf8'));
    let m;
    FROM.lastIndex = 0;
    while ((m = FROM.exec(src))) {
      const spec = (m[1] || m[2] || '').split('?')[0];
      if (!spec) continue;
      const target = resolve(dirname(f), spec);
      if (existsSync(target) && statSync(target).isFile()) stack.push(target);
    }
  }
  return [...seen];
}
const fromPage = reachable(resolve(ROOT, 'js/main.js'));
const heavy = fromPage.filter((p) => p.startsWith('js/core/') && !ALLOWED.has(p));
rec(`the page's own module graph (${fromPage.length} files) stays out of the build-time layer`,
  heavy.length === 0 && fromPage.includes('js/data/lots.js'),
  { reached: fromPage, forbidden: heavy });

// ---- verdict ------------------------------------------------------------------------

for (const r of rows) console.log(`${r.pass ? '  ok  ' : ' FAIL '} ${r.test}${r.detail ? `\n       ${JSON.stringify(r.detail, null, 0).slice(0, 400)}` : ''}`);
const failed = rows.filter((r) => !r.pass);
console.log(`rows: ${rows.length} fail: ${failed.length}`);
process.exit(failed.length ? 1 : 0);
