// Service Worker — Nomad Pocket Library
//
// Rôle strictement limité à l'« app shell » et aux assets statiques (interface, wasm
// SQLite, chunks du corpus de démonstration). Le Service Worker NE PILOTE JAMAIS le
// sélecteur de fichiers de l'import local : cette opération reste du ressort exclusif
// du thread principal (API File / <input type="file">), conformément aux capacités
// réelles de la plateforme web.
//
// Stratégie :
//  - App shell (/, index.html, manifest, icônes) : cache-first avec mise à jour en
//    arrière-plan. Depuis l'Étape 2, l'app shell est auto-contenu : le moteur SQLite
//    WASM (wa-sqlite + binaire) est embarqué dans index.html, aucune requête réseau
//    n'est nécessaire pour ouvrir la base installée.
//  - Segments du corpus (/demo-corpus/* et toute URL de corpus) : cache-first
//    permanent — un changement de version doit changer l'URL ou le nom des fichiers.
//  - Reste : passthrough réseau, sans interception.

const CACHE_VERSION = "nomad-shell-v2";
const SHELL_ASSETS = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isImmutableAsset(url) {
  return url.pathname.startsWith("/demo-corpus/") || /\.(bin|wasm)$/i.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      })
    );
    return;
  }

  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const network = fetch(event.request)
          .then((response) => {
            if (response.ok) {
              caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, response.clone()));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
