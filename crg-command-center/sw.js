/* =============================================================================
   Garvis Service Worker — Cornerstone Command (crg-command.netlify.app)
   -----------------------------------------------------------------------------
   Why this exists:
     index.html registers '/sw.js' and netlify.toml sets a no-cache header for
     it, but the file was missing. Result: registration failed silently and
     PWA cache invalidation never worked — Marc kept hitting stale builds.

   Cache strategy:
     • /api/*  +  /.netlify/functions/*   →  network-only (NEVER cached;
                                              live data must not stale)
     • App shell + static assets          →  cache-first, network fallback
     • Everything else                    →  network-first, cache fallback

   Cache versioning:
     CACHE_VERSION must match the build label in index.html footer
     (id="build-id", currently "stark.03"). Bump on every deploy. The
     'activate' event nukes any cache whose name does not match the
     current version, so old shells are evicted as soon as a new SW
     activates.

   Update flow (already wired in index.html):
     1. New deploy → Netlify serves a new sw.js (no-cache header guarantees
        fresh fetch on every page load).
     2. Browser detects byte-diff → 'updatefound' fires.
     3. New SW reaches 'installed' state → page posts {type:'SKIP_WAITING'}.
     4. self.skipWaiting() promotes the new SW immediately.
     5. clients.claim() in 'activate' takes control of all open tabs.
     6. SW broadcasts {type:'CACHE_UPDATED'} so the page can prompt reload.
   ============================================================================= */

'use strict';

// ─── Version ──────────────────────────────────────────────────────────────
// Keep in sync with index.html footer build label (id="build-id").
// Bump on every deploy that ships UI/asset changes.
const CACHE_VERSION = 'stark.03';
const CACHE_NAME    = `garvis-cache-${CACHE_VERSION}`;

// ─── App shell ────────────────────────────────────────────────────────────
// Pre-cached on install. Use Promise.allSettled-style adds so a missing
// icon (404) does not abort the entire install — Garvis ships icons
// progressively and we do not want to block PWA registration on them.
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/favicon-16.png',
  '/favicon-32.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

// Google Fonts CSS (and the woff2 files it references). Cached on first
// fetch via the runtime cache-first path — no need to pre-cache, the CSS
// bytes change rarely and the font CDN is highly available.
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// Paths that must NEVER be cached. Live endpoints — caching them would
// freeze silo state, agent status, queue contents, etc.
const NEVER_CACHE_PREFIXES = [
  '/api/',
  '/.netlify/functions/',
];

// ─── Helpers ──────────────────────────────────────────────────────────────
function isNeverCache(url) {
  return NEVER_CACHE_PREFIXES.some(prefix => url.pathname.startsWith(prefix));
}

function isAppShell(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname === '/' || url.pathname === '/index.html') return true;
  if (url.pathname === '/manifest.json') return true;
  if (url.pathname.startsWith('/favicon')) return true;
  if (url.pathname.startsWith('/icon-')) return true;
  if (url.pathname === '/apple-touch-icon.png') return true;
  return false;
}

function isFont(url) {
  return FONT_HOSTS.includes(url.hostname);
}

// ─── install: pre-cache the app shell ─────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Add each shell asset individually; tolerate per-asset failures so a
    // missing icon does not block install.
    await Promise.all(
      APP_SHELL.map(async path => {
        try {
          const req = new Request(path, { cache: 'reload' });
          const res = await fetch(req);
          if (res && (res.ok || res.type === 'opaque')) {
            await cache.put(req, res.clone());
          }
        } catch (_err) {
          // Asset missing or offline; skip — runtime fetch will still work.
        }
      })
    );
  })());
});

// ─── activate: prune old versioned caches + claim clients ────────────────
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(name => name.startsWith('garvis-cache-') && name !== CACHE_NAME)
        .map(name => caches.delete(name))
    );
    await self.clients.claim();

    // Notify all open clients so they can prompt the user to reload.
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach(client => {
      client.postMessage({ type: 'CACHE_UPDATED', version: CACHE_VERSION });
    });
  })());
});

// ─── fetch: route by URL ──────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;

  // Only handle GET. POST/PUT/DELETE bypass the SW — they must always go
  // straight to the origin (live data, autonomy-mode toggles, etc.).
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1. Never-cache paths: live data endpoints. Always go network.
  if (isNeverCache(url)) {
    event.respondWith(fetch(req));
    return;
  }

  // 2. App shell + same-origin static icons + fonts: cache-first.
  if (isAppShell(url) || isFont(url)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // 3. Everything else (same-origin pages, JS, JSON data files): network-first.
  event.respondWith(networkFirst(req));
});

// Cache-first: serve from cache if present; otherwise fetch, store, return.
async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    // Last-ditch: if request was for the root, return cached index.
    if (req.mode === 'navigate') {
      const fallback = await cache.match('/index.html');
      if (fallback) return fallback;
    }
    throw err;
  }
}

// Network-first: try network, store fresh copy; fall back to cache on failure.
async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res && res.ok && req.url.startsWith(self.location.origin)) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const fallback = await cache.match('/index.html');
      if (fallback) return fallback;
    }
    throw err;
  }
}

// ─── message: handle SKIP_WAITING from the page ─────────────────────────
self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
