// SalesPal service worker — instant loads via stale-while-revalidate.
// Scoped to /app/ (the dashboard); the marketing page at / is not cached here.
const CACHE = "salespal-v114";
// Separate cache for API GET responses so the app shows last-known data offline
// (network-first: fresh when online, cached copy when the connection is gone).
const API_CACHE = "salespal-api-v1";
const SHELL = [
  "/app/", "/app/index.html", "/app/styles.css", "/app/app.js", "/app/icons.js",
  "/app/manifest.webmanifest",
  "/icons/icon-192.png", "/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // no-cache: seed the shell straight from the server, never a stale
      // HTTP-cache copy (the server sends no Cache-Control header).
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "no-cache" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== API_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate for the app shell: answer instantly from cache (fast
// open on every launch, even on slow networks), and refresh the cache in the
// background. New code reaches users the moment the SW itself updates — bumping
// CACHE on each deploy installs a new SW, which skipWaiting + the page's
// controllerchange listener turn into a one-time auto-reload.
function staleWhileRevalidate(request, url) {
  return caches.open(CACHE).then((cache) =>
    cache.match(request).then((cached) => {
      // no-cache like the install seed: the server sends no Cache-Control, so a
      // plain fetch would hit the browser's heuristic HTTP cache and "refresh"
      // the SW cache with its own stale copy forever.
      const network = fetch(request.url, { cache: "no-cache", credentials: "same-origin" })
        .then((resp) => {
          if (resp && resp.status === 200 && url.origin === location.origin) {
            cache.put(request, resp.clone());
          }
          return resp;
        })
        .catch(() => cached || (request.mode === "navigate" ? cache.match("/app/index.html") : undefined));
      // Serve cache immediately when present; otherwise wait for the network.
      return cached || network;
    })
  );
}

// Network-first for API reads: always try the server (fresh data), fall back to
// the last cached response when offline. A miss returns a 503 the app treats as
// "offline" so reads degrade instead of throwing.
function networkFirst(request) {
  return caches.open(API_CACHE).then((cache) =>
    fetch(request)
      .then((resp) => {
        if (resp && resp.status === 200) cache.put(request, resp.clone());
        return resp;
      })
      .catch(() => cache.match(request).then((cached) =>
        cached || new Response(JSON.stringify({ detail: "You're offline" }),
          { status: 503, headers: { "Content-Type": "application/json" } }))));
}

// New-order alerts: the server pushes {title, body, url}; tapping the
// notification focuses the app (or opens it) so the merchant can fulfil.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil(self.registration.showNotification(d.title || "SalesPal", {
    body: d.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png",
    data: { url: d.url || "/app/" }, tag: "salespal-order",
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/app/";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
    for (const t of tabs) if (t.url.includes("/app")) return t.focus();
    return clients.openWindow(url);
  }));
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return; // POST/PUT/DELETE always hit the network
  const url = new URL(request.url);

  // API reads: network-first with an offline cache fallback so the dashboard and
  // lists still render (from the last sync) when there's no connection.
  if (url.origin === location.origin && url.pathname.startsWith("/api/")) {
    e.respondWith(networkFirst(request));
    return;
  }

  // Navigations, app code, icons, fonts: stale-while-revalidate.
  e.respondWith(staleWhileRevalidate(request, url));
});
