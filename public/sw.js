/*
 * Service worker: app shell only.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *   Nothing that represents money is ever served from cache. Not balances, not transactions,
 *   not loans, not settings. A member shown a cached figure has no way to tell it is three
 *   days old, and in a ledger a stale number is worse than no number -- it gets acted on.
 *   Every request to /api/* and to Supabase goes to the network or it fails, and failing is
 *   the correct outcome.
 *
 * WHAT IS CACHED
 *   The shell: content-hashed JS and CSS, images, fonts, and the prerendered HTML. That makes
 *   the app installable and instant to launch, and lets it open offline far enough to explain
 *   itself. The HTML is safe to cache because these pages are prerendered and user-agnostic --
 *   every figure a member sees is fetched client-side after load. If a page is ever converted
 *   to server-render a member's data into the HTML, it must be excluded here.
 *
 * NO BUILD STEP
 *   There is no generated precache manifest, so this file needs no bundler plugin and cannot
 *   drift from one. Caching is entirely at runtime, keyed on the request. Content-hashed
 *   assets under /_next/static are immutable, so cache-first is always correct for them; the
 *   hash changes on deploy and the new URL simply misses and fetches.
 */

const VERSION = 'v1';
const SHELL_CACHE = `pewosa-shell-${VERSION}`;
const ASSET_CACHE = `pewosa-assets-${VERSION}`;
const OFFLINE_URL = '/offline';

// Hosts whose responses may be cached. Supabase is deliberately absent and must stay absent:
// it serves both the data and the auth tokens.
const CACHEABLE_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://cdnjs.cloudflare.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Only the offline page is precached. Everything else arrives through use, which keeps
      // install cheap on the slow connections this app is actually used on.
      await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
      // Take over immediately. Safe here because every cached asset is content-hashed, so a
      // page loaded under the old worker cannot be handed a mismatched chunk by the new one.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith('pewosa-') && !keep.has(n)).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

/** Requests this worker must not touch at all. */
function isOffLimits(request, url) {
  // Only GET is ever cacheable, and a write must never be replayed from here.
  if (request.method !== 'GET') return true;

  // The ledger and everything that reads it.
  if (url.pathname.startsWith('/api/')) return true;

  // Supabase: PostgREST data, auth tokens, realtime. Never cached, never intercepted.
  if (url.hostname.endsWith('.supabase.co')) return true;

  // Range requests (media seeking) are served wrong by a naive cache.put.
  if (request.headers.has('range')) return true;

  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CACHEABLE_ORIGINS.includes(url.origin)) return true;

  return false;
}

/** Immutable, content-hashed build output. */
function isHashedAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith('/_next/static/');
}

function isAsset(request, url) {
  if (isHashedAsset(url)) return true;
  if (CACHEABLE_ORIGINS.includes(url.origin)) return true;
  return ['style', 'script', 'font', 'image'].includes(request.destination);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok || response.type === 'opaque') {
        cache.put(request, response.clone());
      }
      return response;
    })
    // Offline with nothing cached is a genuine failure; let it propagate as one.
    .catch(() => hit);

  return hit || network;
}

/**
 * Navigations: network first, so a deploy reaches members on their next page load rather
 * than whenever a cache happens to expire. The cached copy is only ever a fallback for
 * being offline.
 */
async function navigate(request) {
  const cache = await caches.open(SHELL_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;

    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;

    return new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (isOffLimits(request, url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  if (isAsset(request, url)) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
  }
});
