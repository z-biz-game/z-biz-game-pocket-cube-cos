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

const CACHE = 'pocketcube-v2';
const SHELL = [
  './',
  './index.html',
  './css/game.css',
  './js/main.js',
  './js/view.js',
  './js/audio.js',
  './js/core/geom.js',
  './js/core/cube.js',
  './js/core/bfs.js',
  './js/core/ida.js',
  './js/core/library.js',
  './js/core/storage.js',
  './manifest.webmanifest',
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
