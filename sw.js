// Service worker : jeu jouable hors ligne, réseau en priorité pour recevoir les mises à jour
const CACHE = 'ligne-etroite-v2';
const FILES = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/main.js', 'js/geom.js', 'js/city.js', 'js/world.js', 'js/bus.js', 'js/mapRenderer.js',
  'js/render.js', 'js/traffic.js', 'js/mission.js', 'js/controls.js', 'js/audio.js', 'js/ui.js', 'js/feasibility.js',
  'js/incidents.js', 'js/challenge.js', 'js/challenges.js', 'js/training.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
