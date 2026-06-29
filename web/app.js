// 生産管理システム JavaScript

const API_BASE_URL = '/api';

// グローバル変数
let currentPage = 'dashboard';
let shippingInstructions = [];
let products = [];

// DOM要素の取得
const elements = {
    // ナビゲーション
    navLinks: document.querySelectorAll('[data-page]'),
    
    // ページコンテンツ
    dashboardPage: document.getElementById('dashboard-page'),
    shippingPage: document.getElementById('shipping-page'),
    inspectionPage: document.getElementById('inspection-page'),
    inventoryPage: document.getElementById('inventory-page'),
    
    // ダッシュボード統計
    pendingShipments: document.getElementById('pending-shipments'),
    totalInspections: document.getElementById('total-inspections'),
    passRate: document.getElementById('pass-rate'),
    totalStock: document.getElementById('total-stock'),
    
    // リスト表示エリア
    recentShipments: document.getElementById('recent-shipments'),
    recentInspections: document.getElementById('recent-inspections'),
    shippingList: document.getElementById('shipping-list'),
    inspectionList: document.getElementById('inspection-list'),
    inventoryList: document.getElementById('inventory-list'),
    
    // モーダル
    inspectionModal: document.getElementById('inspectionModal'),
    inspectionForm: document.getElementById('inspectionForm'),
    
    // フォーム要素
    shippingInstructionSelect: document.getElementById('shipping_instruction_id'),
    inspectorName: document.getElementById('inspector_name'),
    inspectedQuantity: document.getElementById('inspected_quantity'),
    passedQuantity: document.getElementById('passed_quantity'),
    failedQuantity: document.getElementById('failed_quantity'),
    defectDetails: document.getElementById('defect_details'),
    packagingCondition: document.getElementById('packaging_condition'),
    labelCheck: document.getElementById('label_check'),
    documentationCheck: document.getElementById('documentation_check'),
    finalApproval: document.getElementById('final_approval'),
    notes: document.getElementById('notes')
};

// ユーティリティ関数
const utils = {
    // 日付フォーマット
    formatDate: (dateStr) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return date.toLocaleDateString('ja-JP');
    },
    
    // 日時フォーマット
    formatDateTime: (dateStr) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return date.toLocaleString('ja-JP');
    },
    
    // 数値フォーマット
    formatNumber: (num) => {
        if (num === null || num === undefined) return '-';
        return Number(num).toLocaleString('ja-JP');
    },
    
    // ステータスバッジの生成
    getStatusBadge: (status) => {
        const statusMap = {
            'pending': { class: 'status-pending', text: '待機中' },
            'processing': { class: 'status-processing', text: '処理中' },
            'shipped': { class: 'status-shipped', text: '出荷済み' },
            'delivered': { class: 'status-delivered', text: '配送完了' },
            'cancelled': { class: 'status-cancelled', text: 'キャンセル' }
        };
        
        const statusInfo = statusMap[status] || { class: 'status-pending', text: status };
        return `<span class="badge status-badge ${statusInfo.class}">${statusInfo.text}</span>`;
    },
    
    // 優先度バッジの生成
    getPriorityBadge: (priority) => {
        const priorityMap = {
            'high': { class: 'priority-high', text: '高' },
            'normal': { class: 'priority-normal', text: '中' },
            'low': { class: 'priority-low', text: '低' }
        };
        
        const priorityInfo = priorityMap[priority] || { class: 'priority-normal', text: priority };
        return `<span class="badge ${priorityInfo.class}">${priorityInfo.text}</span>`;
    },
    
    // エラーメッセージ表示
    showError: (message, container = document.body) => {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.innerHTML = `<i class="fas fa-exclamation-triangle me-2"></i>${message}`;
        container.appendChild(errorDiv);
        
        setTimeout(() => {
            errorDiv.remove();
        }, 5000);
    },
    
    // 成功メッセージ表示
    showSuccess: (message, container = document.body) => {
        const successDiv = document.createElement('div');
        successDiv.className = 'success-message';
        successDiv.innerHTML = `<i class="fas fa-check-circle me-2"></i>${message}`;
        container.appendChild(successDiv);
        
        setTimeout(() => {
            successDiv.remove();
        }, 3000);
    },
    
    // ローディング表示
    showLoading: (container) => {
        container.innerHTML = `
            <div class="text-center">
                <div class="spinner-border" role="status">
                    <span class="visually-hidden">読み込み中...</span>
                </div>
            </div>
        `;
    }
};

