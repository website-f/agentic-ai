// Offline shell for the installable app. API calls always go to the network; offline
// clock-ins are queued by the app itself (planned, ADR 0003), never served from cache.
// The app may live at the site root or under a path beside another app (Agentic Office:
// /prima/), so every path here is relative to this worker's scope.
const CACHE = 'prima-shell-v3';
const BASE = new URL(self.registration.scope).pathname;
const SHELL = [BASE, `${BASE}index.html`, `${BASE}manifest.webmanifest`, `${BASE}icon.svg`];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only this app's own files: never the API, Microsoft sign-in, another app on the same site
  // or anything from another address.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(BASE) || url.pathname.startsWith('/api/') || url.pathname.startsWith(`${BASE}api/`)) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match(`${BASE}index.html`))),
  );
});
