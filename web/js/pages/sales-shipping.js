(function () {
  'use strict';

  const state = {
    products: [],
    salesOrders: [],
    selectedSalesOrderId: null,
    detail: null
  };

  document.addEventListener('DOMContentLoaded', () => {
    byId('reloadButton').addEventListener('click', loadAll);
    byId('createSalesOrderButton').addEventListener('click', createSalesOrder);
    byId('createShippingButton').addEventListener('click', createShippingInstruction);
    setDefaults();
    loadAll();
  });

  async function loadAll() {
    try {
      const [products, salesOrders] = await Promise.all([
        requestJson('/api/products'),
        requestJson('/api/sales-orders')
      ]);
      state.products = asArray(products);
      state.salesOrders = asArray(salesOrders);
      renderProductOptions();
      renderSalesOrders();
      renderKpis();
      if (state.selectedSalesOrderId) await loadSalesDetail(state.selectedSalesOrderId);
    } catch (error) {
      notify(error.message, 'ng');
      byId('salesOrderList').innerHTML = `<div class="text-danger small p-3">${escapeHtml(error.message)}</div>`;
    }
  }

  async function createSalesOrder() {
    const productId = Number(byId('salesProduct').value);
    const quantity = Number(byId('salesQuantity').value || 0);
    const salesOrderNo = byId('salesOrderNo').value.trim();
    const customerName = byId('customerName').value.trim();
    if (!productId || !quantity || !salesOrderNo || !customerName) {
      notify('受注番号、顧客名、品目、数量を入力してください', 'ng');
      return;
    }

    try {
      const created = await requestJson('/api/sales-orders', {
        method: 'POST',
        body: {
          sales_order_no: salesOrderNo,
          customer_name: customerName,
          requested_ship_date: byId('requestedShipDate').value || null,
          priority: byId('salesPriority').value,
          lines: [{ product_id: productId, ordered_quantity: quantity }]
        }
      });
      notify('受注を作成しました', 'ok');
      setDefaults();
      await loadAll();
      if (created.order?.id) await loadSalesDetail(created.order.id);
    } catch (error) {
      notify(error.message, 'ng');
    }
  }

  async function createShippingInstruction() {
    if (!state.detail?.order) {
      notify('受注を選択してください', 'ng');
      return;
    }
    try {
      const result = await requestJson(`/api/sales-orders/${state.detail.order.id}/create-shipping-instruction`, {
        method: 'POST',
        body: {}
      });
      notify(result.existing ? '既存の出荷指示を表示します' : '出荷指示を生成しました', 'ok');
      await loadAll();
    } catch (error) {
      notify(error.message, 'ng');
    }
  }

  async function loadSalesDetail(id) {
    state.selectedSalesOrderId = Number(id);
    markSelectedSalesOrder();
    const data = await requestJson(`/api/sales-orders/${id}`);
    state.detail = data;
    renderSalesDetail();
  }

  function renderProductOptions() {
    byId('salesProduct').innerHTML = state.products.map((p) =>
      `<option value="${p.id}">${escapeHtml(p.product_code)} ${escapeHtml(p.product_name)} / 在庫 ${Number(p.available_stock ?? p.current_stock ?? 0)}</option>`
    ).join('');
  }

  function renderSalesOrders() {
    byId('salesOrderCount').textContent = `${state.salesOrders.length}件`;
    byId('salesOrderList').innerHTML = state.salesOrders.map((so) => `
      <button class="list-group-item list-group-item-action" type="button" data-sales-id="${so.id}">
        <div class="d-flex justify-content-between gap-2">
          <strong class="sales-code">${escapeHtml(so.sales_order_no)}</strong>
          <span class="badge ${badgeClass(so.status)}">${escapeHtml(statusLabel(so.status))}</span>
        </div>
        <div class="small">${escapeHtml(so.customer_name || '-')}</div>
        <div class="small text-muted">数量 ${Number(so.shipped_quantity || 0)}/${Number(so.ordered_quantity || 0)} / 出荷指示 ${Number(so.shipping_instruction_count || 0)}</div>
      </button>
    `).join('') || '<div class="text-muted small p-3">受注がありません</div>';
    byId('salesOrderList').querySelectorAll('[data-sales-id]').forEach((button) => {
      button.addEventListener('click', () => loadSalesDetail(button.dataset.salesId).catch((error) => notify(error.message, 'ng')));
    });
    markSelectedSalesOrder();
  }

  function renderKpis() {
    const open = state.salesOrders.filter((row) => row.status !== 'shipped' && row.status !== 'delivered').length;
    const ordered = state.salesOrders.reduce((sum, row) => sum + Number(row.ordered_quantity || 0), 0);
    const planned = state.salesOrders.reduce((sum, row) => sum + Number(row.shipping_instruction_count || 0), 0);
    const kpis = [
      ['受注件数', state.salesOrders.length, 'fa-file-contract'],
      ['未完受注', open, 'fa-hourglass-half'],
      ['受注数量', ordered, 'fa-boxes-stacked'],
      ['出荷指示数', planned, 'fa-truck-fast']
    ];
    byId('salesKpis').innerHTML = kpis.map(([label, value, icon]) => `
      <div class="col-6 col-xl-3">
        <div class="sales-kpi p-2 h-100">
          <div class="text-muted small"><i class="fas ${icon} me-1"></i>${escapeHtml(label)}</div>
          <div class="h4 mb-0">${Number(value || 0)}</div>
        </div>
      </div>`).join('');
  }

  function renderSalesDetail() {
    const detail = state.detail;
    const order = detail.order;
    byId('salesEmpty').classList.add('d-none');
    byId('salesDetail').classList.remove('d-none');
    byId('salesTitle').textContent = order.sales_order_no;
    byId('salesMeta').textContent = `${order.customer_name || '-'} / 希望出荷日 ${formatDate(order.requested_ship_date)} / ${priorityLabel(order.priority)}`;
    byId('salesStatus').className = `status-badge ${badgeClass(order.status)}`;
    byId('salesStatus').textContent = statusLabel(order.status);

    byId('salesLines').innerHTML = detail.lines.map((line) => {
      const remaining = Number(line.ordered_quantity || 0) - Number(line.shipped_quantity || 0);
      return `
        <article class="list-group-item sales-line ${remaining <= 0 ? 'complete' : ''}">
          <div class="d-flex justify-content-between gap-2">
            <strong>${escapeHtml(line.product_code)} ${escapeHtml(line.product_name)}</strong>
            <span class="badge ${remaining <= 0 ? 'badge-ok' : 'badge-pending'}">${remaining <= 0 ? '完了' : `未出荷 ${remaining}`}</span>
          </div>
          <div class="small text-muted">受注 ${Number(line.ordered_quantity || 0)} / 出荷済 ${Number(line.shipped_quantity || 0)}</div>
        </article>`;
    }).join('');

    byId('shippingInstructionList').innerHTML = detail.shipping_instructions.map((si) => `
      <a class="list-group-item list-group-item-action" href="shipping-quantity.html?id=${encodeURIComponent(si.id)}">
        <div class="d-flex justify-content-between gap-2">
          <strong class="sales-code">${escapeHtml(si.instruction_id)}</strong>
          <span class="badge ${badgeClass(si.status)}">${escapeHtml(statusLabel(si.status))}</span>
        </div>
        <div class="small text-muted">出荷日 ${formatDate(si.shipping_date)} / 作成 ${formatDate(si.created_at)}</div>
      </a>
    `).join('') || '<div class="text-muted small p-3">出荷指示はまだありません</div>';
  }

  function markSelectedSalesOrder() {
    byId('salesOrderList').querySelectorAll('[data-sales-id]').forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.salesId) === Number(state.selectedSalesOrderId));
    });
  }

  function setDefaults() {
    const now = new Date();
    byId('salesOrderNo').value = `SO-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const ship = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    byId('requestedShipDate').value = `${ship.getFullYear()}-${pad(ship.getMonth() + 1)}-${pad(ship.getDate())}`;
    byId('salesQuantity').value = '1';
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
    const labels = { confirmed: '確定', planned: '出荷計画済', pending: '未着手', picking: 'ピッキング', shipped: '出荷済', delivered: '配達済' };
    return labels[status] || status || '-';
  }

  function priorityLabel(priority) {
    const labels = { high: '高優先', normal: '通常', low: '低優先' };
    return labels[priority] || priority || '-';
  }

  function badgeClass(status) {
    const key = String(status || '').toLowerCase();
    if (key.includes('shipped') || key.includes('delivered') || key.includes('planned')) return 'badge-ok';
    if (key.includes('picking') || key.includes('processing')) return 'badge-progress';
    if (key.includes('cancel') || key.includes('ng')) return 'badge-ng';
    return 'badge-pending';
  }

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('ja-JP');
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
