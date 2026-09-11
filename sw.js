// sw.js — network-first service worker.
//
// BUMP CACHE_NAME ON EVERY DEPLOY, and bump the matching ?v= strings in
// index.html at the same time. Those two are the entire defence against the
// original bug where a stale build stayed pinned in people's browsers.
const CACHE_NAME = 'fitar-v6';

self.addEventListener('install', e => {
  // Take over immediately instead of waiting for every old tab to close.
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(['./icons/icon-192.png', './icons/icon-512.png']))
      .catch(() => { /* missing icon must not abort the install */ })
  );
});

self.addEventListener('activate', e => {
  // Delete every cache that is not the current version. This is what clears
  // out an older cache-first worker's contents on upgrade.
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Only store responses that are safe and useful to replay offline.
// Caching a 404 or 500 (e.g. a blip during a GitHub Pages deploy) would pin an
// error page as the offline fallback. Redirected responses throw on put().
function isCacheable(res) {
  return res && res.ok && res.type === 'basic' && !res.redirected;
}

self.addEventListener('fetch', e => {
  const req = e.request;

  // Never touch anything but GET: caching a POST is meaningless and put() throws.
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Never intercept cross-origin requests. The Railway API must always go
  // straight to the network, and an opaque response is useless to us anyway.
  if (url.origin !== location.origin) return;

  // Let the browser handle its own update check for the worker script.
  if (url.pathname.endsWith('/sw.js')) return;

  // Icons: cache-first, they do not change between deploys.
  if (/\.(png|ico|svg|webp|jpg|jpeg)$/i.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        if (isCacheable(res)) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(() => {});
        }
        return res;
      }))
    );
    return;
  }

  // Everything else (HTML, JS, CSS, manifest): NETWORK FIRST.
  // The network answer always wins when online; the cache is purely an offline
  // fallback. Do not change this to cache-first.
  e.respondWith(
    fetch(req)
      .then(res => {
        if (isCacheable(res)) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(cached =>
        cached || caches.match('./index.html') || Response.error()
      ))
  );
});
