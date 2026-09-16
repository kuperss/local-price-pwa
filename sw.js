const CACHE_NAME = "local-price-pwa-v51-costs";
const APP_SHELL = [
  "./", "./index.html", "./styles.css?v=51", "./app.js?v=51",
  "./manifest.webmanifest?v=51", "./assets/icon.svg?v=51",
  "./managed.js", "./managed.css", "./cost-crypto.js", "./cost-session.js",
];
const SHELL_PATHS = new Set(APP_SHELL.map(path => new URL(path, self.location.href).pathname));
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith("local-price-pwa") && key !== CACHE_NAME).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  // Only cache the application shell, never APIs, admin responses, documents or keys.
  if(event.request.method !== "GET" || url.origin !== self.location.origin || !SHELL_PATHS.has(url.pathname)) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if(response.ok && response.type === "basic") {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)));
    }
    return response;
  })));
});
