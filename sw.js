/**
 * Service worker.
 * Caches the app shell so the app launches offline after the first visit.
 *
 * FIX: the old version hardcoded the *unbundled* dev source file list
 * (js/app.js, css/base.css, etc). After `npm run build`, Vite emits
 * hashed filenames into dist/ (e.g. assets/app-a1b2c3.js), so that list
 * 404'd in production and cache.addAll() failed as a whole - silently
 * disabling offline support (app.js swallows the registration error).
 * This version only precaches the guaranteed-to-exist shell (start URL,
 * manifest) and otherwise caches pages/assets the first time they're
 * actually fetched, so it works the same whether it's serving raw
 * source files (dev) or hashed build output (production).
 */
const CACHE_NAME = 'pl-os-shell-v16';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin (fonts/icons CDN): let the network handle it

  // Never cache API calls - they must always hit the network fresh.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached); // offline: fall back to whatever we have cached

      // Cache-first for instant loads, but still refresh the cache in the background.
      return cached || networkFetch;
    })
  );
});
