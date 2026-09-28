/**
 * Service Worker — offline shell for Ledger.
 *
 * Strategy:
 *  - Navigations (the HTML document): Network-first. When you're online we always
 *    fetch the latest app shell (so a redeployed GitHub Pages build shows up
 *    immediately); when offline we fall back to whatever shell was last cached.
 *  - Static assets (JS/CSS/fonts/images): Cache-first. Vite content-hashes these
 *    filenames on build, so a cached file is guaranteed to be the exact version
 *    that shell referenced — it can never go stale under the same name.
 *
 * There is no "dynamic API data" layer to worry about here — all app data lives
 * in IndexedDB, not on a server — so this file only ever deals with the static
 * app shell itself.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `ledger-shell-${CACHE_VERSION}`;
const STATIC_CACHE = `ledger-static-${CACHE_VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, STATIC_CACHE];

self.addEventListener('install', () => {
  // Activate this version as soon as it's installed rather than waiting for
  // old tabs to close — this is a personal single-user tool, not something
  // where staged rollouts across many clients matter.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => !CURRENT_CACHES.includes(key)).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle same-origin GET requests. Everything else (e.g. any future
  // cross-origin call) passes straight through untouched.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (['style', 'script', 'font', 'image'].includes(request.destination)) {
    event.respondWith(cacheFirst(request));
  }
});

/**
 * Cache-first fetch: serve from cache when present, otherwise fetch and
 * populate the cache for next time. Falls back to whatever's cached (even if
 * the live fetch fails) so a flaky connection doesn't break a repeat visit.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
    return response;
  } catch (err) {
    return cached || Response.error();
  }
}

/**
 * Network-first fetch for the HTML shell: try the network so redeployed
 * builds are picked up immediately, fall back to the cached shell offline.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    return cached || caches.match('./index.html');
  }
}
