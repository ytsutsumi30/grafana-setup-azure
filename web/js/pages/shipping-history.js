(function () {
  'use strict';

  const state = {
    list: [],
    selectedId: null,
    detail: null
  };

  const STATUS_LABELS = {
    pending: '未着手',
    picking: 'ピッキング中',
    packing: '梱包中',
    inspecting: '検品中',
    processing: '処理中',
    shipped: '出荷済',
    delivered: '配達済'
  };

  const EVENT_LABELS = {
    quantity_confirmed: '数量確定',
    lot_allocation_cancelled: 'ロット引当取消',
    pps_started: 'PPS開始',
    qr_scan_ok: 'QR検品OK',
    qr_scan_ng: 'QR検品NG',
    qr_scan_duplicate: '重複スキャン',
    qr_scan_cancelled: 'QRスキャン取消',
    picking_completed: 'ピッキング完了',
    shipment_completed: '出荷完了',
    post_completion_corrected: '完了後修正',
    report_printed: '帳票出力'
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('historySearchButton').addEventListener('click', loadHistoryList);
    document.getElementById('historyRefreshButton').addEventListener('click', loadHistoryList);
    document.getElementById('historySearch').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') loadHistoryList();
    });

    const id = new URLSearchParams(location.search).get('id');
    if (id) {
      state.selectedId = Number(id);
      loadHistoryList().then(() => loadHistoryDetail(id));
    } else {
      loadHistoryList();
    }
  });

  async function loadHistoryList() {
    const query = document.getElementById('historySearch').value.trim();
    const status = document.getElementById('historyStatus').value;
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (query) params.set('instruction_id', query);
    const listEl = document.getElementById('historyList');
    listEl.innerHTML = '<div class="text-muted small p-3">読み込み中...</div>';

    try {
      const res = await fetch(`/api/shipping-instructions?${params.toString()}`);
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || '出荷指示一覧の取得に失敗しました');
      state.list = Array.isArray(data) ? data.slice(0, 50) : [];
      renderHistoryList();
      if (!state.selectedId && state.list[0]) {
        await loadHistoryDetail(state.list[0].id);
      }
    } catch (error) {
      listEl.innerHTML = `<div class="text-danger small p-3">${escapeHtml(error.message)}</div>`;
      notify(error.message, 'ng');
    }
  }

  function renderHistoryList() {
    const listEl = document.getElementById('historyList');
    if (!state.list.length) {
      listEl.innerHTML = '<div class="text-muted small p-3">該当する出荷履歴がありません</div>';
      return;
    }
    listEl.innerHTML = state.list.map((si) => {
      const active = Number(si.id) === Number(state.selectedId) ? 'active' : '';
      return `
        <button class="list-group-item list-group-item-action ${active}" type="button" data-history-id="${si.id}">
          <div class="d-flex justify-content-between gap-2">
            <strong>${escapeHtml(si.instruction_id)}</strong>
            <span class="badge ${badgeClass(si.status)}">${escapeHtml(statusLabel(si.status))}</span>
          </div>
          <div class="small ${active ? '' : 'text-muted'}">${escapeHtml(si.customer_name || '-')}</div>
          <div class="small ${active ? '' : 'text-muted'}">${escapeHtml(si.product_code || '')} ${escapeHtml(si.product_name || '')} / ${Number(si.quantity || 0)}個</div>
        </button>`;
    }).join('');
    listEl.querySelectorAll('[data-history-id]').forEach((button) => {
      button.addEventListener('click', () => loadHistoryDetail(button.dataset.historyId));
    });
  }

  async function loadHistoryDetail(id) {
    state.selectedId = Number(id);
    renderHistoryList();
    try {
      const res = await fetch(`/api/shipping-instructions/${id}/history`);
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || '出荷履歴の取得に失敗しました');
      state.detail = data;
      renderDetail();
      history.replaceState(null, '', `shipping-history.html?id=${encodeURIComponent(id)}`);
    } catch (error) {
      notify(error.message, 'ng');
    }
  }

  function renderDetail() {
    const detail = state.detail;
    const shipping = detail.shipping;
    document.getElementById('historyEmpty').classList.add('d-none');
    document.getElementById('historyDetail').classList.remove('d-none');
    document.getElementById('detailInstructionId').textContent = shipping.instruction_id;
    document.getElementById('detailMeta').textContent =
      `${shipping.customer_name || '-'} / 出荷日 ${formatDate(shipping.shipping_date)} / ${shipping.shipping_location_name || '-'} -> ${shipping.delivery_location_name || '-'}`;
    const statusEl = document.getElementById('detailStatus');
    statusEl.className = `status-badge ${badgeClass(shipping.status)}`;
    statusEl.textContent = statusLabel(shipping.status);
    document.getElementById('detailPpsLink').href = `pps.html?id=${encodeURIComponent(shipping.id)}`;
    document.getElementById('detailInspectionReportLink').href =
      `shipping-report.html?id=${encodeURIComponent(shipping.id)}&type=inspection_result`;
    document.getElementById('detailLotReportLink').href =
      `shipping-report.html?id=${encodeURIComponent(shipping.id)}&type=lot_shipment`;

    renderKpis();
    renderItems();
    renderLots();
    renderScans();
    renderCorrections();
    renderAudit();
  }

  function renderKpis() {
    const detail = state.detail;
    const completion = detail.completion || {};
    const lineCount = (detail.lines || []).length;
    const allocationCount = (detail.allocations || []).length;
    const scanCount = (detail.records || []).length;
    const auditCount = (detail.audit_events || []).length;
    const cancelCount = (detail.audit_events || []).filter((event) => event.event_type === 'qr_scan_cancelled').length;
    const correctionCount = (detail.audit_events || []).filter((event) => event.event_type === 'post_completion_corrected').length;
    const picked = Number(completion.total_picked_quantity || 0);
    const required = Number(completion.total_required_quantity || 0);
    const kpis = [
      ['品目数', `${lineCount}`, 'fa-layer-group'],
      ['ロット数', `${allocationCount}`, 'fa-boxes-stacked'],
      ['検品数量', `${picked}/${required}`, 'fa-qrcode'],
      ['取消/修正', `${cancelCount}/${correctionCount}`, 'fa-rotate-left'],
      ['監査ログ', `${auditCount}`, 'fa-clock-rotate-left']
    ];
    document.getElementById('detailKpis').innerHTML = kpis.map(([label, value, icon]) => `
      <div class="col-6 col-lg">
        <div class="border rounded p-2 bg-light h-100">
          <div class="text-muted small"><i class="fas ${icon} me-1"></i>${label}</div>
          <div class="h5 mb-0">${escapeHtml(value)}</div>
        </div>
      </div>`).join('');
  }

  function renderItems() {
    const lines = state.detail.lines || [];
    document.getElementById('itemsContent').innerHTML = lines.map((line) => {
      const pct = Number(line.allocated_quantity || 0) > 0
        ? Math.min(100, Math.round(Number(line.picked_quantity || 0) / Number(line.allocated_quantity || 1) * 100))
        : 0;
      return `
        <article class="app-card card">
          <div class="card-body">
            <div class="d-flex justify-content-between gap-2 flex-wrap">
              <div>
                <h3 class="h6 mb-1">${escapeHtml(line.product_code || '')} ${escapeHtml(line.product_name || '')}</h3>
                <div class="text-muted small">指示 ${Number(line.quantity || 0)} / 引当 ${Number(line.allocated_quantity || line.shipped_quantity || 0)} / 検品OK ${Number(line.picked_quantity || 0)}</div>
              </div>
              <span class="badge ${line.ng_scan_count > 0 ? 'badge-ng' : 'badge-ok'} align-self-start">${line.ng_scan_count > 0 ? `NG ${line.ng_scan_count}` : 'OK'}</span>
            </div>
            <div class="progress mt-3" style="height:8px">
              <div class="progress-bar bg-success" style="width:${pct}%"></div>
            </div>
            <div class="mt-3 d-flex flex-wrap gap-1">
              ${(line.allocations || []).map((allocation) => `
                <span class="badge rounded-pill text-bg-light border">
                  ${escapeHtml(allocation.lot_number)} ${Number(allocation.picked_quantity || 0)}/${Number(allocation.shipped_quantity || 0)}
                </span>`).join('') || '<span class="text-muted small">ロット引当なし</span>'}
            </div>
          </div>
        </article>`;
    }).join('') || emptyMessage('品目履歴がありません');
  }

  function renderLots() {
    const allocations = state.detail.allocations || [];
    document.getElementById('lotsContent').innerHTML = tableOrEmpty(allocations, `
      <thead>
        <tr>
          <th>品目</th><th>ロット</th><th class="text-end">引当</th><th class="text-end">検品OK</th><th class="text-end">残</th><th>状態</th><th>保管場所</th>
        </tr>
      </thead>
      <tbody>
        ${allocations.map((a) => `
          <tr>
            <td>${escapeHtml(a.product_code || '')}<br><span class="text-muted small">${escapeHtml(a.product_name || '')}</span></td>
            <td><code>${escapeHtml(a.lot_number)}</code></td>
            <td class="text-end">${Number(a.shipped_quantity || 0)}</td>
            <td class="text-end">${Number(a.picked_quantity || 0)}</td>
            <td class="text-end">${Number(a.remaining_pick_quantity || 0)}</td>
            <td><span class="badge ${Number(a.remaining_pick_quantity || 0) === 0 ? 'badge-ok' : 'badge-pending'}">${Number(a.remaining_pick_quantity || 0) === 0 ? '完了' : '未完'}</span></td>
            <td>${escapeHtml(a.location || '-')}</td>
          </tr>`).join('')}
      </tbody>`, 'ロット履歴がありません');
  }

  function renderScans() {
    const records = getScanTimelineItems();
    document.getElementById('scansContent').innerHTML = tableOrEmpty(records, `
      <thead>
        <tr>
          <th>日時</th><th>結果</th><th>QR</th><th>品目</th><th>ロット</th><th class="text-end">数量</th><th>メッセージ</th>
        </tr>
      </thead>
      <tbody>
        ${records.map((record) => `
          <tr>
            <td class="small">${formatDateTime(record.scanned_at)}</td>
            <td><span class="badge ${scanBadgeClass(record.status)}">${escapeHtml(scanStatusLabel(record.status))}</span></td>
            <td><code>${escapeHtml(record.qr_code || record.lot_number || '-')}</code><br><span class="text-muted small">${escapeHtml(record.scan_source || '')}</span></td>
            <td>${escapeHtml(record.product_code || '-')}</td>
            <td>${escapeHtml(record.lot_number || '-')}</td>
            <td class="text-end">${Number(record.picked_quantity || 0)}</td>
            <td class="small">${escapeHtml(record.error_message || '')}</td>
          </tr>`).join('')}
      </tbody>`, 'QR/スキャン履歴がありません');
  }

  function renderCorrections() {
    const events = (state.detail.audit_events || [])
      .filter((event) => ['qr_scan_cancelled', 'post_completion_corrected'].includes(event.event_type));
    document.getElementById('correctionsContent').innerHTML = tableOrEmpty(events, `
      <thead>
        <tr>
          <th>日時</th><th>種別</th><th>品目</th><th>ロット/QR</th><th class="text-end">数量</th><th>理由</th><th>ユーザー</th><th>内容</th>
        </tr>
      </thead>
      <tbody>
        ${events.map((event) => `
          <tr>
            <td class="small">${formatDateTime(event.occurred_at)}</td>
            <td><span class="badge ${event.event_type === 'qr_scan_cancelled' ? 'badge-pending' : 'badge-progress'}">${escapeHtml(eventLabel(event.event_type))}</span></td>
            <td>${escapeHtml(event.product_code || '-')}<br><span class="text-muted small">${escapeHtml(event.product_name || '')}</span></td>
            <td><code>${escapeHtml(event.qr_code || event.lot_number || event.after_data?.lot_number || event.before_data?.lot_number || '-')}</code></td>
            <td class="text-end">${event.quantity == null ? '-' : Number(event.quantity)}</td>
            <td>${escapeHtml(event.reason_code || '-')}</td>
            <td class="small">${escapeHtml(event.user_name || event.user_email || event.actor_name || event.actor_email || '-')}</td>
            <td class="small">${escapeHtml(correctionDetailText(event))}</td>
          </tr>`).join('')}
      </tbody>`, '取消 / 完了後修正の履歴はありません');
  }

  function renderAudit() {
    const events = state.detail.audit_events || [];
    document.getElementById('auditContent').innerHTML = tableOrEmpty(events, `
      <thead>
        <tr>
          <th>日時</th><th>イベント</th><th>品目/ロット</th><th class="text-end">数量</th><th>理由</th><th>ユーザー</th><th>詳細</th>
        </tr>
      </thead>
      <tbody>
        ${events.map((event) => `
          <tr>
            <td class="small">${formatDateTime(event.occurred_at)}</td>
            <td><span class="badge ${event.event_status === 'success' ? 'badge-progress' : 'badge-ng'}">${escapeHtml(eventLabel(event.event_type))}</span></td>
            <td>${escapeHtml(event.product_code || '-')}<br><code>${escapeHtml(event.qr_code || event.lot_number || '-')}</code></td>
            <td class="text-end">${event.quantity == null ? '-' : Number(event.quantity)}</td>
            <td>${escapeHtml(event.reason_code || '-')}</td>
            <td class="small">${escapeHtml(event.user_name || event.user_email || '-')}</td>
            <td class="small">${renderAuditDetail(event)}</td>
          </tr>`).join('')}
      </tbody>`, '監査ログがありません');
  }

  function renderAuditDetail(event) {
    const base = event.comment ? `<div>${escapeHtml(event.comment)}</div>` : '';
    if (event.event_type === 'post_completion_corrected') {
      const before = event.before_data || {};
      const after = event.after_data || {};
      return `${base}
        <div class="text-muted">ロット: ${escapeHtml(before.lot_number || '-')} -> ${escapeHtml(after.lot_number || '-')}</div>
        <div class="text-muted">数量: ${escapeHtml(before.shipped_quantity ?? '-')} -> ${escapeHtml(after.shipped_quantity ?? '-')}</div>`;
    }
    if (event.event_type === 'report_printed') {
      const after = event.after_data || {};
      return `${base}
        <div class="text-muted">${escapeHtml(reportTypeLabel(after.report_type))} / ${escapeHtml(after.revision_label || '-')} / 第${escapeHtml(after.issue_number || '-')}版</div>`;
    }
    if (event.before_data || event.after_data) {
      return `${base}<div class="text-muted">${escapeHtml(compactJsonDiff(event.before_data, event.after_data))}</div>`;
    }
    return base || '-';
  }

  function getScanTimelineItems() {
    const scanRecords = (state.detail.records || []).map((record) => ({
      ...record,
      occurred_at: record.scanned_at
    }));
    const auditRecords = (state.detail.audit_events || [])
      .filter((event) => ['qr_scan_cancelled', 'post_completion_corrected'].includes(event.event_type))
      .map((event) => ({
        id: `audit-${event.id}`,
        occurred_at: event.occurred_at,
        scanned_at: event.occurred_at,
        status: event.event_type === 'qr_scan_cancelled' ? 'cancelled' : 'corrected',
        qr_code: event.qr_code,
        scan_source: event.event_type === 'qr_scan_cancelled' ? '監査ログ: 取消' : '監査ログ: 完了後修正',
        product_code: event.product_code,
        product_name: event.product_name,
        lot_number: event.lot_number || event.after_data?.lot_number || event.before_data?.lot_number,
        picked_quantity: event.quantity || event.after_data?.shipped_quantity || 0,
        error_message: correctionDetailText(event)
      }));
    return [...scanRecords, ...auditRecords].sort((a, b) =>
      new Date(b.occurred_at || b.scanned_at || 0).getTime() - new Date(a.occurred_at || a.scanned_at || 0).getTime()
    );
  }

  function scanStatusLabel(status) {
    return {
      picked: 'OK',
      ok: 'OK',
      ng: 'NG',
      duplicate: '重複',
      cancelled: '取消',
      corrected: '修正'
    }[status] || status || '-';
  }

  function scanBadgeClass(status) {
    if (['picked', 'ok'].includes(status)) return 'badge-ok';
    if (status === 'duplicate' || status === 'cancelled') return 'badge-pending';
    if (status === 'corrected') return 'badge-progress';
    return 'badge-ng';
  }

  function correctionDetailText(event) {
    const base = event.comment || '';
    if (event.event_type === 'post_completion_corrected') {
      const before = event.before_data || {};
      const after = event.after_data || {};
      const lotText = `${before.lot_number || '-'} -> ${after.lot_number || event.lot_number || '-'}`;
      const qtyText = `${before.shipped_quantity ?? '-'} -> ${after.shipped_quantity ?? event.quantity ?? '-'}`;
      return [base, `ロット ${lotText}`, `数量 ${qtyText}`].filter(Boolean).join(' / ');
    }
    if (event.event_type === 'qr_scan_cancelled') {
      const before = event.before_data || {};
      return [base, `取消前数量 ${before.picked_quantity ?? event.quantity ?? '-'}`].filter(Boolean).join(' / ');
    }
    return base || event.reason_code || '';
  }

  function tableOrEmpty(rows, innerHtml, message) {
    if (!rows.length) return emptyMessage(message);
    return `<div class="app-card card"><div class="table-responsive"><table class="table table-sm table-hover align-middle mb-0">${innerHtml}</table></div></div>`;
  }

  function emptyMessage(message) {
    return `<div class="app-card card"><div class="card-body text-muted small">${escapeHtml(message)}</div></div>`;
  }

  async function readJson(res) {
    try {
      return await res.json();
    } catch (error) {
      return {};
    }
  }

  function badgeClass(status) {
    if (['shipped', 'delivered', 'completed'].includes(status)) return 'badge-ok';
    if (['picking', 'packing', 'inspecting', 'processing'].includes(status)) return 'badge-progress';
    return 'badge-pending';
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || '-';
  }

  function eventLabel(type) {
    return EVENT_LABELS[type] || type || '-';
  }

  function reportTypeLabel(type) {
    return {
      inspection_result: '出荷検品結果票',
      lot_shipment: 'ロット別出荷実績票'
    }[type] || type || '-';
  }

  function compactJsonDiff(before, after) {
    const b = before || {};
    const a = after || {};
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].slice(0, 3);
    if (!keys.length) return '';
    return keys.map((key) => `${key}: ${String(b[key] ?? '-')} -> ${String(a[key] ?? '-')}`).join(' / ');
  }

  function formatDate(value) {
    if (!value) return '-';
    return String(value).slice(0, 10);
  }

  function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function notify(message, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
    } else {
      alert(message);
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }
})();
