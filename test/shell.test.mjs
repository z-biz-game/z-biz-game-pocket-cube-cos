// The shell's own bookkeeping. Everything below is a claim the repo already makes in prose —
// "the icons are real PNGs", "the manifest points at files on disk", "the service worker caches
// the shell" — and each of them was silently false at some point: the Pages workflow copied
// index.html, css and js and nothing else, so every icon, the manifest, the worker and both
// textures 404'd in production while the repo looked complete; sw.js listed two build-time modules
// and omitted js/core/game.js, the game itself.
//
// A grep for `pointerdown` can lie. A file that is not on disk cannot.

import { readFileSync, existsSync, statSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, run, ok, eq } from '../tools/harness.mjs';
import { readPng } from '../assets/gen/png.mjs';
import { readIcns, readIco } from '../assets/gen/containers.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// ---- the two readers the brief demands: `file`-equivalent type, and the PNG header --------------

// A PNG is `\x89PNG\r\n\x1a\n` then a 4-byte length, 'IHDR', then width/height/bit-depth/colour-
// type. Nothing else in this repo needs that format, so reading it directly is cheaper than
// depending on a decoder — and it is the only way to tell a real 180x180 icon from a 1 KB SVG that
// was renamed to .png, which is the exact way a "icon 已就绪" checkbox goes wrong.
function pngInfo(buf) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24) return null;
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null;
  if (buf.readUInt32BE(12) !== 0x49484452) return null; // 'IHDR' must be the first chunk
  return {
    w: buf.readUInt32BE(16),
    h: buf.readUInt32BE(20),
    depth: buf[24],
    colorType: buf[25],
  };
}

const PNG = (rel) => {
  const abs = join(ROOT, rel);
  ok(existsSync(abs), `${rel}: not on disk`);
  const buf = readFileSync(abs);
  const info = pngInfo(buf);
  ok(info, `${rel}: not a PNG (${buf.length} bytes, first 8 = ${JSON.stringify([...buf.slice(0, 8)])})`);
  ok(buf.length > 64, `${rel}: ${buf.length} bytes is a placeholder, not a picture`);
  return { ...info, bytes: buf.length, rel };
};

// ---- reference extraction ----------------------------------------------------------------------

const isHttp = (s) => /^https?:\/\//.test(s);
const repoPath = (href) => normalize(href.replace(/^\.\//, '').split('#')[0].split('?')[0]);

function htmlRefs() {
  const html = read('index.html');
  const out = [];
  for (const m of html.matchAll(/<(?:link|script)[^>]*?(?:href|src)="([^"]+)"[^>]*>/g)) out.push(m[1]);
  for (const m of html.matchAll(/<meta[^>]*content="([^"]+)"[^>]*>/g)) {
    if (/\.(png|webp|svg|jpg)$/.test(m[1])) out.push(m[1]);
  }
  return out;
}

// Only the refs a browser would resolve against this repo's own root.
const localRefs = () => htmlRefs().filter((h) => !isHttp(h) && !h.startsWith('data:')).map(repoPath);

function cssRefs() {
  const css = read('css/game.css');
  return [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)]
    .map((m) => normalize(join('css', m[1])))
    .filter((p) => !p.startsWith('data:'));
}

function manifestRefs() {
  const mf = JSON.parse(read('manifest.webmanifest'));
  const paths = [...mf.icons.map((i) => i.src), ...mf.shortcuts.flatMap((s) => s.icons.map((i) => i.src))];
  return { mf, paths: paths.map(repoPath) };
}

// js/main.js's transitive import graph — the modules a browser actually fetches to play the game.
function runtimeGraph(entry = 'js/main.js') {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    for (const m of read(rel).matchAll(/(?:from|import)\s+['"](\.[^'"]+)['"]/g)) {
      stack.push(normalize(join(dirname(rel), m[1])));
    }
  }
  return [...seen].sort();
}

