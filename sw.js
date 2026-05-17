// Cache name — derived from fitlog.html content hash at install time.
// Auto-invalidates on every deploy without manual version bumps.

const SHELL = '/fitlog/fitlog.html';

async function getContentHash(url) {
  try {
    const res  = await fetch(url, { cache: 'no-store' });
    const text = await res.text();
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h + text.charCodeAt(i)) % 1_000_000;
    return 'fitlog-' + h.toString(36);
  } catch {
    return 'fitlog-fallback';
  }
}

// Install — fetch fresh fitlog.html, derive cache name, store it
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cacheName = await getContentHash(SHELL);
    const cache     = await caches.open(cacheName);
    await cache.add(SHELL);
    await caches.open('fitlog-meta').then(m =>
      m.put('cache-name', new Response(cacheName))
    );
    // Skip waiting immediately — don't wait for old tabs to close
    await self.skipWaiting();
  })());
});

// Activate — delete stale fitlog-* caches, claim all clients
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const meta    = await caches.open('fitlog-meta');
    const res     = await meta.match('cache-name');
    const current = res ? await res.text() : null;
    const keys    = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith('fitlog-') && k !== 'fitlog-meta' && k !== current)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// Fetch — network-first for the shell, cache-first for everything else.
// Network-first on the shell ensures fresh HTML is always attempted,
// falling back to cache only when offline.
self.addEventListener('fetch', e => {
  if (!e.request.url.startsWith(self.location.origin)) return;
  if (e.request.method !== 'GET') return;

  const isShell = e.request.url.includes(SHELL) || e.request.url.endsWith('/fitlog/');

  if (isShell) {
    // Network-first: always try to get fresh HTML, cache as fallback
    e.respondWith((async () => {
      try {
        const response = await fetch(e.request, { cache: 'no-store' });
        if (response.ok) {
          const meta      = await caches.open('fitlog-meta');
          const nameRes   = await meta.match('cache-name');
          const cacheName = nameRes ? await nameRes.text() : 'fitlog-fallback';
          const cache     = await caches.open(cacheName);
          await cache.put(e.request, response.clone());
        }
        return response;
      } catch {
        // Offline fallback — return cached shell
        const meta      = await caches.open('fitlog-meta');
        const nameRes   = await meta.match('cache-name');
        const cacheName = nameRes ? await nameRes.text() : 'fitlog-fallback';
        const cache     = await caches.open(cacheName);
        return await cache.match(SHELL);
      }
    })());
  } else {
    // Cache-first for fonts, icons, external assets
    e.respondWith((async () => {
      const meta      = await caches.open('fitlog-meta');
      const nameRes   = await meta.match('cache-name');
      const cacheName = nameRes ? await nameRes.text() : 'fitlog-fallback';
      const cache     = await caches.open(cacheName);
      const cached    = await cache.match(e.request);
      if (cached) return cached;
      const response = await fetch(e.request);
      if (response.ok) cache.put(e.request, response.clone());
      return response;
    })().catch(() => caches.match(SHELL)));
  }
});
