/*
 * 4blade — service worker (origem: FrotaZ)
 * Guarda SOMENTE os arquivos da tela (para abrir sem internet).
 * NUNCA guarda nada de /api/ (dados e login sempre vão direto ao servidor).
 */
const CACHE = "4blade-v44";

const ARQUIVOS = [
  "/",
  "/index.html",
  "/app.js",
  "/tema.js",
  "/legal.js",
  "/ajuda.js",
  "/style.css",
  "/manifest.json",
  "/icons/marca.png",
  "/icons/logo.png",
  "/icons/icon-v2-192.png",
  "/icons/icon-v2-512.png",
  "/icons/icon-v2-maskable-192.png",
  "/icons/icon-v2-maskable-512.png",
  "/icons/apple-touch-icon-v2.png",
  "/icons/favicon-v2.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ARQUIVOS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(
        nomes.filter(n => n !== CACHE).map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);

  // Só GET do próprio site. /api/ nunca passa pelo cache.
  if (
    req.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  // Rede primeiro (pega atualizações); sem rede, usa a cópia guardada.
  event.respondWith((async () => {
    try {
      const resp = await fetch(req);
      if (resp.ok && resp.type === "basic") {
        const cache = await caches.open(CACHE);
        cache.put(req.mode === "navigate" ? "/" : req, resp.clone());
      }
      return resp;
    } catch {
      const cache = await caches.open(CACHE);
      const guardado = req.mode === "navigate" ? await cache.match("/") : await cache.match(req);
      return guardado || Response.error();
    }
  })());
});
