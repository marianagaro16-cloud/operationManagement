/**
 * Minimal service worker.
 *
 * V1 requires installability, NOT offline data. It therefore caches only the
 * static app shell and always goes to the network for anything dynamic —
 * showing stale task state would be worse than showing none.
 *
 * The structure (a fetch handler with per-request routing) is where a future
 * offline layer would slot in, so this does not paint us into a corner.
 */
const CACHE = 'om-shell-v1';
const SHELL = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never cache anything that carries state or authentication.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/auth')) return;

  // Cache-first only for the immutable static shell.
  if (SHELL.includes(url.pathname) || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request)),
    );
  }
});
