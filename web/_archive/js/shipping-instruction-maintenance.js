// 出荷指示マスタメンテナンス JavaScript
// API基本URL
const API_BASE_URL = '/api';

// グローバル状態
let shippingInstructions = [];
let products = [];
let shippingLocations = [];
let deliveryLocations = [];
let currentEditId = null;

// Bootstrap モーダル
let editModal = null;
let deleteModal = null;

// 初期化
document.addEventListener('DOMContentLoaded', async () => {
    console.log('出荷指示マスタメンテナンス画面 初期化開始');

    // Bootstrap モーダルの初期化
    editModal = new bootstrap.Modal(document.getElementById('editModal'));
    deleteModal = new bootstrap.Modal(document.getElementById('deleteModal'));

    // イベントリスナー登録
    document.getElementById('btn-search').addEventListener('click', loadShippingInstructions);
    document.getElementById('btn-refresh').addEventListener('click', loadShippingInstructions);
    document.getElementById('btn-new').addEventListener('click', openNewModal);
    document.getElementById('btn-save').addEventListener('click', saveShippingInstruction);
    document.getElementById('btn-delete-confirm').addEventListener('click', deleteShippingInstruction);

    // フォームのEnterキー送信を防止
    document.getElementById('edit-form').addEventListener('submit', (e) => {
        e.preventDefault();
    });

    // 検索ボックスのEnterキー対応
    document.querySelectorAll('.search-box input').forEach(input => {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                loadShippingInstructions();
            }
        });
    });

    try {
        // マスタデータの読み込み
        await Promise.all([
            loadProducts(),
            loadShippingLocations(),
            loadDeliveryLocations()
        ]);

        // 出荷指示データの読み込み
        await loadShippingInstructions();

        console.log('初期化完了');
    } catch (error) {
        console.error('初期化エラー:', error);
        showAlert('初期化に失敗しました。', 'danger');
    }
});

