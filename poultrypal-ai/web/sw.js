/* PoultryPal service worker — offline app shell.
 *
 * Strategy:
 *  - /api/* and /whatsapp/* : network only (diagnosis/transcription need the server).
 *  - everything else (HTML, JS, CSS, icons): NETWORK-FIRST with cache fallback —
 *    when online you always get the latest code (no stale-cache surprises); when
 *    offline the cached app shell, visual guide and vaccination schedule still load.
 *  Bump CACHE_NAME to force all clients to refresh the cached shell.
 */
const CACHE_NAME = "poultrypal-v3";
// Unversioned paths; the offline fallback matches with ignoreSearch so cached copies
// still serve the ?v=N requests from index.html even after a version bump.
const PRECACHE = [
  "/", "/manifest.json", "/icon-192.png", "/icon-512.png", "/icon.svg",
  "/styles.css", "/visuals.js", "/vaccines.js", "/performance.js", "/app.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin (MSD, Google) pass through

  // Server-dependent endpoints: network only, with a friendly offline fallback.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/whatsapp/")) {
    event.respondWith(
      fetch(req).catch(() =>
        new Response(
          JSON.stringify({ detail: "You're offline. Diagnosis needs an internet connection." }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    return;
  }

  // App shell: NETWORK-FIRST (fresh when online), cache fallback when offline.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const resp = await fetch(req);
        if (resp && resp.status === 200) cache.put(req, resp.clone());
        return resp;
      } catch (e) {
        const cached = await cache.match(req, { ignoreSearch: true });
        return cached || (await cache.match("/")) || new Response("Offline", { status: 503 });
      }
    })
  );
});
