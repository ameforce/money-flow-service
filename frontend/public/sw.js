const CACHE_NAME = "money-flow-shell-v1";
const SHELL_ASSETS = ["/", "/manifest.webmanifest"];
const STATIC_DESTINATIONS = new Set(["font", "image", "manifest", "script", "style"]);
const NAVIGATION_CACHE_KEY = "/";
const NON_SPA_PATHS = new Set(["/healthz", "/readyz", "/docs", "/openapi.json"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/ws/") ||
    NON_SPA_PATHS.has(url.pathname)
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request, url));
    return;
  }

  if (STATIC_DESTINATIONS.has(request.destination)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirstNavigation(request, url) {
  if (url.search) {
    return fetch(request);
  }

  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(NAVIGATION_CACHE_KEY, response.clone());
    }
    return response;
  } catch {
    return cache.match(NAVIGATION_CACHE_KEY);
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then((response) => {
      if (response.ok) {
        void cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);
  return cached || fresh;
}