// API関数
const api = {
    // 基本的なFetch関数
    fetch: async (url, options = {}) => {
        try {
            const response = await fetch(`${API_BASE_URL}${url}`, {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    },
    
    // ダッシュボード統計取得
    getDashboardStats: () => api.fetch('/reports/dashboard-stats'),
    
    // 製品一覧取得
    getProducts: () => api.fetch('/products'),
    
    // 出荷指示一覧取得
    getShippingInstructions: (params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        return api.fetch(`/shipping-instructions${queryString ? '?' + queryString : ''}`);
    },
    
    // 出荷検品一覧取得
    getShippingInspections: (params = {}) => {
        const queryString = new URLSearchParams(params).toString();
        return api.fetch(`/shipping-inspections${queryString ? '?' + queryString : ''}`);
    },
    
    // 出荷検品記録作成
    createShippingInspection: (data) => api.fetch('/shipping-inspections', {
        method: 'POST',
        body: JSON.stringify(data)
    }),
    
    // レポート取得
    getShippingSummary: () => api.fetch('/reports/shipping-summary')
};

// ページナビゲーション
function initNavigation() {
    elements.navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = link.getAttribute('data-page');
            navigateToPage(page);
        });
    });
}

function navigateToPage(page) {
    // 現在のページを非表示
    document.querySelectorAll('.page-content').forEach(content => {
        content.classList.add('d-none');
    });
    
    // ナビゲーションリンクの状態更新
    elements.navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-page') === page) {
            link.classList.add('active');
        }
    });
    
    // 指定されたページを表示
    const targetPage = document.getElementById(`${page}-page`);
    if (targetPage) {
        targetPage.classList.remove('d-none');
        targetPage.classList.add('fade-in');
    }
    
    currentPage = page;
    
    // ページ固有の初期化
    switch (page) {
        case 'dashboard':
            loadDashboard();
            break;
        case 'shipping':
            loadShippingPage();
            break;
        case 'inspection':
            loadInspectionPage();
            break;
        case 'inventory':
            loadInventoryPage();
            break;
    }
}

// ダッシュボード
async function loadDashboard() {
    try {
        // 統計データ取得
        const stats = await api.getDashboardStats();
        
        // 統計カード更新
        updateStatsCards(stats);
        
        // 最近の活動データ取得
        const [shipments, inspections] = await Promise.all([
            api.getShippingInstructions(),
            api.getShippingInspections()
        ]);
        
        // テーブル更新
        updateRecentShipments(shipments.slice(0, 5));
        updateRecentInspections(inspections.slice(0, 5));
        
    } catch (error) {
        console.error('Dashboard loading error:', error);
        utils.showError('ダッシュボードの読み込みに失敗しました。');
    }
}

function updateStatsCards(stats) {
    // 出荷統計
    const pendingCount = stats.shipping.find(s => s.status === 'pending')?.count || 0;
    elements.pendingShipments.textContent = utils.formatNumber(pendingCount);
    
    // 検品統計
    const inspectionStats = stats.inspection || {};
    elements.totalInspections.textContent = utils.formatNumber(inspectionStats.approved_inspections || 0);
    
    const passRate = inspectionStats.pass_rate ? Math.round(inspectionStats.pass_rate) : 0;
    elements.passRate.textContent = `${passRate}%`;
    
    // 在庫統計
    const inventoryStats = stats.inventory || {};
    elements.totalStock.textContent = utils.formatNumber(inventoryStats.total_stock || 0);
}

