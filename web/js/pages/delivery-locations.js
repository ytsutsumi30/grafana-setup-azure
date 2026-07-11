const API_BASE_URL = '/api';
let currentEditingId = null;

// ページ読み込み時に拠点一覧を取得
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('createDeliveryLocationButton')?.addEventListener('click', openCreateModal);
    document.getElementById('refreshDeliveryLocationsButton')?.addEventListener('click', loadLocations);
    document.getElementById('saveDeliveryLocationButton')?.addEventListener('click', saveLocation);
    document.getElementById('locationsTableBody')?.addEventListener('click', handleLocationActionClick);
    loadLocations();
});

// ローディング表示制御
function showLoading() {
    document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
}

// 拠点一覧取得
async function loadLocations() {
    showLoading();
    try {
        const response = await fetch(`${API_BASE_URL}/delivery-locations`);
        if (!response.ok) throw new Error('拠点一覧の取得に失敗しました');

        const locations = await response.json();
        renderLocationsTable(locations);
    } catch (error) {
        console.error('Error loading locations:', error);
        showError('拠点一覧の取得に失敗しました');
        document.getElementById('locationsTableBody').innerHTML = `
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
function renderLocationsTable(locations) {
    const tbody = document.getElementById('locationsTableBody');

    if (locations.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-muted py-5">
                    <i class="fas fa-inbox fa-3x mb-3"></i>
                    <p>拠点が登録されていません</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = locations.map(location => `
        <tr>
            <td><strong>${escapeHtml(location.location_code)}</strong></td>
            <td>${escapeHtml(location.location_name)}</td>
            <td>${location.address ? escapeHtml(location.address) : '<span class="text-muted">-</span>'}</td>
            <td>${location.phone ? escapeHtml(location.phone) : '<span class="text-muted">-</span>'}</td>
            <td>${location.contact_person ? escapeHtml(location.contact_person) : '<span class="text-muted">-</span>'}</td>
            <td><span class="badge bg-info">${escapeHtml(location.delivery_method || '宅配便')}</span></td>
            <td>
                <button class="btn btn-sm btn-outline-primary btn-action me-1" type="button" data-action="edit" data-location-id="${location.id}" title="編集">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger btn-action" type="button" data-action="delete" data-location-id="${location.id}" data-location-code="${escapeHtml(location.location_code)}" title="削除">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}

// 新規登録モーダルを開く
function openCreateModal() {
    currentEditingId = null;
    document.getElementById('modalTitle').textContent = '新規拠点登録';
    document.getElementById('locationForm').reset();
    document.getElementById('locationForm').classList.remove('was-validated');
    document.getElementById('locationId').value = '';
    document.getElementById('deliveryMethod').value = '宅配便';

    const modal = new bootstrap.Modal(document.getElementById('locationModal'));
    modal.show();
}

function handleLocationActionClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const locationId = Number(button.dataset.locationId);
    if (!locationId) return;

    if (button.dataset.action === 'edit') {
        openEditModal(locationId);
        return;
    }

    if (button.dataset.action === 'delete') {
        deleteLocation(locationId, button.dataset.locationCode || '');
    }
}

// 編集モーダルを開く
async function openEditModal(locationId) {
    showLoading();
    try {
        const response = await fetch(`${API_BASE_URL}/delivery-locations/${locationId}`);
        if (!response.ok) throw new Error('拠点情報の取得に失敗しました');

        const location = await response.json();

        currentEditingId = locationId;
        document.getElementById('modalTitle').textContent = '拠点編集';
        document.getElementById('locationId').value = location.id;
        document.getElementById('locationCode').value = location.location_code;
        document.getElementById('locationName').value = location.location_name;
        document.getElementById('address').value = location.address || '';
        document.getElementById('phone').value = location.phone || '';
        document.getElementById('contactPerson').value = location.contact_person || '';
        document.getElementById('deliveryMethod').value = location.delivery_method || '宅配便';

        document.getElementById('locationForm').classList.remove('was-validated');

        const modal = new bootstrap.Modal(document.getElementById('locationModal'));
        modal.show();
    } catch (error) {
        console.error('Error loading location:', error);
        showError('拠点情報の取得に失敗しました');
    } finally {
        hideLoading();
    }
}

// 拠点保存（新規登録・更新）
async function saveLocation() {
    const form = document.getElementById('locationForm');

    if (!form.checkValidity()) {
        form.classList.add('was-validated');
        return;
    }

    const locationData = {
        location_code: document.getElementById('locationCode').value.trim(),
        location_name: document.getElementById('locationName').value.trim(),
        address: document.getElementById('address').value.trim() || null,
        phone: document.getElementById('phone').value.trim() || null,
        contact_person: document.getElementById('contactPerson').value.trim() || null,
        delivery_method: document.getElementById('deliveryMethod').value
    };

    showLoading();
    try {
        const locationId = document.getElementById('locationId').value;
        const url = locationId ? `${API_BASE_URL}/delivery-locations/${locationId}` : `${API_BASE_URL}/delivery-locations`;
        const method = locationId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(locationData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '保存に失敗しました');
        }

        await response.json();

        showSuccess(locationId ? '拠点情報を更新しました' : '拠点を登録しました');

        // モーダルを閉じる
        const modal = bootstrap.Modal.getInstance(document.getElementById('locationModal'));
        modal.hide();

        // 一覧を再読み込み
        await loadLocations();
    } catch (error) {
        console.error('Error saving location:', error);
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// 拠点削除
async function deleteLocation(locationId, locationCode) {
    if (!confirm(`拠点「${locationCode}」を削除してもよろしいですか？\n\n※出荷指示で使用されている場合は削除できません。`)) {
        return;
    }

    showLoading();
    try {
        const response = await fetch(`${API_BASE_URL}/delivery-locations/${locationId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '削除に失敗しました');
        }

        showSuccess('拠点を削除しました');
        await loadLocations();
    } catch (error) {
        console.error('Error deleting location:', error);
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
