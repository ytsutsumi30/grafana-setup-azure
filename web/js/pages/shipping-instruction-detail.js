(function () {
  'use strict';

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
    picking_completed: 'ピッキング完了',
    shipment_completed: '出荷完了',
    post_completion_corrected: '完了後修正',
    report_printed: '帳票出力'
  };

  let detail = null;
  let instructionId = null;

  document.addEventListener('DOMContentLoaded', () => {
    instructionId = new URLSearchParams(location.search).get('id');
    document.getElementById('refreshButton').addEventListener('click', () => loadDetail());
    document.getElementById('detailActionBar').addEventListener('click', (event) => {
      const completeButton = event.target.closest('[data-action="complete-shipment"]');
      if (completeButton) completeShipment();
      const correctionButton = event.target.closest('[data-action="post-completion-correction"]');
      if (correctionButton) openPostCompletionCorrection();
    });
    document.getElementById('nextActionButtons').addEventListener('click', (event) => {
      const completeButton = event.target.closest('[data-action="complete-shipment"]');
      if (completeButton) completeShipment();
      const correctionButton = event.target.closest('[data-action="post-completion-correction"]');
      if (correctionButton) openPostCompletionCorrection();
    });
    document.getElementById('detailCorrectionAllocation').addEventListener('change', syncCorrectionFields);
    document.getElementById('detailCorrectionSubmit').addEventListener('click', () => submitPostCompletionCorrection());
    if (!instructionId) {
      showError('出荷指示IDが指定されていません。');
      return;
    }
    loadDetail();
  });

  async function loadDetail() {
    setLoading(true);
    try {
      const res = await fetch(`/api/shipping-instructions/${encodeURIComponent(instructionId)}/history`);
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || '出荷指示詳細の取得に失敗しました');
      detail = data;
      render();
      history.replaceState(null, '', `shipping-instruction-detail.html?id=${encodeURIComponent(instructionId)}`);
    } catch (error) {
      showError(error.message);
      notify(error.message, 'ng');
    } finally {
      setLoading(false);
    }
  }

  function render() {
    const shipping = detail.shipping || {};
    document.getElementById('detailError').classList.add('d-none');
    document.getElementById('detailContent').classList.remove('d-none');
    document.getElementById('instructionTitle').textContent = shipping.instruction_id || `#${shipping.id}`;
    document.getElementById('instructionMeta').textContent =
      `${shipping.customer_name || '-'} / 出荷日 ${formatDate(shipping.shipping_date)} / ${shipping.shipping_location_name || '-'} -> ${shipping.delivery_location_name || '-'}`;

    const status = document.getElementById('instructionStatus');
    status.className = `status-badge ${badgeClass(shipping.status)}`;
    status.textContent = statusLabel(shipping.status);

    document.getElementById('quantityLink').href = `shipping-quantity.html?id=${encodeURIComponent(shipping.id)}`;
    document.getElementById('ppsLink').href = `pps.html?id=${encodeURIComponent(shipping.id)}`;
    document.getElementById('historyLink').href = `shipping-history.html?id=${encodeURIComponent(shipping.id)}`;
    document.getElementById('inspectionReportLink').href = `shipping-report.html?id=${encodeURIComponent(shipping.id)}&type=inspection_result`;
    document.getElementById('lotReportLink').href = `shipping-report.html?id=${encodeURIComponent(shipping.id)}&type=lot_shipment`;

    renderKpis();
    renderBlockers();
    renderNextAction();
    renderLines();
    renderScans();
    renderWorkflow();
    renderAudit();
    renderActionBar();
  }

  function renderKpis() {
    const lines = asArray(detail.lines);
    const allocations = asArray(detail.allocations);
    const records = asArray(detail.records);
    const auditEvents = asArray(detail.audit_events);
    const completion = detail.completion || {};
    const required = Number(completion.total_required_quantity || sum(lines, 'allocated_quantity') || sum(lines, 'quantity'));
    const picked = Number(completion.total_picked_quantity || sum(lines, 'picked_quantity'));
    const ngCount = records.filter((record) => record.status && record.status !== 'picked').length;
    const undoCount = auditEvents.filter((event) => event.event_type === 'qr_scan_cancelled').length;
    const correctionCount = auditEvents.filter((event) => event.event_type === 'post_completion_corrected').length;
    const pct = required > 0 ? `${Math.min(100, Math.round(picked / required * 100))}%` : '-';
    const kpis = [
      ['品目数', String(lines.length), 'fa-layer-group'],
      ['ロット引当', `${sum(allocations, 'shipped_quantity')}/${sum(lines, 'quantity')}`, 'fa-boxes-stacked'],
      ['QR検品OK', `${picked}/${required}`, 'fa-qrcode'],
      ['完了率', pct, 'fa-chart-simple'],
      ['NG/警告', String(ngCount), 'fa-triangle-exclamation'],
      ['取消/修正', `${undoCount}/${correctionCount}`, 'fa-rotate-left'],
      ['監査ログ', String(auditEvents.length), 'fa-shield-halved']
    ];
    document.getElementById('detailKpis').innerHTML = kpis.map(([label, value, icon]) => `
      <div class="col-6 col-lg-4 col-xxl-2">
        <div class="detail-kpi">
          <div class="detail-kpi-label"><i class="fas ${icon} me-1"></i>${escapeHtml(label)}</div>
          <div class="detail-kpi-value">${escapeHtml(value)}</div>
        </div>
      </div>`).join('');
  }

  function renderNextAction() {
    const shipping = detail.shipping || {};
    const completion = detail.completion || {};
    const picking = detail.picking || null;
    const packing = detail.packing || null;
    const blockers = asArray(completion.blockers);
    const warnings = asArray(completion.warnings);
    const shipped = ['shipped', 'delivered'].includes(shipping.status);
    const title = document.getElementById('nextActionTitle');
    const description = document.getElementById('nextActionDescription');
    const buttons = document.getElementById('nextActionButtons');
    const quantityHref = `shipping-quantity.html?id=${encodeURIComponent(shipping.id)}`;
    const ppsHref = `pps.html?id=${encodeURIComponent(shipping.id)}`;
    const historyHref = `shipping-history.html?id=${encodeURIComponent(shipping.id)}`;
    const reportHref = `shipping-report.html?id=${encodeURIComponent(shipping.id)}&type=inspection_result`;

    let action = {
      title: '出荷指示を確認してください',
      description: '品目、ロット、QR検品、監査ログの状態を確認できます。',
      tone: 'info',
      buttons: [{ label: 'PPS確認', href: ppsHref, icon: 'fa-boxes-packing', className: 'btn-primary' }]
    };

    if (shipped) {
      const corrections = asArray(detail.audit_events).filter((event) => event.event_type === 'post_completion_corrected').length;
      action = {
        title: corrections > 0 ? '出荷完了後修正があります' : '出荷完了済みです',
        description: corrections > 0
          ? `完了後修正が ${corrections} 件あります。帳票と監査ログで修正内容を確認してください。`
          : '出荷完了後の状態です。帳票発行と履歴確認へ進めます。',
        tone: corrections > 0 ? 'warning' : 'success',
        buttons: [
          { label: '帳票', href: reportHref, icon: 'fa-file-lines', className: 'btn-success' },
          { label: '完了後修正', href: '#correction', icon: 'fa-pen-to-square', className: 'btn-outline-warning', action: 'post-completion-correction' },
          { label: '履歴', href: historyHref, icon: 'fa-clock-rotate-left', className: 'btn-outline-secondary' },
          { label: 'PPS', href: ppsHref, icon: 'fa-boxes-packing', className: 'btn-outline-primary' }
        ]
      };
    } else if (!hasQuantityReady()) {
      action = {
        title: '出荷数とロットを確定してください',
        description: 'PPS 開始前に、すべての品目で適正ロットと出荷数量を確定します。',
        tone: 'warning',
        buttons: [{ label: '出荷数入力', href: quantityHref, icon: 'fa-boxes-stacked', className: 'btn-primary' }]
      };
    } else if (!picking) {
      action = {
        title: 'PPS / QR検品を開始してください',
        description: '確定済みロット引当を正として、QRスキャンと数量入力を開始できます。',
        tone: 'info',
        buttons: [{ label: 'PPS開始', href: ppsHref, icon: 'fa-play', className: 'btn-primary' }]
      };
    } else if (picking.status !== 'completed') {
      action = {
        title: 'QR検品を完了してください',
        description: firstBlockerMessage(blockers, '確定済みロット引当の全数量が QR OK になるまで出荷完了できません。'),
        tone: 'warning',
        buttons: [{ label: 'QR検品', href: ppsHref, icon: 'fa-qrcode', className: 'btn-primary' }]
      };
    } else if (!packing || packing.status !== 'completed') {
      action = {
        title: '梱包を完了してください',
        description: firstBlockerMessage(blockers, 'PICK / QR検品は完了しています。梱包情報を入力してください。'),
        tone: 'warning',
        buttons: [{ label: '梱包へ', href: ppsHref, icon: 'fa-box', className: 'btn-warning' }]
      };
    } else if (completion.can_complete) {
      action = {
        title: '出荷完了できます',
        description: warnings.length
          ? `出荷条件は満たしています。警告: ${warnings.map((w) => w.message).join(' / ')}`
          : '確定済みロット引当の全数量が QR 検品 OK で、梱包も完了しています。',
        tone: warnings.length ? 'warning' : 'success',
        buttons: [{ label: '出荷完了', href: '#complete', icon: 'fa-truck', className: 'btn-success', action: 'complete-shipment' }]
      };
    } else if (blockers.length) {
      action = {
        title: '出荷完了はまだできません',
        description: firstBlockerMessage(blockers, '未完了の作業があります。'),
        tone: 'warning',
        buttons: [{ label: 'PPS確認', href: ppsHref, icon: 'fa-boxes-packing', className: 'btn-outline-primary' }]
      };
    }

    const card = document.getElementById('nextActionCard');
    card.className = `app-card card detail-next-action ${action.tone}`;
    title.textContent = action.title;
    description.textContent = action.description;
    buttons.innerHTML = action.buttons.map((button) => button.action
      ? `<button class="btn ${button.className} btn-sm" type="button" data-action="${escapeHtml(button.action)}">
          <i class="fas ${button.icon} me-1"></i>${escapeHtml(button.label)}
        </button>`
      : `<a class="btn ${button.className} btn-sm" href="${escapeHtml(button.href)}">
          <i class="fas ${button.icon} me-1"></i>${escapeHtml(button.label)}
        </a>`).join('');
  }

  function renderBlockers() {
    const blockers = asArray(detail.completion?.blockers);
    const warnings = asArray(detail.completion?.warnings);
    const card = document.getElementById('blockerCard');
    const list = document.getElementById('blockerList');
    if (!blockers.length && !warnings.length) {
      card.classList.add('d-none');
      return;
    }
    card.classList.remove('d-none');
    list.innerHTML = [
      ...blockers.map((item) => alertLine(item.message, 'danger')),
      ...warnings.map((item) => alertLine(item.message, 'warning'))
    ].join('');
  }

  function renderActionBar() {
    const bar = document.getElementById('detailActionBar');
    const shipping = detail.shipping || {};
    const completion = detail.completion || {};
    const blockers = asArray(completion.blockers);
    const warnings = asArray(completion.warnings);
    const shipped = ['shipped', 'delivered'].includes(shipping.status);

    if (shipped) {
      bar.innerHTML = `
        <div>
          <div class="fw-semibold text-success"><i class="fas fa-check-circle me-1"></i>出荷完了済み</div>
          <div class="small text-muted">${escapeHtml(statusLabel(shipping.status))} として記録されています。</div>
        </div>
        <div class="d-flex gap-2 flex-wrap">
          <button class="btn btn-outline-warning detail-secondary-action" type="button" data-action="post-completion-correction">
            <i class="fas fa-pen-to-square me-1"></i>完了後修正
          </button>
          <a class="btn btn-outline-secondary detail-secondary-action" href="shipping-history.html?id=${encodeURIComponent(shipping.id)}">
            <i class="fas fa-clock-rotate-left me-1"></i>履歴
          </a>
        </div>`;
      bar.classList.add('show');
      return;
    }

    if (completion.can_complete) {
      bar.innerHTML = `
        <div>
          <div class="fw-semibold"><i class="fas fa-truck me-1"></i>出荷完了できます</div>
          <div class="small text-muted">確定済みロット引当の全数量が QR 検品 OK です。</div>
          ${warnings.length ? `<div class="small text-warning mt-1">${warnings.map((w) => escapeHtml(w.message)).join(' / ')}</div>` : ''}
        </div>
        <button class="btn btn-success detail-primary-action" type="button" data-action="complete-shipment">
          <i class="fas fa-check me-1"></i>出荷完了
        </button>`;
      bar.classList.add('show');
      return;
    }

    if (blockers.length) {
      bar.innerHTML = `
        <div>
          <div class="fw-semibold"><i class="fas fa-circle-exclamation me-1"></i>出荷完了はまだできません</div>
          <div class="small text-muted">${escapeHtml(blockers[0].message || '未完了の作業があります。')}</div>
        </div>
        <a class="btn btn-outline-primary detail-secondary-action" href="pps.html?id=${encodeURIComponent(shipping.id)}">
          <i class="fas fa-boxes-packing me-1"></i>PPS確認
        </a>`;
      bar.classList.add('show');
      return;
    }

    bar.classList.remove('show');
    bar.innerHTML = '';
  }

  async function completeShipment() {
    const shipping = detail?.shipping || {};
    const completion = detail?.completion || {};
    if (!completion.can_complete) {
      notify('出荷完了条件を満たしていません。', 'ng');
      return;
    }
    if (!confirm('この出荷指示を出荷完了にしますか？')) return;

    const bar = document.getElementById('detailActionBar');
    const button = bar.querySelector('[data-action="complete-shipment"]');
    if (button) {
      button.disabled = true;
      button.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>記録中';
    }

    try {
      const res = await fetch(`/api/shipping-instructions/${encodeURIComponent(shipping.id)}/complete-shipment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: '出荷指示詳細画面から出荷完了' })
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || '出荷完了に失敗しました');
      notify('出荷完了を記録しました。', 'ok');
      await loadDetail();
    } catch (error) {
      notify(error.message, 'ng');
      renderActionBar();
    }
  }

  function openPostCompletionCorrection() {
    const shipping = detail?.shipping || {};
    if (!['shipped', 'delivered'].includes(shipping.status)) {
      notify('完了後修正は出荷完了後のみ実行できます。', 'warning');
      return;
    }
    const allocations = asArray(detail.allocations).filter((allocation) => Number(allocation.id || 0) > 0);
    if (!allocations.length) {
      notify('完了後修正できるロット引当がありません。', 'warning');
      return;
    }

    const select = document.getElementById('detailCorrectionAllocation');
    select.innerHTML = allocations.map((allocation) => `
      <option value="${Number(allocation.id)}"
              data-lot="${escapeHtml(allocation.lot_number || '')}"
              data-qty="${Number(allocation.shipped_quantity || 0)}">
        ${escapeHtml(allocation.product_code || '')} ${escapeHtml(allocation.product_name || '')}
        / ${escapeHtml(allocation.lot_number || '-')}
        / ${Number(allocation.shipped_quantity || 0)}個
      </option>`).join('');
    document.getElementById('detailCorrectionReason').value = 'lot_entry_error';
    document.getElementById('detailCorrectionComment').value = '';
    syncCorrectionFields();
    new bootstrap.Modal(document.getElementById('detailCorrectionModal')).show();
  }

  function syncCorrectionFields() {
    const option = document.getElementById('detailCorrectionAllocation').selectedOptions[0];
    document.getElementById('detailCorrectionLotNumber').value = option ? option.dataset.lot || '' : '';
    document.getElementById('detailCorrectionQuantity').value = option ? option.dataset.qty || '' : '';
  }

  async function submitPostCompletionCorrection() {
    const shipping = detail?.shipping || {};
    const allocationId = Number(document.getElementById('detailCorrectionAllocation').value);
    const lotNumber = document.getElementById('detailCorrectionLotNumber').value.trim();
    const shippedQuantity = Number(document.getElementById('detailCorrectionQuantity').value);
    const reasonCode = document.getElementById('detailCorrectionReason').value;
    const comment = document.getElementById('detailCorrectionComment').value.trim();
    if (!allocationId || !lotNumber || !shippedQuantity || shippedQuantity < 1) {
      notify('修正対象、ロット番号、数量を確認してください。', 'warning');
      return;
    }
    if (!comment) {
      notify('完了後修正にはコメント入力が必要です。', 'warning');
      document.getElementById('detailCorrectionComment').focus();
      return;
    }

    const submitButton = document.getElementById('detailCorrectionSubmit');
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>記録中';
    try {
      const res = await fetch(`/api/shipping-instructions/${encodeURIComponent(shipping.id)}/post-completion-corrections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allocation_id: allocationId,
          lot_number: lotNumber,
          shipped_quantity: shippedQuantity,
          reason_code: reasonCode,
          comment
        })
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || '完了後修正に失敗しました');
      bootstrap.Modal.getInstance(document.getElementById('detailCorrectionModal')).hide();
      notify('完了後修正を監査ログへ記録しました。', 'success');
      await loadDetail();
    } catch (error) {
      notify(error.message, 'ng');
    } finally {
      submitButton.disabled = false;
      submitButton.innerHTML = '<i class="fas fa-check me-1"></i>理由付きで修正';
    }
  }

  function renderLines() {
    const lines = asArray(detail.lines);
    document.getElementById('lineCards').innerHTML = lines.map((line) => {
      const required = Number(line.quantity || 0);
      const allocated = Number(line.allocated_quantity || line.shipped_quantity || 0);
      const picked = Number(line.picked_quantity || 0);
      const allocPct = required > 0 ? Math.min(100, Math.round(allocated / required * 100)) : 0;
      const pickPct = allocated > 0 ? Math.min(100, Math.round(picked / allocated * 100)) : 0;
      const isComplete = allocated >= required && picked >= allocated && allocated > 0;
      const hasNg = Number(line.ng_scan_count || 0) > 0;
      return `
        <div class="col-12 col-lg-6">
          <article class="detail-line-card ${isComplete ? 'complete' : 'warning'}">
            <div class="d-flex justify-content-between gap-2 align-items-start">
              <div>
                <h3 class="h6 mb-1">${escapeHtml(line.product_code || '')} ${escapeHtml(line.product_name || '')}</h3>
                <div class="text-muted small">指示 ${required} / 引当 ${allocated} / QR OK ${picked}</div>
              </div>
              <span class="badge ${hasNg ? 'badge-ng' : isComplete ? 'badge-ok' : 'badge-pending'}">${hasNg ? `NG ${Number(line.ng_scan_count || 0)}` : isComplete ? '完了' : '進行中'}</span>
            </div>
            ${progressBlock('ロット引当', allocated, required, allocPct, '')}
            ${progressBlock('QR検品', picked, allocated || required, pickPct, 'bg-success')}
            <div class="mt-2">
              ${renderLineLots(line)}
            </div>
          </article>
        </div>`;
    }).join('') || `<div class="text-muted small">品目明細がありません。</div>`;
  }

  function renderLineLots(line) {
    const allocations = asArray(line.allocations);
    if (!allocations.length) return '<span class="text-muted small">ロット引当なし</span>';
    return allocations.map((allocation) => {
      const required = Number(allocation.shipped_quantity || 0);
      const picked = Number(allocation.picked_quantity || 0);
      const remaining = Math.max(0, required - picked);
      const cls = required > 0 && remaining === 0 ? 'complete' : picked > 0 ? 'warning' : '';
      return `
        <span class="detail-lot-chip ${cls}">
          <i class="fas fa-box"></i>
          ${escapeHtml(allocation.lot_number)} ${picked}/${required}
        </span>`;
    }).join('');
  }

  function renderScans() {
    const records = getScanTimelineItems().slice(0, 100);
    const emptyRow = `<tr><td colspan="6" class="text-muted text-center py-4">QR/スキャン履歴がありません。</td></tr>`;
    const emptyCard = `<div class="text-muted small p-3">QR/スキャン履歴がありません。</div>`;
    document.getElementById('scanRows').innerHTML = records.map((record) => `
      <tr>
        <td class="small">${formatDateTime(record.occurred_at || record.scanned_at)}</td>
        <td><span class="badge ${scanBadgeClass(record.status)}">${escapeHtml(scanStatusLabel(record.status))}</span></td>
        <td>${escapeHtml(record.product_code || '-')}<br><span class="text-muted small">${escapeHtml(record.product_name || '')}</span></td>
        <td><code>${escapeHtml(record.lot_number || '-')}</code><br><span class="text-muted small">${escapeHtml(record.qr_code || record.scan_source || '')}</span></td>
        <td class="text-end">${Number(record.picked_quantity || 0)}</td>
        <td class="small">${escapeHtml(record.error_message || record.reason_code || '-')}</td>
      </tr>`).join('') || emptyRow;
    document.getElementById('scanCards').innerHTML = records.map((record) => `
      <article class="detail-scan-card ${scanCardClass(record.status)}">
        <div class="d-flex justify-content-between gap-2">
          <span class="badge ${scanBadgeClass(record.status)}">${escapeHtml(scanStatusLabel(record.status))}</span>
          <span class="text-muted small">${formatDateTime(record.occurred_at || record.scanned_at)}</span>
        </div>
        <div class="fw-semibold mt-2">${escapeHtml(record.product_code || '-')} ${escapeHtml(record.product_name || '')}</div>
        <div class="detail-scan-code mt-1">
          <div><span class="text-muted">ロット</span> ${escapeHtml(record.lot_number || '-')}</div>
          <div><span class="text-muted">QR</span> ${escapeHtml(record.qr_code || record.scan_source || '-')}</div>
        </div>
        <div class="d-flex justify-content-between align-items-center mt-2">
          <span class="text-muted small">数量</span>
          <strong>${Number(record.picked_quantity || 0)}</strong>
        </div>
        <div class="small text-muted mt-1">${escapeHtml(record.error_message || record.reason_code || '-')}</div>
      </article>`).join('') || emptyCard;
  }

  function renderWorkflow() {
    const picking = detail.picking || null;
    const packing = detail.packing || null;
    const completion = detail.completion || {};
    const shipping = detail.shipping || {};
    const steps = [
      {
        title: '数量確定',
        status: sum(asArray(detail.allocations), 'shipped_quantity') > 0 ? 'complete' : 'active',
        body: `ロット引当 ${sum(asArray(detail.allocations), 'shipped_quantity')} 個`
      },
      {
        title: 'PICK / QR検品',
        status: picking?.status === 'completed' ? 'complete' : picking ? 'active' : '',
        body: picking ? `${picking.picker_name || '-'} / ${Number(picking.picked_quantity || 0)}/${Number(picking.total_quantity || 0)}` : '未開始'
      },
      {
        title: 'PACK',
        status: packing?.status === 'completed' ? 'complete' : packing ? 'active' : '',
        body: packing ? `${packing.packer_name || '-'} / ${Number(packing.packed_quantity || 0)}個 / ${Number(packing.box_count || 0)}箱` : '未開始'
      },
      {
        title: 'SHIP',
        status: ['shipped', 'delivered'].includes(shipping.status) ? 'complete' : completion.can_complete ? 'active' : '',
        body: ['shipped', 'delivered'].includes(shipping.status) ? statusLabel(shipping.status) : completion.can_complete ? '出荷完了可能' : '条件未達'
      }
    ];
    document.getElementById('workflowSteps').innerHTML = steps.map((step) => `
      <div class="detail-step ${step.status}">
        <div class="fw-semibold">${escapeHtml(step.title)}</div>
        <div class="text-muted small">${escapeHtml(step.body)}</div>
      </div>`).join('');
  }

  function renderAudit() {
    const events = asArray(detail.audit_events).slice(0, 20);
    document.getElementById('auditList').innerHTML = events.map((event) => `
      <div class="list-group-item">
        <div class="d-flex justify-content-between gap-2">
          <strong class="small">${escapeHtml(eventLabel(event.event_type))}</strong>
          <span class="text-muted small">${formatDateTime(event.occurred_at)}</span>
        </div>
        <div class="small">${escapeHtml(event.product_code || '-')} / ${escapeHtml(event.lot_number || event.qr_code || '-')}</div>
        <div class="text-muted small">${escapeHtml(event.comment || event.reason_code || '')}</div>
      </div>`).join('') || `<div class="list-group-item text-muted small">監査ログがありません。</div>`;
  }

  function getScanTimelineItems() {
    const scanRecords = asArray(detail.records).map((record) => ({
      ...record,
      occurred_at: record.scanned_at,
      timeline_type: 'scan'
    }));
    const auditScans = asArray(detail.audit_events)
      .filter((event) => ['qr_scan_cancelled', 'post_completion_corrected'].includes(event.event_type))
      .map((event) => ({
        id: `audit-${event.id}`,
        occurred_at: event.occurred_at,
        scanned_at: event.occurred_at,
        status: event.event_type === 'qr_scan_cancelled' ? 'cancelled' : 'corrected',
        product_code: event.product_code,
        product_name: event.product_name,
        lot_number: event.lot_number || event.after_data?.lot_number || event.before_data?.lot_number,
        qr_code: event.qr_code,
        scan_source: event.event_type === 'qr_scan_cancelled' ? '監査ログ: 取消' : '監査ログ: 完了後修正',
        picked_quantity: event.quantity || event.after_data?.shipped_quantity || 0,
        error_message: event.comment || event.reason_code || eventLabel(event.event_type),
        reason_code: event.reason_code,
        timeline_type: 'audit'
      }));
    return [...scanRecords, ...auditScans].sort((a, b) =>
      new Date(b.occurred_at || b.scanned_at || 0).getTime() - new Date(a.occurred_at || a.scanned_at || 0).getTime()
    );
  }

  function progressBlock(label, value, total, pct, barClass) {
    return `
      <div class="mt-3">
        <div class="d-flex justify-content-between small text-muted">
          <span>${escapeHtml(label)}</span><span>${Number(value || 0)}/${Number(total || 0)}</span>
        </div>
        <div class="progress mt-1" style="height:8px">
          <div class="progress-bar ${barClass || ''}" style="width:${pct}%"></div>
        </div>
      </div>`;
  }

  function alertLine(message, type) {
    return `<div class="alert alert-${type} py-2 mb-2 small">${escapeHtml(message || '-')}</div>`;
  }

  function setLoading(active) {
    document.getElementById('detailLoading').classList.toggle('d-none', !active);
    if (active) {
      document.getElementById('detailError').classList.add('d-none');
    }
  }

  function showError(message) {
    document.getElementById('detailLoading').classList.add('d-none');
    document.getElementById('detailContent').classList.add('d-none');
    document.getElementById('detailError').classList.remove('d-none');
    document.getElementById('detailErrorMessage').textContent = message;
  }

  async function readJson(res) {
    try {
      return await res.json();
    } catch (error) {
      return {};
    }
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function sum(rows, field) {
    return asArray(rows).reduce((total, row) => total + Number(row[field] || 0), 0);
  }

  function badgeClass(status) {
    if (['shipped', 'delivered', 'completed'].includes(status)) return 'badge-ok';
    if (['picking', 'packing', 'inspecting', 'processing'].includes(status)) return 'badge-progress';
    return 'badge-pending';
  }

  function scanBadgeClass(status) {
    if (status === 'picked') return 'badge-ok';
    if (status === 'cancelled') return 'badge-pending';
    if (status === 'corrected') return 'badge-progress';
    if (status === 'duplicate') return 'badge-pending';
    return 'badge-ng';
  }

  function scanStatusLabel(status) {
    return {
      picked: 'OK',
      duplicate: '重複',
      error: 'NG',
      cancelled: '取消',
      corrected: '修正'
    }[status] || status || '-';
  }

  function scanCardClass(status) {
    if (status === 'picked') return 'ok';
    if (status === 'duplicate' || status === 'cancelled' || status === 'corrected') return 'warn';
    return 'ng';
  }

  function hasQuantityReady() {
    const lines = asArray(detail.lines);
    if (!lines.length) return false;
    return lines.every((line) => {
      const required = Number(line.quantity || 0);
      const allocated = Number(line.allocated_quantity || line.shipped_quantity || 0);
      return required > 0 && allocated >= required;
    });
  }

  function firstBlockerMessage(blockers, fallback) {
    const first = asArray(blockers)[0];
    return first?.message || fallback;
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || '-';
  }

  function eventLabel(type) {
    return EVENT_LABELS[type] || type || '-';
  }

  function formatDate(value) {
    return value ? String(value).slice(0, 10) : '-';
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
