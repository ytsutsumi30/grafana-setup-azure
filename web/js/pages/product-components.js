const API_BASE_URL = '/api';
let currentEditingId = null;
let products = [];

// ページ読み込み時に部品一覧と製品一覧を取得
document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('createProductComponentButton')?.addEventListener('click', openCreateModal);
    document.getElementById('refreshProductComponentsButton')?.addEventListener('click', loadComponents);
    document.getElementById('saveProductComponentButton')?.addEventListener('click', saveComponent);
    document.getElementById('componentsTableBody')?.addEventListener('click', handleComponentActionClick);
    await loadProducts();
    await loadComponents();
});

// ローディング表示制御
function showLoading() {
    document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
}

// 製品一覧取得
async function loadProducts() {
    try {
        const response = await fetch(`${API_BASE_URL}/products`);
        if (!response.ok) throw new Error('製品一覧の取得に失敗しました');
        products = await response.json();

        // 製品選択プルダウンを更新
        const select = document.getElementById('productId');
        select.innerHTML = '<option value="">製品を選択してください</option>';
        products.forEach(product => {
            const option = document.createElement('option');
            option.value = product.id;
            option.textContent = `${product.product_code} - ${product.product_name}`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading products:', error);
        showError('製品一覧の取得に失敗しました');
    }
}

// 部品一覧取得
async function loadComponents() {
    showLoading();
    try {
        const response = await fetch(`${API_BASE_URL}/product-components`);
        if (!response.ok) throw new Error('部品一覧の取得に失敗しました');

        const components = await response.json();
        renderComponentsTable(components);
    } catch (error) {
        console.error('Error loading components:', error);
        showError('部品一覧の取得に失敗しました');
        document.getElementById('componentsTableBody').innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-danger py-5">
                    <i class="fas fa-exclamation-triangle fa-3x mb-3"></i>
                    <p>${error.message}</p>
                </td>
            </tr>
        `;
    } finally {
        hideLoading();
    }
}

// テーブル描画
function renderComponentsTable(components) {
    const tbody = document.getElementById('componentsTableBody');

    if (components.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-muted py-5">
                    <i class="fas fa-inbox fa-3x mb-3"></i>
                    <p>部品が登録されていません</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = components.map(component => {
        const typeBadge = getComponentTypeBadge(component.component_type);
        return `
            <tr>
                <td><strong>${escapeHtml(component.product_code)}</strong></td>
                <td>${escapeHtml(component.product_name)}</td>
                <td>${typeBadge}</td>
                <td>${escapeHtml(component.component_name)}</td>
                <td><code>${escapeHtml(component.qr_code)}</code></td>
                <td>${component.is_required ? '<span class="badge bg-danger">必須</span>' : '<span class="badge bg-secondary">任意</span>'}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary btn-action me-1" type="button" data-action="edit" data-component-id="${component.id}" title="編集">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger btn-action" type="button" data-action="delete" data-component-id="${component.id}" data-component-name="${escapeHtml(component.component_name)}" title="削除">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// 部品種別バッジ取得
function getComponentTypeBadge(type) {
    const badges = {
        'main': '<span class="badge badge-component-type bg-primary">製品本体</span>',
        'accessory': '<span class="badge badge-component-type bg-success">付属品</span>',
        'manual': '<span class="badge badge-component-type bg-info">マニュアル</span>',
        'warranty': '<span class="badge badge-component-type bg-warning text-dark">保証書</span>'
    };
    return badges[type] || `<span class="badge badge-component-type bg-secondary">${type}</span>`;
}

// 新規登録モーダルを開く
function openCreateModal() {
    currentEditingId = null;
    document.getElementById('modalTitle').textContent = '新規部品登録';
    document.getElementById('componentForm').reset();
    document.getElementById('componentForm').classList.remove('was-validated');
    document.getElementById('componentId').value = '';
    document.getElementById('isRequired').checked = true;

    const modal = new bootstrap.Modal(document.getElementById('componentModal'));
    modal.show();
}

function handleComponentActionClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const componentId = Number(button.dataset.componentId);
    if (!componentId) return;

    if (button.dataset.action === 'edit') {
        openEditModal(componentId);
        return;
    }

    if (button.dataset.action === 'delete') {
        deleteComponent(componentId, button.dataset.componentName || '');
    }
}
// 編集モーダルを開く
async function openEditModal(componentId) {
    showLoading();
    try {
        const response = await fetch(`${API_BASE_URL}/product-components/${componentId}`);
        if (!response.ok) throw new Error('部品情報の取得に失敗しました');

        const component = await response.json();

        currentEditingId = componentId;
        document.getElementById('modalTitle').textContent = '部品編集';
        document.getElementById('componentId').value = component.id;
        document.getElementById('productId').value = component.product_id;
        document.getElementById('componentType').value = component.component_type;
        document.getElementById('componentName').value = component.component_name;
        document.getElementById('qrCode').value = component.qr_code;
        document.getElementById('isRequired').checked = component.is_required;

        document.getElementById('componentForm').classList.remove('was-validated');

        const modal = new bootstrap.Modal(document.getElementById('componentModal'));
        modal.show();
    } catch (error) {
        console.error('Error loading component:', error);
        showError('部品情報の取得に失敗しました');
    } finally {
        hideLoading();
    }
}

// 部品保存（新規登録・更新）
async function saveComponent() {
    const form = document.getElementById('componentForm');

    if (!form.checkValidity()) {
        form.classList.add('was-validated');
        return;
    }

    const componentData = {
        product_id: parseInt(document.getElementById('productId').value),
        component_type: document.getElementById('componentType').value,
        component_name: document.getElementById('componentName').value.trim(),
        qr_code: document.getElementById('qrCode').value.trim(),
        is_required: document.getElementById('isRequired').checked
    };

    showLoading();
    try {
        const componentId = document.getElementById('componentId').value;
        const url = componentId ? `${API_BASE_URL}/product-components/${componentId}` : `${API_BASE_URL}/product-components`;
        const method = componentId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(componentData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '保存に失敗しました');
        }

        await response.json();

        showSuccess(componentId ? '部品情報を更新しました' : '部品を登録しました');

        // モーダルを閉じる
        const modal = bootstrap.Modal.getInstance(document.getElementById('componentModal'));
        modal.hide();

        // 一覧を再読み込み
        await loadComponents();
    } catch (error) {
        console.error('Error saving component:', error);
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// 部品削除
async function deleteComponent(componentId, componentName) {
    if (!confirm(`部品「${componentName}」を削除してもよろしいですか？\n\n※検品記録で使用されている場合は削除できません。`)) {
        return;
    }

    showLoading();
    try {
        const response = await fetch(`${API_BASE_URL}/product-components/${componentId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '削除に失敗しました');
        }

        showSuccess('部品を削除しました');
        await loadComponents();
    } catch (error) {
        console.error('Error deleting component:', error);
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// 成功メッセージ表示
function showSuccess(message) {
    const alert = document.createElement('div');
    alert.className = 'alert alert-success alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3';
    alert.style.zIndex = '10000';
    alert.innerHTML = `
        <i class="fas fa-check-circle me-2"></i>${escapeHtml(message)}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    document.body.appendChild(alert);

    setTimeout(() => {
        alert.remove();
    }, 3000);
}

// エラーメッセージ表示
function showError(message) {
    const alert = document.createElement('div');
    alert.className = 'alert alert-danger alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3';
    alert.style.zIndex = '10000';
    alert.innerHTML = `
        <i class="fas fa-exclamation-circle me-2"></i>${escapeHtml(message)}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    document.body.appendChild(alert);

    setTimeout(() => {
        alert.remove();
    }, 5000);
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
