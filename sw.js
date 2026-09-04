// sw.js
const CACHE_NAME = 'fattar-v9'; // bumped: added missing renderNotOpenScreen + loadSubmitTime

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/config.js',
  './js/api.js',
  './js/app.js',
  './js/manager.js',
  './js/screens.js',
  './js/utils.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Railway API calls → network-only with 15s timeout
  if (url.includes('fitar-production.up.railway.app')) {
    event.respondWith(
      (() => {
        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), 15000);
        return fetch(event.request, { signal: controller.signal })
          .then(r => { clearTimeout(timeoutId); return r; })
          .catch(() => {
            clearTimeout(timeoutId);
            return new Response(
              JSON.stringify({ success: false, error: 'أنت offline — تأكد من الإنترنت' }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            );
          });
      })()
    );
    return;
  }

  // Static assets → cache-first, revalidate in background
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
      return cached || networkFetch;
    }).catch(() => caches.match('./index.html'))
  );
});
