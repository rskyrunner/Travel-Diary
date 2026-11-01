// Offline support: cache the app shell and serve it cache-first.
// Bump VERSION whenever app files change so phones pick up the update.
const VERSION = 'td-v1';
const ASSETS = [
  './',
  'index.html',
  'app.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/db.js',
  'js/util.js',
  'js/image.js',
  'js/report.js',
  'vendor/jspdf.umd.min.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match('index.html')))
  );
});