// 製品マスタ読み込み
async function loadProducts() {
    try {
        const response = await fetch(`${API_BASE_URL}/products`);
        if (!response.ok) throw new Error('製品マスタの取得に失敗しました');
        products = await response.json();

        // プルダウン更新
        const select = document.getElementById('edit-product-id');
        select.innerHTML = '<option value="">選択してください</option>';
        products.forEach(product => {
            const option = document.createElement('option');
            option.value = product.id;
            option.textContent = `${product.product_code} - ${product.product_name}`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('製品マスタ読み込みエラー:', error);
        throw error;
    }
}

// 出荷場所マスタ読み込み
async function loadShippingLocations() {
    try {
        const response = await fetch(`${API_BASE_URL}/shipping-locations`);
        if (!response.ok) throw new Error('出荷場所マスタの取得に失敗しました');
        shippingLocations = await response.json();

        // プルダウン更新
        const select = document.getElementById('edit-shipping-location-id');
        select.innerHTML = '<option value="">選択してください</option>';
        shippingLocations.forEach(location => {
            const option = document.createElement('option');
            option.value = location.id;
            option.textContent = `${location.location_code} - ${location.location_name}`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('出荷場所マスタ読み込みエラー:', error);
        throw error;
    }
}

// 納入場所マスタ読み込み
async function loadDeliveryLocations() {
    try {
        const response = await fetch(`${API_BASE_URL}/delivery-locations`);
        if (!response.ok) throw new Error('納入場所マスタの取得に失敗しました');
        deliveryLocations = await response.json();

        // プルダウン更新
        const select = document.getElementById('edit-delivery-location-id');
        select.innerHTML = '<option value="">選択してください</option>';
        deliveryLocations.forEach(location => {
            const option = document.createElement('option');
            option.value = location.id;
            option.textContent = `${location.location_code} - ${location.location_name}`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('納入場所マスタ読み込みエラー:', error);
        throw error;
    }
}

// 出荷指示一覧読み込み
async function loadShippingInstructions() {
    try {
        // 検索条件取得
        const params = new URLSearchParams();

        const instructionId = document.getElementById('search-instruction-id').value.trim();
        if (instructionId) params.append('instruction_id', instructionId);

        const status = document.getElementById('search-status').value;
        if (status) params.append('status', status);

        const priority = document.getElementById('search-priority').value;
        if (priority) params.append('priority', priority);

        const dateFrom = document.getElementById('search-date-from').value;
        if (dateFrom) params.append('shipping_date_from', dateFrom);

        const dateTo = document.getElementById('search-date-to').value;
        if (dateTo) params.append('shipping_date_to', dateTo);

        const url = `${API_BASE_URL}/shipping-instructions${params.toString() ? '?' + params.toString() : ''}`;
        const response = await fetch(url);

        if (!response.ok) throw new Error('出荷指示一覧の取得に失敗しました');

        shippingInstructions = await response.json();
        renderTable();

    } catch (error) {
        console.error('出荷指示一覧読み込みエラー:', error);
        showAlert('データの読み込みに失敗しました。', 'danger');
    }
}

// テーブル描画
function renderTable() {
    const tbody = document.getElementById('data-table-body');
    const totalCount = document.getElementById('total-count');

    totalCount.textContent = shippingInstructions.length;

    if (shippingInstructions.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="text-center text-muted py-4">
                    <i class="fas fa-inbox me-2"></i>データがありません
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = shippingInstructions.map(item => `
        <tr>
            <td>${item.id}</td>
            <td><strong>${item.instruction_id}</strong></td>
            <td>
                <div>${item.product_code}</div>
                <small class="text-muted">${item.product_name}</small>
            </td>
            <td class="text-end">${item.quantity}</td>
            <td>${formatDate(item.shipping_date)}</td>
            <td>
                <div>${item.shipping_location_code || '-'}</div>
                <small class="text-muted">${item.shipping_location_name || '-'}</small>
            </td>
            <td>
                <div>${item.delivery_location_code || '-'}</div>
                <small class="text-muted">${item.delivery_location_name || '-'}</small>
            </td>
            <td>${item.customer_name || '-'}</td>
            <td>
                <span class="status-badge priority-${item.priority}">
                    ${getPriorityLabel(item.priority)}
                </span>
            </td>
            <td>
                <span class="status-badge status-${item.status}">
                    ${getStatusLabel(item.status)}
                </span>
            </td>
            <td class="text-center">
                <button class="btn btn-sm btn-outline-primary btn-action me-1"
                        onclick="openEditModal(${item.id})"
                        title="編集">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger btn-action"
                        onclick="openDeleteModal(${item.id})"
                        title="削除">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// 日付フォーマット
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

// ステータスラベル取得
function getStatusLabel(status) {
    const labels = {
        'pending': '保留中',
        'processing': '処理中',
        'shipped': '出荷済み',
        'delivered': '配達済み'
    };
    return labels[status] || status;
}

// 優先度ラベル取得
function getPriorityLabel(priority) {
    const labels = {
        'high': '高',
        'normal': '通常',
        'low': '低'
    };
    return labels[priority] || priority;
}

// 新規作成モーダルを開く
function openNewModal() {
    currentEditId = null;
    document.getElementById('modal-title').innerHTML = '<i class="fas fa-plus me-2"></i>出荷指示新規作成';
    document.getElementById('edit-form').reset();
    document.getElementById('edit-form').classList.remove('was-validated');
    document.getElementById('edit-status').value = 'pending';
    document.getElementById('edit-priority').value = 'normal';

    // 今日の日付をデフォルトに設定
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('edit-shipping-date').value = today;

    editModal.show();
}

// 編集モーダルを開く
async function openEditModal(id) {
    currentEditId = id;
    const item = shippingInstructions.find(i => i.id === id);

    if (!item) {
        showAlert('データが見つかりません。', 'danger');
        return;
    }

    document.getElementById('modal-title').innerHTML = '<i class="fas fa-edit me-2"></i>出荷指示編集';
    document.getElementById('edit-form').classList.remove('was-validated');

    // フォームに値を設定
    document.getElementById('edit-id').value = item.id;
    document.getElementById('edit-instruction-id').value = item.instruction_id;
    document.getElementById('edit-product-id').value = item.product_id;
    document.getElementById('edit-quantity').value = item.quantity;
    document.getElementById('edit-shipping-date').value = item.shipping_date;
    document.getElementById('edit-shipping-location-id').value = item.shipping_location_id || '';
    document.getElementById('edit-delivery-location-id').value = item.delivery_location_id || '';
    document.getElementById('edit-customer-name').value = item.customer_name || '';
    document.getElementById('edit-priority').value = item.priority;
    document.getElementById('edit-status').value = item.status;
    document.getElementById('edit-tracking-number').value = item.tracking_number || '';
    document.getElementById('edit-notes').value = item.notes || '';

    editModal.show();
}

// 保存処理
async function saveShippingInstruction() {
    const form = document.getElementById('edit-form');

    // バリデーション
    if (!form.checkValidity()) {
        form.classList.add('was-validated');
        return;
    }

    const data = {
        instruction_id: document.getElementById('edit-instruction-id').value.trim(),
        product_id: parseInt(document.getElementById('edit-product-id').value),
        quantity: parseInt(document.getElementById('edit-quantity').value),
        shipping_date: document.getElementById('edit-shipping-date').value,
        shipping_location_id: parseInt(document.getElementById('edit-shipping-location-id').value),
        delivery_location_id: parseInt(document.getElementById('edit-delivery-location-id').value),
        customer_name: document.getElementById('edit-customer-name').value.trim(),
        priority: document.getElementById('edit-priority').value,
        status: document.getElementById('edit-status').value,
        tracking_number: document.getElementById('edit-tracking-number').value.trim(),
        notes: document.getElementById('edit-notes').value.trim()
    };

    try {
        let response;
        if (currentEditId) {
            // 更新
            response = await fetch(`${API_BASE_URL}/shipping-instructions/${currentEditId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } else {
            // 新規作成
            response = await fetch(`${API_BASE_URL}/shipping-instructions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        }

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '保存に失敗しました');
        }

        showAlert(currentEditId ? '更新しました。' : '作成しました。', 'success');
        editModal.hide();
        await loadShippingInstructions();

    } catch (error) {
        console.error('保存エラー:', error);
        showAlert(error.message, 'danger');
    }
}

// 削除確認モーダルを開く
function openDeleteModal(id) {
    currentEditId = id;
    const item = shippingInstructions.find(i => i.id === id);

    if (!item) {
        showAlert('データが見つかりません。', 'danger');
        return;
    }

    document.getElementById('delete-instruction-id').textContent = item.instruction_id;
    deleteModal.show();
}

// 削除処理
async function deleteShippingInstruction() {
    try {
        const response = await fetch(`${API_BASE_URL}/shipping-instructions/${currentEditId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '削除に失敗しました');
        }

        showAlert('削除しました。', 'success');
        deleteModal.hide();
        await loadShippingInstructions();

    } catch (error) {
        console.error('削除エラー:', error);
        showAlert(error.message, 'danger');
    }
}

// アラート表示
function showAlert(message, type = 'info') {
    // 既存のアラートを削除
    const existingAlert = document.querySelector('.alert-notification');
    if (existingAlert) {
        existingAlert.remove();
    }

    // 新しいアラートを作成
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} alert-dismissible fade show alert-notification`;
    alert.style.position = 'fixed';
    alert.style.top = '20px';
    alert.style.right = '20px';
    alert.style.zIndex = '9999';
    alert.style.minWidth = '300px';
    alert.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;

    document.body.appendChild(alert);

    // 3秒後に自動削除
    setTimeout(() => {
        if (alert.parentElement) {
            alert.remove();
        }
    }, 3000);
}

// グローバル関数として公開（onclick属性で使用）
window.openEditModal = openEditModal;
window.openDeleteModal = openDeleteModal;
