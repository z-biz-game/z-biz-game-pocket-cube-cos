// Service worker for the installed game. One rule, and it is the rule that decides whether a
// deploy is visible: every same-origin request goes to the network *first* and the cache is only a
// fallback. A cache-first worker is the classic self-inflicted wound — the shipped fix lands and
// every returning player keeps playing last week's js/view.js forever, with no way to tell them
// apart from the console.
//
// The cache is therefore written on the way past (a successful response is stored, not consulted),
// which is what makes the offline case work at all: an installed game with no connection still
// opens, because index.html and every module it imports were saved the last time they were fetched
// fresh.
//
// Bump CACHE on any change worth forcing. Stale versions are deleted on activate, so an update is
// one string, not a migration.

const CACHE = 'pocketcube-v4';
// The page's own transitive import graph, plus the bitmaps its first paint needs. Both halves were
// hand-maintained here once and both had drifted: `js/core/bfs.js` and `js/core/ida.js` are
// build-time modules that js/main.js never imports, while `js/core/game.js` — the game itself —
// together with `js/core/rng.js` and `js/data/lots.js` were missing, so an installed game opening
// offline got a shell without the thing to play. This list is checked against the real graph by
// test/shell.test.mjs, which turns that drift into a red test instead of a player's blank board.
// The two stylesheets, the worker's own registration script and the manifest's full icon set are
// primed too: each is either fetched by index.html or read by the launcher when the app is
// installed, and an install that happens offline cannot fetch the tile it was about to use.
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/game.css',
  './css/studio.css',
  './js/main.js',
  './js/view.js',
  './js/audio.js',
  './js/haptics.js',
  './js/sw-register.js',
  './js/core/game.js',
  './js/core/geom.js',
  './js/core/cube.js',
  './js/core/library.js',
  './js/core/rng.js',
  './js/core/storage.js',
  './js/data/lots.js',
  './icons/favicon-16.png',
  './icons/favicon-32.png',
  './icons/favicon-48.png',
  './icons/apple-touch-icon.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-192.png',
  './icons/icon-256.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-1024.png',
  './icons/icon-maskable-512.png',
  './assets/tex/blueprint-256.png',
  './assets/tex/spark-64.png',
];

self.addEventListener('install', (event) => {
  // Prime the shell so a first visit that drops offline still has something to show. Errors are
  // swallowed on purpose: a missing file here is a packaging bug the page itself will report, and
  // an install that throws would leave the old worker serving the old game indefinitely.
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url)))),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const sameOriginGet = (request) => {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!sameOriginGet(request)) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && (response.type === 'basic' || response.type === 'default')) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      // Network failed — offline, or a dead server. Serve what was last fetched, if ever.
      .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || offlineFallback(request))),
  );
});

// A navigation that cannot be answered from cache must not become the browser's error page inside
// an installed app: fall back to the cached shell, which routes itself from its URL hash.
async function offlineFallback(request) {
  if (request.mode === 'navigate') {
    const shell = await caches.match('./index.html');
    if (shell) return shell;
  }
  return new Response('offline', { status: 503, headers: { 'content-type': 'text/plain' } });
}
