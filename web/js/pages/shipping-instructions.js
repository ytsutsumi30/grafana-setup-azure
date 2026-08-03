const API_BASE_URL = '/api';
let currentEditingId = null;
let products = [];
let shippingLocations = [];
let deliveryLocations = [];
let instructionsCache = [];
let isSavingInstruction = false;
const deletingInstructionIds = new Set();

// ページ読み込み時にデータ取得
document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('createInstructionButton')?.addEventListener('click', openCreateModal);
    document.getElementById('refreshInstructionsButton')?.addEventListener('click', loadInstructions);
    document.getElementById('saveInstructionButton')?.addEventListener('click', saveInstruction);
    document.getElementById('instructionsTableBody')?.addEventListener('click', handleInstructionActionClick);
    document.getElementById('instructionsMobileList')?.addEventListener('click', handleInstructionActionClick);

    await loadMasterData();
    await loadInstructions();
});

// ローディング表示制御
function showLoading() {
    document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
}

// マスタデータ取得
async function loadMasterData() {
    try {
        const [productsRes, shippingRes, deliveryRes] = await Promise.all([
            fetch(`${API_BASE_URL}/products`),
            fetch(`${API_BASE_URL}/shipping-locations`),
            fetch(`${API_BASE_URL}/delivery-locations`)
        ]);

        if (!productsRes.ok || !shippingRes.ok || !deliveryRes.ok) {
            throw new Error('マスタデータの取得に失敗しました');
        }

        products = await productsRes.json();
        shippingLocations = await shippingRes.json();
        deliveryLocations = await deliveryRes.json();

        // プルダウン更新
        updateProductSelect();
        updateShippingLocationSelect();
        updateDeliveryLocationSelect();
    } catch (error) {
        console.error('Error loading master data:', error);
        showError('マスタデータの取得に失敗しました');
    }
}

// 製品プルダウン更新
function updateProductSelect() {
    const select = document.getElementById('productId');
    select.innerHTML = '<option value="">製品を選択してください</option>';
    products.forEach(product => {
        const option = document.createElement('option');
        option.value = product.id;
        option.textContent = `${product.product_code} - ${product.product_name}`;
        select.appendChild(option);
    });
}

// 出荷元拠点プルダウン更新
function updateShippingLocationSelect() {
    const select = document.getElementById('shippingLocationId');
    select.innerHTML = '<option value="">選択してください</option>';
    shippingLocations.forEach(location => {
        const option = document.createElement('option');
        option.value = location.id;
        option.textContent = `${location.location_code} - ${location.location_name}`;
        select.appendChild(option);
    });
}

// 配送先拠点プルダウン更新
function updateDeliveryLocationSelect() {
    const select = document.getElementById('deliveryLocationId');
    select.innerHTML = '<option value="">選択してください</option>';
    deliveryLocations.forEach(location => {
        const option = document.createElement('option');
        option.value = location.id;
        option.textContent = `${location.location_code} - ${location.location_name}`;
        select.appendChild(option);
    });
}

