const API_BASE_URL = '/api';

let paretoChart = null;
let controlChart = null;
let histogramChart = null;
let scatterChart = null;

document.addEventListener('DOMContentLoaded', () => {
    initializeCharts();
    loadParetoData();
    loadControlChartData();
    loadHistogramData();
    loadScatterData();
    loadChecksheetData();

    // タブ切り替え時にチャートをリサイズ
    document.querySelectorAll('[data-bs-toggle="pill"]').forEach(tab => {
        tab.addEventListener('shown.bs.tab', () => {
            if (paretoChart) paretoChart.resize();
            if (controlChart) controlChart.resize();
            if (histogramChart) histogramChart.resize();
            if (scatterChart) scatterChart.resize();
        });
    });

    // 期間選択の変更イベント
    document.getElementById('pareto-period')?.addEventListener('change', loadParetoData);
    document.getElementById('control-metric')?.addEventListener('change', loadControlChartData);
    document.getElementById('histogram-metric')?.addEventListener('change', loadHistogramData);
    document.getElementById('scatter-x')?.addEventListener('change', loadScatterData);
    document.getElementById('scatter-y')?.addEventListener('change', loadScatterData);

    // サンプルデータ生成ボタン
    document.getElementById('btn-generate-sample-data')?.addEventListener('click', generateSampleData);
});

