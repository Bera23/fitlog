// Cache name is derived at install time from the actual content of fitlog.html.
// This means the cache auto-invalidates whenever fitlog.html changes —
// no manual version bumping needed on every deploy.

const SHELL = '/fitlog/fitlog.html';

async function getContentHash(url) {
  try {
    const res  = await fetch(url, { cache: 'no-store' });
    const text = await res.text();
    // Simple hash — sum of char codes mod 1M, converted to base-36
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h + text.charCodeAt(i)) % 1_000_000;
    return 'fitlog-' + h.toString(36);
  } catch {
    return 'fitlog-fallback';
  }
}

// Install — fetch fitlog.html, derive cache name from its content, store it
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cacheName = await getContentHash(SHELL);
    const cache     = await caches.open(cacheName);
    await cache.add(SHELL);
    // Store cache name so activate event can clean up old ones
    await caches.open('fitlog-meta').then(m => m.put('cache-name',
      new Response(cacheName)));
    await self.skipWaiting();
  })());
});

// Activate — delete any old fitlog-* caches except the current one
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const meta      = await caches.open('fitlog-meta');
    const res       = await meta.match('cache-name');
    const current   = res ? await res.text() : null;
    const keys      = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith('fitlog-') && k !== 'fitlog-meta' && k !== current)
          .map(k  => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Fetch — serve fitlog.html from cache, everything else from network
self.addEventListener('fetch', e => {
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith((async () => {
    const meta      = await caches.open('fitlog-meta');
    const res       = await meta.match('cache-name');
    const cacheName = res ? await res.text() : 'fitlog-fallback';
    const cache     = await caches.open(cacheName);
    const cached    = await cache.match(e.request);

    if (cached) return cached;

    const response = await fetch(e.request);
    if (response.ok && e.request.method === 'GET') {
      cache.put(e.request, response.clone());
    }
    return response;
  })().catch(() => caches.match(SHELL)));
});
