(function () {
  'use strict';

  const state = {
    selected: null,
    detail: null
  };

  const TYPE_LABELS = {
    lot: 'ロット',
    qr: 'QR',
    document: '伝票・指図',
    sales_order: '受注',
    shipping_instruction: '出荷指示',
    purchase_order: '発注',
    manufacturing_order: '製造指図'
  };

  document.addEventListener('DOMContentLoaded', () => {
    byId('traceSearchButton').addEventListener('click', runTrace);
    byId('traceClearButton').addEventListener('click', clearTrace);
    byId('traceSearch').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') runTrace();
    });

    const params = new URLSearchParams(location.search);
    const q = params.get('q');
    const type = params.get('type') || 'search';
    if (q) {
      byId('traceSearch').value = q;
      byId('traceType').value = type;
      runTrace();
    }
  });

  async function runTrace() {
    const query = byId('traceSearch').value.trim();
    const type = byId('traceType').value;
    if (!query) {
      notify('検索条件を入力してください', 'ng');
      return;
    }

    setResultsLoading();
    try {
      if (type === 'search') {
        const data = await requestJson(`/api/traceability/search?q=${encodeURIComponent(query)}`);
        renderResults(data);
        if (data[0]) loadDetail(normalizeResult(data[0]));
      } else {
        const result = { result_type: type, result_key: query, label: '' };
        renderResults([result]);
        await loadDetail(result);
      }
      history.replaceState(null, '', `traceability.html?type=${encodeURIComponent(type)}&q=${encodeURIComponent(query)}`);
    } catch (error) {
      renderResultsError(error.message);
      notify(error.message, 'ng');
    }
  }

  function clearTrace() {
    byId('traceSearch').value = '';
    byId('traceType').value = 'search';
    byId('traceResultCount').textContent = '0件';
    byId('traceResults').innerHTML = '<div class="text-muted small p-3">検索条件を入力してください</div>';
    byId('traceDetail').classList.add('d-none');
    byId('traceEmpty').classList.remove('d-none');
    history.replaceState(null, '', 'traceability.html');
  }

  async function loadDetail(result) {
    const normalized = normalizeResult(result);
    state.selected = normalized;
    markSelectedResult();
    showDetailLoading(normalized);

    try {
      const endpoint = detailEndpoint(normalized);
      const data = await requestJson(endpoint);
      state.detail = data;
      renderDetail(normalized, data);
    } catch (error) {
      notify(error.message, 'ng');
      byId('traceDetailBadge').className = 'status-badge badge-ng';
      byId('traceDetailBadge').textContent = '取得失敗';
      byId('traceTimeline').innerHTML = emptyMessage(error.message);
    }
  }

  function normalizeResult(row) {
    const resultType = row.result_type || row.type || 'document';
    return {
      type: resultType,
      key: row.result_key || row.key || row.document_no || row.lot_number || row.qr_code || '',
      label: row.label || row.customer_name || row.lot_number || ''
    };
  }

  function detailEndpoint(result) {
    if (result.type === 'lot') return `/api/traceability/lot/${encodeURIComponent(result.key)}`;
    if (result.type === 'qr') return `/api/traceability/qr/${encodeURIComponent(result.key)}`;
    return `/api/traceability/document/${encodeURIComponent(result.key)}`;
  }

  function renderResults(rows) {
    const results = Array.isArray(rows) ? rows.map(normalizeResult) : [];
    byId('traceResultCount').textContent = `${results.length}件`;
    if (!results.length) {
      byId('traceResults').innerHTML = '<div class="text-muted small p-3">該当データがありません</div>';
      return;
    }

    byId('traceResults').innerHTML = results.map((row, index) => `
      <button class="list-group-item list-group-item-action" type="button" data-trace-index="${index}">
        <div class="d-flex justify-content-between gap-2">
          <strong class="trace-result-key">${escapeHtml(row.key)}</strong>
          <span class="badge ${badgeClass(row.type)}">${escapeHtml(typeLabel(row.type))}</span>
        </div>
        <div class="small text-muted">${escapeHtml(row.label || '-')}</div>
      </button>
    `).join('');

    byId('traceResults').querySelectorAll('[data-trace-index]').forEach((button) => {
      button.addEventListener('click', () => loadDetail(results[Number(button.dataset.traceIndex)]));
    });
  }

  function renderResultsError(message) {
    byId('traceResultCount').textContent = '0件';
    byId('traceResults').innerHTML = `<div class="text-danger small p-3">${escapeHtml(message)}</div>`;
  }

  function setResultsLoading() {
    byId('traceResultCount').textContent = '-';
    byId('traceResults').innerHTML = '<div class="text-muted small p-3">検索中...</div>';
  }

  function markSelectedResult() {
    const selected = state.selected;
    byId('traceResults').querySelectorAll('.list-group-item').forEach((button) => {
      const key = button.querySelector('.trace-result-key')?.textContent || '';
      button.classList.toggle('active', selected && key === selected.key);
    });
  }

  function showDetailLoading(result) {
    byId('traceEmpty').classList.add('d-none');
    byId('traceDetail').classList.remove('d-none');
    byId('traceDetailTitle').textContent = result.key;
    byId('traceDetailMeta').textContent = typeLabel(result.type);
    byId('traceDetailBadge').className = 'status-badge badge-progress';
    byId('traceDetailBadge').textContent = '照会中';
    byId('traceKpis').innerHTML = '';
    byId('traceTimeline').innerHTML = '<div class="text-muted small p-3">読み込み中...</div>';
    byId('traceLots').innerHTML = '';
    byId('traceInventory').innerHTML = '';
    byId('traceDocuments').innerHTML = '';
  }

  function renderDetail(result, data) {
    const summary = summarize(data);
    byId('traceDetailTitle').textContent = result.key;
    byId('traceDetailMeta').textContent = `${typeLabel(result.type)} / ${summary.primaryProduct || '-'}`;
    byId('traceDetailBadge').className = `status-badge ${summary.hasRecords ? 'badge-ok' : 'badge-pending'}`;
    byId('traceDetailBadge').textContent = summary.hasRecords ? '履歴あり' : '履歴なし';
    byId('traceKpis').innerHTML = renderKpis(summary);
    byId('traceTimeline').innerHTML = renderTimeline(buildTimeline(data));
    byId('traceLots').innerHTML = renderLotsAndQr(data);
    byId('traceInventory').innerHTML = renderInventory(data);
    byId('traceDocuments').innerHTML = renderDocuments(data);
  }

  function summarize(data) {
    const lotTrace = data.lot_trace || data;
    const lots = asArray(lotTrace.lots);
    const qrUnits = asArray(lotTrace.qr_units);
    const transactions = asArray(lotTrace.inventory_transactions).concat(asArray(data.inventory_transactions));
    const events = asArray(lotTrace.operation_events).concat(asArray(data.operation_events));
    const docs = countDocs(data);
    const primary = lots[0] || qrUnits[0] || data.qr_unit || {};
    return {
      hasRecords: lots.length + qrUnits.length + transactions.length + events.length + docs > 0,
      primaryProduct: [primary.product_code, primary.product_name].filter(Boolean).join(' '),
      lots: lots.length,
      qr: qrUnits.length + (data.qr_unit ? 1 : 0),
      transactions: uniqueRows(transactions).length,
      events: uniqueRows(events).length,
      docs
    };
  }

  function renderKpis(summary) {
    return [
      ['ロット', summary.lots, 'fa-boxes-stacked'],
      ['QR', summary.qr, 'fa-qrcode'],
      ['在庫移動', summary.transactions, 'fa-right-left'],
      ['イベント', summary.events + summary.docs, 'fa-clock-rotate-left']
    ].map(([label, value, icon]) => `
      <div class="col-6 col-lg-3">
        <div class="trace-kpi p-2 h-100">
          <div class="text-muted small"><i class="fas ${icon} me-1"></i>${label}</div>
          <div class="h4 mb-0">${Number(value || 0)}</div>
        </div>
      </div>
    `).join('');
  }

  function buildTimeline(data) {
    const lotTrace = data.lot_trace || data;
    const rows = [];
    asArray(lotTrace.receiving_results).concat(asArray(data.receiving_results)).forEach((row) => {
      rows.push({ at: row.received_at, type: '入庫', title: row.receiving_order_no || row.purchase_order_no || '入庫実績', text: `${row.product_code || ''} ${row.lot_number || ''} ${qty(row.received_quantity || row.quantity)}` });
    });
    asArray(lotTrace.manufacturing_consumptions).concat(asArray(data.manufacturing_consumptions)).forEach((row) => {
      rows.push({ at: row.consumed_at, type: '製造投入', title: row.work_order_no || '材料投入', text: `${row.lot_number || ''} ${qty(row.consumed_quantity || row.quantity)}` });
    });
    asArray(lotTrace.manufacturing_receipts).concat(asArray(data.manufacturing_receipts)).forEach((row) => {
      rows.push({ at: row.received_at, type: '製造受入', title: row.work_order_no || '製造受入', text: `${row.product_code || ''} ${row.lot_number || ''} ${qty(row.received_quantity || row.quantity)}` });
    });
    asArray(lotTrace.inventory_transactions).concat(asArray(data.inventory_transactions)).forEach((row) => {
      rows.push({ at: row.occurred_at, type: '在庫移動', title: row.transaction_type || '在庫移動', text: `${row.product_code || ''} ${row.lot_number || ''} ${qty(row.quantity)}` });
    });
    asArray(lotTrace.shipping_allocations).forEach((row) => {
      rows.push({ at: row.scanned_at || row.updated_at || row.created_at, type: '出荷引当', title: row.instruction_id || '出荷指示', text: `${row.product_code || ''} ${row.lot_number || ''} ${qty(row.shipped_quantity || row.picked_quantity)}` });
    });
    asArray(lotTrace.operation_events).concat(asArray(data.operation_events)).forEach((row) => {
      rows.push({ at: row.occurred_at, type: '監査', title: row.event_type || '業務イベント', text: [row.source_type, row.actor_name || row.actor_email].filter(Boolean).join(' / ') });
    });
    return uniqueTimeline(rows).sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  }

  function renderTimeline(rows) {
    if (!rows.length) return emptyMessage('時系列履歴がありません');
    return `<div class="trace-timeline">${rows.map((row) => `
      <article class="trace-event">
        <div class="d-flex flex-wrap justify-content-between gap-2">
          <strong>${escapeHtml(row.title || '-')}</strong>
          <span class="badge ${badgeClass(row.type)}">${escapeHtml(row.type)}</span>
        </div>
        <div class="text-muted small">${escapeHtml(formatDate(row.at))}</div>
        <div class="small mt-1">${escapeHtml(row.text || '-')}</div>
      </article>
    `).join('')}</div>`;
  }

  function renderLotsAndQr(data) {
    const lotTrace = data.lot_trace || data;
    const lots = asArray(lotTrace.lots);
    const qrUnits = uniqueRows(asArray(lotTrace.qr_units).concat(data.qr_unit ? [data.qr_unit] : []));
    return [
      renderTable('ロット', lots, ['品目', 'ロット', '数量', '利用可能', '場所'], (row) => [
        productLabel(row),
        code(row.lot_number),
        numberText(row.quantity || row.current_quantity),
        numberText(row.available_quantity),
        text(row.location)
      ]),
      renderTable('QR', qrUnits, ['QR', '品目', 'ロット', '状態', '数量'], (row) => [
        code(row.qr_code),
        productLabel(row),
        code(row.lot_number),
        badge(row.status || 'active'),
        numberText(row.quantity)
      ])
    ].join('');
  }

  function renderInventory(data) {
    const lotTrace = data.lot_trace || data;
    const rows = uniqueRows(asArray(lotTrace.inventory_transactions).concat(asArray(data.inventory_transactions)));
    return renderTable('在庫移動', rows, ['日時', '種別', '品目', 'ロット', '数量', '場所'], (row) => [
      text(formatDate(row.occurred_at)),
      badge(row.transaction_type || '-'),
      productLabel(row),
      code(row.lot_number),
      numberText(row.quantity),
      text(row.location || row.from_location || row.to_location)
    ]);
  }

  function renderDocuments(data) {
    const rows = []
      .concat(asArray(data.sales_orders).map((row) => ({ type: '受注', key: row.sales_order_no, label: row.customer_name, status: row.status })))
      .concat(asArray(data.shipping_instructions).map((row) => ({ type: '出荷指示', key: row.instruction_id, label: row.customer_name || row.sales_order_no, status: row.status })))
      .concat(asArray(data.purchase_orders).map((row) => ({ type: '発注', key: row.purchase_order_no, label: row.supplier_name, status: row.status })))
      .concat(asArray(data.receiving_orders).map((row) => ({ type: '入庫指示', key: row.receiving_order_no, label: row.purchase_order_no, status: row.status })))
      .concat(asArray(data.manufacturing_orders).map((row) => ({ type: '製造指図', key: row.work_order_no, label: productLabel(row), status: row.status })))
      .concat(asArray(data.ocr_documents).map((row) => ({ type: 'OCR', key: row.document_no, label: row.document_type, status: row.status })));
    return renderTable('伝票・指図', rows, ['種別', '番号', '内容', '状態'], (row) => [
      badge(row.type),
      code(row.key),
      text(row.label),
      badge(row.status || '-')
    ]);
  }

  function renderTable(title, rows, headers, mapper) {
    if (!rows.length) return `<section class="app-card card"><div class="card-body">${emptyMessage(`${title}はありません`)}</div></section>`;
    return `
      <section class="app-card card">
        <div class="card-header bg-white"><h3 class="h6 mb-0">${escapeHtml(title)}</h3></div>
        <div class="table-responsive trace-table">
          <table class="table table-sm table-hover mb-0">
            <thead class="table-light"><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
            <tbody>${rows.map((row) => `<tr>${mapper(row).map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>
      </section>
    `;
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

  function countDocs(data) {
    return asArray(data.sales_orders).length +
      asArray(data.shipping_instructions).length +
      asArray(data.purchase_orders).length +
      asArray(data.receiving_orders).length +
      asArray(data.manufacturing_orders).length +
      asArray(data.ocr_documents).length;
  }

  function uniqueRows(rows) {
    const seen = new Set();
    return rows.filter((row) => {
      const key = `${row.id || ''}:${row.qr_code || ''}:${row.lot_number || ''}:${row.transaction_type || ''}:${row.occurred_at || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function uniqueTimeline(rows) {
    const seen = new Set();
    return rows.filter((row) => {
      const key = `${row.at || ''}:${row.type}:${row.title}:${row.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function badgeClass(type) {
    const key = String(type || '').toLowerCase();
    if (key.includes('ng') || key.includes('cancel') || key.includes('error')) return 'badge-ng';
    if (key.includes('pending') || key.includes('未')) return 'badge-pending';
    if (key.includes('ship') || key.includes('complete') || key.includes('ok') || key.includes('active')) return 'badge-ok';
    return 'badge-progress';
  }

  function badge(value) {
    return `<span class="badge ${badgeClass(value)}">${escapeHtml(String(value || '-'))}</span>`;
  }

  function code(value) {
    return value ? `<code>${escapeHtml(String(value))}</code>` : '<span class="text-muted">-</span>';
  }

  function text(value) {
    return escapeHtml(value || '-');
  }

  function numberText(value) {
    if (value === null || value === undefined || value === '') return '<span class="text-muted">-</span>';
    return `<span class="text-end d-inline-block w-100">${Number(value)}</span>`;
  }

  function qty(value) {
    if (value === null || value === undefined || value === '') return '';
    return `${Number(value)}個`;
  }

  function productLabel(row) {
    return text([row.product_code, row.product_name].filter(Boolean).join(' ') || row.product_id || '-');
  }

  function typeLabel(type) {
    return TYPE_LABELS[type] || type || '-';
  }

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('ja-JP', { hour12: false });
  }

  function emptyMessage(message) {
    return `<div class="text-muted text-center py-4">${escapeHtml(message)}</div>`;
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
