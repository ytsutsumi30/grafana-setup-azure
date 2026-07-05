/*
 * prj3 共通レイアウト
 * 各ページの <body data-page="..."> と <script src="js/layout.js"> だけで、
 * 共通ヘッダー・ホームボタン・テーマ・トースト・作業者記憶を提供する。
 * ヘッダーは <main> の直前(body 先頭)に挿入される。
 */
(function () {
  // ページ登録(data-page -> 表示情報)。新規ページはここに 1 行追加する。
  var PAGES = {
    'inspection':          { title: '出荷検品システム', subtitle: '品質管理・出荷前最終検査', home: false },
    'maintenance':         { title: 'システムメンテナンス', subtitle: 'マスタデータの管理・メンテナンス' },
    'products':            { title: '製品マスタ', subtitle: '製品情報の管理' },
    'shipping-locations':  { title: '出荷元拠点', subtitle: '倉庫・工場の管理' },
    'delivery-locations':  { title: '配送先拠点', subtitle: '配送先の管理' },
    'product-components':  { title: '製品構成部品', subtitle: '部品とQRコードの管理' },
    'inspectors':          { title: '検品者マスタ', subtitle: '検品担当者の管理' },
    'shipping-instructions': { title: '出荷指示', subtitle: '出荷指示の管理' },
    'production-plans':    { title: '生産計画', subtitle: '生産計画の管理' },
    'inventory':           { title: '在庫', subtitle: '在庫の照会' },
    'monitoring':          { title: 'モニタリング', subtitle: '稼働・業務メトリクス' },
    'qc-dashboard':        { title: 'QCダッシュボード', subtitle: '品質分析' },
    'qc-analysis':         { title: 'QC分析', subtitle: '新QC7つ道具' },
    'pps':                 { title: 'PPS フロー', subtitle: 'ピッキング・梱包' },
    'qr-inspection':       { title: 'QR検品', subtitle: 'QRコード読み取り検品', home: true },
    'database':            { title: 'データベース', subtitle: '統計・バックアップ' },
    'system-config':       { title: 'システム設定', subtitle: '動作設定' }
  };

  function applyTheme() {
    var t = localStorage.getItem('prj3-theme') || 'light';
    document.documentElement.setAttribute('data-theme', t);
  }
  applyTheme();

  function buildHeader(page) {
    var info = PAGES[page] || { title: '出荷検品システム', subtitle: '' };
    var showHome = info.home !== false && page !== 'inspection';
    var header = document.createElement('div');
    header.className = 'app-header';
    header.innerHTML =
      '<div class="container">' +
        '<div class="row align-items-center">' +
          '<div class="col">' +
            '<h1><i class="fas fa-clipboard-check me-2"></i>' + info.title + '</h1>' +
            (info.subtitle ? '<p class="subtitle">' + info.subtitle + '</p>' : '') +
          '</div>' +
          '<div class="col-auto d-flex gap-2 align-items-center">' +
            (showHome ? '<a class="btn btn-light app-home-btn" href="index.html"><i class="fas fa-home"></i>ホーム</a>' : '') +
            '<button class="btn btn-light app-home-btn" type="button" data-theme-toggle title="テーマ切替"><i class="fas fa-circle-half-stroke"></i></button>' +
          '</div>' +
        '</div>' +
      '</div>';
    return header;
  }

  // PWA: manifest リンクと theme-color を注入(各ページを編集せず一括適用)
  function ensurePwaHead() {
    if (!document.querySelector('link[rel="manifest"]')) {
      var l = document.createElement('link');
      l.rel = 'manifest'; l.href = 'manifest.json';
      document.head.appendChild(l);
    }
    if (!document.querySelector('meta[name="theme-color"]')) {
      var m = document.createElement('meta');
      m.name = 'theme-color'; m.content = '#0d6efd';
      document.head.appendChild(m);
    }
  }

  // Service Worker 登録(オフライン対応)
  function registerSW() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
  }

  // オフラインバナー + 未送信件数インジケータ
  function setupOfflineUI() {
    var banner = document.createElement('div');
    banner.id = 'app-offline-banner';
    banner.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;z-index:1090;' +
      'background:var(--color-status-pending);color:#212529;text-align:center;' +
      'padding:0.4rem 1rem;font-size:0.9rem;font-weight:600;';
    banner.innerHTML = '<i class="fas fa-wifi"></i> オフライン: 操作は継続できます。送信は復帰後に自動再送されます ' +
      '<span id="app-pending-count"></span>';
    document.body.appendChild(banner);
    function render() { banner.style.display = navigator.onLine ? 'none' : 'block'; }
    window.addEventListener('online', render);
    window.addEventListener('offline', render);
    render();
    function subscribe() {
      if (window.OfflineQueue && typeof window.OfflineQueue.onChange === 'function') {
        window.OfflineQueue.onChange(function (count) {
          var el = document.getElementById('app-pending-count');
          if (el) el.textContent = count > 0 ? '(未送信 ' + count + ' 件)' : '';
        });
      }
    }
    if (window.OfflineQueue) {
      subscribe();
    } else {
      var s = document.createElement('script');
      s.src = 'js/offline-queue.js';
      s.onload = subscribe;
      document.head.appendChild(s);
    }
  }

  function mount() {
    ensurePwaHead();
    registerSW();
    setupOfflineUI();
    setupAuthUI();
    var page = document.body.getAttribute('data-page');
    // ヘッダー挿入は data-layout="auto" のページのみ(部分移行ページの二重ヘッダーを防ぐ)
    if (page && document.body.getAttribute('data-layout') === 'auto' && !document.querySelector('.app-header')) {
      document.body.insertBefore(buildHeader(page), document.body.firstChild);
    }
    // テーマ切替
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-theme-toggle]');
      if (!t) return;
      var cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      localStorage.setItem('prj3-theme', cur);
      document.documentElement.setAttribute('data-theme', cur);
    });
    // トーストコンテナ
    if (!document.querySelector('.app-toast-container')) {
      var c = document.createElement('div');
      c.className = 'app-toast-container';
      document.body.appendChild(c);
    }
  }

  // 認証UI(自前 OIDC / 案C): /api/auth/whoami で状態取得。
  // ウォール有効かつ未認証なら login.html へ誘導。認証済みは user+ログアウト、
  // 未認証(ウォール無効=ローカル等)はログイン導線を出す。
  function setupAuthUI() {
    fetch('/api/auth/whoami', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (info) {
        if (!info) return;
        // ウォール有効 & 未認証 → ログイン画面へ(login.html 自体は除外)
        if (info.wallEnabled && !info.authenticated &&
            location.pathname.indexOf('login.html') === -1) {
          location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname + location.search);
          return;
        }
        var slot = document.querySelector('.app-header .col-auto');
        if (!slot) return;
        var box = document.createElement('span');
        box.className = 'app-auth ms-2';
        if (info.authenticated && info.user) {
          var who = info.user.email || info.user.name || 'ユーザー';
          box.innerHTML =
            '<span class="text-white-50 me-2 small"><i class="fas fa-user me-1"></i>' + who + '</span>' +
            '<a class="btn btn-outline-light btn-sm" href="/api/auth/logout?redirect=/index.html">ログアウト</a>';
        } else if (info.providers && (info.providers.microsoft || info.providers.google)) {
          var r = encodeURIComponent(location.pathname);
          var h = '';
          if (info.providers.microsoft) h += '<a class="btn btn-outline-light btn-sm me-1" href="/api/auth/login/microsoft?redirect=' + r + '"><i class="fab fa-microsoft me-1"></i>M365</a>';
          if (info.providers.google) h += '<a class="btn btn-outline-light btn-sm" href="/api/auth/login/google?redirect=' + r + '"><i class="fab fa-google me-1"></i>Google</a>';
          box.innerHTML = h;
        } else {
          return; // プロバイダ未設定(ローカル等)は何も出さない
        }
        slot.appendChild(box);
      })
      .catch(function () { /* whoami 不在は無視 */ });
  }

  // 共通トースト(silent fail を避けるための通知)
  window.showToast = function (message, type) {
    var c = document.querySelector('.app-toast-container');
    if (!c) { c = document.createElement('div'); c.className = 'app-toast-container'; document.body.appendChild(c); }
    var el = document.createElement('div');
    el.className = 'app-toast ' + (type === 'ok' ? 'ok' : type === 'ng' ? 'ng' : 'info');
    el.textContent = message;
    c.appendChild(el);
    setTimeout(function () { el.remove(); }, 4000);
  };

  // 作業者(検品者)のセッション記憶。毎回選択させないため。
  window.getInspector = function () {
    try { return JSON.parse(localStorage.getItem('prj3-inspector') || 'null'); } catch (e) { return null; }
  };
  window.setInspector = function (obj) {
    localStorage.setItem('prj3-inspector', JSON.stringify(obj));
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