function swShell() {
  const sw = read('sw.js');
  const list = sw.match(/const SHELL = \[([\s\S]*?)\];/);
  ok(list, 'sw.js has no SHELL array to read');
  // Kept verbatim, `./` and all: the comparison below is against the strings the worker will
  // actually hand to `cache.add`, and a normalised copy of a list is not that list.
  return [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

// ---- tests -------------------------------------------------------------------------------------

// The single most valuable row in this file: a reference the browser would 404 on.
test('every path index.html, the stylesheet and the manifest reach for is on disk', () => {
  const missing = [];
  for (const p of localRefs()) if (!existsSync(join(ROOT, p))) missing.push(`index.html -> ${p}`);
  for (const p of cssRefs()) if (!existsSync(join(ROOT, p))) missing.push(`css/game.css -> ${p}`);
  const { paths } = manifestRefs();
  for (const p of paths) if (!existsSync(join(ROOT, p))) missing.push(`manifest -> ${p}`);
  // The sprite the win splash loads at runtime is a string inside js/, so no <link> would catch it.
  for (const m of read('js/view.js').matchAll(/src = '([^']+\.(?:png|svg|jpg))'/g)) {
    if (!existsSync(join(ROOT, repoPath(m[1])))) missing.push(`js/view.js -> ${m[1]}`);
  }
  ok(localRefs().length >= 4, `index.html only exposes ${localRefs().length} local refs — the reader is broken`);
  eq(missing, [], 'a referenced file is missing from disk');
});

// Not just "a file with that name exists": the bytes have to be a PNG, non-trivial, RGBA8, and the
// size the filename or the manifest promises.
test('every shipped bitmap is a real PNG at the size its name claims', () => {
  const dirs = ['icons', 'social', 'assets/tex'];
  const files = dirs.flatMap((d) => readdirSync(join(ROOT, d)).map((f) => `${d}/${f}`));
  ok(files.length >= 16, `only ${files.length} bitmaps shipped; the art set is incomplete`);
  const bad = [];
  for (const rel of files) {
    if (!rel.endsWith('.png')) { bad.push(`${rel}: a bitmap that is not a PNG`); continue; }
    if (statSync(join(ROOT, rel)).size === 0) { bad.push(`${rel}: 0 bytes`); continue; }
    const info = PNG(rel);
    if (info.depth !== 8 || info.colorType !== 6) bad.push(`${rel}: depth ${info.depth} colortype ${info.colorType}, expected 8/rgba8`);
    // `icon-384.png` claiming to be 512 wide is how a resize step that never ran looks.
    const claimed = rel.match(/(?:icon|favicon|blueprint|spark)-(\d+)\.png$/);
    if (claimed && info.w !== Number(claimed[1])) bad.push(`${rel}: name says ${claimed[1]}px, IHDR says ${info.w}x${info.h}`);
    if (info.w !== info.h && !rel.includes('og')) bad.push(`${rel}: ${info.w}x${info.h} is not square for an icon`);
  }
  eq(bad, [], 'a shipped bitmap is fake, placeholder-sized, or mislabelled');
});

// The sellability line "图标 favicon + ≥180px 真 PNG" is a size claim, so measure it.
test('the icon set covers the sizes a device and a store actually ask for', () => {
  const touch = PNG('icons/apple-touch-icon.png');
  ok(touch.w >= 180 && touch.h >= 180, `apple-touch-icon is ${touch.w}x${touch.h}, needs 180`);
  const { mf, paths } = manifestRefs();
  const byPath = new Map(paths.map((p) => [p, PNG(p)]));
  const need = [192, 512];
  for (const side of need) {
    const hit = [...byPath.entries()].find(([, i]) => i.w === side && i.h === side);
    ok(hit, `manifest has no ${side}x${side} icon`);
  }
  const maskable = mf.icons.filter((i) => i.purpose === 'maskable');
  ok(maskable.length > 0, 'no maskable icon: Android will letterbox the tile');
  for (const req of ['name', 'short_name', 'start_url', 'display', 'theme_color', 'icons']) {
    ok(mf[req], `manifest.webmanifest has no ${req}`);
  }
  ok(mf.id === './' && mf.scope === './', 'manifest scope must follow the site root, not one path');
});

// Header checks cannot see pixels, and this repo shipped a hole because of it:
// icons/icon-maskable-512.png was 81% transparent — a maskable tile that lets the launcher's own
// backdrop through the mask — while every row above stayed green. So: decode the bitmap and judge
// it by the role its name claims.
test('each bitmap is a readable picture for the role its name claims', () => {
  const measure = (rel) => {
    const { w, h, data } = readPng(join(ROOT, rel));
    const alphaAt = (x, y) => data[(y * w + x) * 4 + 3];
    let solid = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] === 255) solid++;
    const tally = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      tally.set(k, (tally.get(k) || 0) + 1);
    }
    let mode = 0;
    let seen = 0;
    for (const [k, n] of tally) if (n > seen) { seen = n; mode = k; }
    const base = [(mode >> 16) & 255, (mode >> 8) & 255, mode & 255];
    let sum = 0;
    let motifR = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const d = Math.max(Math.abs(data[i] - base[0]), Math.abs(data[i + 1] - base[1]), Math.abs(data[i + 2] - base[2]));
        sum += d;
        if (d > 60) motifR = Math.max(motifR, Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2));
      }
    }
    return {
      w, h,
      coverage: solid / (w * h),
      corners: Math.max(alphaAt(0, 0), alphaAt(w - 1, 0), alphaAt(0, h - 1), alphaAt(w - 1, h - 1)),
      centre: alphaAt(w >> 1, h >> 1),
      activity: sum / (w * h),
      motifR,
    };
  };

  const maskable = measure('icons/icon-maskable-512.png');
  ok(maskable.coverage > 0.999, `maskable tile is ${(maskable.coverage * 100).toFixed(1)}% opaque — the launcher paints its own background through the rest`);
  const safe = 0.4 * maskable.w;
  ok(maskable.motifR <= safe, `maskable motif reaches ${maskable.motifR}px, past the ${safe}px safe radius — Android would clip the cube`);
  ok(maskable.motifR > safe * 0.7, `maskable motif only reaches ${maskable.motifR}px of ${safe}px: a small sticker on a big field`);

  const plates = ['icons/favicon-16.png', 'icons/favicon-32.png', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png'];
  for (const rel of plates) {
    const p = measure(rel);
    ok(p.corners === 0, `${rel}: corner alpha ${p.corners}, a rounded plate must be masked clear`);
    ok(p.centre === 255, `${rel}: centre alpha ${p.centre}, the middle of the plate must be solid`);
    ok(p.coverage > 0.55 && p.coverage < 0.95, `${rel}: ${(p.coverage * 100).toFixed(1)}% opaque is not a rounded slab`);
  }

  const ground = measure('assets/tex/blueprint-256.png');
  ok(ground.coverage > 0.999, `page ground tile is ${(ground.coverage * 100).toFixed(1)}% opaque — the body has no colour of its own under it`);
  ok(ground.activity >= 6, `page ground activity ${ground.activity.toFixed(1)}: the tile is flat paint, not a blueprint`);

  const sprite = measure('assets/tex/spark-64.png');
  ok(sprite.centre >= 150, `particle sprite centre alpha ${sprite.centre}: too faint to read as a dot`);
  ok(sprite.corners === 0, 'particle sprite must fade to nothing at its edge');
});

