(function () {
  'use strict';

  const state = {
    suppliers: [],
    products: [],
    purchaseOrders: [],
    receivingOrders: [],
    selectedReceivingId: null,
    detail: null
  };

  document.addEventListener('DOMContentLoaded', () => {
    byId('reloadButton').addEventListener('click', loadAll);
    byId('createPoButton').addEventListener('click', createPurchaseOrder);
    byId('scanButton').addEventListener('click', submitReceivingScan);
    byId('completeReceivingButton').addEventListener('click', completeReceiving);
    byId('scanStatus').addEventListener('change', updateScanStatusDefaults);
    setDefaultPoValues();
    loadAll();
  });

  async function loadAll() {
    try {
      const [suppliers, products, purchaseOrders, receivingOrders] = await Promise.all([
        requestJson('/api/suppliers'),
        requestJson('/api/products'),
        requestJson('/api/purchase-orders'),
        requestJson('/api/receiving-orders')
      ]);
      state.suppliers = asArray(suppliers);
      state.products = asArray(products);
      state.purchaseOrders = asArray(purchaseOrders);
      state.receivingOrders = asArray(receivingOrders);
      renderMasterOptions();
      renderPurchaseOrders();
      renderReceivingOrders();
      renderKpis();
      if (state.selectedReceivingId) await loadReceivingDetail(state.selectedReceivingId);
    } catch (error) {
      notify(error.message, 'ng');
      byId('purchaseOrderList').innerHTML = `<div class="text-danger small p-3">${escapeHtml(error.message)}</div>`;
      byId('receivingOrderList').innerHTML = `<div class="text-danger small p-3">${escapeHtml(error.message)}</div>`;
    }
  }

  async function createPurchaseOrder() {
    const supplierId = Number(byId('poSupplier').value);
    const productId = Number(byId('poProduct').value);
    const quantity = Number(byId('poQuantity').value || 0);
    const poNumber = byId('poNumber').value.trim();
    if (!supplierId || !productId || !quantity || !poNumber) {
      notify('仕入先、発注番号、品目、数量を入力してください', 'ng');
      return;
    }

    try {
      const created = await requestJson('/api/purchase-orders', {
        method: 'POST',
        body: {
          purchase_order_no: poNumber,
          supplier_id: supplierId,
          expected_date: byId('poExpectedDate').value || null,
          lines: [{ product_id: productId, ordered_quantity: quantity }]
        }
      });
      const receiving = await requestJson(`/api/purchase-orders/${created.order.id}/create-receiving-order`, { method: 'POST', body: {} });
      notify('発注と入庫予定を作成しました', 'ok');
      setDefaultPoValues();
      await loadAll();
      if (receiving.receiving_order?.id) await loadReceivingDetail(receiving.receiving_order.id);
    } catch (error) {
      notify(error.message, 'ng');
    }
  }

  async function generateReceivingOrder(poId) {
    try {
      const result = await requestJson(`/api/purchase-orders/${poId}/create-receiving-order`, { method: 'POST', body: {} });
      notify(result.existing ? '既存の入庫予定を開きました' : '入庫予定を作成しました', 'ok');
      await loadAll();
      if (result.receiving_order?.id) await loadReceivingDetail(result.receiving_order.id);
    } catch (error) {
      notify(error.message, 'ng');
    }
  }

  async function loadReceivingDetail(id) {
    state.selectedReceivingId = Number(id);
    markSelectedReceiving();
    const data = await requestJson(`/api/receiving-orders/${id}`);
    state.detail = data;
    renderReceivingDetail();
  }

  async function submitReceivingScan() {
    if (!state.detail?.receiving_order) {
      notify('入庫予定を選択してください', 'ng');
      return;
    }
    const lineId = Number(byId('scanLine').value);
    const lot = byId('scanLot').value.trim();
    const quantity = Number(byId('scanQuantity').value || 0);
    if (!lineId || !lot || quantity <= 0) {
      notify('明細、ロット、数量を入力してください', 'ng');
      return;
    }

    const status = byId('scanStatus').value;
    const body = {
      receiving_order_line_id: lineId,
      qr_code: byId('scanQr').value.trim() || null,
      lot_number: lot,
      received_quantity: quantity,
      location_code: byId('scanLocation').value.trim() || 'RECEIVING',
      inspection_status: status,
      comment: byId('scanComment').value.trim() || null
    };
    if (status === 'accepted') body.accepted_quantity = quantity;
    if (status === 'rejected') body.rejected_quantity = quantity;

    try {
      await requestJson(`/api/receiving-orders/${state.detail.receiving_order.id}/scan`, { method: 'POST', body });
      notify('入庫を登録しました', 'ok');
      byId('scanQr').value = '';
      byId('scanLot').value = '';
      byId('scanQuantity').value = '1';
      byId('scanComment').value = '';
      await loadAll();
    } catch (error) {
      notify(error.message, 'ng');
    }
  }

  async function completeReceiving() {
    if (!state.detail?.receiving_order) return;
    try {
      await requestJson(`/api/receiving-orders/${state.detail.receiving_order.id}/complete`, {
        method: 'PATCH',
        body: { comment: '画面から入庫完了' }
      });
      notify('入庫予定を完了しました', 'ok');
      await loadAll();
    } catch (error) {
      notify(error.message, 'ng');
    }
  }

  function renderMasterOptions() {
    byId('poSupplier').innerHTML = state.suppliers.map((s) =>
      `<option value="${s.id}">${escapeHtml(s.supplier_code)} ${escapeHtml(s.supplier_name)}</option>`
    ).join('');
    byId('poProduct').innerHTML = state.products.map((p) =>
      `<option value="${p.id}">${escapeHtml(p.product_code)} ${escapeHtml(p.product_name)}</option>`
    ).join('');
  }

  function renderPurchaseOrders() {
    byId('poCount').textContent = `${state.purchaseOrders.length}件`;
    byId('purchaseOrderList').innerHTML = state.purchaseOrders.map((po) => `
      <article class="list-group-item">
        <div class="d-flex justify-content-between gap-2">
          <strong class="receiving-code">${escapeHtml(po.purchase_order_no)}</strong>
          <span class="badge ${badgeClass(po.status)}">${escapeHtml(statusLabel(po.status))}</span>
        </div>
        <div class="small">${escapeHtml(po.supplier_name || '-')}</div>
        <div class="small text-muted">数量 ${Number(po.received_quantity || 0)}/${Number(po.ordered_quantity || 0)} / 明細 ${Number(po.line_count || 0)}</div>
        <button class="btn btn-outline-primary btn-sm mt-2" type="button" data-create-receiving="${po.id}">
          <i class="fas fa-truck-ramp-box me-1"></i>入庫予定
        </button>
      </article>
    `).join('') || '<div class="text-muted small p-3">発注がありません</div>';
    byId('purchaseOrderList').querySelectorAll('[data-create-receiving]').forEach((button) => {
      button.addEventListener('click', () => generateReceivingOrder(button.dataset.createReceiving));
    });
  }

  function renderReceivingOrders() {
    byId('receivingCount').textContent = `${state.receivingOrders.length}件`;
    byId('receivingOrderList').innerHTML = state.receivingOrders.map((ro) => `
      <button class="list-group-item list-group-item-action" type="button" data-receiving-id="${ro.id}">
        <div class="d-flex justify-content-between gap-2">
          <strong class="receiving-code">${escapeHtml(ro.receiving_order_no)}</strong>
          <span class="badge ${badgeClass(ro.status)}">${escapeHtml(statusLabel(ro.status))}</span>
        </div>
        <div class="small">${escapeHtml(ro.supplier_name || '-')}</div>
        <div class="small text-muted">数量 ${Number(ro.received_quantity || 0)}/${Number(ro.expected_quantity || 0)}</div>
      </button>
    `).join('') || '<div class="text-muted small p-3">入庫予定がありません</div>';
    byId('receivingOrderList').querySelectorAll('[data-receiving-id]').forEach((button) => {
      button.addEventListener('click', () => loadReceivingDetail(button.dataset.receivingId).catch((error) => notify(error.message, 'ng')));
    });
    markSelectedReceiving();
  }

  function renderKpis() {
    const open = state.receivingOrders.filter((row) => row.status !== 'received').length;
    const expected = state.receivingOrders.reduce((sum, row) => sum + Number(row.expected_quantity || 0), 0);
    const received = state.receivingOrders.reduce((sum, row) => sum + Number(row.received_quantity || 0), 0);
    const kpis = [
      ['発注件数', state.purchaseOrders.length, 'fa-file-invoice'],
      ['未完入庫', open, 'fa-truck-ramp-box'],
      ['予定数量', expected, 'fa-boxes-stacked'],
      ['入庫済数量', received, 'fa-circle-check']
    ];
    byId('receivingKpis').innerHTML = kpis.map(([label, value, icon]) => `
      <div class="col-6 col-xl-3">
        <div class="receiving-kpi p-2 h-100">
          <div class="text-muted small"><i class="fas ${icon} me-1"></i>${escapeHtml(label)}</div>
          <div class="h4 mb-0">${Number(value || 0)}</div>
        </div>
      </div>
    `).join('');
  }

  function renderReceivingDetail() {
    const detail = state.detail;
    const order = detail.receiving_order;
    byId('receivingEmpty').classList.add('d-none');
    byId('receivingDetail').classList.remove('d-none');
    byId('receivingTitle').textContent = order.receiving_order_no;
    byId('receivingMeta').textContent = `${order.supplier_name || '-'} / 予定日 ${formatDate(order.expected_date)}`;
    byId('receivingStatus').className = `status-badge ${badgeClass(order.status)}`;
    byId('receivingStatus').textContent = statusLabel(order.status);

    byId('receivingLines').innerHTML = detail.lines.map((line) => {
      const remaining = Number(line.expected_quantity || 0) - Number(line.received_quantity || 0);
      return `
        <button class="list-group-item list-group-item-action receiving-line ${remaining <= 0 ? 'complete' : ''}" type="button" data-line-id="${line.id}">
          <div class="d-flex justify-content-between gap-2">
            <strong>${escapeHtml(line.product_code)} ${escapeHtml(line.product_name)}</strong>
            <span class="badge ${remaining <= 0 ? 'badge-ok' : 'badge-pending'}">${remaining <= 0 ? '完了' : `残 ${remaining}`}</span>
          </div>
          <div class="small text-muted">入庫 ${Number(line.received_quantity || 0)}/${Number(line.expected_quantity || 0)} / 合格 ${Number(line.accepted_quantity || 0)} / NG ${Number(line.rejected_quantity || 0)}</div>
        </button>
      `;
    }).join('');
    byId('receivingLines').querySelectorAll('[data-line-id]').forEach((button) => {
      button.addEventListener('click', () => selectLine(button.dataset.lineId));
    });

    byId('scanLine').innerHTML = detail.lines.map((line) => {
      const remaining = Number(line.expected_quantity || 0) - Number(line.received_quantity || 0);
      return `<option value="${line.id}" data-remaining="${remaining}">${escapeHtml(line.product_code)} ${escapeHtml(line.product_name)} / 残 ${remaining}</option>`;
    }).join('');
    const firstOpen = detail.lines.find((line) => Number(line.received_quantity || 0) < Number(line.expected_quantity || 0));
    if (firstOpen) selectLine(firstOpen.id);
    renderResults();
  }

  function renderResults() {
    const rows = asArray(state.detail?.results);
    if (!rows.length) {
      byId('receivingResults').innerHTML = '<div class="text-muted text-center py-4">入庫実績がありません</div>';
      return;
    }
    byId('receivingResults').innerHTML = `
      <table class="table table-sm table-hover mb-0">
        <thead class="table-light"><tr><th>日時</th><th>品目</th><th>ロット</th><th>QR</th><th class="text-end">入庫</th><th class="text-end">合格</th><th class="text-end">NG</th><th>場所</th></tr></thead>
        <tbody>${rows.map((row) => `
          <tr>
            <td class="small text-muted">${escapeHtml(formatDate(row.received_at))}</td>
            <td>${escapeHtml(row.product_code)} ${escapeHtml(row.product_name)}</td>
            <td><code>${escapeHtml(row.lot_number || '-')}</code></td>
            <td>${row.qr_code ? `<a href="traceability.html?type=qr&q=${encodeURIComponent(row.qr_code)}">${escapeHtml(row.qr_code)}</a>` : '<span class="text-muted">-</span>'}</td>
            <td class="text-end">${Number(row.received_quantity || 0)}</td>
            <td class="text-end">${Number(row.accepted_quantity || 0)}</td>
            <td class="text-end">${Number(row.rejected_quantity || 0)}</td>
            <td>${escapeHtml(row.location_code || '-')}</td>
          </tr>`).join('')}</tbody>
      </table>`;
  }

  function selectLine(lineId) {
    byId('scanLine').value = String(lineId);
    const option = byId('scanLine').selectedOptions[0];
    const remaining = Number(option?.dataset.remaining || 1);
    byId('scanQuantity').value = String(Math.max(1, remaining));
    const line = state.detail?.lines?.find((item) => Number(item.id) === Number(lineId));
    if (line && !byId('scanLot').value) {
      byId('scanLot').value = `RCV-${line.product_code}-${dateStamp()}`;
    }
  }

  function updateScanStatusDefaults() {
    if (byId('scanStatus').value === 'accepted' && !byId('scanLocation').value) {
      byId('scanLocation').value = 'RECEIVING';
    }
  }

  function markSelectedReceiving() {
    byId('receivingOrderList').querySelectorAll('[data-receiving-id]').forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.receivingId) === Number(state.selectedReceivingId));
    });
  }

  function setDefaultPoValues() {
    const now = new Date();
    byId('poNumber').value = `PO-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const expected = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    byId('poExpectedDate').value = `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}`;
    byId('poQuantity').value = '1';
  }

  async function requestJson(path, options = {}) {
    const init = { method: options.method || 'GET', headers: { Accept: 'application/json' } };
    if (options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    const res = await fetch(path, init);
    const data = await readJson(res);
    if (!res.ok) throw new Error(data.error || `処理に失敗しました (HTTP ${res.status})`);
    return data;
  }

  async function readJson(res) {
    try { return await res.json(); } catch { return {}; }
  }

  function statusLabel(status) {
    const labels = { ordered: '発注済', pending: '未入庫', in_progress: '入庫中', partial: '一部', received: '完了' };
    return labels[status] || status || '-';
  }

  function badgeClass(status) {
    const key = String(status || '').toLowerCase();
    if (key.includes('received') || key.includes('complete')) return 'badge-ok';
    if (key.includes('progress') || key.includes('partial')) return 'badge-progress';
    if (key.includes('reject') || key.includes('cancel')) return 'badge-ng';
    return 'badge-pending';
  }

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('ja-JP');
  }

  function dateStamp() {
    const now = new Date();
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
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
