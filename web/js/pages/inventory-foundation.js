(function () {
  'use strict';

  const state = {
    balances: [],
    transactions: []
  };

  document.addEventListener('DOMContentLoaded', () => {
    byId('inventoryReloadButton').addEventListener('click', loadInventoryFoundation);
    byId('qrLookupButton').addEventListener('click', lookupQr);
    byId('qrLookupInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') lookupQr();
    });
    ['inventoryLotFilter', 'inventoryLocationFilter', 'inventoryStatusFilter'].forEach((id) => {
      byId(id).addEventListener('change', loadInventoryFoundation);
      byId(id).addEventListener('keydown', (event) => {
        if (event.key === 'Enter') loadInventoryFoundation();
      });
    });
    loadInventoryFoundation();
  });

  async function loadInventoryFoundation() {
    const params = new URLSearchParams();
    const lot = byId('inventoryLotFilter').value.trim();
    const location = byId('inventoryLocationFilter').value.trim();
    const status = byId('inventoryStatusFilter').value;
    if (lot) params.set('lot_number', lot);
    if (location) params.set('location_code', location);
    if (status) params.set('inventory_status', status);

    renderLoading();
    try {
      const txParams = new URLSearchParams();
      if (lot) txParams.set('lot_number', lot);
      const [balances, transactions] = await Promise.all([
        requestJson(`/api/inventory/balances?${params.toString()}`),
        requestJson(`/api/inventory/transactions?${txParams.toString()}`)
      ]);
      state.balances = Array.isArray(balances) ? balances : [];
      state.transactions = Array.isArray(transactions) ? transactions : [];
      renderKpis();
      renderBalances();
      renderTransactions();
    } catch (error) {
      notify(error.message, 'ng');
      byId('inventoryBalanceBody').innerHTML = `<tr><td colspan="7" class="text-danger text-center py-4">${escapeHtml(error.message)}</td></tr>`;
      byId('inventoryTransactionList').innerHTML = `<div class="text-danger small p-3">${escapeHtml(error.message)}</div>`;
    }
  }

  async function lookupQr() {
    const qr = byId('qrLookupInput').value.trim();
    if (!qr) {
      notify('QRコードを入力してください', 'ng');
      return;
    }

    byId('qrLookupResult').innerHTML = '<div class="text-muted small">照会中...</div>';
    try {
      const data = await requestJson(`/api/qr-units/${encodeURIComponent(qr)}`);
      byId('qrLookupResult').innerHTML = `
        <article class="border rounded p-3">
          <div class="d-flex justify-content-between gap-2 align-items-start">
            <strong class="inventory-code">${escapeHtml(data.qr_code)}</strong>
            <span class="badge ${badgeClass(data.inventory_status || data.status)}">${escapeHtml(data.inventory_status || data.status || '-')}</span>
          </div>
          <div class="mt-2">${escapeHtml(productLabel(data))}</div>
          <div class="small text-muted">ロット <code>${escapeHtml(data.lot_number || '-')}</code></div>
          <div class="row g-2 mt-2">
            <div class="col-6"><div class="inventory-kpi p-2"><div class="text-muted small">残高</div><div class="h5 mb-0">${numberText(data.balance_quantity ?? data.quantity)}</div></div></div>
            <div class="col-6"><div class="inventory-kpi p-2"><div class="text-muted small">場所</div><div class="h6 mb-0">${escapeHtml(data.current_location_code || data.location_name || '-')}</div></div></div>
          </div>
          <a class="btn btn-outline-primary w-100 mt-3" href="traceability.html?type=qr&q=${encodeURIComponent(data.qr_code)}">
            <i class="fas fa-route me-1"></i>トレースを開く
          </a>
        </article>`;
    } catch (error) {
      byId('qrLookupResult').innerHTML = `<div class="text-danger small">${escapeHtml(error.message)}</div>`;
      notify(error.message, 'ng');
    }
  }

  function renderLoading() {
    byId('inventoryBalanceBody').innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">読み込み中...</td></tr>';
    byId('inventoryTransactionList').innerHTML = '<div class="text-muted small p-3">読み込み中...</div>';
  }

  function renderKpis() {
    const totalQty = state.balances.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const lots = new Set(state.balances.map((row) => row.lot_number).filter(Boolean)).size;
    const qrRows = state.balances.filter((row) => row.qr_code).length;
    const holdQty = state.balances
      .filter((row) => !['available', 'reserved'].includes(String(row.inventory_status || '').toLowerCase()))
      .reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const kpis = [
      ['総在庫数量', totalQty, 'fa-cubes'],
      ['ロット数', lots, 'fa-boxes-stacked'],
      ['QR単位', qrRows, 'fa-qrcode'],
      ['保留/不良数量', holdQty, 'fa-triangle-exclamation']
    ];
    byId('inventoryKpis').innerHTML = kpis.map(([label, value, icon]) => `
      <div class="col-6 col-xl-3">
        <div class="inventory-kpi p-2 h-100">
          <div class="text-muted small"><i class="fas ${icon} me-1"></i>${escapeHtml(label)}</div>
          <div class="h4 mb-0">${Number(value || 0)}</div>
        </div>
      </div>`).join('');
  }

  function renderBalances() {
    byId('inventoryBalanceCount').textContent = `${state.balances.length}件`;
    if (!state.balances.length) {
      byId('inventoryBalanceBody').innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">在庫残高がありません</td></tr>';
      return;
    }
    byId('inventoryBalanceBody').innerHTML = state.balances.map((row) => `
      <tr>
        <td>${escapeHtml(productLabel(row))}</td>
        <td>${code(row.lot_number)}</td>
        <td>${row.qr_code ? `<a href="traceability.html?type=qr&q=${encodeURIComponent(row.qr_code)}" class="inventory-code">${escapeHtml(row.qr_code)}</a>` : '<span class="text-muted">-</span>'}</td>
        <td>${escapeHtml(row.location_code || row.location_name || '-')}</td>
        <td><span class="badge ${badgeClass(row.inventory_status)}">${escapeHtml(statusLabel(row.inventory_status))}</span></td>
        <td class="text-end">${Number(row.quantity || 0)}</td>
        <td class="small text-muted">${escapeHtml(formatDate(row.updated_at))}</td>
      </tr>
    `).join('');
  }

  function renderTransactions() {
    const rows = state.transactions.slice(0, 20);
    byId('inventoryTransactionCount').textContent = `${state.transactions.length}件`;
    if (!rows.length) {
      byId('inventoryTransactionList').innerHTML = '<div class="text-muted small p-3">在庫移動がありません</div>';
      return;
    }
    byId('inventoryTransactionList').innerHTML = rows.map((row) => `
      <a class="list-group-item list-group-item-action inventory-transaction-item" href="traceability.html?type=lot&q=${encodeURIComponent(row.lot_number || '')}">
        <div class="d-flex justify-content-between gap-2">
          <strong>${escapeHtml(transactionLabel(row.transaction_type))}</strong>
          <span class="badge ${Number(row.quantity_delta || 0) < 0 ? 'badge-ng' : 'badge-ok'}">${Number(row.quantity_delta || 0)}</span>
        </div>
        <div class="small">${escapeHtml(productLabel(row))}</div>
        <div class="small text-muted">${escapeHtml(row.lot_number || '-')} / ${escapeHtml(row.location_code || '-')} / ${escapeHtml(formatDate(row.occurred_at))}</div>
      </a>
    `).join('');
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
    const labels = { available: '利用可能', reserved: '引当済', hold: '保留', damaged: '不良' };
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
    if (key.includes('damage') || key.includes('ng')) return 'badge-ng';
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
