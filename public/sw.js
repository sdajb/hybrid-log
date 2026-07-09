const CACHE_NAME = "hybrid-log-web-v2";
const BASE_URL = new URL(self.registration.scope);
const shellUrl = (path) => new URL(path, BASE_URL).toString();

const APP_SHELL = [
  shellUrl("./"),
  shellUrl("index.html"),
  shellUrl("manifest.webmanifest"),
  shellUrl("icon-192.png"),
  shellUrl("icon-512.png"),
  shellUrl("icon-maskable-192.png"),
  shellUrl("icon-maskable-512.png"),
  shellUrl("apple-touch-icon.png")
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(BASE_URL.pathname)) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => {
          if (req.mode === "navigate") return caches.match(shellUrl("index.html"));
          return caches.match(shellUrl("./"));
        });
    })
  );
});
