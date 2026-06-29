// モニタリングダッシュボード - JavaScript
const API_BASE_URL = window.location.protocol + '//' + window.location.host + '/api';

// Chart.js インスタンス
let hourlyTrendChart = null;
let productRankingChart = null;
let turnoverRateChart = null;
let inspectorComparisonChart = null;

// 自動更新タイマー
let autoRefreshInterval = null;

// ページ読み込み時の初期化
document.addEventListener('DOMContentLoaded', () => {
    initializeCharts();
    loadDashboardSummary();
    loadShipmentRealtime();
    loadProductRanking();
    loadInventoryHealth();
    loadStockoutRisk();
    loadInspectorPerformance();
    loadAlerts();

    // 自動更新（30秒ごと）
    autoRefreshInterval = setInterval(refreshAllData, 30000);

    // アラートフィルター
    document.getElementById('alert-filter-severity').addEventListener('change', loadAlerts);
});

// すべてのデータを更新
function refreshAllData() {
    const refreshIcon = document.getElementById('refresh-icon');
    refreshIcon.classList.add('refresh-indicator');

    loadDashboardSummary();
    loadShipmentRealtime();
    loadProductRanking();
    loadInventoryHealth();
    loadStockoutRisk();
    loadInspectorPerformance();
    loadAlerts();

    setTimeout(() => {
        refreshIcon.classList.remove('refresh-indicator');
    }, 1000);
}

