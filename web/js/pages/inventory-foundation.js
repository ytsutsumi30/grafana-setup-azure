(function () {
  'use strict';

  const state = {
    balances: [],
    transactions: [],
    inventoryStatus: '',
    sortKey: 'product',
    sortDirection: 'asc',
    expandedBalanceKey: null,
    inventoryRequestToken: 0,
    qrRequestToken: 0
  };

  document.addEventListener('DOMContentLoaded', () => {
    byId('inventoryReloadButton').addEventListener('click', loadInventoryFoundation);
    byId('inventoryClearFiltersButton').addEventListener('click', clearFilters);
    byId('inventoryStatusFilters').addEventListener('click', (event) => {
      const button = event.target.closest('[data-inventory-status]');
      if (!button) return;
      setInventoryStatus(button.dataset.inventoryStatus || '');
      loadInventoryFoundation();
    });
    document.querySelector('.inventory-balance-table thead').addEventListener('click', (event) => {
      const button = event.target.closest('[data-inventory-sort]');
      if (!button) return;
      setSort(button.dataset.inventorySort);
    });
    byId('inventoryBalanceBody').addEventListener('click', (event) => {
      const button = event.target.closest('[data-balance-key]');
      if (!button) return;
      state.expandedBalanceKey = state.expandedBalanceKey === button.dataset.balanceKey
        ? null
        : button.dataset.balanceKey;
      renderBalances();
    });
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-inventory-retry]')) loadInventoryFoundation();
      if (event.target.closest('[data-inventory-clear]')) clearFilters();
    });
    byId('qrLookupButton').addEventListener('click', lookupQr);
    byId('qrLookupInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        lookupQr();
      }
    });
    ['inventoryLotFilter', 'inventoryLocationFilter'].forEach((id) => {
      byId(id).addEventListener('change', loadInventoryFoundation);
      byId(id).addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          loadInventoryFoundation();
        }
      });
    });
    loadInventoryFoundation();
  });

  async function loadInventoryFoundation() {
    const requestToken = ++state.inventoryRequestToken;
    const params = new URLSearchParams();
    const lot = byId('inventoryLotFilter').value.trim();
    const location = byId('inventoryLocationFilter').value.trim();
    const status = state.inventoryStatus;
    if (lot) params.set('lot_number', lot);
    if (location) params.set('location_code', location);
    if (status) params.set('inventory_status', status);

    renderLoading();
    setReloading(true);
    try {
      const txParams = new URLSearchParams();
      if (lot) txParams.set('lot_number', lot);
      const [balanceResult, transactionResult] = await Promise.allSettled([
        requestJson(`/api/inventory/balances?${params.toString()}`),
        requestJson(`/api/inventory/transactions?${txParams.toString()}`)
      ]);
      if (requestToken !== state.inventoryRequestToken) return;
      const failures = [];
      if (balanceResult.status === 'fulfilled') {
        state.balances = Array.isArray(balanceResult.value) ? balanceResult.value : [];
        renderKpis();
        renderBalances();
      } else {
        state.balances = [];
        failures.push(`在庫残高: ${balanceResult.reason.message}`);
        renderBalanceLoadError(balanceResult.reason.message);
      }
      if (transactionResult.status === 'fulfilled') {
        state.transactions = Array.isArray(transactionResult.value) ? transactionResult.value : [];
        renderTransactions();
      } else {
        state.transactions = [];
        failures.push(`在庫移動: ${transactionResult.reason.message}`);
        renderTransactionLoadError(transactionResult.reason.message);
      }
      renderLastUpdated(failures.length > 0);
      if (failures.length) notify(failures.join(' / '), 'ng');
    } catch (error) {
      if (requestToken !== state.inventoryRequestToken) return;
      notify(error.message, 'ng');
      renderBalanceLoadError(error.message);
      renderTransactionLoadError(error.message);
      byId('inventoryLastUpdated').textContent = '同期エラー';
    } finally {
      if (requestToken === state.inventoryRequestToken) setReloading(false);
    }
  }

  function setInventoryStatus(value) {
    state.inventoryStatus = value;
    document.querySelectorAll('[data-inventory-status]').forEach((button) => {
      const active = button.dataset.inventoryStatus === value;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function clearFilters() {
    byId('inventoryLotFilter').value = '';
    byId('inventoryLocationFilter').value = '';
    setInventoryStatus('');
    loadInventoryFoundation();
  }

  function setReloading(isLoading) {
    const button = byId('inventoryReloadButton');
    button.disabled = isLoading;
    button.querySelector('i').classList.toggle('fa-spin', isLoading);
    button.querySelector('span').textContent = isLoading ? '更新中' : '更新';
  }

  async function lookupQr() {
    const qr = byId('qrLookupInput').value.trim();
    if (!qr) {
      notify('QRコードを入力してください', 'ng');
      return;
    }

    const requestToken = ++state.qrRequestToken;
    setQrLookupLoading(true);
    setScannerState('idle', '照会中');
    byId('qrLookupResult').innerHTML = '<div class="inventory-empty-compact"><i class="fas fa-circle-notch fa-spin"></i><span>照会中...</span></div>';
    try {
      const data = await requestJson(`/api/qr-units/${encodeURIComponent(qr)}`);
      if (requestToken !== state.qrRequestToken) return;
      byId('qrLookupResult').innerHTML = `
        <article class="inventory-qr-result-summary">
          <div class="d-flex justify-content-between gap-2 align-items-start">
            <strong class="inventory-code">${escapeHtml(data.qr_code)}</strong>
            <span class="badge ${badgeClass(data.inventory_status || data.status)}">${escapeHtml(statusLabel(data.inventory_status || data.status))}</span>
          </div>
          <div class="mt-2">${escapeHtml(productLabel(data))}</div>
          <div class="small text-muted">ロット <code>${escapeHtml(data.lot_number || '-')}</code></div>
          <div class="inventory-qr-metrics">
            <div class="inventory-qr-metric"><div class="inventory-detail-label">現在残高</div><div class="inventory-qr-metric-value">${numberText(data.balance_quantity ?? data.quantity)}</div></div>
            <div class="inventory-qr-metric"><div class="inventory-detail-label">現在地</div><div class="inventory-qr-metric-value">${escapeHtml(data.current_location_code || data.location_name || '-')}</div></div>
          </div>
          <a class="btn btn-outline-primary w-100 mt-3" href="traceability.html?type=qr&q=${encodeURIComponent(data.qr_code)}">
            <i class="fas fa-route me-1"></i>トレースを開く
          </a>
        </article>`;
      setScannerState('success', '照会成功');
      playScanFeedback('success');
    } catch (error) {
      if (requestToken !== state.qrRequestToken) return;
      byId('qrLookupResult').innerHTML = `<div class="inventory-empty-compact text-danger"><i class="fas fa-circle-exclamation"></i><span>${escapeHtml(error.message)}</span></div>`;
      setScannerState('error', '照会失敗');
      playScanFeedback('error');
      notify(error.message, 'ng');
    } finally {
      if (requestToken === state.qrRequestToken) {
        setQrLookupLoading(false);
        byId('qrLookupInput').focus();
      }
    }
  }

  function setQrLookupLoading(isLoading) {
    const button = byId('qrLookupButton');
    button.disabled = isLoading;
    button.querySelector('i').className = `fas ${isLoading ? 'fa-circle-notch fa-spin' : 'fa-magnifying-glass'} me-1`;
    button.querySelector('span').textContent = isLoading ? '照会中' : '照会';
  }

  function setScannerState(value, label) {
    const panel = byId('qrScannerPanel');
    const status = byId('qrScannerStatus');
    panel.dataset.scanState = value;
    status.innerHTML = `<i class="fas fa-circle"></i>${escapeHtml(label)}`;
    status.className = `inventory-scanner-status is-${value}`;
    if (value !== 'idle') {
      window.setTimeout(() => {
        panel.dataset.scanState = 'idle';
      }, 700);
    }
  }

  function playScanFeedback(type) {
    const success = type === 'success';
    if (navigator.vibrate) navigator.vibrate(success ? [80] : [120, 80, 120]);
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      const context = new AudioContext();
      const beep = (frequency, startsAt) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.08, context.currentTime + startsAt);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + startsAt + 0.1);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(context.currentTime + startsAt);
        oscillator.stop(context.currentTime + startsAt + 0.11);
      };
      beep(success ? 880 : 220, 0);
      if (!success) beep(180, 0.16);
      window.setTimeout(() => context.close(), success ? 250 : 450);
    } catch { /* 音声非対応でも画面とバイブのフィードバックは継続する */ }
  }

  function renderLoading() {
    byId('inventoryBalanceBody').innerHTML = Array.from({ length: 5 }, () => `
      <tr class="inventory-table-skeleton" aria-hidden="true">
        <td colspan="7"><div class="inventory-skeleton-line"></div><div class="inventory-skeleton-line w-50"></div></td>
      </tr>`).join('');
    byId('inventoryMobileList').innerHTML = Array.from({ length: 3 }, () => `
      <div class="inventory-mobile-card" aria-hidden="true"><div class="inventory-skeleton-line"></div><div class="inventory-skeleton-line w-75"></div></div>`).join('');
    byId('inventoryTransactionList').innerHTML = Array.from({ length: 4 }, () => `
      <div class="inventory-timeline-item" aria-hidden="true"><span class="inventory-timeline-node"></span><div class="inventory-timeline-content"><div class="inventory-skeleton-line"></div><div class="inventory-skeleton-line w-75"></div></div></div>`).join('');
  }

  function loadErrorHtml(title, message) {
    return `<div class="inventory-state is-error">
      <span class="inventory-state-icon"><i class="fas fa-triangle-exclamation"></i></span>
      <strong>${escapeHtml(title)}</strong>
      <span class="small">${escapeHtml(message)}</span>
      <button class="btn btn-outline-danger" type="button" data-inventory-retry><i class="fas fa-rotate me-1"></i>再試行</button>
    </div>`;
  }

  function renderBalanceLoadError(message) {
    const stateHtml = loadErrorHtml('在庫残高を取得できませんでした', message);
    byId('inventoryBalanceBody').innerHTML = `<tr><td colspan="7">${stateHtml}</td></tr>`;
    byId('inventoryMobileList').innerHTML = stateHtml;
    byId('inventoryBalanceCount').textContent = '取得失敗';
    byId('inventoryKpis').innerHTML = stateHtml;
  }

  function renderTransactionLoadError(message) {
    const stateHtml = loadErrorHtml('在庫移動を取得できませんでした', message);
    byId('inventoryTransactionList').innerHTML = stateHtml;
    byId('inventoryTransactionCount').textContent = '取得失敗';
  }

  function renderKpis() {
    const totalQty = state.balances.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const lots = new Set(state.balances.map((row) => row.lot_number).filter(Boolean)).size;
    const qrRows = state.balances.filter((row) => row.qr_code).length;
    const holdQty = state.balances
      .filter((row) => !['available', 'reserved'].includes(String(row.inventory_status || '').toLowerCase()))
      .reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const kpis = [
      ['総在庫数量', totalQty, 'fa-cubes', false],
      ['ロット数', lots, 'fa-boxes-stacked', false],
      ['QR単位', qrRows, 'fa-qrcode', false],
      ['保留・不良', holdQty, 'fa-triangle-exclamation', holdQty > 0]
    ];
    byId('inventoryKpis').innerHTML = kpis.map(([label, value, icon, isAlert]) => `
      <article class="inventory-kpi${isAlert ? ' is-alert' : ''}">
        <div class="inventory-kpi-label"><i class="fas ${icon}"></i>${escapeHtml(label)}</div>
        <div class="inventory-kpi-value">${Number(value || 0).toLocaleString('ja-JP')}</div>
      </article>`).join('');
  }

  function renderLastUpdated(partialFailure = false) {
    const prefix = partialFailure ? '一部同期エラー' : '最終同期';
    byId('inventoryLastUpdated').textContent = `${prefix} ${new Date().toLocaleTimeString('ja-JP', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    })}`;
  }

  function renderBalances() {
    byId('inventoryBalanceCount').textContent = `${state.balances.length}件`;
    if (!state.balances.length) {
      const filtered = hasActiveFilters();
      const emptyHtml = `<div class="inventory-state">
        <span class="inventory-state-icon"><i class="fas ${filtered ? 'fa-filter-circle-xmark' : 'fa-box-open'}"></i></span>
        <strong>${filtered ? '条件に一致する在庫はありません' : '在庫残高はまだありません'}</strong>
        ${filtered ? '<button class="btn btn-outline-secondary" type="button" data-inventory-clear><i class="fas fa-filter-circle-xmark me-1"></i>条件を解除</button>' : ''}
      </div>`;
      byId('inventoryBalanceBody').innerHTML = `<tr><td colspan="7">${emptyHtml}</td></tr>`;
      byId('inventoryMobileList').innerHTML = emptyHtml;
      return;
    }
    const rows = [...state.balances].sort(compareBalances);
    renderMobileBalances(rows);
    byId('inventoryBalanceBody').innerHTML = rows.map((row, index) => {
      const rowKey = String(row.id ?? `${row.product_id || 'product'}-${row.lot_number || 'lot'}-${index}`);
      const expanded = state.expandedBalanceKey === rowKey;
      return `
      <tr class="inventory-balance-row${expanded ? ' is-expanded' : ''}">
        <td><div class="inventory-product-cell">
          <button class="inventory-row-toggle" type="button" data-balance-key="${escapeHtml(rowKey)}" aria-expanded="${expanded}" aria-label="${escapeHtml(productLabel(row))}の詳細を${expanded ? '閉じる' : '開く'}"><i class="fas fa-chevron-right"></i></button>
          <div><div class="inventory-product-code">${escapeHtml(row.product_code || '-')}</div><div class="inventory-product-name">${escapeHtml(row.product_name || '-')}</div></div>
        </div></td>
        <td>${code(row.lot_number)}</td>
        <td>${row.qr_code ? `<a href="traceability.html?type=qr&q=${encodeURIComponent(row.qr_code)}" class="inventory-code">${escapeHtml(row.qr_code)}</a>` : '<span class="text-muted">-</span>'}</td>
        <td>${escapeHtml(row.location_code || row.location_name || '-')}</td>
        <td><span class="badge ${badgeClass(row.inventory_status)}">${escapeHtml(statusLabel(row.inventory_status))}</span></td>
        <td class="text-end"><span class="inventory-quantity">${Number(row.quantity || 0).toLocaleString('ja-JP')}</span></td>
        <td class="small text-muted">${escapeHtml(formatDate(row.updated_at))}</td>
      </tr>${expanded ? renderBalanceDetail(row) : ''}`;
    }).join('');
  }

  function renderMobileBalances(rows) {
    byId('inventoryMobileList').innerHTML = rows.map((row) => {
      const traceType = row.qr_code ? 'qr' : 'lot';
      const traceValue = row.qr_code || row.lot_number || '';
      return `<article class="inventory-mobile-card">
        <div class="inventory-mobile-card-header">
          <div><div class="inventory-product-code">${escapeHtml(row.product_code || '-')}</div><div class="inventory-product-name">${escapeHtml(row.product_name || '-')}</div></div>
          <div class="inventory-mobile-quantity">${Number(row.quantity || 0).toLocaleString('ja-JP')}</div>
        </div>
        <div class="mt-2"><span class="badge ${badgeClass(row.inventory_status)}">${escapeHtml(statusLabel(row.inventory_status))}</span></div>
        <div class="inventory-mobile-meta">
          <div><div class="inventory-detail-label">ロット</div><div class="inventory-detail-value inventory-code">${escapeHtml(row.lot_number || '-')}</div></div>
          <div><div class="inventory-detail-label">場所</div><div class="inventory-detail-value">${escapeHtml(row.location_code || row.location_name || '-')}</div></div>
          <div><div class="inventory-detail-label">QR</div><div class="inventory-detail-value inventory-code">${escapeHtml(row.qr_code || '-')}</div></div>
          <div><div class="inventory-detail-label">更新日時</div><div class="inventory-detail-value">${escapeHtml(formatDate(row.updated_at))}</div></div>
        </div>
        <div class="inventory-mobile-actions"><a class="btn btn-outline-primary w-100" href="traceability.html?type=${traceType}&q=${encodeURIComponent(traceValue)}"><i class="fas fa-route me-1"></i>トレース</a></div>
      </article>`;
    }).join('');
  }

  function hasActiveFilters() {
    return Boolean(byId('inventoryLotFilter').value.trim()
      || byId('inventoryLocationFilter').value.trim()
      || state.inventoryStatus);
  }

  function renderBalanceDetail(row) {
    const traceType = row.qr_code ? 'qr' : 'lot';
    const traceValue = row.qr_code || row.lot_number || '';
    return `<tr class="inventory-detail-row"><td colspan="7">
      <div class="inventory-row-detail">
        <div><div class="inventory-detail-label">品目ID</div><div class="inventory-detail-value">${escapeHtml(row.product_id || '-')}</div></div>
        <div><div class="inventory-detail-label">ロット在庫ID</div><div class="inventory-detail-value">${escapeHtml(row.lot_inventory_id || '-')}</div></div>
        <div><div class="inventory-detail-label">QR単位ID</div><div class="inventory-detail-value">${escapeHtml(row.qr_unit_id || '-')}</div></div>
        <div><div class="inventory-detail-label">最終トランザクション</div><div class="inventory-detail-value">${escapeHtml(row.last_transaction_id || '-')}</div></div>
        <a class="btn btn-outline-primary" href="traceability.html?type=${traceType}&q=${encodeURIComponent(traceValue)}"><i class="fas fa-route me-1"></i>トレース</a>
      </div>
    </td></tr>`;
  }

  function setSort(key) {
    if (state.sortKey === key) {
      state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortKey = key;
      state.sortDirection = 'asc';
    }
    document.querySelectorAll('[data-inventory-sort]').forEach((button) => {
      const active = button.dataset.inventorySort === state.sortKey;
      button.classList.toggle('is-active', active);
      button.querySelector('i').className = `fas ${active
        ? (state.sortDirection === 'asc' ? 'fa-arrow-up-short-wide' : 'fa-arrow-down-wide-short')
        : 'fa-sort'}`;
    });
    renderBalances();
  }

  function compareBalances(a, b) {
    const values = {
      product: (row) => `${row.product_code || ''} ${row.product_name || ''}`,
      lot: (row) => row.lot_number || '',
      location: (row) => row.location_code || row.location_name || '',
      status: (row) => row.inventory_status || '',
      quantity: (row) => Number(row.quantity || 0),
      updated: (row) => new Date(row.updated_at || 0).getTime()
    };
    const getter = values[state.sortKey] || values.product;
    const left = getter(a);
    const right = getter(b);
    const result = typeof left === 'number'
      ? left - right
      : String(left).localeCompare(String(right), 'ja');
    return state.sortDirection === 'asc' ? result : -result;
  }

  function renderTransactions() {
    const rows = state.transactions.slice(0, 20);
    byId('inventoryTransactionCount').textContent = `${state.transactions.length}件`;
    if (!rows.length) {
      byId('inventoryTransactionList').innerHTML = '<div class="inventory-empty-compact m-3"><i class="fas fa-right-left"></i><span>在庫移動がありません</span></div>';
      return;
    }
    byId('inventoryTransactionList').innerHTML = rows.map((row) => {
      const quantity = Number(row.quantity_delta || 0);
      const tone = transactionTone(row.transaction_type, quantity);
      return `
      <a class="inventory-timeline-item ${tone.className}" href="traceability.html?type=lot&q=${encodeURIComponent(row.lot_number || '')}">
        <span class="inventory-timeline-node"><i class="fas ${tone.icon}"></i></span>
        <div class="inventory-timeline-content">
          <div class="inventory-timeline-title">
            <strong>${escapeHtml(transactionLabel(row.transaction_type))}</strong>
            <span class="inventory-delta">${quantity > 0 ? '+' : ''}${quantity.toLocaleString('ja-JP')}</span>
          </div>
          <div class="inventory-timeline-product">${escapeHtml(productLabel(row))}</div>
          <div class="inventory-timeline-meta">
            <span><i class="fas fa-box me-1"></i>${escapeHtml(row.lot_number || '-')}</span>
            <span><i class="fas fa-location-dot me-1"></i>${escapeHtml(row.location_code || '-')}</span>
            <time><i class="fas fa-clock me-1"></i>${escapeHtml(formatDate(row.occurred_at))}</time>
          </div>
        </div>
      </a>`;
    }).join('');
  }

  function transactionTone(type, quantity) {
    const key = String(type || '').toLowerCase();
    if (key.includes('adjustment') || key.includes('count')) {
      return { className: 'is-adjustment', icon: 'fa-sliders' };
    }
    if (quantity < 0 || key.includes('issue') || key.includes('consumption')) {
      return { className: 'is-outbound', icon: 'fa-arrow-up' };
    }
    return { className: 'is-inbound', icon: 'fa-arrow-down' };
  }

  async function requestJson(path) {
    const res = await fetch(path, { headers: { Accept: 'application/json' } });
    const data = await readJson(res);
    if (!res.ok) throw new Error(data.error || `取得に失敗しました (HTTP ${res.status})`);
    return data;
  }

  async function readJson(res) {
    try { return await res.json(); } catch { return {}; }
  }

  function productLabel(row) {
    return [row.product_code, row.product_name].filter(Boolean).join(' ') || '-';
  }

  function statusLabel(value) {
    const labels = {
      available: '利用可能',
      reserved: '引当済',
      on_hold: '保留',
      defective: '不良',
      hold: '保留',
      damaged: '不良'
    };
    return labels[value] || value || '-';
  }

  function transactionLabel(value) {
    const labels = {
      receipt: '入庫',
      issue: '出庫',
      adjustment: '調整',
      manufacturing_consumption: '製造投入',
      manufacturing_receipt: '製造受入',
      inventory_count_adjustment: '棚卸差異'
    };
    return labels[value] || value || '-';
  }

  function badgeClass(value) {
    const key = String(value || '').toLowerCase();
    if (key.includes('available') || key.includes('posted') || key.includes('active')) return 'badge-ok';
    if (key.includes('reserved') || key.includes('hold')) return 'badge-pending';
    if (key.includes('damage') || key.includes('defective') || key.includes('ng')) return 'badge-ng';
    return 'badge-progress';
  }

  function code(value) {
    return value ? `<code class="inventory-code">${escapeHtml(value)}</code>` : '<span class="text-muted">-</span>';
  }

  function numberText(value) {
    if (value === null || value === undefined || value === '') return '-';
    return String(Number(value));
  }

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('ja-JP', { hour12: false });
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function notify(message, type) {
    if (window.showToast) window.showToast(message, type);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }
})();
