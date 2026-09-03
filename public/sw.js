/**
 * Service worker.
 *
 * Two jobs:
 *  1. Cache the static app shell so the PWA is installable.
 *  2. Receive Web Push notifications so the team is reached when the app is
 *     closed.
 *
 * Offline DATA is still out of scope: anything dynamic always goes to the
 * network, because showing stale task or order state would be worse than
 * showing none.
 */
const CACHE = 'om-shell-v2';
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
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/auth')) return;

  // Cache-first only for the immutable static shell.
  if (SHELL.includes(url.pathname) || url.pathname.startsWith('/icons/')) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
  }
});

/* ------------------------------ Web Push ------------------------------- */

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Operation Manager', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Operation Manager';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // Same tag replaces an earlier notification for the same order rather
    // than stacking three copies as it escalates.
    tag: payload.tag || 'operation-manager',
    renotify: true,
    // Overdue and critical alerts must survive a locked screen without being
    // silently collapsed into the notification tray.
    requireInteraction: payload.level === 'overdue' || payload.level === 'critical',
    data: { url: payload.url || '/preparation' },
    timestamp: Date.now(),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/preparation';

  // Focus an already-open tab rather than piling up new windows on a shared
  // warehouse device.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
