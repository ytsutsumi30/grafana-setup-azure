/*
 * オフライン送信キュー(IndexedDB)
 * スキャン結果など更新系 POST をオフライン時にローカル保存し、
 * オンライン復帰時に自動再送する。UI には未送信件数を表示できる。
 *
 * 使い方:
 *   await OfflineQueue.submit('/api/qr-inspections/123/scan', { qr: 'QR-...' });
 *     → オンラインなら即送信。失敗/オフラインならキューへ保存し {queued:true} を返す。
 *   OfflineQueue.onChange(count => ...)  未送信件数の変化を購読
 */
(function () {
  const DB_NAME = 'prj3-offline';
  const STORE = 'queue';
  const listeners = [];

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(db, mode) {
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  async function add(item) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const r = tx(db, 'readwrite').add(item);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function all() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const r = tx(db, 'readonly').getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  }
  async function remove(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const r = tx(db, 'readwrite').delete(id);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  }

  async function notify() {
    let count = 0;
    try { count = (await all()).length; } catch (e) { /* ignore */ }
    listeners.forEach((fn) => { try { fn(count); } catch (e) { /* ignore */ } });
    return count;
  }

  async function sendOne(item) {
    const res = await fetch(item.url, {
      method: item.method || 'POST',
      headers: { 'Content-Type': 'application/json', ...(item.headers || {}) },
      body: item.body === undefined ? undefined : JSON.stringify(item.body)
    });
    // 4xx(バリデーション等)は再送しても成功しないためキューから除去する。
    // 5xx / ネットワーク失敗のみ再送対象として残す。
    if (res.ok || (res.status >= 400 && res.status < 500)) return true;
    throw new Error('retryable status ' + res.status);
  }

  const OfflineQueue = {
    /**
     * 更新系リクエストを送る。オンラインなら即送信、失敗時はキューへ。
     * @returns {Promise<{sent:boolean, queued:boolean, status?:number}>}
     */
    async submit(url, body, opts = {}) {
      const item = { url, method: opts.method || 'POST', body, headers: opts.headers || {}, ts: Date.now() };
      if (navigator.onLine) {
        try {
          const res = await fetch(url, {
            method: item.method,
            headers: { 'Content-Type': 'application/json', ...item.headers },
            body: body === undefined ? undefined : JSON.stringify(body)
          });
          if (res.ok || (res.status >= 400 && res.status < 500)) {
            return { sent: true, queued: false, status: res.status };
          }
        } catch (e) { /* fall through to queue */ }
      }
      await add(item);
      await notify();
      if (typeof window.showToast === 'function') {
        window.showToast('オフラインのため保存しました(復帰後に自動送信)', 'info');
      }
      return { sent: false, queued: true };
    },

    /** キューを再送する(オンライン時)。 */
    async flush() {
      if (!navigator.onLine) return;
      const items = await all();
      for (const item of items) {
        try {
          await sendOne(item);
          await remove(item.id);
        } catch (e) {
          break; // まだオフライン/一時障害。次の online で再試行
        }
      }
      const remaining = await notify();
      if (remaining === 0 && items.length > 0 && typeof window.showToast === 'function') {
        window.showToast('保留していた送信を完了しました', 'ok');
      }
    },

    async pendingCount() { return notify(); },
    onChange(fn) { listeners.push(fn); notify(); }
  };

  window.OfflineQueue = OfflineQueue;

  // オンライン復帰で自動再送
  window.addEventListener('online', () => OfflineQueue.flush());
  // 起動時に未送信があれば再送を試みる
  if (navigator.onLine) OfflineQueue.flush();
})();