// サンプルデータ生成
async function generateSampleData() {
    if (!confirm('モニタリングのサンプルデータを生成します。\n既存のモニタリングデータは削除されます。\nよろしいですか？')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/monitoring/generate-sample-data`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'サンプルデータの生成に失敗しました');
        }

        const result = await response.json();

        // Bootstrap Toast 表示（Toastがない場合はalert）
        if (typeof showToast === 'function') {
            showToast(`サンプルデータを生成しました: 在庫スナップショット ${result.data.inventory_snapshots}件、パフォーマンス記録 ${result.data.performance_records}件、アラート ${result.data.alerts}件`, 'success');
        } else {
            alert(`✅ ${result.message}\n\n` +
                  `在庫スナップショット: ${result.data.inventory_snapshots}件\n` +
                  `パフォーマンス記録: ${result.data.performance_records}件\n` +
                  `アラート: ${result.data.alerts}件\n` +
                  `使用製品数: ${result.data.products_used}件`);
        }

        // 全データを再読み込み
        refreshAllData();

    } catch (error) {
        console.error('Sample data generation error:', error);
        if (typeof showToast === 'function') {
            showToast(`エラー: ${error.message}`, 'danger');
        } else {
            alert(`❌ エラー: ${error.message}`);
        }
    }
}

// Chart.js 初期化
function initializeCharts() {
    // 時間帯別出荷推移チャート
    const hourlyCtx = document.getElementById('hourlyTrendChart').getContext('2d');
    hourlyTrendChart = new Chart(hourlyCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: '検品件数',
                data: [],
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1 } }
            }
        }
    });

    // 製品別出荷ランキングチャート
    const productCtx = document.getElementById('productRankingChart').getContext('2d');
    productRankingChart = new Chart(productCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: '出荷件数',
                data: [],
                backgroundColor: 'rgba(118, 75, 162, 0.8)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { beginAtZero: true }
            }
        }
    });

    // 在庫回転率チャート
    const turnoverCtx = document.getElementById('turnoverRateChart').getContext('2d');
    turnoverRateChart = new Chart(turnoverCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: '在庫回転率',
                data: [],
                backgroundColor: 'rgba(40, 167, 69, 0.8)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });

    // 検品員比較チャート
    const inspectorCtx = document.getElementById('inspectorComparisonChart').getContext('2d');
    inspectorComparisonChart = new Chart(inspectorCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: '成功率 (%)',
                data: [],
                backgroundColor: 'rgba(23, 162, 184, 0.8)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true, max: 100 }
            }
        }
    });
}

// ダッシュボード総合サマリー
async function loadDashboardSummary() {
    try {
        const response = await fetch(`${API_BASE_URL}/monitoring/dashboard-summary`);
        const data = await response.json();

        // KPIカード更新
        document.getElementById('stat-today-completed').textContent = data.shipment.today_completed || 0;
        document.getElementById('stat-in-progress').textContent = data.shipment.in_progress || 0;

        document.getElementById('stat-inventory-critical').textContent = data.inventory.critical_count || 0;
        document.getElementById('stat-inventory-warning').textContent = data.inventory.warning_count || 0;

        document.getElementById('stat-alerts-total').textContent = data.alerts.total_unacknowledged || 0;
        document.getElementById('stat-alerts-critical').textContent = data.alerts.critical_alerts || 0;

        document.getElementById('stat-active-inspectors').textContent = data.performance.active_inspectors || 0;
        document.getElementById('stat-avg-success').textContent = data.performance.avg_success_rate || '--';
    } catch (error) {
        console.error('Error loading dashboard summary:', error);
    }
}

// リアルタイム出荷モニタリング
async function loadShipmentRealtime() {
    try {
        const response = await fetch(`${API_BASE_URL}/monitoring/shipment-realtime`);
        const data = await response.json();

        // 出荷状況統計
        document.getElementById('today-total').textContent = data.total_today || 0;
        document.getElementById('today-completed').textContent = data.completed_today || 0;
        document.getElementById('today-in-progress').textContent = data.in_progress_today || 0;
        document.getElementById('today-waiting').textContent = data.waiting_count || 0;

        // 時間帯別推移チャート
        if (data.hourly_data && data.hourly_data.length > 0) {
            const labels = data.hourly_data.map(h => `${h.hour}:00`);
            const counts = data.hourly_data.map(h => h.count);

            hourlyTrendChart.data.labels = labels;
            hourlyTrendChart.data.datasets[0].data = counts;
            hourlyTrendChart.update();
        }
    } catch (error) {
        console.error('Error loading shipment realtime:', error);
    }
}

// 製品別出荷ランキング
async function loadProductRanking() {
    try {
        const response = await fetch(`${API_BASE_URL}/monitoring/product-shipment-ranking?limit=10&period=30`);
        const data = await response.json();

        const labels = data.map(p => p.product_name);
        const counts = data.map(p => p.shipment_count);

        productRankingChart.data.labels = labels;
        productRankingChart.data.datasets[0].data = counts;
        productRankingChart.update();
    } catch (error) {
        console.error('Error loading product ranking:', error);
    }
}

// 在庫健全性
async function loadInventoryHealth() {
    try {
        const response = await fetch(`${API_BASE_URL}/monitoring/inventory-health`);
        const data = await response.json();

        const tbody = document.getElementById('inventory-health-tbody');
        tbody.innerHTML = '';

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">データがありません</td></tr>';
            return;
        }

        data.slice(0, 20).forEach(item => {
            const statusClass = `health-status-${item.health_status}`;
            const statusText = {
                'critical': '危険',
                'warning': '警告',
                'healthy': '健全',
                'overstocked': '過剰'
            }[item.health_status] || item.health_status;

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.product_code}</td>
                <td>${item.product_name}</td>
                <td class="text-end">${item.available_stock.toFixed(0)}</td>
                <td class="text-end">${item.avg_daily_demand ? item.avg_daily_demand.toFixed(1) : '--'}</td>
                <td><span class="${statusClass}">${statusText}</span></td>
            `;
            tbody.appendChild(row);
        });

        // 在庫回転率チャート
        const turnoverData = data.filter(item => item.turnover_rate).slice(0, 15);
        turnoverRateChart.data.labels = turnoverData.map(item => item.product_code);
        turnoverRateChart.data.datasets[0].data = turnoverData.map(item => item.turnover_rate);
        turnoverRateChart.update();
    } catch (error) {
        console.error('Error loading inventory health:', error);
    }
}

// 欠品リスク
async function loadStockoutRisk() {
    try {
        const response = await fetch(`${API_BASE_URL}/monitoring/stockout-risk?threshold=14`);
        const data = await response.json();

        const tbody = document.getElementById('stockout-risk-tbody');
        tbody.innerHTML = '';

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-success"><i class="fas fa-check-circle me-2"></i>欠品リスクはありません</td></tr>';
            return;
        }

        data.forEach(item => {
            const riskClass = {
                'critical': 'text-danger fw-bold',
                'high': 'text-warning fw-bold',
                'medium': 'text-info',
                'low': 'text-secondary'
            }[item.risk_level];

            const riskText = {
                'critical': '重大',
                'high': '高',
                'medium': '中',
                'low': '低'
            }[item.risk_level];

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.product_code}</td>
                <td>${item.product_name}</td>
                <td class="text-end">${item.available_stock.toFixed(0)}</td>
                <td class="text-end">${item.days_of_stock ? item.days_of_stock.toFixed(1) + '日' : '--'}</td>
                <td><span class="${riskClass}">${riskText}</span></td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        console.error('Error loading stockout risk:', error);
    }
}

