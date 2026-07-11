const API_BASE_URL = '/api';
let currentEditingId = null;
let products = [];

// ページ読み込み時にデータ取得
document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('createProductionPlanButton')?.addEventListener('click', openCreateModal);
    document.getElementById('refreshProductionPlansButton')?.addEventListener('click', loadPlans);
    document.getElementById('saveProductionPlanButton')?.addEventListener('click', savePlan);
    document.getElementById('plansTableBody')?.addEventListener('click', handlePlanActionClick);
    await loadProducts();
    await loadPlans();
});

// ローディング表示制御
function showLoading() {
    document.getElementById('loadingOverlay').classList.add('active');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('active');
}

// 製品マスタ取得
async function loadProducts() {
    try {
        const response = await fetch(`${API_BASE_URL}/products`);
        if (!response.ok) throw new Error('製品一覧の取得に失敗しました');
        products = await response.json();

        // プルダウン更新
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

// 生産計画一覧取得
async function loadPlans() {
    showLoading();
    try {
        const response = await fetch(`${API_BASE_URL}/production-plans`);
        if (!response.ok) throw new Error('生産計画一覧の取得に失敗しました');

        const plans = await response.json();
        renderPlansTable(plans);
    } catch (error) {
        console.error('Error loading plans:', error);
        showError('生産計画一覧の取得に失敗しました');
        document.getElementById('plansTableBody').innerHTML = `
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
function renderPlansTable(plans) {
    const tbody = document.getElementById('plansTableBody');

    if (plans.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center text-muted py-5">
                    <i class="fas fa-inbox fa-3x mb-3"></i>
                    <p>生産計画が登録されていません</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = plans.map(plan => {
        const startDate = plan.planned_start_date ? new Date(plan.planned_start_date).toLocaleDateString('ja-JP') : '-';
        const endDate = plan.planned_end_date ? new Date(plan.planned_end_date).toLocaleDateString('ja-JP') : '-';
        const statusBadge = getStatusBadge(plan.status);

        return `
            <tr>
                <td><strong>${escapeHtml(plan.plan_id)}</strong></td>
                <td>${escapeHtml(plan.product_code)}<br><small class="text-muted">${escapeHtml(plan.product_name)}</small></td>
                <td><strong>${plan.planned_quantity}</strong></td>
                <td>${startDate}</td>
                <td>${endDate}</td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary btn-action me-1" type="button" data-action="edit" data-plan-id="${plan.id}" title="編集">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger btn-action" type="button" data-action="delete" data-plan-id="${plan.id}" data-plan-code="${escapeHtml(plan.plan_id)}" title="削除">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// ステータスバッジ
function getStatusBadge(status) {
    const badges = {
        'planned': '<span class="badge bg-secondary">計画</span>',
        'in_progress': '<span class="badge bg-primary">進行中</span>',
        'completed': '<span class="badge bg-success">完了</span>',
        'cancelled': '<span class="badge bg-danger">キャンセル</span>'
    };
    return badges[status] || `<span class="badge bg-secondary">${status}</span>`;
}

// 新規登録モーダルを開く
function openCreateModal() {
    currentEditingId = null;
    document.getElementById('modalTitle').textContent = '新規計画登録';
    document.getElementById('planForm').reset();
    document.getElementById('planForm').classList.remove('was-validated');
    document.getElementById('planDbId').value = '';
    document.getElementById('status').value = 'planned';

    const modal = new bootstrap.Modal(document.getElementById('planModal'));
    modal.show();
}

function handlePlanActionClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const planId = Number(button.dataset.planId);
    if (!planId) return;

    if (button.dataset.action === 'edit') {
        openEditModal(planId);
        return;
    }

    if (button.dataset.action === 'delete') {
        deletePlan(planId, button.dataset.planCode || '');
    }
}

// 編集モーダルを開く
async function openEditModal(planId) {
    showLoading();
    try {
        const response = await fetch(`${API_BASE_URL}/production-plans/${planId}`);
        if (!response.ok) throw new Error('生産計画情報の取得に失敗しました');

        const plan = await response.json();

        currentEditingId = planId;
        document.getElementById('modalTitle').textContent = '計画編集';
        document.getElementById('planDbId').value = plan.id;
        document.getElementById('planId').value = plan.plan_id;
        document.getElementById('productId').value = plan.product_id || '';
        document.getElementById('plannedQuantity').value = plan.planned_quantity;
        document.getElementById('plannedStartDate').value = plan.planned_start_date || '';
        document.getElementById('plannedEndDate').value = plan.planned_end_date || '';
        document.getElementById('status').value = plan.status || 'planned';

        document.getElementById('planForm').classList.remove('was-validated');

        const modal = new bootstrap.Modal(document.getElementById('planModal'));
        modal.show();
    } catch (error) {
        console.error('Error loading plan:', error);
        showError('生産計画情報の取得に失敗しました');
    } finally {
        hideLoading();
    }
}

// 生産計画保存（新規登録・更新）
async function savePlan() {
    const form = document.getElementById('planForm');

    if (!form.checkValidity()) {
        form.classList.add('was-validated');
        return;
    }

    const planData = {
        plan_id: document.getElementById('planId').value.trim(),
        product_id: parseInt(document.getElementById('productId').value),
        planned_quantity: parseInt(document.getElementById('plannedQuantity').value),
        planned_start_date: document.getElementById('plannedStartDate').value || null,
        planned_end_date: document.getElementById('plannedEndDate').value || null,
        status: document.getElementById('status').value
    };

    showLoading();
    try {
        const planId = document.getElementById('planDbId').value;
        const url = planId ? `${API_BASE_URL}/production-plans/${planId}` : `${API_BASE_URL}/production-plans`;
        const method = planId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(planData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '保存に失敗しました');
        }

        await response.json();

        showSuccess(planId ? '生産計画を更新しました' : '生産計画を登録しました');

        // モーダルを閉じる
        const modal = bootstrap.Modal.getInstance(document.getElementById('planModal'));
        modal.hide();

        // 一覧を再読み込み
        await loadPlans();
    } catch (error) {
        console.error('Error saving plan:', error);
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// 生産計画削除
async function deletePlan(planId, planIdStr) {
    if (!confirm(`生産計画「${planIdStr}」を削除してもよろしいですか？\n\n※生産実績がある場合は削除できません。`)) {
        return;
    }

    showLoading();
    try {
        const response = await fetch(`${API_BASE_URL}/production-plans/${planId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || '削除に失敗しました');
        }

        showSuccess('生産計画を削除しました');
        await loadPlans();
    } catch (error) {
        console.error('Error deleting plan:', error);
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
