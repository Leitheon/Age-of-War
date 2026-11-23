/* Evony Age II — asset service worker.
 *
 * Persists game art in Cache Storage so it is served locally instead of being re-fetched from the server on
 * every use (the old behaviour: the server sent Cache-Control: no-cache, so every image re-downloaded, which
 * caused the constant loading + lag and the "hover swaps to a not-yet-loaded image" flash).
 *
 * Strategy: CACHE-FIRST for all static assets (images, fonts, swf, and the hashed JS/CSS bundle). A cache hit
 * is served with no network at all; a miss is fetched with {cache:'reload'} so it bypasses the browser HTTP
 * cache (avoiding the "SW revalidates against a still-fresh HTTP-cached stale copy" gotcha) and stored. The
 * cache name carries a per-BUILD id (VERSION, stamped into this file at build time), so every deploy activates
 * a new worker that drops the previous build's cache — returning players then re-fetch fresh art once. Between
 * deploys nothing is re-fetched. The HTML shell, the /json websocket, dynamic endpoints and /asset-manifest.json
 * are NOT intercepted (always straight from the network), so a redeploy is picked up immediately.
 *
 * Safety: every Cache Storage access is wrapped so a storage failure (quota, private mode, corrupt profile)
 * falls back to a plain network fetch and can never brick the app. Recovery: post {type:'PURGE'} to wipe caches.
 */
const VERSION = 'aow-0.1.18' // replaced per build by the asset-manifest Vite plugin; Age of War: changed by hand when kept art must go
const CACHE = 'evony-assets-' + VERSION
const STATIC_RE = /\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|wasm|swf|css|js)$/i

self.addEventListener('install', () => { self.skipWaiting() })

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k.startsWith('evony-assets-') && k !== CACHE).map((k) => caches.delete(k)))
    } catch { /* ignore */ }
    try { await self.clients.claim() } catch { /* ignore */ }
  })())
})

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'PURGE') {
    e.waitUntil((async () => {
      try { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))) } catch { /* ignore */ }
    })())
  }
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  let url
  try { url = new URL(req.url) } catch { return }
  if (url.origin !== self.location.origin) return // cross-origin (e.g. CDN portraits) -> browser default
  if (!STATIC_RE.test(url.pathname)) return        // HTML shell, /json websocket, manifest, dynamic -> network

  e.respondWith((async () => {
    try {
      const cache = await caches.open(CACHE)
      const cached = await cache.match(req)
      if (cached) return cached
      // Miss: for mutable same-filename art bypass the HTTP cache so a fresh build pulls fresh bytes; for the
      // content-hashed immutable /assets/* bundle use the default cache mode so a still-fresh HTTP-cached copy is
      // reused (an old page that lazy-imports a chunk after a deploy still gets it, instead of a 404 from origin).
      const immutable = url.pathname.startsWith('/assets/')
      const res = await fetch(req, immutable ? undefined : { cache: 'reload' })
      // (Age of War: not what the server marks no-store, a stand-in portrait it would rather replace soon)
      if (res && res.status === 200 && res.type === 'basic' && !/no-store/i.test(res.headers.get('Cache-Control') || '')) { try { await cache.put(req, res.clone()) } catch { /* quota */ } }
      return res
    } catch {
      return fetch(req) // any Cache Storage failure -> plain network; never brick the app
    }
  })())
})
