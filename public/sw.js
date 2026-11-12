/* Familianzas — service worker: la app abre y funciona sin señal.
 *  - Al instalarse guarda todas las pantallas y sus archivos.
 *  - Páginas: primero la red (para tener la última versión); sin señal, la copia guardada.
 *  - Archivos /_next/static (tienen hash): primero la copia guardada.
 *  - Nunca toca pedidos a otros dominios (Supabase, cotización).
 */
const VERSION = "familianzas-v1";
const RUTAS = [
  "/", "/nuevo", "/negocio/me-deben", "/negocio/sueldo", "/negocio/sobres", "/negocio/deudas",
  "/familia/sobres", "/familia/debemos", "/mas", "/mas/cuentas", "/mas/dolar", "/mas/sync",
  "/entrar", "/bienvenida", "/manifest.webmanifest", "/icono-192.png", "/icono-512.png",
];

async function guardarTodo() {
  const cache = await caches.open(VERSION);
  const estaticos = new Set();
  for (const ruta of RUTAS) {
    try {
      const r = await fetch(ruta, { cache: "no-store" });
      if (!r.ok) continue;
      if ((r.headers.get("content-type") || "").includes("text/html")) {
        const html = await r.clone().text();
        for (const m of html.matchAll(/\/_next\/static\/[^"'\s)]+/g)) estaticos.add(m[0]);
      }
      await cache.put(ruta, r);
    } catch (e) { /* sin red durante la instalación: se completa en la próxima */ }
  }
  await Promise.all([...estaticos].map((u) => cache.add(u).catch(() => undefined)));
}

self.addEventListener("install", (e) => {
  e.waitUntil(guardarTodo().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function primeroRed(req, claveCache) {
  const cache = await caches.open(VERSION);
  try {
    const r = await fetch(req);
    if (r.ok) cache.put(claveCache, r.clone());
    return r;
  } catch (e) {
    return (await cache.match(claveCache)) || (await cache.match("/")) || Response.error();
  }
}

async function primeroCache(req) {
  const cache = await caches.open(VERSION);
  const guardado = await cache.match(req);
  if (guardado) return guardado;
  const r = await fetch(req);
  if (r.ok) cache.put(req, r.clone());
  return r;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(primeroCache(req));
  } else if (req.mode === "navigate") {
    e.respondWith(primeroRed(req, url.pathname));
  } else if (url.searchParams.has("_rsc")) {
    // Navegación interna de Next: sin señal, falla y Next hace una carga completa (que sí está guardada).
    return;
  } else {
    e.respondWith(primeroRed(req, url.pathname));
  }
});