function updateRecentShipments(shipments) {
    const container = elements.recentShipments;
    
    if (!shipments || shipments.length === 0) {
        container.innerHTML = '<p class="text-muted">データがありません</p>';
        return;
    }
    
    const tableHTML = `
        <table class="table table-sm">
            <thead>
                <tr>
                    <th>指示番号</th>
                    <th>製品</th>
                    <th>数量</th>
                    <th>ステータス</th>
                </tr>
            </thead>
            <tbody>
                ${shipments.map(s => `
                    <tr>
                        <td>${s.instruction_id}</td>
                        <td>${s.product_name}</td>
                        <td>${utils.formatNumber(s.quantity)}</td>
                        <td>${utils.getStatusBadge(s.status)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = tableHTML;
}

function updateRecentInspections(inspections) {
    const container = elements.recentInspections;
    
    if (!inspections || inspections.length === 0) {
        container.innerHTML = '<p class="text-muted">データがありません</p>';
        return;
    }
    
    const tableHTML = `
        <table class="table table-sm">
            <thead>
                <tr>
                    <th>検品者</th>
                    <th>製品</th>
                    <th>合格数</th>
                    <th>日時</th>
                </tr>
            </thead>
            <tbody>
                ${inspections.map(i => `
                    <tr>
                        <td>${i.inspector_name}</td>
                        <td>${i.product_name}</td>
                        <td>${utils.formatNumber(i.passed_quantity)}</td>
                        <td>${utils.formatDateTime(i.inspection_date)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = tableHTML;
}

// 出荷管理ページ
async function loadShippingPage() {
    utils.showLoading(elements.shippingList);
    
    try {
        const shipments = await api.getShippingInstructions();
        shippingInstructions = shipments;
        updateShippingList(shipments);
    } catch (error) {
        console.error('Shipping page loading error:', error);
        utils.showError('出荷データの読み込みに失敗しました。');
    }
}

function updateShippingList(shipments) {
    const container = elements.shippingList;
    
    if (!shipments || shipments.length === 0) {
        container.innerHTML = '<p class="text-muted">データがありません</p>';
        return;
    }
    
    const tableHTML = `
        <table class="table table-hover">
            <thead>
                <tr>
                    <th>指示番号</th>
                    <th>製品</th>
                    <th>数量</th>
                    <th>出荷日</th>
                    <th>顧客</th>
                    <th>優先度</th>
                    <th>ステータス</th>
                    <th>アクション</th>
                </tr>
            </thead>
            <tbody>
                ${shipments.map(s => `
                    <tr>
                        <td>${s.instruction_id}</td>
                        <td>${s.product_name}</td>
                        <td>${utils.formatNumber(s.quantity)}</td>
                        <td>${utils.formatDate(s.shipping_date)}</td>
                        <td>${s.customer_name}</td>
                        <td>${utils.getPriorityBadge(s.priority)}</td>
                        <td>${utils.getStatusBadge(s.status)}</td>
                        <td>
                            <div class="action-buttons">
                                <button class="btn btn-sm btn-primary" onclick="inspectShipment(${s.id})">
                                    <i class="fas fa-search"></i>
                                </button>
                                <button class="btn btn-sm btn-info" onclick="viewShipmentDetails(${s.id})">
                                    <i class="fas fa-eye"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = tableHTML;
}

// 出荷検品ページ
async function loadInspectionPage() {
    utils.showLoading(elements.inspectionList);
    
    try {
        const inspections = await api.getShippingInspections();
        updateInspectionList(inspections);
        
        // 出荷指示選択肢を更新
        await updateShippingInstructionOptions();
    } catch (error) {
        console.error('Inspection page loading error:', error);
        utils.showError('検品データの読み込みに失敗しました。');
    }
}

function updateInspectionList(inspections) {
    const container = elements.inspectionList;
    
    if (!inspections || inspections.length === 0) {
        container.innerHTML = '<p class="text-muted">データがありません</p>';
        return;
    }
    
    const tableHTML = `
        <table class="table table-hover">
            <thead>
                <tr>
                    <th>指示番号</th>
                    <th>製品</th>
                    <th>検品者</th>
                    <th>検品数</th>
                    <th>合格数</th>
                    <th>不合格数</th>
                    <th>最終承認</th>
                    <th>検品日時</th>
                </tr>
            </thead>
            <tbody>
                ${inspections.map(i => `
                    <tr>
                        <td>${i.instruction_id}</td>
                        <td>${i.product_name}</td>
                        <td>${i.inspector_name}</td>
                        <td>${utils.formatNumber(i.inspected_quantity)}</td>
                        <td class="text-success">${utils.formatNumber(i.passed_quantity)}</td>
                        <td class="text-danger">${utils.formatNumber(i.failed_quantity)}</td>
                        <td>
                            ${i.final_approval ? 
                                '<i class="fas fa-check-circle text-success"></i>' : 
                                '<i class="fas fa-clock text-warning"></i>'
                            }
                        </td>
                        <td>${utils.formatDateTime(i.inspection_date)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = tableHTML;
}

// 在庫管理ページ
async function loadInventoryPage() {
    utils.showLoading(elements.inventoryList);
    
    try {
        const products = await api.getProducts();
        updateInventoryList(products);
    } catch (error) {
        console.error('Inventory page loading error:', error);
        utils.showError('在庫データの読み込みに失敗しました。');
    }
}

function updateInventoryList(products) {
    const container = elements.inventoryList;
    
    if (!products || products.length === 0) {
        container.innerHTML = '<p class="text-muted">データがありません</p>';
        return;
    }
    
    const tableHTML = `
        <table class="table table-hover">
            <thead>
                <tr>
                    <th>製品コード</th>
                    <th>製品名</th>
                    <th>カテゴリ</th>
                    <th>現在在庫</th>
                    <th>利用可能在庫</th>
                    <th>単価</th>
                </tr>
            </thead>
            <tbody>
                ${products.map(p => `
                    <tr>
                        <td>${p.product_code}</td>
                        <td>${p.product_name}</td>
                        <td>${p.category}</td>
                        <td>${utils.formatNumber(p.current_stock)}</td>
                        <td>
                            <span class="${p.available_stock < 10 ? 'text-danger' : 'text-success'}">
                                ${utils.formatNumber(p.available_stock)}
                            </span>
                        </td>
                        <td>¥${utils.formatNumber(p.unit_price)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = tableHTML;
}

// 検品フォーム関連
async function showInspectionForm(shippingInstructionId = null) {
    try {
        await updateShippingInstructionOptions();
        
        // フォームリセット
        elements.inspectionForm.reset();
        
        // 指定された出荷指示があれば選択
        if (shippingInstructionId) {
            elements.shippingInstructionSelect.value = shippingInstructionId;
        }
        
        // モーダル表示
        const modal = new bootstrap.Modal(elements.inspectionModal);
        modal.show();
    } catch (error) {
        console.error('Inspection form error:', error);
        utils.showError('検品フォームの表示に失敗しました。');
    }
}

async function updateShippingInstructionOptions() {
    try {
        const shipments = await api.getShippingInstructions({ status: 'pending' });
        
        const options = shipments.map(s => 
            `<option value="${s.id}">${s.instruction_id} - ${s.product_name} (${s.quantity}個)</option>`
        ).join('');
        
        elements.shippingInstructionSelect.innerHTML = 
            '<option value="">選択してください</option>' + options;
    } catch (error) {
        console.error('Error updating shipping instruction options:', error);
    }
}

async function submitInspection() {
    try {
        // フォームバリデーション
        if (!elements.inspectionForm.checkValidity()) {
            elements.inspectionForm.reportValidity();
            return;
        }
        
        // データ収集
        const data = {
            shipping_instruction_id: parseInt(elements.shippingInstructionSelect.value),
            inspector_name: elements.inspectorName.value,
            inspected_quantity: parseInt(elements.inspectedQuantity.value),
            passed_quantity: parseInt(elements.passedQuantity.value),
            failed_quantity: parseInt(elements.failedQuantity.value),
            defect_details: elements.defectDetails.value,
            packaging_condition: elements.packagingCondition.value,
            label_check: elements.labelCheck.checked,
            documentation_check: elements.documentationCheck.checked,
            final_approval: elements.finalApproval.checked,
            notes: elements.notes.value
        };
        
        // API呼び出し
        await api.createShippingInspection(data);
        
        // 成功メッセージ
        utils.showSuccess('出荷検品記録を保存しました。');
        
        // モーダルを閉じる
        const modal = bootstrap.Modal.getInstance(elements.inspectionModal);
        modal.hide();
        
        // 検品ページを再読み込み
        if (currentPage === 'inspection') {
            loadInspectionPage();
        }
        
        // ダッシュボードも更新
        if (currentPage === 'dashboard') {
            loadDashboard();
        }
        
    } catch (error) {
        console.error('Inspection submission error:', error);
        utils.showError('検品記録の保存に失敗しました。');
    }
}

// アクション関数
function inspectShipment(shippingInstructionId) {
    showInspectionForm(shippingInstructionId);
}

function viewShipmentDetails(shippingInstructionId) {
    // 詳細表示の実装（今回は省略）
    console.log('View shipping details:', shippingInstructionId);
}

// 数量の自動計算
function setupQuantityCalculation() {
    elements.inspectedQuantity.addEventListener('input', updateFailedQuantity);
    elements.passedQuantity.addEventListener('input', updateFailedQuantity);
}

function updateFailedQuantity() {
    const inspected = parseInt(elements.inspectedQuantity.value) || 0;
    const passed = parseInt(elements.passedQuantity.value) || 0;
    const failed = inspected - passed;
    
    if (failed >= 0) {
        elements.failedQuantity.value = failed;
    }
}

// 初期化
function init() {
    console.log('Initializing Production Management System...');
    
    // ナビゲーション初期化
    initNavigation();
    
    // 数量計算設定
    setupQuantityCalculation();
    
    // 初期ページ読み込み
    loadDashboard();
    
    console.log('System initialized successfully.');
}

// DOM読み込み完了時に初期化実行
document.addEventListener('DOMContentLoaded', init);

// グローバル関数として公開
window.showInspectionForm = showInspectionForm;
window.submitInspection = submitInspection;
window.inspectShipment = inspectShipment;
window.viewShipmentDetails = viewShipmentDetails;
