(function () {
  'use strict';

  const CONFIG_URL = '/api/auth/m365/config';
  const ME_URL = '/api/auth/m365/me';
  const MSAL_SCRIPT = '/vendor/msal/msal-browser.min.js';
  const originalFetch = window.fetch.bind(window);

  let config = null;
  let msalApp = null;
  let activeAccount = null;
  let initialized = false;
  let readyPromise = null;
  let loginPromise = null;

  function isSameOriginApi(input) {
    const raw = typeof input === 'string' ? input : input && input.url;
    if (!raw) return false;
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin) return false;
    if (url.pathname === CONFIG_URL || url.pathname === ME_URL) return false;
    return url.pathname.startsWith('/api/') ||
      /^\/(products|production-plans|shipping-locations|delivery-locations|shipping-instructions|shipping-instruction-lines|shipping-inspections|shipping-lots|product-components|qr-inspections|inspectors|reports|qc-tools|inventory|database|logs|new-qc|monitoring|lot-inventory|picking-instructions|packing-records|system-config|ocr)(\/|$)/.test(url.pathname);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.msal) return resolve();
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('MSAL script load failed: ' + src));
      document.head.appendChild(script);
    });
  }

  function ensureStyle() {
    if (document.getElementById('m365-auth-style')) return;
    const style = document.createElement('style');
    style.id = 'm365-auth-style';
    style.textContent = `
      .m365-auth-bar{position:fixed;right:16px;top:12px;z-index:2147483000;background:#fff;border:1px solid #d0d7de;border-radius:8px;box-shadow:0 8px 20px rgba(0,0,0,.12);padding:8px 10px;font:13px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;gap:8px;align-items:center}
      .m365-auth-bar button,.m365-auth-overlay button{border:0;border-radius:6px;background:#0f6cbd;color:#fff;padding:7px 10px;cursor:pointer;font-weight:600}
      .m365-auth-bar button.secondary{background:#f3f4f6;color:#24292f;border:1px solid #d0d7de}
      .m365-auth-overlay{position:fixed;inset:0;z-index:2147482999;background:rgba(248,250,252,.96);display:flex;align-items:center;justify-content:center;padding:24px}
      .m365-auth-panel{max-width:420px;background:#fff;border:1px solid #d0d7de;border-radius:10px;box-shadow:0 16px 40px rgba(0,0,0,.16);padding:24px;font:14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .m365-auth-panel h2{margin:0 0 10px;font-size:20px}
      .m365-auth-panel p{line-height:1.6;color:#4b5563}
      .m365-auth-error{margin-top:12px;color:#b42318}
    `;
    document.head.appendChild(style);
  }

  function showBar(user) {
    ensureStyle();
    let bar = document.getElementById('m365-auth-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'm365-auth-bar';
      bar.className = 'm365-auth-bar';
      document.body.appendChild(bar);
    }
    const name = user && (user.displayName || user.username || user.mail || user.userPrincipalName) || 'M365';
    bar.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = name;
    const signOut = document.createElement('button');
    signOut.className = 'secondary';
    signOut.type = 'button';
    signOut.textContent = 'サインアウト';
    signOut.addEventListener('click', () => {
      if (msalApp && activeAccount) {
        msalApp.logoutPopup({ account: activeAccount }).finally(() => window.location.reload());
      }
    });
    bar.append(label, signOut);
  }

  async function showRequiredOverlay() {
    ensureStyle();
    await new Promise((resolve) => {
      if (document.body) return resolve();
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });

    let overlay = document.getElementById('m365-auth-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'm365-auth-overlay';
      overlay.className = 'm365-auth-overlay';
      overlay.innerHTML = `
        <div class="m365-auth-panel">
          <h2>Microsoft 365 サインイン</h2>
          <p>出荷検品システムを利用するには、組織の Microsoft 365 アカウントでサインインしてください。</p>
          <button type="button" id="m365-auth-login">サインイン</button>
          <div class="m365-auth-error" id="m365-auth-error" hidden></div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    return new Promise((resolve) => {
      const button = document.getElementById('m365-auth-login');
      const error = document.getElementById('m365-auth-error');
      button.onclick = async () => {
        try {
          await signIn();
          overlay.remove();
          resolve();
        } catch (e) {
          error.hidden = false;
          error.textContent = 'サインインに失敗しました。ブラウザのポップアップ許可と Azure アプリ設定を確認してください。';
        }
      };
    });
  }

  async function showFatalAuthError(message) {
    ensureStyle();
    await new Promise((resolve) => {
      if (document.body) return resolve();
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
    let overlay = document.getElementById('m365-auth-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'm365-auth-overlay';
      overlay.className = 'm365-auth-overlay';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="m365-auth-panel">
        <h2>Microsoft 365 認証エラー</h2>
        <p>${message}</p>
        <button type="button" id="m365-auth-reload">再読み込み</button>
      </div>
    `;
    document.getElementById('m365-auth-reload').onclick = () => window.location.reload();
  }

  async function signIn() {
    if (!msalApp || !config || !config.enabled) return null;
    if (loginPromise) return loginPromise;
    loginPromise = msalApp.loginPopup({ scopes: config.scopes || ['User.Read'] })
      .then((result) => {
        activeAccount = result.account;
        msalApp.setActiveAccount(activeAccount);
        showBar(activeAccount);
        return activeAccount;
      })
      .finally(() => {
        loginPromise = null;
      });
    return loginPromise;
  }

  async function getAccessToken() {
    if (!config || !config.enabled || !msalApp) return null;
    activeAccount = msalApp.getActiveAccount() || msalApp.getAllAccounts()[0] || activeAccount;
    if (!activeAccount) {
      if (config.required) await showRequiredOverlay();
      activeAccount = msalApp.getActiveAccount() || msalApp.getAllAccounts()[0] || activeAccount;
      if (!activeAccount) return null;
    }
    try {
      const result = await msalApp.acquireTokenSilent({
        account: activeAccount,
        scopes: config.scopes || ['User.Read']
      });
      return result.accessToken;
    } catch (e) {
      const result = await msalApp.acquireTokenPopup({ scopes: config.scopes || ['User.Read'] });
      activeAccount = result.account;
      msalApp.setActiveAccount(activeAccount);
      showBar(activeAccount);
      return result.accessToken;
    }
  }

  async function init() {
    if (initialized) return;
    initialized = true;
    try {
      const response = await originalFetch(CONFIG_URL, { cache: 'no-store' });
      config = await response.json();
      window.m365AuthConfig = config;
      if (!config.enabled) return;

      await loadScript(MSAL_SCRIPT);
      msalApp = new window.msal.PublicClientApplication({
        auth: {
          clientId: config.clientId,
          authority: config.authority,
          redirectUri: window.location.origin
        },
        cache: {
          cacheLocation: config.cacheLocation || 'localStorage',
          storeAuthStateInCookie: false
        }
      });
      await msalApp.initialize?.();
      await msalApp.handleRedirectPromise?.();
      activeAccount = msalApp.getActiveAccount() || msalApp.getAllAccounts()[0] || null;
      if (activeAccount) {
        msalApp.setActiveAccount(activeAccount);
        showBar(activeAccount);
      } else if (config.required) {
        await showRequiredOverlay();
      }
    } catch (e) {
      console.warn('[M365 Auth] initialization failed', e);
      if (config && config.enabled && config.required) {
        await showFatalAuthError('Microsoft 365 認証ライブラリの読み込みに失敗しました。画面を再読み込みしてください。');
      }
    }
  }

  readyPromise = init();

  window.m365Auth = {
    ready: () => readyPromise,
    signIn,
    getAccessToken,
    getAccount: () => activeAccount,
    getConfig: () => config
  };

  window.fetch = async function (input, initOptions) {
    if (!isSameOriginApi(input)) {
      return originalFetch(input, initOptions);
    }

    await readyPromise;
    const token = await getAccessToken();
    const options = Object.assign({}, initOptions || {});
    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    options.headers = headers;

    let response = await originalFetch(input, options);
    if (response.status === 401 && config && config.enabled) {
      await signIn();
      const retryToken = await getAccessToken();
      if (retryToken) {
        headers.set('Authorization', `Bearer ${retryToken}`);
        response = await originalFetch(input, options);
      }
    }
    return response;
  };
})();
