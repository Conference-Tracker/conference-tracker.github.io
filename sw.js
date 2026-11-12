// Makes the app installable and quick to open. Pages and code come from the network first, with a saved copy
// used only when offline. Database requests are never cached, so data is always current.
const CACHE = "ct-v6";
const SHELL = ["./", "index.html", "app.js", "api.js", "config.js", "seed.js", "taxonomy.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon.svg"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;   // leave the database and other sites alone
  e.respondWith(fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
    .catch(() => caches.match(e.request)));
});
