/* Service worker: offline shell + app install. Network-first so signals are always fresh. */
const CACHE = 'signals-v1';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const url = new URL(req.url);
  if (url.pathname.includes('/admin') || url.pathname.includes('/api/') || url.pathname.includes('/cron')) return;
  if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    })));
    return;
  }
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    }).catch(() => caches.match(req).then(hit => hit || new Response('<h1 style="font-family:sans-serif">You are offline</h1><p style="font-family:sans-serif">Reconnect to see live signals.</p>', {headers: {'Content-Type': 'text/html'}}))));
  }
});
