/* Copenhagen 21K - always prefer network: Garmin data must not stay stale. */
const CACHE = 'piano-allenamento-cph-2027-v1';
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async()=>{
  for(const key of await caches.keys()) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const u = new URL(event.request.url);
  if(u.origin !== self.location.origin) return;
  // Dynamic Garmin JSON/HTML and the workout diary must never be cached.
  if(/\/(garmin|training-log-public\.json)/.test(u.pathname)) {
    event.respondWith(fetch(event.request,{cache:'no-store'}));return;
  }
  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
});
