// sw.js — SAFE MODE v10: clears all old caches, zero JS caching
const CACHE_NAME = 'fattar-v10';

self.addEventListener('install', event => {
  // Take over immediately — don't wait for old SW to die
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => {
        console.log('[SW] Clearing caches:', keys);
        return Promise.all(keys.map(key => caches.delete(key)));
      })
      .then(() => self.clients.claim())
  );
});

// Everything goes straight to the network — no caching at all
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => {
      if (event.request.mode === 'navigate') {
        return new Response('<h1>لا يوجد إنترنت</h1>', { headers: { 'Content-Type': 'text/html' } });
      }
      return new Response(JSON.stringify({ success: false, error: 'offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    })
  );
});