// The desktop shell is part of this product (package.json has an electron main and a build block),
// and a packaged Electron app with no icon ships wearing Electron's own artwork. So the containers
// are checked the same way the PNGs are: parsed, and compared byte for byte against the tiles the
// web build ships — a stale .icns that no longer matches icons/icon-512.png is exactly the drift a
// "已生成桌面图标" checkbox hides.
test('the desktop containers hold the shipped tiles, and the shell points at them', () => {
  const main = read('electron/main.cjs');
  ok(/icon:\s*path\.join\(/.test(main), 'electron/main.cjs creates its window without an icon: taskbar gets Electron\'s artwork');
  for (const rel of ['build/icon.ico', 'build/icon.icns', 'build/icon.png']) {
    ok(existsSync(join(ROOT, rel)), `${rel} is missing`);
  }

  const ico = readIco(join(ROOT, 'build/icon.ico'));
  eq(ico.sizes, [16, 24, 32, 48, 64, 128, 256], 'the .ico does not carry the size ladder Windows picks from');
  const png = (rel) => readFileSync(join(ROOT, rel));
  // 24px exists only inside the container, so the rest of the ladder has to be the same bytes.
  eq(ico.pngs[0].equals(png('icons/favicon-16.png')), true, '.ico 16px is not icons/favicon-16.png');
  eq(ico.pngs[6].equals(png('icons/icon-256.png')), true, '.ico 256px is not icons/icon-256.png');

  const icns = readIcns(join(ROOT, 'build/icon.icns'));
  const byType = new Map(icns.icons.map((i) => [i.type, i]));
  for (const [type, side, src] of [['ic11', 32, 'icons/favicon-32.png'], ['ic07', 128, 'icons/icon-128.png'], ['ic08', 256, 'icons/icon-256.png'], ['ic09', 512, 'icons/icon-512.png'], ['ic10', 1024, 'icons/icon-1024.png']]) {
    const chunk = byType.get(type);
    ok(chunk, `no ${type} (${side}px) chunk in build/icon.icns`);
    if (chunk) {
      eq(chunk.side, side, `${type} payload is ${chunk.side}px, not ${side}`);
      eq(chunk.png.equals(png(src)), true, `${type} is not the bytes of ${src}`);
    }
  }
  eq(readPng(join(ROOT, 'build/icon.png')).w, 512, 'build/icon.png (Linux) is not the 512 tile');
});

// og:image with a relative path is a card with no picture: crawlers resolve it against their own
// base, not the page's.
test('the social card is an absolute URL whose bytes are on disk', () => {
  const html = read('index.html');
  const og = html.match(/property="og:image"\s+content="([^"]+)"/);
  const tw = html.match(/name="twitter:image"\s+content="([^"]+)"/);
  ok(og && isHttp(og[1]), `og:image is ${og ? og[1] : 'absent'} — must be absolute https://`);
  ok(tw && isHttp(tw[1]), `twitter:image is ${tw ? tw[1] : 'absent'} — must be absolute https://`);
  const card = PNG('social/og.png');
  eq([card.w, card.h], [1200, 630], 'the card is not the size og:image:width/height declare');
  const declared = [...html.matchAll(/og:image:(width|height)" content="(\d+)"/g)];
  eq(declared.map((m) => Number(m[2])), [1200, 630], 'the card declares its own size wrongly');
  // The absolute URL has to be the same file the repo ships, or the card 404s anyway. Pages serves
  // the site under /<repo-name>/, so the check is a suffix, not a whole path.
  const cardPath = new URL(og[1]).pathname;
  ok(/\/social\/og\.png$/.test(cardPath), `og:image resolves to ${cardPath}, not .../social/og.png`);
  ok(existsSync(join(ROOT, 'social/og.png')), 'social/og.png is missing from the artifact');
  ok(new URL(tw[1]).pathname === cardPath, 'twitter:image points at a different card than og:image');
});

// The deploy artifact is the deployment: if a path is referenced and not copied, production 404s
// while every local test passes. This is the row that would have caught the original bug. The copy
// list lives in tools/assemble-site.sh — the one manifest Pages and tools/deploy-set.mjs both call —
// so the test runs that script and looks at the directory it produces, instead of parsing a second
// list transcribed into the workflow (that transcription is exactly how the two drifted apart).
test('the deploy manifest copies every top-level path the page references', () => {
  const site = mkdtempSync(join(tmpdir(), 'pc-shell-'));
  execFileSync('bash', [join(ROOT, 'tools/assemble-site.sh'), site], { stdio: 'pipe' });
  // A path the shell reaches for that actually exists in the repo must be in the artifact. `sw.js`
  // is not referenced by index.html at all (a worker registers itself from js/sw-register.js), so it
  // is added by hand — forgetting it is what makes an installed game never update.
  const wanted = new Set(['index.html', 'manifest.webmanifest', 'sw.js']);
  for (const p of [...localRefs(), ...cssRefs(), ...manifestRefs().paths]) wanted.add(p.split('/')[0]);
  // An absolute og:image still names a file in this artifact, and a card that 404s is a card that
  // shows nothing. Pages serves the site under /<repo-name>/, so the URL's own path is one level
  // deeper than the repo root: the file is whichever suffix actually exists here.
  for (const href of htmlRefs()) {
    if (!isHttp(href)) continue;
    const parts = href.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '').split('/');
    for (let i = 0; i < parts.length; i++) {
      const cand = parts.slice(i).join('/');
      if (cand && existsSync(join(ROOT, cand))) { wanted.add(cand.split('/')[0]); break; }
    }
  }
  const dropped = [...wanted]
    .filter((p) => existsSync(join(ROOT, p)))
    .filter((p) => !existsSync(join(site, p)));
  eq(dropped, [], `the artifact drops ${dropped.join(', ')} — those paths 404 on Pages`);
  ok([...wanted].some((p) => p === 'icons'), 'no icon directory was even collected to check');
  rmSync(site, { recursive: true, force: true });
});

