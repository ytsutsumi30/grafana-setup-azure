(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const instructionId = params.get('id');
  const reportType = params.get('type') === 'lot_shipment' ? 'lot_shipment' : 'inspection_result';
  let reportData = null;
  let reportIssue = null;

  const REPORT_LABELS = {
    inspection_result: '出荷検品結果票',
    lot_shipment: 'ロット別出荷実績票'
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('reportPrintButton').addEventListener('click', printReport);
    if (!instructionId) {
      showError('出荷指示 ID が指定されていません。');
      return;
    }
    loadReport();
  });

  async function loadReport() {
    try {
      const res = await fetch(`/api/shipping-instructions/${encodeURIComponent(instructionId)}/history`);
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || '帳票データの取得に失敗しました。');
      reportData = data;
      renderReport();
      if (params.get('print') === '1') {
        setTimeout(printReport, 300);
      }
    } catch (error) {
      showError(error.message);
    }
  }

  function renderReport() {
    const shipping = reportData.shipping;
    const label = REPORT_LABELS[reportType];
    reportIssue = buildReportIssue(reportData.audit_events || []);
    const revision = reportIssue.label;
    document.title = `${label} ${shipping.instruction_id} - 出荷検品システム`;
    document.getElementById('reportScreenTitle').textContent = label;
    document.getElementById('reportScreenMeta').textContent =
      `${shipping.instruction_id} / ${shipping.customer_name || '-'} / ${revision}`;
    document.getElementById('historyLink').href = `shipping-history.html?id=${encodeURIComponent(shipping.id)}`;
    document.getElementById('reportLoading').classList.add('d-none');

    const documentEl = document.getElementById('reportDocument');
    documentEl.classList.remove('d-none');
    documentEl.innerHTML = reportType === 'lot_shipment'
      ? renderLotShipmentReport(shipping, revision)
      : renderInspectionResultReport(shipping, revision);
  }

  function renderInspectionResultReport(shipping, revision) {
    const lines = reportData.lines || [];
    const records = reportData.records || [];
    const auditEvents = reportData.audit_events || [];
    const correctionEvents = auditEvents.filter((event) => event.event_type === 'post_completion_corrected');
    const cancelEvents = auditEvents.filter((event) => event.event_type === 'qr_scan_cancelled');
    const completion = reportData.completion || {};
    const ngRecords = records.filter((record) => record.status !== 'picked');
    const reportNo = reportNumber(shipping, 'IR', reportIssue.issueNumber);
    const totalRequired = Number(completion.total_required_quantity || 0);
    const totalPicked = Number(completion.total_picked_quantity || 0);

    return `
      <article class="report-page">
        ${renderHeader('出荷検品結果票', reportNo, revision)}
        ${renderBasicInfo(shipping)}
        <section class="report-section">
          <div class="row g-2">
            ${renderKpi('出荷対象数量', totalRequired)}
            ${renderKpi('検品 OK 数量', totalPicked)}
            ${renderKpi('NG / 警告件数', ngRecords.length)}
            ${renderKpi('取消 / 修正', `${cancelEvents.length}/${correctionEvents.length}`)}
            ${renderKpi('出荷状態', statusLabel(shipping.status))}
          </div>
        </section>
        <section class="report-section">
          <h3>品目別検品結果</h3>
          <table class="report-table">
            <thead>
              <tr>
                <th>品目コード</th><th>品目名</th><th class="text-end">指示数</th><th class="text-end">引当数</th><th class="text-end">検品OK</th><th class="text-end">NG</th>
              </tr>
            </thead>
            <tbody>
              ${lines.map((line) => `
                <tr>
                  <td>${escapeHtml(line.product_code || '')}</td>
                  <td>${escapeHtml(line.product_name || '')}</td>
                  <td class="text-end">${Number(line.quantity || 0)}</td>
                  <td class="text-end">${Number(line.allocated_quantity || line.shipped_quantity || 0)}</td>
                  <td class="text-end">${Number(line.picked_quantity || 0)}</td>
                  <td class="text-end">${Number(line.ng_scan_count || 0)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </section>
        <section class="report-section">
          <h3>ロット別検品結果</h3>
          ${renderLotSummaryTable(reportData.allocations || [])}
        </section>
        <section class="report-section">
          <h3>NG / 警告スキャン</h3>
          ${renderNgRecordsTable(ngRecords)}
        </section>
        <section class="report-section">
          <h3>主要監査イベント</h3>
          ${renderAuditSummaryTable(auditEvents)}
        </section>
        <section class="report-section">
          <h3>取消 / 完了後修正</h3>
          ${renderCorrectionSummaryTable(auditEvents)}
        </section>
        <section class="report-section">
          <h3>帳票発行履歴</h3>
          ${renderReportIssueHistory(auditEvents)}
        </section>
        ${renderFooter()}
      </article>`;
  }

  function renderLotShipmentReport(shipping, revision) {
    const allocations = reportData.allocations || [];
    const records = getScanTimelineItems();
    const reportNo = reportNumber(shipping, 'LR', reportIssue.issueNumber);

    return `
      <article class="report-page">
        ${renderHeader('ロット別出荷実績票', reportNo, revision)}
        ${renderBasicInfo(shipping)}
        <section class="report-section">
          <h3>ロット別出荷実績</h3>
          ${renderLotSummaryTable(allocations)}
        </section>
        <section class="report-section">
          <h3>QR / スキャン単位実績</h3>
          <table class="report-table">
            <thead>
              <tr>
                <th>日時</th><th>結果</th><th>QR / 入力値</th><th>品目</th><th>ロット</th><th class="text-end">数量</th><th>備考</th>
              </tr>
            </thead>
            <tbody>
              ${records.map((record) => `
                <tr>
                  <td>${formatDateTime(record.occurred_at || record.scanned_at)}</td>
                  <td>${escapeHtml(scanStatusLabel(record.status))}</td>
                  <td>${escapeHtml(record.qr_code || record.lot_number || '-')}<br>${escapeHtml(record.scan_source || '')}</td>
                  <td>${escapeHtml(record.product_code || '-')}</td>
                  <td>${escapeHtml(record.lot_number || '-')}</td>
                  <td class="text-end">${Number(record.picked_quantity || 0)}</td>
                  <td>${escapeHtml(record.error_message || '')}</td>
                </tr>`).join('') || '<tr><td colspan="7" class="text-muted">スキャン実績なし</td></tr>'}
            </tbody>
          </table>
        </section>
        <section class="report-section">
          <h3>取消 / 完了後修正</h3>
          ${renderCorrectionSummaryTable(reportData.audit_events || [])}
        </section>
        <section class="report-section">
          <h3>帳票発行履歴</h3>
          ${renderReportIssueHistory(reportData.audit_events || [])}
        </section>
        ${renderFooter()}
      </article>`;
  }

  function renderHeader(title, reportNo, revision) {
    return `
      <header class="report-header d-flex justify-content-between gap-3 align-items-start">
        <div>
          <h1 class="report-title">${escapeHtml(title)}</h1>
          <div class="text-muted small">帳票番号: ${escapeHtml(reportNo)}</div>
          <div class="text-muted small">出力日時: ${escapeHtml(formatDateTime(new Date().toISOString()))}</div>
        </div>
        <div class="report-mark">${escapeHtml(revision)}</div>
      </header>`;
  }

  function renderBasicInfo(shipping) {
    return `
      <section class="report-section">
        <h3>出荷指示情報</h3>
        <table class="report-table">
          <tbody>
            <tr><th>出荷指示番号</th><td>${escapeHtml(shipping.instruction_id)}</td><th>顧客名</th><td>${escapeHtml(shipping.customer_name || '-')}</td></tr>
            <tr><th>出荷予定日</th><td>${escapeHtml(formatDate(shipping.shipping_date))}</td><th>ステータス</th><td>${escapeHtml(statusLabel(shipping.status))}</td></tr>
            <tr><th>出荷元</th><td>${escapeHtml(shipping.shipping_location_name || '-')}</td><th>配送先</th><td>${escapeHtml(shipping.delivery_location_name || '-')}</td></tr>
            <tr><th>備考</th><td colspan="3">${escapeHtml(shipping.notes || '')}</td></tr>
          </tbody>
        </table>
      </section>`;
  }

  function renderKpi(label, value) {
    return `
      <div class="col-6 col-lg-3">
        <div class="report-kpi">
          <div class="report-kpi-label">${escapeHtml(label)}</div>
          <div class="report-kpi-value">${escapeHtml(value)}</div>
        </div>
      </div>`;
  }

  function renderLotSummaryTable(allocations) {
    return `
      <table class="report-table">
        <thead>
          <tr>
            <th>品目コード</th><th>品目名</th><th>ロット</th><th>保管場所</th><th class="text-end">引当数</th><th class="text-end">検品OK</th><th class="text-end">残</th>
          </tr>
        </thead>
        <tbody>
          ${allocations.map((allocation) => `
            <tr>
              <td>${escapeHtml(allocation.product_code || '')}</td>
              <td>${escapeHtml(allocation.product_name || '')}</td>
              <td>${escapeHtml(allocation.lot_number || '')}</td>
              <td>${escapeHtml(allocation.location || '-')}</td>
              <td class="text-end">${Number(allocation.shipped_quantity || 0)}</td>
              <td class="text-end">${Number(allocation.picked_quantity || 0)}</td>
              <td class="text-end">${Number(allocation.remaining_pick_quantity || 0)}</td>
            </tr>`).join('') || '<tr><td colspan="7" class="text-muted">ロット実績なし</td></tr>'}
        </tbody>
      </table>`;
  }

  function renderNgRecordsTable(records) {
    if (!records.length) {
      return '<div class="text-muted small">NG / 警告スキャンはありません。</div>';
    }
    return `
      <table class="report-table">
        <thead>
          <tr><th>日時</th><th>区分</th><th>QR / 入力値</th><th>品目</th><th>ロット</th><th>コメント</th></tr>
        </thead>
        <tbody>
          ${records.map((record) => `
            <tr>
              <td>${formatDateTime(record.scanned_at)}</td>
              <td>${escapeHtml(scanStatusLabel(record.status))}</td>
              <td>${escapeHtml(record.qr_code || record.lot_number || '-')}</td>
              <td>${escapeHtml(record.product_code || '-')}</td>
              <td>${escapeHtml(record.lot_number || '-')}</td>
              <td>${escapeHtml(record.error_message || '')}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function renderAuditSummaryTable(events) {
    const visible = events.filter((event) => [
      'shipment_completed',
      'post_completion_corrected',
      'qr_scan_cancelled',
      'qr_scan_ng',
      'qr_scan_duplicate',
      'report_printed'
    ].includes(event.event_type)).slice(0, 20);
    if (!visible.length) {
      return '<div class="text-muted small">主要監査イベントはありません。</div>';
    }
    return `
      <table class="report-table">
        <thead>
          <tr><th>日時</th><th>イベント</th><th>品目/ロット</th><th>理由</th><th>コメント</th></tr>
        </thead>
        <tbody>
          ${visible.map((event) => `
            <tr>
              <td>${formatDateTime(event.occurred_at)}</td>
              <td>${escapeHtml(eventLabel(event.event_type))}</td>
              <td>${escapeHtml(event.product_code || '-')} / ${escapeHtml(event.qr_code || event.lot_number || '-')}</td>
              <td>${escapeHtml(event.reason_code || '-')}</td>
              <td>${escapeHtml(event.comment || '')}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function renderCorrectionSummaryTable(events) {
    const visible = events
      .filter((event) => ['qr_scan_cancelled', 'post_completion_corrected'].includes(event.event_type))
      .slice(0, 50);
    if (!visible.length) {
      return '<div class="text-muted small">取消 / 完了後修正はありません。</div>';
    }
    return `
      <table class="report-table">
        <thead>
          <tr><th>日時</th><th>区分</th><th>品目</th><th>ロット</th><th class="text-end">数量</th><th>理由</th><th>コメント / 変更内容</th></tr>
        </thead>
        <tbody>
          ${visible.map((event) => `
            <tr>
              <td>${formatDateTime(event.occurred_at)}</td>
              <td>${escapeHtml(eventLabel(event.event_type))}</td>
              <td>${escapeHtml(event.product_code || '-')}</td>
              <td>${escapeHtml(event.lot_number || event.after_data?.lot_number || event.before_data?.lot_number || '-')}</td>
              <td class="text-end">${event.quantity == null ? '-' : Number(event.quantity)}</td>
              <td>${escapeHtml(event.reason_code || '-')}</td>
              <td>${escapeHtml(correctionDetailText(event))}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function renderReportIssueHistory(events) {
    const reportEvents = events
      .filter((event) => event.event_type === 'report_printed' && event.after_data?.report_type === reportType)
      .sort((a, b) => Number(a.after_data?.issue_number || 0) - Number(b.after_data?.issue_number || 0));
    const pendingRow = {
      occurred_at: new Date().toISOString(),
      actor_name: '現在の出力',
      after_data: {
        issue_number: reportIssue.issueNumber,
        revision_label: reportIssue.label,
        output_method: 'html_print'
      }
    };
    const rows = [...reportEvents, pendingRow];
    return `
      <table class="report-table">
        <thead>
          <tr><th>版</th><th>表示</th><th>出力方法</th><th>出力者</th><th>日時</th></tr>
        </thead>
        <tbody>
          ${rows.map((event) => `
            <tr>
              <td>第${Number(event.after_data?.issue_number || 0)}版</td>
              <td>${escapeHtml(event.after_data?.revision_label || '-')}</td>
              <td>${escapeHtml(outputMethodLabel(event.after_data?.output_method))}</td>
              <td>${escapeHtml(event.user_name || event.user_email || event.actor_name || event.actor_email || '-')}</td>
              <td>${formatDateTime(event.occurred_at)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function getScanTimelineItems() {
    const scanRecords = (reportData.records || []).map((record) => ({
      ...record,
      occurred_at: record.scanned_at
    }));
    const auditRecords = (reportData.audit_events || [])
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

  function renderFooter() {
    return `
      <footer class="report-footer">
        <div class="report-sign-box">作業者</div>
        <div class="report-sign-box">確認者</div>
        <div class="report-sign-box">承認者</div>
      </footer>`;
  }

  async function printReport() {
    if (!reportData) return;
    await recordReportEvent();
    window.print();
  }

  async function recordReportEvent() {
    try {
      const issue = reportIssue || buildReportIssue(reportData.audit_events || []);
      const res = await fetch(`/api/shipping-instructions/${encodeURIComponent(instructionId)}/report-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_type: reportType,
          output_method: 'html_print',
          revision_label: issue.label,
          comment: `${REPORT_LABELS[reportType]}を出力`
        })
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || '帳票出力ログの記録に失敗しました。');
      reportIssue = {
        issueNumber: Number(data.issue_number || issue.issueNumber),
        label: data.revision_label || issue.label
      };
    } catch (error) {
      notify('帳票出力ログの記録に失敗しました。', 'ng');
    }
  }

  function reportNumber(shipping, prefix, issueNumber) {
    const datePart = formatDate(new Date().toISOString()).replaceAll('-', '');
    const issuePart = String(issueNumber || 1).padStart(2, '0');
    return `${prefix}-${shipping.instruction_id}-${datePart}-${issuePart}`;
  }

  function buildReportIssue(events) {
    const hasCorrection = events.some((event) => event.event_type === 'post_completion_corrected');
    const issueNumber = events.filter((event) =>
      event.event_type === 'report_printed' && event.after_data?.report_type === reportType
    ).length + 1;
    if (issueNumber === 1) {
      return {
        issueNumber,
        label: hasCorrection ? '修正版' : '初版'
      };
    }
    return {
      issueNumber,
      label: hasCorrection ? `修正版・再発行${issueNumber}` : `再発行${issueNumber}`
    };
  }

  async function readJson(res) {
    try {
      return await res.json();
    } catch (error) {
      return {};
    }
  }

  function showError(message) {
    document.getElementById('reportLoading').innerHTML = `<div class="card-body text-danger">${escapeHtml(message)}</div>`;
    notify(message, 'ng');
  }

  function statusLabel(status) {
    return {
      pending: '未着手',
      picking: 'ピッキング中',
      packing: '梱包中',
      inspecting: '検品中',
      processing: '処理中',
      shipped: '出荷済',
      delivered: '配達済'
    }[status] || status || '-';
  }

  function scanStatusLabel(status) {
    return {
      picked: 'OK',
      duplicate: '重複',
      error: 'NG',
      cancelled: '取消',
      corrected: '修正'
    }[status] || status || 'NG';
  }

  function eventLabel(type) {
    return {
      shipment_completed: '出荷完了',
      post_completion_corrected: '完了後修正',
      qr_scan_cancelled: 'QRスキャン取消',
      qr_scan_ng: 'QR検品NG',
      qr_scan_duplicate: '重複スキャン',
      report_printed: '帳票出力'
    }[type] || type || '-';
  }

  function outputMethodLabel(method) {
    return {
      html_print: 'HTML印刷',
      browser_pdf: 'ブラウザPDF保存'
    }[method] || method || '-';
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