// 出荷指示一覧取得
async function loadInstructions() {
    const refreshButton = document.getElementById('refreshInstructionsButton');
    setButtonBusy(refreshButton, true, '更新中');
    showLoading();
    try {
        const response = await fetch(`${API_BASE_URL}/shipping-instructions`);
        if (!response.ok) throw new Error('出荷指示一覧の取得に失敗しました');

        const instructions = await response.json();
        instructionsCache = Array.isArray(instructions) ? instructions : [];
        renderInstructionsTable(instructionsCache);
        renderInstructionsMobile(instructionsCache);
        renderShippingSummary(instructionsCache);
    } catch (error) {
        console.error('Error loading instructions:', error);
        showError('出荷指示一覧の取得に失敗しました');
        document.getElementById('instructionsTableBody').innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-danger py-5">
                    <i class="fas fa-exclamation-triangle fa-3x mb-3"></i>
                    <p>${error.message}</p>
                </td>
            </tr>
        `;
        document.getElementById('instructionsMobileList').innerHTML = shippingLoadError(error.message);
        document.getElementById('shippingSummary').textContent = '出荷指示を取得できませんでした。';
    } finally {
        hideLoading();
        setButtonBusy(refreshButton, false);
    }
}

// テーブル描画
function renderInstructionsTable(instructions) {
    const tbody = document.getElementById('instructionsTableBody');

    if (instructions.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-muted py-5">
                    <i class="fas fa-inbox fa-3x mb-3"></i>
                    <p>出荷指示が登録されていません</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = instructions.map(instruction => {
        const shippingDate = instruction.shipping_date ? new Date(instruction.shipping_date).toLocaleDateString('ja-JP') : '-';
        const priorityBadge = getPriorityBadge(instruction.priority);
        const statusBadge = getStatusBadge(instruction.status);

        return `
            <tr>
                <td>
                    <strong class="shipping-code">${escapeHtml(instruction.instruction_id)}</strong>
                    <div class="small text-muted">${escapeHtml(instruction.shipping_location_code || '-')} → ${escapeHtml(instruction.delivery_location_code || '-')}</div>
                </td>
                <td>
                    <strong>${instruction.customer_name ? escapeHtml(instruction.customer_name) : '<span class="text-muted">未設定</span>'}</strong>
                    <div class="small text-muted">出荷日 ${shippingDate}</div>
                </td>
                <td>${escapeHtml(instruction.product_code)} ${escapeHtml(instruction.product_name)}<div class="small text-muted">数量 ${Number(instruction.quantity || 0)}</div></td>
                <td><div class="d-flex flex-wrap gap-1">${priorityBadge}${statusBadge}</div></td>
                <td>${renderAuditFlags(instruction)}</td>
                <td><div class="progress-cell" data-progress-id="${instruction.id}">
                    <span class="text-muted small">…</span>
                </div></td>
                <td><div class="shipping-row-actions">${renderInstructionActions(instruction, true)}</div></td>
            </tr>
        `;
    }).join('');

    // 各行の出荷進捗を非同期取得して描画
    instructions.forEach(inst => loadRowProgress(inst.id));
}

function renderInstructionsMobile(instructions) {
    const list = document.getElementById('instructionsMobileList');
    if (!instructions.length) {
        list.innerHTML = '<div class="shipping-empty"><i class="fas fa-inbox"></i><span>出荷指示が登録されていません</span></div>';
        return;
    }
    list.innerHTML = instructions.map((instruction) => {
        const shippingDate = instruction.shipping_date ? new Date(instruction.shipping_date).toLocaleDateString('ja-JP') : '-';
        return `<article class="shipping-mobile-item">
            <div class="shipping-mobile-heading">
                <div><strong class="shipping-code">${escapeHtml(instruction.instruction_id)}</strong><div class="small text-muted">${escapeHtml(instruction.customer_name || '顧客未設定')}</div></div>
                <div class="d-flex flex-wrap justify-content-end gap-1">${getPriorityBadge(instruction.priority)}${getStatusBadge(instruction.status)}</div>
            </div>
            <dl class="shipping-mobile-facts">
                <div><dt>代表品目</dt><dd>${escapeHtml(instruction.product_code)} ${escapeHtml(instruction.product_name)}</dd></div>
                <div><dt>数量</dt><dd>${Number(instruction.quantity || 0)}</dd></div>
                <div><dt>出荷日</dt><dd>${shippingDate}</dd></div>
            </dl>
            <div class="progress-cell" data-progress-id="${instruction.id}"><span class="text-muted small">進捗を確認中...</span></div>
            <div class="shipping-mobile-actions">${renderInstructionActions(instruction, false)}</div>
        </article>`;
    }).join('');
}

function renderInstructionActions(instruction, compact) {
    const status = String(instruction.status || '').toLowerCase();
    const editable = status === 'pending';
    const labelClass = compact ? ' visually-hidden' : '';
    return `
        <a class="btn btn-outline-primary" href="shipping-instruction-detail.html?id=${instruction.id}" title="詳細">
            <i class="fas fa-circle-info"></i><span class="${labelClass}">詳細</span>
        </a>
        ${!['shipped', 'delivered'].includes(status) ? `
        <a class="btn btn-success" href="shipping-quantity.html?id=${instruction.id}" title="出荷数入力">
            <i class="fas fa-boxes-packing"></i><span class="${labelClass}">出荷作業</span>
        </a>` : ''}
        ${editable ? `
        <button class="btn btn-outline-secondary" type="button" data-action="edit" data-instruction-id="${instruction.id}" title="基本情報を編集">
            <i class="fas fa-pen"></i><span class="${labelClass}">編集</span>
        </button>
        <button class="btn btn-outline-danger" type="button" data-action="delete" data-instruction-id="${instruction.id}" data-instruction-code="${escapeHtml(instruction.instruction_id)}" title="削除">
            <i class="fas fa-trash"></i><span class="${labelClass}">削除</span>
        </button>` : ''}
    `;
}

function renderShippingSummary(instructions) {
    const open = instructions.filter((instruction) => !['shipped', 'delivered'].includes(String(instruction.status || '').toLowerCase())).length;
    const priority = instructions.filter((instruction) => instruction.priority === 'high').length;
    document.getElementById('shippingSummary').textContent = `${instructions.length}件 / 作業中 ${open}件 / 高優先 ${priority}件`;
}

function shippingLoadError(message) {
    return `<div class="shipping-empty is-error"><i class="fas fa-triangle-exclamation"></i><strong>出荷指示を取得できませんでした</strong><span>${escapeHtml(message)}</span></div>`;
}

function handleInstructionActionClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const instructionId = Number(button.dataset.instructionId);
    if (!instructionId) return;
    if (button.dataset.action === 'edit') {
        openEditModal(instructionId);
    } else if (button.dataset.action === 'delete') {
        deleteInstruction(instructionId, button.dataset.instructionCode || '', button);
    }
}

// 監査注意表示
function renderAuditFlags(instruction) {
    const cancelCount = Number(instruction.cancelled_scan_count || 0);
    const correctionCount = Number(instruction.post_completion_correction_count || 0);
    if (cancelCount === 0 && correctionCount === 0) {
        return '<span class="text-muted small">-</span>';
    }
    const flags = [];
    if (cancelCount > 0) {
        flags.push(`<span class="badge badge-pending me-1">取消 ${cancelCount}</span>`);
    }
    if (correctionCount > 0) {
        flags.push(`<span class="badge badge-progress me-1">修正 ${correctionCount}</span>`);
    }
    const lastAudit = instruction.last_shipping_audit_at
        ? `<div class="text-muted small mt-1">${formatDateTime(instruction.last_shipping_audit_at)}</div>`
        : '';
    return `${flags.join('')}${lastAudit}`;
}

// 行ごとの出荷進捗
async function loadRowProgress(id) {
    const cells = [...document.querySelectorAll(`.progress-cell[data-progress-id="${id}"]`)];
    if (!cells.length) return;
    try {
        const res = await fetch(`${API_BASE_URL}/shipping-instructions/${id}/progress`);
        if (!res.ok) throw new Error();
        const p = await res.json();
        if (p.line_count === 0) {
            cells.forEach((cell) => { cell.innerHTML = '<span class="text-muted small">明細なし</span>'; });
            return;
        }
        const barClass = p.status === 'completed' ? 'bg-success'
            : (p.status === 'partial' ? 'bg-warning' : 'bg-secondary');
        const progressHtml = `
            <div class="progress shipping-progress">
                <div class="progress-bar ${barClass}" style="width:${p.percent}%">${p.percent}%</div>
            </div>
            <div class="small text-muted mt-1">${p.shipped_quantity} / ${p.total_quantity}(${p.completed_lines}/${p.line_count}明細完了)</div>`;
        cells.forEach((cell) => { cell.innerHTML = progressHtml; });
    } catch (e) {
        cells.forEach((cell) => { cell.innerHTML = '<span class="text-muted small">進捗を取得できません</span>'; });
    }
}

// 優先度バッジ
function getPriorityBadge(priority) {
    const badges = {
        'high': '<span class="badge badge-ng">高優先</span>',
        'normal': '<span class="badge badge-progress">通常</span>',
        'low': '<span class="badge badge-hold">低</span>'
    };
    return badges[priority] || `<span class="badge badge-hold">${escapeHtml(priority || '-')}</span>`;
}

// ステータスバッジ
function getStatusBadge(status) {
    const badges = {
        'pending': '<span class="badge badge-pending">未処理</span>',
        'processing': '<span class="badge badge-progress">処理中</span>',
        'picking': '<span class="badge badge-progress">ピッキング中</span>',
        'packing': '<span class="badge badge-progress">梱包中</span>',
        'inspected': '<span class="badge badge-ok">検品済</span>',
        'shipped': '<span class="badge badge-ok">出荷済</span>',
        'delivered': '<span class="badge badge-ok">配送完了</span>'
    };
    return badges[status] || `<span class="badge badge-hold">${escapeHtml(status || '-')}</span>`;
}

function getStatusLabel(status) {
    const labels = {
        pending: '未処理',
        processing: '処理中',
        picking: 'ピッキング中',
        packing: '梱包中',
        inspected: '検品済',
        shipped: '出荷済',
        delivered: '配送完了'
    };
    return labels[status] || status || '-';
}

function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('ja-JP', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// 新規登録モーダルを開く
function openCreateModal() {
    currentEditingId = null;
    document.getElementById('modalTitle').textContent = '新規出荷指示登録';
    document.getElementById('instructionForm').reset();
    document.getElementById('instructionForm').classList.remove('was-validated');
    document.getElementById('instructionDbId').value = '';
    document.getElementById('priority').value = 'normal';
    document.getElementById('status').value = 'pending';
    document.getElementById('statusDisplay').textContent = getStatusLabel('pending');
    setInstructionLineFieldsLocked(false);

    const modal = new bootstrap.Modal(document.getElementById('instructionModal'));
    modal.show();
}

// 編集モーダルを開く
async function openEditModal(instructionId) {
    showLoading();
    try {
        const response = await fetch(`${API_BASE_URL}/shipping-instructions/${instructionId}`);
        if (!response.ok) throw new Error('出荷指示情報の取得に失敗しました');

        const instruction = await response.json();

        currentEditingId = instructionId;
        document.getElementById('modalTitle').textContent = '出荷指示編集';
        document.getElementById('instructionDbId').value = instruction.id;
        document.getElementById('instructionId').value = instruction.instruction_id;
        document.getElementById('productId').value = instruction.product_id || '';
        document.getElementById('quantity').value = instruction.quantity;
        document.getElementById('shippingDate').value = instruction.shipping_date || '';
        document.getElementById('shippingLocationId').value = instruction.shipping_location_id || '';
        document.getElementById('deliveryLocationId').value = instruction.delivery_location_id || '';
        document.getElementById('customerName').value = instruction.customer_name || '';
        document.getElementById('priority').value = instruction.priority || 'normal';
        document.getElementById('status').value = instruction.status || 'pending';
        document.getElementById('statusDisplay').textContent = getStatusLabel(instruction.status || 'pending');
        document.getElementById('trackingNumber').value = instruction.tracking_number || '';
        document.getElementById('notes').value = instruction.notes || '';
        setInstructionLineFieldsLocked(true);

        document.getElementById('instructionForm').classList.remove('was-validated');

        const modal = new bootstrap.Modal(document.getElementById('instructionModal'));
        modal.show();
    } catch (error) {
        console.error('Error loading instruction:', error);
        showError('出荷指示情報の取得に失敗しました');
    } finally {
        hideLoading();
    }
}

function setInstructionLineFieldsLocked(locked) {
    const product = document.getElementById('productId');
    const quantity = document.getElementById('quantity');
    product.disabled = locked;
    quantity.disabled = locked;
    product.title = locked ? '明細の品目変更は出荷指示詳細から行ってください' : '';
    quantity.title = locked ? '数量変更は出荷数入力から行ってください' : '';
}

// 出荷指示保存（新規登録・更新）
async function saveInstruction() {
    if (isSavingInstruction) return;
    const form = document.getElementById('instructionForm');

    if (!form.checkValidity()) {
        form.classList.add('was-validated');
        return;
    }

    const instructionId = document.getElementById('instructionDbId').value;
    const instructionData = {
        instruction_id: document.getElementById('instructionId').value.trim(),
        product_id: parseInt(document.getElementById('productId').value),
        quantity: parseInt(document.getElementById('quantity').value),
        shipping_date: document.getElementById('shippingDate').value || null,
        shipping_location_id: document.getElementById('shippingLocationId').value ? parseInt(document.getElementById('shippingLocationId').value) : null,
        delivery_location_id: document.getElementById('deliveryLocationId').value ? parseInt(document.getElementById('deliveryLocationId').value) : null,
        customer_name: document.getElementById('customerName').value.trim() || null,
        priority: document.getElementById('priority').value,
        tracking_number: document.getElementById('trackingNumber').value.trim() || null,
        notes: document.getElementById('notes').value.trim() || null
    };
    if (!instructionId) instructionData.status = 'pending';

    const saveButton = document.getElementById('saveInstructionButton');
    isSavingInstruction = true;
    setButtonBusy(saveButton, true, '保存中');
    showLoading();
    try {
        const url = instructionId ? `${API_BASE_URL}/shipping-instructions/${instructionId}` : `${API_BASE_URL}/shipping-instructions`;
        const method = instructionId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(instructionData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '保存に失敗しました');
        }

        await response.json();

        showSuccess(instructionId ? '出荷指示を更新しました' : '出荷指示を登録しました');

        // モーダルを閉じる
        const modal = bootstrap.Modal.getInstance(document.getElementById('instructionModal'));
        modal.hide();

        // 一覧を再読み込み
        await loadInstructions();
    } catch (error) {
        console.error('Error saving instruction:', error);
        showError(error.message);
    } finally {
        hideLoading();
        isSavingInstruction = false;
        setButtonBusy(saveButton, false);
    }
}

// 出荷指示削除
async function deleteInstruction(instructionId, instructionIdStr, button) {
    const key = String(instructionId);
    if (deletingInstructionIds.has(key)) return;
    if (!confirm(`出荷指示「${instructionIdStr}」を削除してもよろしいですか？\n\n※検品データがある場合は削除できません。`)) {
        return;
    }

    deletingInstructionIds.add(key);
    setButtonBusy(button, true, '削除中');
    showLoading();
    try {
        const response = await fetch(`${API_BASE_URL}/shipping-instructions/${instructionId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '削除に失敗しました');
        }

        showSuccess('出荷指示を削除しました');
        await loadInstructions();
    } catch (error) {
        console.error('Error deleting instruction:', error);
        showError(error.message);
    } finally {
        hideLoading();
        deletingInstructionIds.delete(key);
        setButtonBusy(button, false);
    }
}

// 成功メッセージ表示
function showSuccess(message) {
    if (window.showToast) window.showToast(message, 'ok');
}

// エラーメッセージ表示
function showError(message) {
    if (window.showToast) window.showToast(message, 'ng');
}

function setButtonBusy(button, busy, busyLabel = '') {
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
    button.disabled = false;
    button.removeAttribute('aria-busy');
}

// HTMLエスケープ
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}
