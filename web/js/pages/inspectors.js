const API_BASE_URL = '/api';
let currentEditingId = null;

// ページ読み込み時に検品者一覧を取得
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('createInspectorButton')?.addEventListener('click', openCreateModal);
    document.getElementById('refreshInspectorsButton')?.addEventListener('click', loadInspectors);
    document.getElementById('saveInspectorButton')?.addEventListener('click', saveInspector);
    document.getElementById('inspectorsTableBody')?.addEventListener('click', handleInspectorActionClick);
    loadInspectors();
});

// ローディング表示制御
function showLoading() {
    document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
}

// 検品者一覧取得
async function loadInspectors() {
    showLoading();
    try {
        const response = await fetch(`${API_BASE_URL}/inspectors`);
        if (!response.ok) throw new Error('検品者一覧の取得に失敗しました');

        const inspectors = await response.json();
        renderInspectorsTable(inspectors);
    } catch (error) {
        console.error('Error loading inspectors:', error);
        showError('検品者一覧の取得に失敗しました');
        document.getElementById('inspectorsTableBody').innerHTML = `
            <tr>
                <td colspan="8" class="text-center text-danger py-5">
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
function renderInspectorsTable(inspectors) {
    const tbody = document.getElementById('inspectorsTableBody');

    if (inspectors.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="text-center text-muted py-5">
                    <i class="fas fa-inbox fa-3x mb-3"></i>
                    <p>検品者が登録されていません</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = inspectors.map(inspector => `
        <tr>
            <td><strong>${escapeHtml(inspector.inspector_code)}</strong></td>
            <td>${escapeHtml(inspector.inspector_name)}</td>
            <td>${inspector.email ? escapeHtml(inspector.email) : '<span class="text-muted">-</span>'}</td>
            <td>${inspector.phone ? escapeHtml(inspector.phone) : '<span class="text-muted">-</span>'}</td>
            <td>${inspector.department ? escapeHtml(inspector.department) : '<span class="text-muted">-</span>'}</td>
            <td><span class="badge badge-role ${getRoleBadgeClass(inspector.role)}">${getRoleLabel(inspector.role)}</span></td>
            <td>
                ${inspector.is_active ?
                    '<span class="badge bg-success">有効</span>' :
                    '<span class="badge bg-secondary">無効</span>'}
            </td>
            <td>
                <button class="btn btn-sm btn-outline-primary btn-action me-1" type="button" data-action="edit" data-inspector-id="${inspector.id}" title="編集">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger btn-action" type="button" data-action="delete" data-inspector-id="${inspector.id}" data-inspector-code="${escapeHtml(inspector.inspector_code)}" title="削除">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// 役割に応じたバッジクラスを返す
function getRoleBadgeClass(role) {
    switch(role) {
        case 'admin': return 'bg-danger';
        case 'supervisor': return 'bg-warning text-dark';
        case 'inspector': return 'bg-info';
        default: return 'bg-secondary';
    }
}

// 役割ラベルを返す
function getRoleLabel(role) {
    switch(role) {
        case 'admin': return '管理者';
        case 'supervisor': return 'スーパーバイザー';
        case 'inspector': return '検品者';
        default: return role;
    }
}

// 新規登録モーダルを開く
function openCreateModal() {
    currentEditingId = null;
    document.getElementById('modalTitle').textContent = '新規検品者登録';
    document.getElementById('inspectorForm').reset();
    document.getElementById('inspectorForm').classList.remove('was-validated');
    document.getElementById('inspectorId').value = '';
    document.getElementById('isActive').checked = true;
    document.getElementById('role').value = 'inspector';

    const modal = new bootstrap.Modal(document.getElementById('inspectorModal'));
    modal.show();
}

function handleInspectorActionClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const inspectorId = Number(button.dataset.inspectorId);
    if (!inspectorId) return;

    if (button.dataset.action === 'edit') {
        openEditModal(inspectorId);
        return;
    }

    if (button.dataset.action === 'delete') {
        deleteInspector(inspectorId, button.dataset.inspectorCode || '');
    }
}

// 編集モーダルを開く
async function openEditModal(inspectorId) {
    showLoading();
    try {
        const response = await fetch(`${API_BASE_URL}/inspectors/${inspectorId}`);
        if (!response.ok) throw new Error('検品者情報の取得に失敗しました');

        const inspector = await response.json();

        currentEditingId = inspectorId;
        document.getElementById('modalTitle').textContent = '検品者編集';
        document.getElementById('inspectorId').value = inspector.id;
        document.getElementById('inspectorCode').value = inspector.inspector_code;
        document.getElementById('inspectorName').value = inspector.inspector_name;
        document.getElementById('email').value = inspector.email || '';
        document.getElementById('phone').value = inspector.phone || '';
        document.getElementById('department').value = inspector.department || '';
        document.getElementById('role').value = inspector.role || 'inspector';
        document.getElementById('isActive').checked = inspector.is_active;

        document.getElementById('inspectorForm').classList.remove('was-validated');

        const modal = new bootstrap.Modal(document.getElementById('inspectorModal'));
        modal.show();
    } catch (error) {
        console.error('Error loading inspector:', error);
        showError('検品者情報の取得に失敗しました');
    } finally {
        hideLoading();
    }
}

// 検品者保存（新規登録・更新）
async function saveInspector() {
    const form = document.getElementById('inspectorForm');

    if (!form.checkValidity()) {
        form.classList.add('was-validated');
        return;
    }

    const inspectorData = {
        inspector_code: document.getElementById('inspectorCode').value.trim(),
        inspector_name: document.getElementById('inspectorName').value.trim(),
        email: document.getElementById('email').value.trim() || null,
        phone: document.getElementById('phone').value.trim() || null,
        department: document.getElementById('department').value.trim() || null,
        role: document.getElementById('role').value,
        is_active: document.getElementById('isActive').checked
    };

    showLoading();
    try {
        const inspectorId = document.getElementById('inspectorId').value;
        const url = inspectorId ? `${API_BASE_URL}/inspectors/${inspectorId}` : `${API_BASE_URL}/inspectors`;
        const method = inspectorId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(inspectorData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '保存に失敗しました');
        }

        await response.json();

        showSuccess(inspectorId ? '検品者情報を更新しました' : '検品者を登録しました');

        // モーダルを閉じる
        const modal = bootstrap.Modal.getInstance(document.getElementById('inspectorModal'));
        modal.hide();

        // 一覧を再読み込み
        await loadInspectors();
    } catch (error) {
        console.error('Error saving inspector:', error);
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// 検品者削除
async function deleteInspector(inspectorId, inspectorCode) {
    if (!confirm(`検品者「${inspectorCode}」を削除してもよろしいですか？\n\n※この検品者が検品記録に紐付いている場合でも削除できます。`)) {
        return;
    }

    showLoading();
    try {
        const response = await fetch(`${API_BASE_URL}/inspectors/${inspectorId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '削除に失敗しました');
        }

        showSuccess('検品者を削除しました');
        await loadInspectors();
    } catch (error) {
        console.error('Error deleting inspector:', error);
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
