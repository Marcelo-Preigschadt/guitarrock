export function offlineWorkerSource(name, files) {
  return `const CACHE=${JSON.stringify(name)};
const FILES=${JSON.stringify(files.map((f) => "./" + f))};
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('riffsync-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  if (url.pathname.endsWith('/version.json') || url.pathname.endsWith('/sw.js')) return;
  if (self.location.hostname.endsWith('.app.github.dev')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () =>
      (await caches.match(new URL('./index.html', self.location.href))) ||
      new Response('RiffSync está offline. Reconecte e tente novamente.', {status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})
    ));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
`;
}