// The worker's promise is "an installed game opens offline". That is only true if the list it
// primes is the list the page loads.
test('the service worker primes the real runtime graph, not a hand-typed copy of it', () => {
  const graph = runtimeGraph();
  const shell = swShell();
  const missing = graph.map((m) => `./${m}`).filter((p) => !shell.includes(p));
  eq(missing, [], `sw.js does not cache ${missing.join(', ')} — offline the page cannot start`);
  // A stale entry is not merely untidy: it makes `install` fetch a URL that no longer exists, and
  // the allSettled call swallows the 404, so the drift is invisible from the console too. Classic
  // scripts the page mounts itself (js/sw-register.js) are not in the import graph, so they count
  // as reachable by their script tag rather than by `import`.
  const pageScripts = localRefs().filter((p) => p.startsWith('js/')).map((p) => `./${p}`);
  const orphans = shell.filter((p) => p.startsWith('./js/') && !graph.map((m) => `./${m}`).includes(p) && !pageScripts.includes(p));
  eq(orphans, [], `sw.js primes modules js/main.js never imports: ${orphans.join(', ')}`);
  for (const p of ['./index.html', './css/game.css', './manifest.webmanifest']) {
    ok(shell.includes(p), `sw.js does not prime ${p}`);
  }
  for (const p of cssRefs().map((c) => `./${c}`)) ok(shell.includes(p), `sw.js does not prime texture ${p}`);
  // Structural, not textual: sw.js's own header comment describes the cache-first mistake it avoids,
  // and a grep for "cache-first" would call that a bug. Inside the fetch handler the network call
  // has to come before the cache call, which is the whole difference between a deploy being
  // visible and a returning player playing last week's build forever.
  const handler = read('sw.js').match(/addEventListener\('fetch',([\s\S]*?)\n\}\);/);
  ok(handler, 'sw.js has no fetch handler to read');
  const net = handler[1].indexOf('fetch(request');
  const cache = handler[1].indexOf('caches.match');
  ok(net >= 0 && cache >= 0 && net < cache,
    `the fetch handler is not network-first (fetch@${net}, caches.match@${cache})`);
});

// Everything the brief calls behaviour-not-string has to be reachable from window, or no probe can
// re-verify any of it.
test('the page exposes a live state hook and registers the worker only over http', () => {
  const main = read('js/main.js');
  ok(/window\.pocketcube\s*=/.test(main), 'no window.pocketcube hook: no probe can read this game');
  const at = main.indexOf('serviceWorker');
  ok(at > 0, 'the worker is never registered');
  // Two guards, and the first is the one that matters for Electron: a file:// origin rejects
  // register() with an uncaught SecurityError unless the call is never reached at all, and the
  // rejection itself has to be caught rather than left in the console as an anonymous red line.
  const gate = main.slice(Math.max(0, at - 260), at);
  ok(/location\.protocol/.test(gate) && /https\?:/.test(gate),
    'registration is not gated to http(s) — the packaged app would throw on every start');
  ok(/\.catch\(/.test(main.slice(at, at + 260)), 'register() has no catch: a failed install is fatal');
  ok(/'serviceWorker' in navigator/.test(main), 'no feature test before touching navigator');
});

run();
