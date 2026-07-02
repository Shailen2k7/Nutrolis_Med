/* ============================================================
 *  Nutrolis AI · Service Worker
 *  PWA offline support — HEALTH-SAFE caching.
 *
 *  GOLDEN RULE (do not break this):
 *  We cache ONLY the static app shell — HTML, CSS, JS, icons, fonts.
 *  We NEVER cache anything from Supabase (auth, database) or the
 *  Claude proxy. Health data and auth tokens stay network-only so
 *  nothing sensitive is ever written to the device cache. This keeps
 *  us aligned with our privacy/DPDP posture.
 *
 *  Bump CACHE_VERSION on every shell change to ship updates cleanly.
 * ============================================================ */

const CACHE_VERSION = "nutrolis-v6";
const SHELL_CACHE   = CACHE_VERSION + "-shell";
const RUNTIME_CACHE = CACHE_VERSION + "-runtime";

/* Same-origin files that make the app boot offline. Keep this list to
   things we KNOW exist at the root, or install will fail. */
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/app.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
  "/icons/favicon-16.png",
];

/* Hosts whose responses must NEVER be cached (private / dynamic). */
function isPrivate(url) {
  return (
    url.hostname.endsWith("supabase.co") ||      // auth + database + storage
    url.pathname.includes("/functions/v1/") ||   // Claude proxy edge function
    url.hostname.endsWith("supabase.in")
  );
}

/* Static third-party assets we MAY cache (libraries + fonts only). */
function isCacheableCDN(url) {
  return (
    url.hostname === "cdn.jsdelivr.net" ||
    url.hostname === "cdnjs.cloudflare.com" ||
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com"
  );
}

/* ---------- install: precache the shell ---------- */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // addAll is atomic; if one URL 404s the whole install fails, so we
      // add resiliently and don't let a single miss block activation.
      Promise.allSettled(SHELL_ASSETS.map((u) => cache.add(u)))
    ).then(() => self.skipWaiting())
  );
});

/* ---------- activate: drop old caches, take control ---------- */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ---------- fetch: route every request safely ---------- */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) Never touch non-GET (sign-in, saves, deletes) — straight to network.
  if (req.method !== "GET") return;

  // 2) Private hosts (Supabase, Claude proxy) — NETWORK ONLY, no cache,
  //    no offline fallback. We never serve stale health data.
  if (isPrivate(url)) return;

  // 3) Navigations (loading index.html / app.html) — network-first so an
  //    online user always gets fresh HTML, with cached shell as fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() =>
          caches.match(req).then(
            (hit) => hit || caches.match("/app.html") || caches.match("/index.html")
          )
        )
    );
    return;
  }

  // 4) Static CDN libs + Google Fonts — stale-while-revalidate.
  if (isCacheableCDN(url)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // 5) Same-origin static assets (icons, etc.) — cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetchAndCache(req, SHELL_CACHE))
    );
    return;
  }

  // 6) Everything else — plain network, no caching.
});

/* ---------- helpers ---------- */
function staleWhileRevalidate(req) {
  return caches.open(RUNTIME_CACHE).then((cache) =>
    cache.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
}

function fetchAndCache(req, cacheName) {
  return fetch(req)
    .then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(cacheName).then((c) => c.put(req, copy));
      }
      return res;
    })
    .catch(() => caches.match(req));
}

/* Allow the page to trigger an immediate update if it wants to. */
self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});
