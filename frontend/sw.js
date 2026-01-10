const CACHE_NAME = 'teleprompter-v1';
const ASSETS = [
  '/static/index.html',
  '/static/app.js',
  '/static/style.css',
  '/static/manifest.json',
  '/static/icon-192.png',
  '/static/icon-512.png',
  'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js'
];

// Install - cache assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate - clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch - serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip WebSocket and API requests (need network)
  if (url.pathname.startsWith('/ws') || url.pathname.startsWith('/api')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cached) => {
        // Return cached version or fetch from network
        const fetched = fetch(event.request)
          .then((response) => {
            // Cache successful responses
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => cached); // Network failed, use cache

        return cached || fetched;
      })
  );
});
