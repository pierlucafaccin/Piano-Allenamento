/* Copenhagen 21K — rete prima, copia di riserva per la palestra senza campo.
 * Ogni risposta riuscita aggiorna la cache: online vedi sempre l'ultima versione,
 * offline l'app, il piano e la modalità allenamento continuano a funzionare. */
const CACHE = 'piano-allenamento-cph-vlc-2027-v3';
const SHELL = ['./', './index.html', './style.css', './responsive-fixes.css', './progressi.css', './coach.css', './races.css',
  './app.js', './progressi.js', './coach.js', './training-plan.json', './manifest.webmanifest', './favicon.svg'];

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await Promise.all(SHELL.map(u => cache.add(new Request(u, {cache: 'reload'})).catch(() => {})));
  await self.skipWaiting();
})()));

self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin || u.pathname.includes('/api/')) return;
  // Le dashboard Garmin generate non servono offline e non devono mai restare vecchie.
  if (/\/garmin\/.*\.html$/.test(u.pathname)) { event.respondWith(fetch(req, {cache: 'no-store'})); return; }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, {cache: 'no-store'});
      if (res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      const hit = await cache.match(req, {ignoreSearch: true});
      if (hit) return hit;
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      throw err;
    }
  })());
});