// 検品員パフォーマンス
async function loadInspectorPerformance() {
    try {
        const response = await fetch(`${API_BASE_URL}/monitoring/inspector-performance?period=7`);
        const data = await response.json();

        const tbody = document.getElementById('inspector-performance-tbody');
        tbody.innerHTML = '';

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">データがありません</td></tr>';
            return;
        }

        data.forEach(item => {
            const performanceClass = {
                'excellent': 'performance-excellent',
                'good': 'performance-good',
                'fair': 'performance-fair',
                'needs_improvement': 'performance-needs_improvement'
            };

            // 成功率から評価を計算
            let rating = 'needs_improvement';
            if (item.success_rate >= 95) rating = 'excellent';
            else if (item.success_rate >= 85) rating = 'good';
            else if (item.success_rate >= 70) rating = 'fair';

            const ratingText = {
                'excellent': '優秀',
                'good': '良好',
                'fair': '普通',
                'needs_improvement': '要改善'
            }[rating];

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${item.inspector_name}</td>
                <td class="text-end">${item.total_inspections}</td>
                <td class="text-end">${item.completed_count}</td>
                <td class="text-end">${item.failed_count}</td>
                <td class="text-end fw-bold">${item.success_rate}%</td>
                <td class="text-end">${item.avg_inspection_time || '--'}</td>
                <td class="text-end">${item.total_components}</td>
                <td><span class="${performanceClass[rating]}">${ratingText}</span></td>
            `;
            tbody.appendChild(row);
        });

        // 検品員比較チャート
        inspectorComparisonChart.data.labels = data.map(item => item.inspector_name);
        inspectorComparisonChart.data.datasets[0].data = data.map(item => item.success_rate);
        inspectorComparisonChart.update();
    } catch (error) {
        console.error('Error loading inspector performance:', error);
    }
}

// アラート一覧
async function loadAlerts() {
    try {
        const severity = document.getElementById('alert-filter-severity').value;
        let url = `${API_BASE_URL}/monitoring/alerts?acknowledged=false`;
        if (severity) {
            url += `&severity=${severity}`;
        }

        const response = await fetch(url);
        const data = await response.json();

        const container = document.getElementById('alerts-container');
        container.innerHTML = '';

        if (data.length === 0) {
            container.innerHTML = `
                <div class="text-center text-muted py-5">
                    <i class="fas fa-check-circle fa-3x mb-3 text-success"></i>
                    <p>未対応のアラートはありません</p>
                </div>
            `;
            return;
        }

        data.forEach(alert => {
            const severityClass = {
                'critical': 'alert-critical',
                'high': 'alert-warning',
                'medium': 'alert-info',
                'low': 'alert-success'
            }[alert.severity];

            const severityBadge = {
                'critical': 'danger',
                'high': 'warning',
                'medium': 'info',
                'low': 'secondary'
            }[alert.severity];

            const severityText = {
                'critical': '重大',
                'high': '高',
                'medium': '中',
                'low': '低'
            }[alert.severity];

            const alertDate = new Date(alert.created_at);

            const alertDiv = document.createElement('div');
            alertDiv.className = `alert ${severityClass} d-flex justify-content-between align-items-center mb-2`;
            alertDiv.innerHTML = `
                <div>
                    <span class="badge bg-${severityBadge} me-2">${severityText}</span>
                    <strong>${alert.alert_type}</strong>: ${alert.alert_message}
                    <br>
                    <small class="text-muted">発生時刻: ${alertDate.toLocaleString('ja-JP')}</small>
                </div>
                <button class="btn btn-sm btn-outline-secondary" onclick="acknowledgeAlert(${alert.id})">
                    <i class="fas fa-check me-1"></i>確認
                </button>
            `;
            container.appendChild(alertDiv);
        });
    } catch (error) {
        console.error('Error loading alerts:', error);
    }
}

// アラート確認
async function acknowledgeAlert(alertId) {
    try {
        const response = await fetch(`${API_BASE_URL}/monitoring/alerts/${alertId}/acknowledge`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acknowledged_by: 'user' })
        });

        if (response.ok) {
            loadAlerts();
            loadDashboardSummary();
        }
    } catch (error) {
        console.error('Error acknowledging alert:', error);
    }
}

// ページ離脱時にタイマークリア
window.addEventListener('beforeunload', () => {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
});
