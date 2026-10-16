// Aeris Phase 4.2 service worker.
//
// Hand-rolled (no next-pwa or other framework). Caches the public
// surface for offline survival; explicitly bypasses admin / operator
// / api so those always hit the network with fresh auth.
//
// Cache strategy:
//   - Static assets (_next/static, /icons, /images, fonts, raster)
//     → cache-first.
//   - HTML pages (everything else, except the bypass list)
//     → network-first, fallback to cache, fallback to /offline.
//   - Bypass list (/admin, /operator, /api, the signed-in client
//     portal /me, and token-gated personal pages: /booking/<token>,
//     /reset-password/<token>, /empty-legs/<leg>/reserved) → no SW
//     intervention; the browser handles them. Personal pages must
//     never land in Cache Storage: it ignores `no-store`, survives
//     logout, and would replay one user's data to the next person
//     on a shared device while offline.
//
// On every deploy that changes this file, bump CACHE_VERSION so the
// activate handler can purge the previous cache and force fresh
// fetches.

// v2: purges v1 caches, which could hold /me pages (incl. MedEvac
// patient details) from before /me joined the bypass list.
const CACHE_VERSION = 'aeris-v2';

// Precache list MUST include '/offline' so the offline fallback is
// guaranteed-available the first time the user goes offline. We rely
// on cache.addAll being atomic — any 404 / network error rejects the
// whole batch, which fails the SW install and prevents activation.
// That is the desired loud failure: a SW that can't precache the
// offline fallback should never activate.
const PRECACHE_URLS = ['/', '/offline'];

// EXACT-PATH-AND-PREFIX exclusion: regex like /^\/admin\// would
// match /admin/foo but miss /admin itself, /admin?x=1, and /admin#h.
// We must exclude both the bare path AND its children so admin,
// operator and signed-in client surfaces always hit the network.
const BYPASS_PREFIXES = [
  '/admin',
  '/operator',
  '/api',
  '/me',
  '/booking',
  '/reset-password',
];

function shouldBypassCache(pathname) {
  if (
    BYPASS_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(prefix + '/')
    )
  ) {
    return true;
  }
  // Guest empty-leg reservation status page (?token=…).
  return /^\/empty-legs\/[^/]+\/reserved\/?$/.test(pathname);
}

function isStaticAsset(pathname) {
  return (
    pathname.startsWith('/_next/static/') ||
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/images/') ||
    /\.(woff2?|ttf|otf|png|jpg|jpeg|svg|webp|ico|css|js)$/i.test(pathname)
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GETs.
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Never cache admin / operator / api (exact path or any sub-path).
  if (shouldBypassCache(url.pathname)) {
    return;
  }

  // Static assets: cache-first.
  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // HTML pages: network-first, cache fallback for offline.
  // /offline is precached above, so the final fallback is always
  // available even on the very first offline visit.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches
            .open(CACHE_VERSION)
            .then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then((cached) => cached || caches.match('/offline'))
      )
  );
});
