/* Lift Tracker service worker: offline app shell (cache-first, refreshed in background). */
const VERSION = 'lt-v1.5.1';
const IMG_CACHE = 'lt-img-v1'; // form-demo photos from the jsDelivr CDN, cached once viewed
const IMG_MAX = 600;
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/importers.js', './js/store.js', './js/sound.js', './js/library.js', './js/features.js', './js/onboard.js', './js/app.js',
  './data/exercises.json', './programs/bodyweight-full-body.program.json',
  './sample/example-ppl.json', './programs/starter-ppl.program.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon.png'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))) /* bypass the HTTP cache so a new version never installs stale files */).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== IMG_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method === 'GET' && url.hostname === 'cdn.jsdelivr.net' && /\.(jpe?g|png|webp|gif)$/i.test(url.pathname)) { e.respondWith(cachedImage(req)); return; }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true }) ||
        (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
      const network = fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      }).catch(() => undefined);
      return cached || (await network) || new Response('Offline', { status: 503 });
    })
  );
});

async function cachedImage(req) {
  const cache = await caches.open(IMG_CACHE);
  const hit = await cache.match(req); if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      await cache.put(req, res.clone());
      cache.keys().then((keys) => { if (keys.length > IMG_MAX) keys.slice(0, keys.length - IMG_MAX).forEach((k) => cache.delete(k)); });
    }
    return res;
  } catch (err) { return new Response('', { status: 504, statusText: 'offline' }); }
}
