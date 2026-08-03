(function () {
  'use strict';

  const state = {
    suppliers: [],
    products: [],
    masterDataReady: false,
    purchaseOrders: [],
    receivingOrders: [],
    selectedReceivingId: null,
    detail: null,
    detailRequestToken: 0,
    completionModal: null,
    isCompleting: false,
    isCreatingPurchaseOrder: false,
    creatingReceivingOrderIds: new Set(),
    isSubmittingScan: false,
    pendingScan: null
  };

  document.addEventListener('DOMContentLoaded', () => {
    byId('reloadButton').addEventListener('click', loadAll);
    byId('createPoButton').addEventListener('click', createPurchaseOrder);
    byId('scanButton').addEventListener('click', submitReceivingScan);
    byId('scanLine').addEventListener('change', (event) => selectLine(event.target.value));
    byId('completeReceivingButton').addEventListener('click', openCompleteReceivingModal);
    byId('confirmCompleteReceivingButton').addEventListener('click', confirmCompleteReceiving);
    byId('scanStatus').addEventListener('change', updateScanStatusDefaults);
    byId('addPoLineButton').addEventListener('click', addPurchaseLine);
    byId('purchaseOrderLines').addEventListener('click', handleLineEditorClick);
    byId('purchaseOrderLines').addEventListener('input', renderPoLineSummary);
    byId('receivingBackButton').addEventListener('click', () => byId('receivingQueue').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    setDefaultPoValues();
    renderPoLineSummary();
    loadAll();
  });

  async function loadAll() {
    state.masterDataReady = false;
    const results = await Promise.allSettled([
      requestJson('/api/suppliers'),
      requestJson('/api/products'),
      requestJson('/api/purchase-orders'),
      requestJson('/api/receiving-orders')
    ]);
    const failures = [];
    const [suppliers, products, purchaseOrders, receivingOrders] = results;

    if (suppliers.status === 'fulfilled') state.suppliers = asArray(suppliers.value);
    else failures.push(`仕入先: ${suppliers.reason.message}`);
    if (products.status === 'fulfilled') state.products = asArray(products.value);
    else failures.push(`品目: ${products.reason.message}`);
    renderMasterOptions();
    const masterReady = suppliers.status === 'fulfilled' && products.status === 'fulfilled';
    state.masterDataReady = masterReady;
    byId('createPoButton').disabled = !masterReady;
    byId('addPoLineButton').disabled = !masterReady;

    if (purchaseOrders.status === 'fulfilled') {
      state.purchaseOrders = asArray(purchaseOrders.value);
      renderPurchaseOrders();
    } else {
      failures.push(`発注一覧: ${purchaseOrders.reason.message}`);
      byId('poCount').textContent = '取得失敗';
      byId('purchaseOrderList').innerHTML = scopedLoadError('発注一覧', purchaseOrders.reason.message);
    }

    if (receivingOrders.status === 'fulfilled') {
      state.receivingOrders = asArray(receivingOrders.value);
      renderReceivingOrders();
    } else {
      failures.push(`入庫予定: ${receivingOrders.reason.message}`);
      byId('receivingCount').textContent = '取得失敗';
      byId('receivingOrderList').innerHTML = scopedLoadError('入庫予定', receivingOrders.reason.message);
    }
    renderKpis();

    if (state.selectedReceivingId) {
      try {
        await loadReceivingDetail(state.selectedReceivingId);
      } catch (error) {
        failures.push(`選択中の入庫予定: ${error.message}`);
      }
    }
    if (failures.length) notify(`一部データを取得できませんでした: ${failures.join(' / ')}`, 'ng');
  }

  function scopedLoadError(label, message) {
    return `<div class="text-danger small p-3"><strong>${escapeHtml(label)}を取得できませんでした。</strong><br>${escapeHtml(message)}</div>`;
  }

  async function createPurchaseOrder() {
    if (state.isCreatingPurchaseOrder) return;
    if (!state.masterDataReady) {
      notify('仕入先・品目マスタを再取得してから登録してください', 'ng');
      return;
    }
    const supplierId = Number(byId('poSupplier').value);
    const poNumber = byId('poNumber').value.trim();
    const lines = collectPurchaseLines();
    if (!supplierId || !poNumber || !lines.length || lines.some((line) => !line.product_id || line.ordered_quantity <= 0)) {
      notify('仕入先、発注番号と、全明細の品目・数量を入力してください', 'ng');
      return;
    }
    if (hasDuplicateProducts(lines)) {
      notify('同じ品目が複数行にあります。数量を1明細にまとめてください', 'ng');
      return;
    }

    const button = byId('createPoButton');
    state.isCreatingPurchaseOrder = true;
    setButtonBusy(button, true, '登録中');
    try {
      const created = await requestJson('/api/purchase-orders', {
        method: 'POST',
        body: {
          purchase_order_no: poNumber,
          supplier_id: supplierId,
          expected_date: byId('poExpectedDate').value || null,
          lines
        }
      });
      const receiving = await requestJson(`/api/purchase-orders/${created.order.id}/create-receiving-order`, { method: 'POST', body: {} });
      notify(`${lines.length}品目の発注と入庫予定を作成しました`, 'ok');
      setDefaultPoValues();
      resetPurchaseLines();
      await loadAll();
      if (receiving.receiving_order?.id) await loadReceivingDetail(receiving.receiving_order.id);
    } catch (error) {
      notify(error.message, 'ng');
    } finally {
      state.isCreatingPurchaseOrder = false;
      setButtonBusy(button, false, '', !state.masterDataReady);
    }
  }

  async function generateReceivingOrder(poId, button) {
    const key = String(poId);
    if (state.creatingReceivingOrderIds.has(key)) return;
    state.creatingReceivingOrderIds.add(key);
    setButtonBusy(button, true, '作成中');
    try {
      const result = await requestJson(`/api/purchase-orders/${poId}/create-receiving-order`, { method: 'POST', body: {} });
      notify(result.existing ? '既存の入庫予定を開きました' : '入庫予定を作成しました', 'ok');
      await loadAll();
      if (result.receiving_order?.id) await loadReceivingDetail(result.receiving_order.id);
    } catch (error) {
      notify(error.message, 'ng');
    } finally {
      state.creatingReceivingOrderIds.delete(key);
      setButtonBusy(button, false);
    }
  }

  async function loadReceivingDetail(id) {
    const selectedId = Number(id);
    const requestToken = ++state.detailRequestToken;
    state.selectedReceivingId = selectedId;
    state.detail = null;
    markSelectedReceiving();
    clearReceivingDetail();
    setDetailState('loading', '入庫予定を読み込んでいます');
    try {
      const data = await requestJson(`/api/receiving-orders/${selectedId}`);
      if (requestToken !== state.detailRequestToken) return;
      state.detail = data;
      setDetailState('ready');
      renderReceivingDetail();
      if (window.matchMedia('(max-width: 1199.98px)').matches) {
        byId('receivingWorkspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (error) {
      if (requestToken !== state.detailRequestToken) return;
      state.detail = null;
      setDetailState('error', error.message);
      throw error;
    }
  }

  async function submitReceivingScan() {
    if (state.isSubmittingScan) return;
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
    const selectedLine = byId('scanLine').selectedOptions[0];
    const remaining = Number(selectedLine?.dataset.remaining || 0);
    if (quantity > remaining) {
      notify(`残入庫数量(${remaining})を超えています`, 'ng');
      return;
    }

    const status = byId('scanStatus').value;
    const reasonCode = byId('scanReason').value;
    if (status !== 'accepted' && !reasonCode) {
      notify('保留・不合格の場合は理由分類を選択してください', 'ng');
      setScannerState('error', '理由未選択');
      playScanFeedback('error');
      return;
    }
    const body = {
      receiving_order_line_id: lineId,
      qr_code: byId('scanQr').value.trim() || null,
      lot_number: lot,
      received_quantity: quantity,
      location_code: byId('scanLocation').value.trim() || 'RECEIVING',
      inspection_status: status,
      reason_code: reasonCode || null,
      comment: byId('scanComment').value.trim() || null
    };
    if (status === 'accepted') body.accepted_quantity = quantity;
    if (status === 'rejected') body.rejected_quantity = quantity;

    const scanFingerprint = JSON.stringify({
      receivingOrderId: state.detail.receiving_order.id,
      body
    });
    if (state.pendingScan?.fingerprint !== scanFingerprint) {
      state.pendingScan = { fingerprint: scanFingerprint, key: createIdempotencyKey() };
    }

    const button = byId('scanButton');
    state.isSubmittingScan = true;
    setButtonBusy(button, true, '登録中');
    setScannerState('loading', '登録中');
    try {
      await requestJson(`/api/receiving-orders/${state.detail.receiving_order.id}/scan`, {
        method: 'POST',
        headers: { 'Idempotency-Key': state.pendingScan.key },
        body
      });
      state.pendingScan = null;
      notify('入庫を登録しました', 'ok');
      setScannerState('success', '登録完了');
      playScanFeedback('success');
      byId('scanQr').value = '';
      byId('scanLot').value = '';
      byId('scanQuantity').value = '1';
      byId('scanReason').value = '';
      byId('scanComment').value = '';
      await loadAll();
    } catch (error) {
      setScannerState('error', '登録失敗');
      playScanFeedback('error');
      notify(error.message, 'ng');
    } finally {
      state.isSubmittingScan = false;
      const completed = state.detail?.receiving_order?.status === 'received';
      const hasOpenLines = asArray(state.detail?.lines).some((line) =>
        Number(line.received_quantity || 0) < Number(line.expected_quantity || 0));
      setButtonBusy(button, false, '', completed || !hasOpenLines);
      if (!byId('scanQr').disabled) byId('scanQr').focus();
    }
  }

  function openCompleteReceivingModal() {
    const completion = getCompletionState();
    if (!completion.ready) {
      notify(completion.reason, 'ng');
      return;
    }

    const order = state.detail.receiving_order;
    byId('completeReceivingOrderNo').textContent = order.receiving_order_no || '-';
    byId('completeReceivingSupplier').textContent = order.supplier_name || '-';
    byId('completeReceivingQuantity').textContent = `${completion.receivedQuantity} / ${completion.expectedQuantity}`;
    state.completionModal ||= new bootstrap.Modal(byId('completeReceivingModal'));
    state.completionModal.show();
  }

  async function confirmCompleteReceiving() {
    if (state.isCompleting) return;
    const completion = getCompletionState();
    if (!completion.ready) {
      state.completionModal?.hide();
      notify(completion.reason, 'ng');
      return;
    }

    const orderId = state.detail.receiving_order.id;
    const confirmButton = byId('confirmCompleteReceivingButton');
    state.isCompleting = true;
    confirmButton.disabled = true;
    confirmButton.innerHTML = '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>処理中';
    try {
      await requestJson(`/api/receiving-orders/${orderId}/complete`, {
        method: 'PATCH',
        body: { comment: '画面から入庫完了' }
      });
      state.completionModal?.hide();
      notify('入庫予定を完了しました', 'ok');
      await loadAll();
    } catch (error) {
      notify(error.message, 'ng');
    } finally {
      state.isCompleting = false;
      confirmButton.disabled = false;
      confirmButton.innerHTML = '<i class="fas fa-circle-check me-1"></i>入庫完了を確定';
    }
  }

  function renderMasterOptions() {
    byId('poSupplier').innerHTML = state.suppliers.map((s) =>
      `<option value="${s.id}">${escapeHtml(s.supplier_code)} ${escapeHtml(s.supplier_name)}</option>`
    ).join('');
    byId('purchaseOrderLines').querySelectorAll('[data-line-product]').forEach((select) => {
      const selected = select.value;
      select.innerHTML = purchaseProductOptions(selected);
    });
  }

  function purchaseProductOptions(selectedValue = '') {
    return state.products.map((product) => {
      const selected = String(product.id) === String(selectedValue) ? ' selected' : '';
      return `<option value="${product.id}"${selected}>${escapeHtml(product.product_code)} ${escapeHtml(product.product_name)}</option>`;
    }).join('');
  }

  function addPurchaseLine() {
    if (!state.masterDataReady) return;
    const row = document.createElement('div');
    row.className = 'order-line-row';
    row.dataset.orderLine = '';
    row.innerHTML = `
      <span class="order-line-index" aria-hidden="true"></span>
      <div class="order-line-product">
        <label class="form-label">品目</label>
        <select class="form-select form-select-lg" data-line-product>${purchaseProductOptions()}</select>
      </div>
      <div class="order-line-quantity">
        <label class="form-label">数量</label>
        <input class="form-control form-control-lg" data-line-quantity type="number" min="1" step="1" value="1">
      </div>
      <button class="btn btn-outline-danger order-line-remove" data-remove-line type="button" title="明細を削除" aria-label="明細を削除">
        <i class="fas fa-trash"></i>
      </button>`;
    byId('purchaseOrderLines').appendChild(row);
    updatePurchaseLineRows();
    row.querySelector('[data-line-product]').focus();
  }

  function handleLineEditorClick(event) {
    const button = event.target.closest('[data-remove-line]');
    if (!button || button.disabled) return;
    button.closest('[data-order-line]')?.remove();
    updatePurchaseLineRows();
  }

  function updatePurchaseLineRows() {
    const rows = [...byId('purchaseOrderLines').querySelectorAll('[data-order-line]')];
    rows.forEach((row, index) => {
      row.querySelector('.order-line-index').textContent = String(index + 1);
      const suffix = index === 0 ? '' : `-${index + 1}`;
      const product = row.querySelector('[data-line-product]');
      const quantity = row.querySelector('[data-line-quantity]');
      const productId = `poProduct${suffix}`;
      const quantityId = `poQuantity${suffix}`;
      product.id = productId;
      quantity.id = quantityId;
      row.querySelector('.order-line-product label').htmlFor = productId;
      row.querySelector('.order-line-quantity label').htmlFor = quantityId;
      row.querySelector('[data-remove-line]').disabled = rows.length === 1;
    });
    renderPoLineSummary();
  }

  function resetPurchaseLines() {
    const rows = [...byId('purchaseOrderLines').querySelectorAll('[data-order-line]')];
    rows.slice(1).forEach((row) => row.remove());
    const first = rows[0];
    if (first) {
      first.querySelector('[data-line-product]').innerHTML = purchaseProductOptions();
      first.querySelector('[data-line-quantity]').value = '1';
    }
    updatePurchaseLineRows();
  }

  function collectPurchaseLines() {
    return [...byId('purchaseOrderLines').querySelectorAll('[data-order-line]')].map((row) => ({
      product_id: Number(row.querySelector('[data-line-product]').value),
      ordered_quantity: Number(row.querySelector('[data-line-quantity]').value || 0)
    }));
  }

  function hasDuplicateProducts(lines) {
    const productIds = lines.map((line) => line.product_id).filter(Boolean);
    return new Set(productIds).size !== productIds.length;
  }

  function renderPoLineSummary() {
    const lines = collectPurchaseLines();
    const quantity = lines.reduce((sum, line) => sum + Math.max(0, line.ordered_quantity || 0), 0);
    byId('poLineSummary').textContent = `${lines.length}品目 / 合計${quantity}`;
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
      button.addEventListener('click', () => generateReceivingOrder(button.dataset.createReceiving, button));
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
    renderCompletionControl();
    renderReceivingProcess(order);

    byId('receivingLines').innerHTML = detail.lines.map((line) => {
      const remaining = Number(line.expected_quantity || 0) - Number(line.received_quantity || 0);
      return `
        <button class="list-group-item list-group-item-action receiving-line ${remaining <= 0 ? 'complete' : ''}" type="button" data-line-id="${line.id}" ${remaining <= 0 ? 'disabled' : ''}>
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

    renderScanControls();
    renderResults();
  }

  function renderScanControls() {
    const order = state.detail?.receiving_order;
    const openLines = asArray(state.detail?.lines).filter((line) =>
      Number(line.received_quantity || 0) < Number(line.expected_quantity || 0));
    const completed = order?.status === 'received';
    const disabled = completed || openLines.length === 0;
    const hint = byId('scanAvailabilityHint');
    const controlIds = ['scanLine', 'scanQr', 'scanLot', 'scanQuantity', 'scanLocation', 'scanStatus', 'scanReason', 'scanComment', 'scanButton'];

    byId('scanLine').innerHTML = openLines.map((line) => {
      const remaining = Number(line.expected_quantity || 0) - Number(line.received_quantity || 0);
      return `<option value="${line.id}" data-remaining="${remaining}">${escapeHtml(line.product_code)} ${escapeHtml(line.product_name)} / 残 ${remaining}</option>`;
    }).join('');
    controlIds.forEach((id) => { byId(id).disabled = disabled; });

    if (disabled) {
      hint.textContent = completed
        ? 'この入庫予定は完了済みです。入庫実績を確認してください。'
        : '全明細の入庫数量を登録済みです。入庫完了を確定してください。';
      hint.classList.remove('d-none');
      byId('scanLot').value = '';
      byId('scanQuantity').value = '';
      byId('scanQuantity').removeAttribute('max');
      return;
    }

    hint.classList.add('d-none');
    selectLine(openLines[0].id);
    updateScanStatusDefaults();
  }

  function setDetailState(type, message = '') {
    const statePanel = byId('receivingDetailState');
    byId('receivingDetail').classList.add('d-none');
    byId('receivingEmpty').classList.add('d-none');
    if (type === 'ready') {
      statePanel.classList.add('d-none');
      return;
    }
    statePanel.className = `app-state is-${type}`;
    statePanel.innerHTML = type === 'loading'
      ? '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><strong>入庫予定を読み込んでいます</strong>'
      : `<i class="fas fa-triangle-exclamation" aria-hidden="true"></i><div><strong>入庫予定を表示できません</strong><div class="small">${escapeHtml(message)}</div></div><button class="btn btn-outline-danger" type="button" data-detail-retry><i class="fas fa-rotate me-1"></i>再試行</button>`;
    statePanel.classList.remove('d-none');
    statePanel.querySelector('[data-detail-retry]')?.addEventListener('click', () => {
      if (state.selectedReceivingId) loadReceivingDetail(state.selectedReceivingId).catch((error) => notify(error.message, 'ng'));
    });
  }

  function clearReceivingDetail() {
    byId('receivingTitle').textContent = '';
    byId('receivingMeta').textContent = '';
    byId('receivingStatus').textContent = '未選択';
    byId('receivingLines').innerHTML = '';
    byId('receivingResults').innerHTML = '';
    byId('receivingProcess').querySelectorAll('li').forEach((step) => {
      step.classList.remove('is-complete', 'is-current');
    });
  }

  function renderReceivingProcess(order) {
    const status = String(order.status || '').toLowerCase();
    const currentIndex = status === 'received' ? 3 : ['in_progress', 'partial'].includes(status) ? 2 : 1;
    byId('receivingProcess').querySelectorAll('li').forEach((step, index) => {
      step.classList.toggle('is-complete', index < currentIndex || currentIndex === 3);
      step.classList.toggle('is-current', index === currentIndex && currentIndex < 3);
    });
  }

  function renderCompletionControl() {
    const completion = getCompletionState();
    const button = byId('completeReceivingButton');
    const hint = byId('completeReceivingHint');
    button.disabled = !completion.ready;
    if (completion.completed) {
      button.innerHTML = '<i class="fas fa-circle-check me-1"></i>入庫完了済み';
    } else {
      button.innerHTML = '<i class="fas fa-circle-check me-1"></i>入庫完了';
    }
    hint.textContent = completion.reason;
    hint.className = `receiving-completion-hint small mt-1 ${completion.ready ? 'text-success' : 'text-muted'}`;
  }

  function getCompletionState() {
    const order = state.detail?.receiving_order;
    const lines = asArray(state.detail?.lines);
    if (!order) return { ready: false, completed: false, reason: '入庫予定を選択してください', expectedQuantity: 0, receivedQuantity: 0 };

    const expectedQuantity = lines.reduce((sum, line) => sum + Number(line.expected_quantity || 0), 0);
    const receivedQuantity = lines.reduce((sum, line) => sum + Number(line.received_quantity || 0), 0);
    if (order.status === 'received') {
      return { ready: false, completed: true, reason: 'この入庫予定は完了済みです', expectedQuantity, receivedQuantity };
    }
    if (!lines.length) {
      return { ready: false, completed: false, reason: '入庫明細がありません', expectedQuantity, receivedQuantity };
    }

    const incompleteLines = lines.filter((line) => Number(line.received_quantity || 0) < Number(line.expected_quantity || 0));
    const remainingQuantity = incompleteLines.reduce((sum, line) =>
      sum + Math.max(0, Number(line.expected_quantity || 0) - Number(line.received_quantity || 0)), 0);
    if (incompleteLines.length) {
      return {
        ready: false,
        completed: false,
        reason: `未入庫の明細が${incompleteLines.length}件、残り${remainingQuantity}あります`,
        expectedQuantity,
        receivedQuantity
      };
    }
    return { ready: true, completed: false, reason: '全明細の入庫数量を確認済みです', expectedQuantity, receivedQuantity };
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
    if (!option) return;
    const remaining = Math.max(0, Number(option.dataset.remaining || 0));
    byId('scanQuantity').max = String(remaining);
    byId('scanQuantity').value = String(remaining);
    const line = state.detail?.lines?.find((item) => Number(item.id) === Number(lineId));
    if (line && !byId('scanLot').value) {
      byId('scanLot').value = `RCV-${line.product_code}-${dateStamp()}`;
    }
  }

  function updateScanStatusDefaults() {
    const accepted = byId('scanStatus').value === 'accepted';
    byId('scanReasonGroup').classList.toggle('d-none', accepted);
    byId('scanReason').required = !accepted;
    if (accepted) byId('scanReason').value = '';
    if (accepted && !byId('scanLocation').value) {
      byId('scanLocation').value = 'RECEIVING';
    }
  }

  function setScannerState(value, label) {
    const panel = byId('receivingScannerPanel');
    const status = byId('receivingScannerStatus');
    panel.dataset.scanState = value;
    status.className = `receiving-scanner-status is-${value}`;
    status.innerHTML = `<i class="fas fa-circle"></i>${escapeHtml(label)}`;
    if (value === 'success' || value === 'error') {
      window.setTimeout(() => {
        panel.dataset.scanState = 'idle';
        status.className = 'receiving-scanner-status is-idle';
        status.innerHTML = '<i class="fas fa-circle"></i>入力待ち';
      }, 900);
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
    const firstQuantity = byId('purchaseOrderLines').querySelector('[data-line-quantity]');
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

  function createIdempotencyKey() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `scan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