async function generateSampleData() {
    const btn = document.getElementById('btn-generate-sample-data');

    if (!confirm('過去30日分のサンプルデータを生成します。\n既存のサンプルデータは削除されます。\nよろしいですか？')) {
        return;
    }

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>生成中...';

        const response = await fetch(`${API_BASE_URL}/qc-tools/generate-sample-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new Error('サンプルデータの生成に失敗しました');
        }

        const result = await response.json();

        showToast(`サンプルデータの生成が完了しました\n検品記録: ${result.total_inspections}件\n検品詳細: ${result.total_details}件`, 'success', 5000);

        // 全データを再読み込み
        loadParetoData();
        loadControlChartData();
        loadHistogramData();
        loadScatterData();
        loadChecksheetData();
    } catch (error) {
        console.error('generateSampleData error:', error);
        showToast('サンプルデータの生成に失敗しました: ' + error.message, 'danger');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-database me-2"></i>サンプルデータ生成';
    }
}

function initializeCharts() {
    // パレート図の初期化
    const paretoCtx = document.getElementById('paretoChart');
    if (paretoCtx) {
        paretoChart = new Chart(paretoCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [
                    {
                        type: 'bar',
                        label: '不良件数',
                        data: [],
                        backgroundColor: 'rgba(54, 162, 235, 0.7)',
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 1,
                        yAxisID: 'y'
                    },
                    {
                        type: 'line',
                        label: '累積比率 (%)',
                        data: [],
                        borderColor: 'rgba(255, 99, 132, 1)',
                        backgroundColor: 'rgba(255, 99, 132, 0.2)',
                        borderWidth: 2,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: '不良件数'
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        min: 0,
                        max: 100,
                        title: {
                            display: true,
                            text: '累積比率 (%)'
                        },
                        grid: {
                            drawOnChartArea: false
                        }
                    }
                },
                plugins: {
                    annotation: {
                        annotations: {
                            line1: {
                                type: 'line',
                                yMin: 80,
                                yMax: 80,
                                yScaleID: 'y1',
                                borderColor: 'rgb(255, 99, 132)',
                                borderWidth: 2,
                                borderDash: [5, 5],
                                label: {
                                    content: '80%ライン',
                                    enabled: true
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    // 管理図の初期化
    const controlCtx = document.getElementById('controlChart');
    if (controlCtx) {
        controlChart = new Chart(controlCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'データ',
                    data: [],
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    borderWidth: 2,
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        title: {
                            display: true,
                            text: '値'
                        }
                    }
                },
                plugins: {
                    annotation: {
                        annotations: {}
                    }
                }
            }
        });
    }

    // ヒストグラムの初期化
    const histogramCtx = document.getElementById('histogramChart');
    if (histogramCtx) {
        histogramChart = new Chart(histogramCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: '度数',
                    data: [],
                    backgroundColor: 'rgba(153, 102, 255, 0.7)',
                    borderColor: 'rgba(153, 102, 255, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: '度数'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: '階級'
                        }
                    }
                }
            }
        });
    }

    // 散布図の初期化
    const scatterCtx = document.getElementById('scatterChart');
    if (scatterCtx) {
        scatterChart = new Chart(scatterCtx, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'データポイント',
                    data: [],
                    backgroundColor: 'rgba(255, 159, 64, 0.6)',
                    borderColor: 'rgba(255, 159, 64, 1)',
                    pointRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'linear',
                        position: 'bottom',
                        title: {
                            display: true,
                            text: 'X軸'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Y軸'
                        }
                    }
                }
            }
        });
    }
}

async function loadParetoData() {
    try {
        const period = document.getElementById('pareto-period')?.value || 'week';
        const response = await fetch(`${API_BASE_URL}/qc-tools/pareto?period=${period}`);

        if (!response.ok) {
            throw new Error('パレート図データの取得に失敗しました');
        }

        const data = await response.json();

        // チャート更新
        if (paretoChart && data.categories) {
            paretoChart.data.labels = data.categories;
            paretoChart.data.datasets[0].data = data.counts;
            paretoChart.data.datasets[1].data = data.cumulative;
            paretoChart.update();

            // 統計情報更新
            document.getElementById('pareto-total').textContent = data.total + '件';
            document.getElementById('pareto-top3').textContent = data.top3_percentage + '%';
            document.getElementById('pareto-80').textContent = data.items_to_80 + '項目';

            // 推奨アクション
            const recommendationsHtml = data.recommendations.map(rec =>
                `<div class="alert alert-warning py-2 small mb-2">
                    <i class="fas fa-lightbulb me-1"></i>${rec}
                </div>`
            ).join('');
            document.getElementById('pareto-recommendations').innerHTML = recommendationsHtml;
        }
    } catch (error) {
        console.error('loadParetoData error:', error);
        showToast('パレート図の読み込みに失敗しました', 'danger');
    }
}

async function loadControlChartData() {
    try {
        const metric = document.getElementById('control-metric')?.value || 'defect_rate';
        const response = await fetch(`${API_BASE_URL}/qc-tools/control-chart?metric=${metric}`);

        if (!response.ok) {
            throw new Error('管理図データの取得に失敗しました');
        }

        const data = await response.json();

        if (controlChart && data.dates) {
            controlChart.data.labels = data.dates;
            controlChart.data.datasets[0].data = data.values;

            // 管理限界線を追加
            controlChart.options.plugins.annotation.annotations = {
                ucl: {
                    type: 'line',
                    yMin: data.ucl,
                    yMax: data.ucl,
                    borderColor: 'red',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    label: {
                        content: 'UCL',
                        enabled: true
                    }
                },
                cl: {
                    type: 'line',
                    yMin: data.cl,
                    yMax: data.cl,
                    borderColor: 'blue',
                    borderWidth: 2,
                    label: {
                        content: 'CL',
                        enabled: true
                    }
                },
                lcl: {
                    type: 'line',
                    yMin: data.lcl,
                    yMax: data.lcl,
                    borderColor: 'orange',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    label: {
                        content: 'LCL',
                        enabled: true
                    }
                }
            };

            controlChart.update();

            // 統計情報更新
            document.getElementById('control-ucl').textContent = data.ucl.toFixed(2);
            document.getElementById('control-cl').textContent = data.cl.toFixed(2);
            document.getElementById('control-lcl').textContent = data.lcl.toFixed(2);

            // 状態表示
            const statusHtml = data.in_control
                ? '<span class="badge bg-success"><i class="fas fa-check"></i> 管理内</span>'
                : '<span class="badge bg-danger"><i class="fas fa-exclamation-triangle"></i> 管理外</span>';
            document.getElementById('control-status').innerHTML = statusHtml;

            // アラート表示
            if (data.alerts && data.alerts.length > 0) {
                const alertsHtml = data.alerts.map(alert =>
                    `<div class="alert alert-danger py-1 small mb-1">${alert}</div>`
                ).join('');
                document.getElementById('control-alerts').innerHTML = alertsHtml;
            } else {
                document.getElementById('control-alerts').innerHTML = '';
            }
        }
    } catch (error) {
        console.error('loadControlChartData error:', error);
        showToast('管理図の読み込みに失敗しました', 'danger');
    }
}

async function loadHistogramData() {
    try {
        const metric = document.getElementById('histogram-metric')?.value || 'inspection_time';
        const response = await fetch(`${API_BASE_URL}/qc-tools/histogram?metric=${metric}`);

        if (!response.ok) {
            throw new Error('ヒストグラムデータの取得に失敗しました');
        }

        const data = await response.json();

        if (histogramChart && data.bins) {
            histogramChart.data.labels = data.bins;
            histogramChart.data.datasets[0].data = data.frequencies;
            histogramChart.update();

            // 統計量更新
            document.getElementById('histogram-mean').textContent = data.mean.toFixed(2);
            document.getElementById('histogram-std').textContent = data.std.toFixed(2);
            document.getElementById('histogram-range').textContent = data.range.toFixed(2);
        }
    } catch (error) {
        console.error('loadHistogramData error:', error);
        showToast('ヒストグラムの読み込みに失敗しました', 'danger');
    }
}

async function loadScatterData() {
    try {
        const xMetric = document.getElementById('scatter-x')?.value || 'inspection_time';
        const yMetric = document.getElementById('scatter-y')?.value || 'defect_rate';
        const response = await fetch(`${API_BASE_URL}/qc-tools/scatter?x=${xMetric}&y=${yMetric}`);

        if (!response.ok) {
            throw new Error('散布図データの取得に失敗しました');
        }

        const data = await response.json();

        if (scatterChart && data.points) {
            scatterChart.data.datasets[0].data = data.points;
            scatterChart.update();

            // 相関係数更新
            document.getElementById('scatter-correlation').textContent = data.correlation.toFixed(3);

            let correlationType = '';
            const r = Math.abs(data.correlation);
            if (r >= 0.7) correlationType = '強い相関';
            else if (r >= 0.4) correlationType = '中程度の相関';
            else if (r >= 0.2) correlationType = '弱い相関';
            else correlationType = 'ほぼ無相関';

            document.getElementById('scatter-correlation-type').textContent = correlationType;
        }
    } catch (error) {
        console.error('loadScatterData error:', error);
        showToast('散布図の読み込みに失敗しました', 'danger');
    }
}

async function loadChecksheetData() {
    try {
        const response = await fetch(`${API_BASE_URL}/qc-tools/checksheet`);

        if (!response.ok) {
            throw new Error('チェックシートデータの取得に失敗しました');
        }

        const data = await response.json();

        const tbody = document.getElementById('checksheet-data');
        if (tbody && data.items) {
            tbody.innerHTML = data.items.map(item => `
                <tr>
                    <td><strong>${item.name}</strong></td>
                    ${item.daily_counts.map(count => `<td class="text-center">${count}</td>`).join('')}
                    <td class="text-end"><strong>${item.total}</strong></td>
                </tr>
            `).join('');

            // サマリー更新
            const summaryHtml = `
                <div class="mb-2">
                    <small class="text-muted">総検査項目数</small>
                    <h5 class="mb-0">${data.total_items}項目</h5>
                </div>
                <div class="mb-2">
                    <small class="text-muted">総チェック数</small>
                    <h5 class="mb-0">${data.total_checks}件</h5>
                </div>
            `;
            document.getElementById('checksheet-summary').innerHTML = summaryHtml;
        }
    } catch (error) {
        console.error('loadChecksheetData error:', error);
        showToast('チェックシートの読み込みに失敗しました', 'danger');
    }
}

function showToast(message, type = 'info') {
    console.log(`[${type}] ${message}`);

    const toastContainerId = 'global-toast-container';
    let container = document.getElementById(toastContainerId);

    if (!container) {
        container = document.createElement('div');
        container.id = toastContainerId;
        container.className = 'toast-container position-fixed top-0 end-0 p-3';
        container.style.zIndex = 1100;
        document.body.appendChild(container);
    }

    const tone = type === 'danger' ? 'danger' : type === 'success' ? 'success' : 'info';
    const toastEl = document.createElement('div');
    toastEl.className = `toast align-items-center text-bg-${tone} border-0`;
    toastEl.role = 'alert';

    toastEl.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">${message}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
        </div>
    `;

    container.appendChild(toastEl);

    const toast = new bootstrap.Toast(toastEl);
    toast.show();
}
