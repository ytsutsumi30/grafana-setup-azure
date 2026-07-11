/*
 * 出荷検品システム Service Worker
 * - アプリシェル(HTML/CSS/JS/vendor)は cache-first(オフラインでも表示)
 * - API GET は network-first(最新優先、失敗時は最終取得値)
 * - API の更新系(POST/PUT/PATCH/DELETE)はキャッシュせず、失敗はアプリ側キューへ委ねる
 * キャッシュ版を上げるときは CACHE_VERSION を変更する。
 */
const CACHE_VERSION = 'v28';
const SHELL_CACHE = 'prj3-shell-' + CACHE_VERSION;
const API_CACHE = 'prj3-api-' + CACHE_VERSION;

// 事前キャッシュするアプリシェル(存在するものだけ、失敗は無視)
const SHELL_ASSETS = [
  '/index.html',
  '/shipping-history.html',
  '/shipping-report.html',
  '/shipping-instruction-detail.html',
  '/traceability.html',
  '/inventory-foundation.html',
  '/purchase-receiving.html',
  '/sales-shipping.html',
  '/shipping-quantity.html',
  '/pps.html',
  '/css/tokens.css',
  '/css/components.css',
  '/css/pages/shipping-report.css',
  '/css/pages/shipping-instructions.css',
  '/css/pages/shipping-quantity.css',
  '/css/pages/shipping-locations.css',
  '/css/pages/delivery-locations.css',
  '/css/pages/inspectors.css',
  '/css/pages/production-plans.css',
  '/css/pages/product-components.css',
  '/css/pages/shipping-instruction-detail.css',
  '/css/pages/traceability.css',
  '/css/pages/inventory-foundation.css',
  '/css/pages/purchase-receiving.css',
  '/css/pages/sales-shipping.css',
  '/js/layout.js',
  '/js/pages/shipping-history.js',
  '/js/pages/shipping-instructions.js',
  '/js/pages/shipping-quantity.js',
  '/js/pages/shipping-locations.js',
  '/js/pages/delivery-locations.js',
  '/js/pages/inspectors.js',
  '/js/pages/production-plans.js',
  '/js/pages/product-components.js',
  '/js/pages/shipping-report.js',
  '/js/pages/shipping-instruction-detail.js',
  '/js/pages/traceability.js',
  '/js/pages/inventory-foundation.js',
  '/js/pages/purchase-receiving.js',
  '/js/pages/sales-shipping.js',
  '/js/m365-auth.js',
  '/js/offline-queue.js',
  '/vendor/bootstrap/css/bootstrap.min.css',
  '/vendor/bootstrap/js/bootstrap.bundle.min.js',
  '/vendor/fontawesome/css/all.min.css',
  '/vendor/msal/msal-browser.min.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.allSettled(SHELL_ASSETS.map((u) => cache.add(u)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== API_CACHE).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isApi(url) {
  return url.pathname.startsWith('/api/') || url.pathname === '/api';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 同一オリジンのみ扱う
  if (url.origin !== self.location.origin) return;

  // 更新系は SW で扱わない(アプリ側のオフラインキューに委譲)
  if (req.method !== 'GET') return;

  if (isApi(url)) {
    // API GET: network-first、失敗時はキャッシュ
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(API_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || new Response(
          JSON.stringify({ error: 'offline', offline: true }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )))
    );
    return;
  }

  // HTML(ページ遷移・.html): network-first。常に最新UIを表示し、オフライン時のみキャッシュ。
  const isHtml = req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/';
  if (isHtml) {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((c) => c || caches.match('/index.html')))
    );
    return;
  }

  // 静的アセット(CSS/JS/vendor): cache-first、無ければ取得してキャッシュ
  event.respondWith(
    caches.match(req).then((cached) =>
      cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => cached)
    )
  );
});
