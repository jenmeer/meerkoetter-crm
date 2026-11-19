// Service Worker der Webapp: hält nur die Programmdateien für einen schnellen Start bereit.
// Kundendaten (/api, /auth, /v1) werden nie zwischengespeichert, sie bleiben auf dem Server.
const CACHE = "crm-programm-v1";
const SHELL = ["/", "/app.js", "/style.css", "/logo.svg", "/favicon.svg", "/manifest.webmanifest", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (/^\/(api|auth|v1)\//.test(url.pathname)) return;
  // Immer zuerst das Netz, damit Änderungen sofort ankommen; ohne Netz die gespeicherte Fassung.
  event.respondWith(fetch(event.request)
    .then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return res;
    })
    .catch(() => caches.match(event.request).then((hit) => hit || caches.match("/"))));
});
