(function () {
  'use strict';

  const state = {
    products: [],
    salesOrders: [],
    selectedSalesOrderId: null,
    detail: null,
    detailRequestToken: 0,
    masterDataReady: false,
    isCreatingSalesOrder: false,
    isCreatingShippingInstruction: false
  };

  document.addEventListener('DOMContentLoaded', () => {
    byId('reloadButton').addEventListener('click', loadAll);
    byId('createSalesOrderButton').addEventListener('click', createSalesOrder);
    byId('createShippingButton').addEventListener('click', createShippingInstruction);
    byId('addSalesLineButton').addEventListener('click', addSalesLine);
    byId('salesOrderLines').addEventListener('click', handleLineEditorClick);
    byId('salesOrderLines').addEventListener('input', renderLineSummary);
    byId('salesBackButton').addEventListener('click', () => byId('salesQueue').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    setDefaults();
    renderLineSummary();
    loadAll();
  });

  async function loadAll() {
    state.masterDataReady = false;
    try {
      const [products, salesOrders] = await Promise.all([
        requestJson('/api/products'),
        requestJson('/api/sales-orders')
      ]);
      state.products = asArray(products);
      state.salesOrders = asArray(salesOrders);
      state.masterDataReady = true;
      renderProductOptions();
      byId('createSalesOrderButton').disabled = state.products.length === 0;
      byId('addSalesLineButton').disabled = state.products.length === 0;
      renderSalesOrders();
      renderKpis();
      if (state.selectedSalesOrderId) await loadSalesDetail(state.selectedSalesOrderId);
    } catch (error) {
      notify(error.message, 'ng');
      state.detailRequestToken += 1;
      state.detail = null;
      clearSalesDetail();
      if (state.selectedSalesOrderId) setDetailState('error', error.message);
      byId('createSalesOrderButton').disabled = true;
      byId('addSalesLineButton').disabled = true;
      byId('createShippingButton').disabled = true;
      byId('salesOrderList').innerHTML = `<div class="text-danger small p-3">${escapeHtml(error.message)}</div>`;
    }
  }

  async function createSalesOrder() {
    if (state.isCreatingSalesOrder) return;
    if (!state.masterDataReady) {
      notify('品目マスタを再取得してから登録してください', 'ng');
      return;
    }
    const salesOrderNo = byId('salesOrderNo').value.trim();
    const customerName = byId('customerName').value.trim();
    const lines = collectSalesLines();
    if (!salesOrderNo || !customerName || !lines.length || lines.some((line) => !line.product_id || line.ordered_quantity <= 0)) {
      notify('受注番号、顧客名と、全明細の品目・数量を入力してください', 'ng');
      return;
    }
    if (hasDuplicateProducts(lines)) {
      notify('同じ品目が複数行にあります。数量を1明細にまとめてください', 'ng');
      return;
    }

    const button = byId('createSalesOrderButton');
    state.isCreatingSalesOrder = true;
    setButtonBusy(button, true, '登録中');
    try {
      const created = await requestJson('/api/sales-orders', {
        method: 'POST',
        body: {
          sales_order_no: salesOrderNo,
          customer_name: customerName,
          requested_ship_date: byId('requestedShipDate').value || null,
          priority: byId('salesPriority').value,
          lines
        }
      });
      notify(`${lines.length}品目の受注を作成しました`, 'ok');
      setDefaults();
      resetSalesLines();
      await loadAll();
      if (created.order?.id) await loadSalesDetail(created.order.id);
    } catch (error) {
      notify(error.message, 'ng');
    } finally {
      state.isCreatingSalesOrder = false;
      setButtonBusy(button, false, '', !state.masterDataReady);
    }
  }

  async function createShippingInstruction() {
    if (state.isCreatingShippingInstruction) return;
    if (!state.detail?.order) {
      notify('受注を選択してください', 'ng');
      return;
    }
    const existingInstruction = asArray(state.detail.shipping_instructions)[0];
    if (existingInstruction?.id) {
      window.location.href = `shipping-quantity.html?id=${encodeURIComponent(existingInstruction.id)}`;
      return;
    }
    const orderId = state.detail.order.id;
    const button = byId('createShippingButton');
    state.isCreatingShippingInstruction = true;
    setButtonBusy(button, true, '生成中');
    try {
      const result = await requestJson(`/api/sales-orders/${orderId}/create-shipping-instruction`, {
        method: 'POST',
        body: {}
      });
      notify(result.existing ? '既存の出荷指示を表示します' : '出荷指示を生成しました', 'ok');
      await loadAll();
    } catch (error) {
      notify(error.message, 'ng');
    } finally {
      state.isCreatingShippingInstruction = false;
      setButtonBusy(button, false, '', !state.detail?.order);
      if (state.detail?.order) renderSalesDetail();
    }
  }

  async function loadSalesDetail(id) {
    const selectedId = Number(id);
    const requestToken = ++state.detailRequestToken;
    state.selectedSalesOrderId = selectedId;
    state.detail = null;
    markSelectedSalesOrder();
    clearSalesDetail();
    setDetailState('loading', '受注明細を読み込んでいます');
    byId('createShippingButton').disabled = true;
    try {
      const data = await requestJson(`/api/sales-orders/${selectedId}`);
      if (requestToken !== state.detailRequestToken) return;
      state.detail = data;
      setDetailState('ready');
      renderSalesDetail();
      if (window.matchMedia('(max-width: 1199.98px)').matches) {
        byId('salesWorkspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (error) {
      if (requestToken !== state.detailRequestToken) return;
      state.detail = null;
      setDetailState('error', error.message);
      throw error;
    }
  }

  function renderProductOptions() {
    byId('salesOrderLines').querySelectorAll('[data-line-product]').forEach((select) => {
      const selected = select.value;
      select.innerHTML = productOptions(selected);
    });
  }

  function productOptions(selectedValue = '') {
    return state.products.map((product) => {
      const selected = String(product.id) === String(selectedValue) ? ' selected' : '';
      const stock = Number(product.available_stock ?? product.current_stock ?? 0);
      return `<option value="${product.id}"${selected}>${escapeHtml(product.product_code)} ${escapeHtml(product.product_name)} / 在庫 ${stock}</option>`;
    }).join('');
  }

  function addSalesLine() {
    if (!state.masterDataReady) return;
    const row = document.createElement('div');
    row.className = 'order-line-row';
    row.dataset.orderLine = '';
    row.innerHTML = `
      <span class="order-line-index" aria-hidden="true"></span>
      <div class="order-line-product">
        <label class="form-label">品目</label>
        <select class="form-select form-select-lg" data-line-product>${productOptions()}</select>
      </div>
      <div class="order-line-quantity">
        <label class="form-label">数量</label>
        <input class="form-control form-control-lg" data-line-quantity type="number" min="1" step="1" value="1">
      </div>
      <button class="btn btn-outline-danger order-line-remove" data-remove-line type="button" title="明細を削除" aria-label="明細を削除">
        <i class="fas fa-trash"></i>
      </button>`;
    byId('salesOrderLines').appendChild(row);
    updateSalesLineRows();
    row.querySelector('[data-line-product]').focus();
  }

  function handleLineEditorClick(event) {
    const button = event.target.closest('[data-remove-line]');
    if (!button || button.disabled) return;
    button.closest('[data-order-line]')?.remove();
    updateSalesLineRows();
  }

  function updateSalesLineRows() {
    const rows = [...byId('salesOrderLines').querySelectorAll('[data-order-line]')];
    rows.forEach((row, index) => {
      row.querySelector('.order-line-index').textContent = String(index + 1);
      const suffix = index === 0 ? '' : `-${index + 1}`;
      const product = row.querySelector('[data-line-product]');
      const quantity = row.querySelector('[data-line-quantity]');
      const productId = `salesProduct${suffix}`;
      const quantityId = `salesQuantity${suffix}`;
      product.id = productId;
      quantity.id = quantityId;
      row.querySelector('.order-line-product label').htmlFor = productId;
      row.querySelector('.order-line-quantity label').htmlFor = quantityId;
      const removeButton = row.querySelector('[data-remove-line]');
      removeButton.disabled = rows.length === 1;
    });
    renderLineSummary();
  }

  function resetSalesLines() {
    const rows = [...byId('salesOrderLines').querySelectorAll('[data-order-line]')];
    rows.slice(1).forEach((row) => row.remove());
    const first = rows[0];
    if (first) {
      first.querySelector('[data-line-product]').innerHTML = productOptions();
      first.querySelector('[data-line-quantity]').value = '1';
    }
    updateSalesLineRows();
  }

  function collectSalesLines() {
    return [...byId('salesOrderLines').querySelectorAll('[data-order-line]')].map((row) => ({
      product_id: Number(row.querySelector('[data-line-product]').value),
      ordered_quantity: Number(row.querySelector('[data-line-quantity]').value || 0)
    }));
  }

  function hasDuplicateProducts(lines) {
    const productIds = lines.map((line) => line.product_id).filter(Boolean);
    return new Set(productIds).size !== productIds.length;
  }

  function renderLineSummary() {
    const lines = collectSalesLines();
    const quantity = lines.reduce((sum, line) => sum + Math.max(0, line.ordered_quantity || 0), 0);
    byId('salesLineSummary').textContent = `${lines.length}品目 / 合計${quantity}`;
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
    const shippingInstructions = asArray(detail.shipping_instructions);
    const shippingButton = byId('createShippingButton');
    const locked = ['shipped', 'delivered'].includes(String(order.status || '').toLowerCase());
    shippingButton.disabled = locked;
    shippingButton.innerHTML = shippingInstructions.length
      ? '<i class="fas fa-arrow-up-right-from-square me-1"></i>出荷指示を確認'
      : '<i class="fas fa-truck-fast me-1"></i>出荷指示生成';
    if (locked) shippingButton.title = '出荷完了済みのため新しい出荷指示は生成できません';
    else shippingButton.removeAttribute('title');

    byId('salesLines').innerHTML = asArray(detail.lines).map((line) => {
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

    byId('shippingInstructionList').innerHTML = shippingInstructions.map((si) => `
      <a class="list-group-item list-group-item-action" href="shipping-quantity.html?id=${encodeURIComponent(si.id)}">
        <div class="d-flex justify-content-between gap-2">
          <strong class="sales-code">${escapeHtml(si.instruction_id)}</strong>
          <span class="badge ${badgeClass(si.status)}">${escapeHtml(statusLabel(si.status))}</span>
        </div>
        <div class="small text-muted">出荷日 ${formatDate(si.shipping_date)} / 作成 ${formatDate(si.created_at)}</div>
      </a>
    `).join('') || '<div class="text-muted small p-3">出荷指示はまだありません</div>';
    renderProcessStrip(order, shippingInstructions);
  }

  function setDetailState(type, message = '') {
    const statePanel = byId('salesDetailState');
    byId('salesDetail').classList.add('d-none');
    byId('salesEmpty').classList.add('d-none');
    if (type === 'ready') {
      statePanel.classList.add('d-none');
      return;
    }
    statePanel.className = `app-state is-${type}`;
    statePanel.innerHTML = type === 'loading'
      ? '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><strong>受注明細を読み込んでいます</strong>'
      : `<i class="fas fa-triangle-exclamation" aria-hidden="true"></i><div><strong>受注明細を表示できません</strong><div class="small">${escapeHtml(message)}</div></div><button class="btn btn-outline-danger" type="button" data-detail-retry><i class="fas fa-rotate me-1"></i>再試行</button>`;
    statePanel.classList.remove('d-none');
    statePanel.querySelector('[data-detail-retry]')?.addEventListener('click', () => {
      if (state.selectedSalesOrderId) loadSalesDetail(state.selectedSalesOrderId).catch((error) => notify(error.message, 'ng'));
    });
  }

  function clearSalesDetail() {
    byId('salesTitle').textContent = '';
    byId('salesMeta').textContent = '';
    byId('salesStatus').textContent = '未選択';
    byId('salesLines').innerHTML = '';
    byId('shippingInstructionList').innerHTML = '';
    byId('salesProcess').querySelectorAll('li').forEach((step) => {
      step.classList.remove('is-complete', 'is-current');
    });
  }

  function renderProcessStrip(order, shippingInstructions) {
    const status = String(order.status || '').toLowerCase();
    let currentIndex = 0;
    if (shippingInstructions.length || ['planned', 'picking', 'processing', 'shipped', 'delivered'].includes(status)) currentIndex = 1;
    if (shippingInstructions.some((item) => ['picking', 'processing'].includes(String(item.status || '').toLowerCase()))) currentIndex = 2;
    if (shippingInstructions.some((item) => String(item.status || '').toLowerCase() === 'inspected')) currentIndex = 3;
    if (['shipped', 'delivered'].includes(status) || shippingInstructions.some((item) => ['shipped', 'delivered'].includes(String(item.status || '').toLowerCase()))) currentIndex = 4;
    byId('salesProcess').querySelectorAll('li').forEach((step, index) => {
      step.classList.toggle('is-complete', index < currentIndex || currentIndex === 4);
      step.classList.toggle('is-current', index === currentIndex && currentIndex < 4);
    });
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
    const firstQuantity = byId('salesOrderLines').querySelector('[data-line-quantity]');
    if (firstQuantity) firstQuantity.value = '1';
  }

  async function requestJson(path, options = {}) {
    const init = {
      method: options.method || 'GET',
      headers: { Accept: 'application/json', ...(options.headers || {}) }
    };
    if (options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    const res = await fetch(path, init);
    const data = await readJson(res);
    if (!res.ok) throw new Error(data.error || `処理に失敗しました (HTTP ${res.status})`);
    return data;
  }

  function setButtonBusy(button, busy, busyLabel = '', disabledWhenIdle = false) {
    if (!button) return;
    if (busy) {
      button.dataset.idleHtml = button.innerHTML;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.innerHTML = `<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>${escapeHtml(busyLabel)}`;
      return;
    }
    if (button.dataset.idleHtml) {
      button.innerHTML = button.dataset.idleHtml;
      delete button.dataset.idleHtml;
    }
    button.disabled = disabledWhenIdle;
    button.removeAttribute('aria-busy');
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
