import SafariOptimizedQRScanner from './qr-scanner.js';

const API_BASE_URL = '/api';
const DEFAULT_WORKER_PATH = 'js/qr-scanner-worker.min.js';

function formatVersionLabel(version) {
    if (!version) {
        return null;
    }

    const matches = version.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/);
    if (!matches) {
        return null;
    }

    const [, year, month, day, hour, minute] = matches;
    return `${year}-${month}-${day} ${hour}:${minute}`;
}

function getAppBuildInfo() {
    let version = null;

    try {
        if (typeof import.meta !== 'undefined' && import.meta.url) {
            const metaUrl = new URL(import.meta.url);
            version = metaUrl.searchParams.get('v');
        }
    } catch (error) {
        console.warn('Failed to parse version from import.meta.url', error);
    }

    if (!version && typeof document !== 'undefined') {
        const scripts = Array.from(document.querySelectorAll('script[src]'));
        const target = scripts.find(script => script.src.includes('js/index-app.js'));

        if (target) {
            try {
                const url = new URL(target.src, window.location.href);
                version = url.searchParams.get('v');
            } catch (error) {
                console.warn('Failed to parse version from script tag', error);
            }
        }
    }

    if (!version && typeof window !== 'undefined' && window.APP_BUILD_VERSION) {
        version = window.APP_BUILD_VERSION;
    }

    if (!version) {
        return null;
    }

    const formatted = formatVersionLabel(version);
    return {
        raw: version,
        label: formatted || version
    };
}

let shipments = [];
let shipmentIndex = new Map();
let currentShipment = null;

let inspectionModal = null;
let detailModal = null;
let qrModal = null;

let qrContext = null;
let qrInspectionRecord = null;
let safariScanner = null;
let qrVideoElement = null;
let qrStatusBadge = null;
let qrResultContainer = null;
let qrProgressLabel = null;
let qrPassedQuantity = null;
let qrScanButton = null;
let qrSimulateButton = null;

const APP_BUILD_INFO = getAppBuildInfo();
const QR_WORKER_URL = getWorkerPath(APP_BUILD_INFO);

const bootstrapAvailable = typeof bootstrap !== 'undefined';
if (!bootstrapAvailable) {
    console.warn('Bootstrap modal utilities are not available. Modals may not function correctly.');
}

if (typeof window !== 'undefined' && window.QrScanner) {
    window.QrScanner.WORKER_PATH = QR_WORKER_URL;
}

if (typeof window !== 'undefined' && APP_BUILD_INFO?.raw) {
    window.APP_BUILD_VERSION = APP_BUILD_INFO.raw;
}

document.addEventListener('DOMContentLoaded', () => {
    renderGlobalBuildInfo();
    initializeModals();
    initializeEventListeners();
    loadShipments();
    loadDailyStats();
    loadRecentInspections();
});

function initializeModals() {
    if (!bootstrapAvailable) {
        return;
    }

    const inspectionModalElement = document.getElementById('inspectionModal');
    const detailModalElement = document.getElementById('detailModal');
    const qrModalElement = document.getElementById('qrInspectionModal');

    if (inspectionModalElement) {
        inspectionModal = new bootstrap.Modal(inspectionModalElement);
        inspectionModalElement.addEventListener('hidden.bs.modal', () => {
            currentShipment = null;
            clearInspectionForm();
        });
    }

    if (detailModalElement) {
        detailModal = new bootstrap.Modal(detailModalElement);
    }

    if (qrModalElement) {
        qrModal = new bootstrap.Modal(qrModalElement);
        qrModalElement.addEventListener('hidden.bs.modal', () => {
            stopQRScanner();
            resetQRState();
        });
    }
}

function initializeEventListeners() {
    const completeInspectionButton = document.getElementById('btn-complete-inspection');
    const saveDraftButton = document.getElementById('btn-save-draft');
    const printDetailsButton = document.getElementById('btn-print-details');
    const printShipmentsButton = document.getElementById('btn-print-shipments');
    const startQRButton = document.getElementById('btn-start-qr-scan');
    const completeQRButton = document.getElementById('btn-complete-qr-inspection');

    if (completeInspectionButton) {
        completeInspectionButton.addEventListener('click', () => submitInspection({ isDraft: false }));
    }
    if (saveDraftButton) {
        saveDraftButton.addEventListener('click', () => submitInspection({ isDraft: true }));
    }
    if (printDetailsButton) {
        printDetailsButton.addEventListener('click', printShipmentDetail);
    }
    if (printShipmentsButton) {
        printShipmentsButton.addEventListener('click', printShipmentList);
    }
    if (startQRButton) {
        startQRButton.addEventListener('click', startQRScanner);
    }
    if (completeQRButton) {
        completeQRButton.addEventListener('click', completeQRInspection);
    }
}

function renderGlobalBuildInfo() {
    if (typeof document === 'undefined') {
        return;
    }

    const badge = document.getElementById('app-build-info');
    if (!badge) {
        return;
    }

    if (APP_BUILD_INFO) {
        const baseLabel = `コード修正日時: ${APP_BUILD_INFO.label}`;
        badge.textContent = APP_BUILD_INFO.raw && APP_BUILD_INFO.raw !== APP_BUILD_INFO.label
            ? `${baseLabel} (v=${APP_BUILD_INFO.raw})`
            : baseLabel;
        badge.classList.remove('text-warning');
    } else {
        badge.textContent = 'コード修正日時: 不明';
        badge.classList.add('text-warning');
    }
}

async function loadShipments() {
    const listContainer = document.getElementById('shipment-list');
    const loadingIndicator = document.getElementById('shipment-loading');
    const pendingCount = document.getElementById('pending-count');

    try {
        if (listContainer && !loadingIndicator) {
            listContainer.innerHTML = '<div class="text-center text-muted py-5">データを取得しています...</div>';
        }

        const response = await fetch(`${API_BASE_URL}/shipping-instructions?status=pending`);
        if (!response.ok) {
            throw new Error(`出荷指示の取得に失敗しました (HTTP ${response.status})`);
        }

        const data = await response.json();
        shipments = Array.isArray(data) ? data : [];
        shipmentIndex = new Map(shipments.map(item => [item.instruction_id, item]));

        if (pendingCount) {
            pendingCount.textContent = `${shipments.length}件`;
        }

        renderShipmentCards(shipments);
    } catch (error) {
        console.error('loadShipments error:', error);
        if (listContainer) {
            listContainer.innerHTML = `
                <div class="alert alert-danger">
                    <h5 class="alert-heading">データ読込エラー</h5>
                    <p class="mb-2">出荷指示データの取得に失敗しました。</p>
                    <small class="text-muted">${error.message}</small>
                </div>
            `;
        }
    }
}

async function loadDailyStats() {
    const completedElement = document.getElementById('stat-completed');
    const inProgressElement = document.getElementById('stat-in-progress');
    const passRateElement = document.getElementById('stat-pass-rate');

    try {
        const response = await fetch(`${API_BASE_URL}/reports/daily-inspection-stats`);
        if (!response.ok) {
            throw new Error(`統計情報の取得に失敗しました (HTTP ${response.status})`);
        }

        const stats = await response.json();

        if (completedElement) {
            completedElement.textContent = stats.completed_today || 0;
        }

        if (inProgressElement) {
            inProgressElement.textContent = stats.in_progress || 0;
        }

        if (passRateElement) {
            const passRate = stats.pass_rate_today || 0;
            passRateElement.textContent = `${passRate.toFixed(1)}%`;
        }
    } catch (error) {
        console.error('loadDailyStats error:', error);

        // エラー時はデフォルト値を表示
        if (completedElement) {
            completedElement.textContent = '-';
        }
        if (inProgressElement) {
            inProgressElement.textContent = '-';
        }
        if (passRateElement) {
            passRateElement.textContent = '-';
        }
    }
}

async function loadRecentInspections() {
    const container = document.getElementById('recent-inspections-container');
    if (!container) return;

    try {
        const response = await fetch(`${API_BASE_URL}/reports/recent-inspections?limit=5`);
        if (!response.ok) {
            throw new Error(`検品履歴の取得に失敗しました (HTTP ${response.status})`);
        }

        const inspections = await response.json();

        if (inspections.length === 0) {
            container.innerHTML = `
                <div class="text-center text-muted py-3">
                    <i class="fas fa-inbox fa-2x mb-2"></i>
                    <div class="small">検品履歴がありません</div>
                </div>
            `;
            return;
        }

        container.innerHTML = inspections.map(inspection => {
            const time = formatInspectionTime(inspection.completed_at || inspection.created_at);
            const instructionId = inspection.instruction_id || '不明';
            const inspectorName = inspection.inspector_name || '不明';

            // ステータスマッピング
            let statusClass = 'status-pending';
            let statusText = '検品中';

            if (inspection.status === 'completed') {
                statusClass = 'status-approved';
                statusText = '承認済み';
            } else if (inspection.status === 'failed') {
                statusClass = 'status-rejected';
                statusText = '要再検品';
            }

            return `
                <div class="inspection-item">
                    <small class="text-muted">${time}</small>
                    <div>${instructionId} - ${inspectorName}</div>
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('loadRecentInspections error:', error);
        container.innerHTML = `
            <div class="text-center text-muted py-3">
                <i class="fas fa-exclamation-triangle text-warning mb-2"></i>
                <div class="small">履歴の読み込みに失敗しました</div>
            </div>
        `;
    }
}

function formatInspectionTime(dateTimeString) {
    if (!dateTimeString) return '--:--';

    try {
        const date = new Date(dateTimeString);
        if (isNaN(date.getTime())) return '--:--';

        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
    } catch (error) {
        console.error('formatInspectionTime error:', error);
        return '--:--';
    }
}

function renderShipmentCards(items) {
    const container = document.getElementById('shipment-list');
    if (!container) return;

    container.innerHTML = '';

    if (!items.length) {
        container.innerHTML = `
            <div class="text-center text-muted py-5">
                <i class="fas fa-box-open fa-3x mb-3"></i>
                <div>現在、検品待ちの出荷指示はありません。</div>
            </div>
        `;
        return;
    }

    items.forEach(item => {
        const card = createShipmentCard(item);
        container.appendChild(card);
    });
}

function createShipmentCard(item) {
    const card = document.createElement('div');
    card.className = 'inspection-card card';

    const priorityClass = item.priority === 'high' ? 'priority-high'
        : item.priority === 'low' ? 'priority-normal'
        : 'priority-normal';
    const priorityLabel = item.priority === 'high' ? '高優先度'
        : item.priority === 'low' ? '低優先度'
        : '通常優先度';

    const shippingDate = formatDate(item.shipping_date);
    const barcodeText = generateBarcodePlaceholder(item.product_code);

    card.innerHTML = `
        <div class="card-header d-flex justify-content-between align-items-center">
            <h5 class="mb-0">出荷指示: ${item.instruction_id}</h5>
            <span class="status-badge ${priorityClass}">
                <i class="fas fa-circle me-1"></i>${priorityLabel}
            </span>
        </div>
        <div class="card-body">
            <div class="row">
                <div class="col-md-8">
                    <p><strong>製品:</strong> ${item.product_name} (${item.product_code})</p>
                    <p><strong>数量:</strong> <span class="quantity-display">${item.quantity.toLocaleString()}個</span></p>
                    <p><strong>顧客:</strong> ${item.customer_name || '未設定'}</p>
                    <p><strong>出荷日:</strong> ${shippingDate}</p>
                    <p><strong>配送先:</strong> ${item.delivery_location_name || '未設定'}</p>
                    <p><strong>特記事項:</strong> ${item.notes || 'なし'}</p>
                </div>
                <div class="col-md-4 text-center qr-code-section">
                    <p class="mb-1 small"><strong>製品QRコード:</strong></p>
                    <div style="cursor: pointer;" data-role="qr-code-container">
                        <div id="qrcode-${item.id}" style="display: inline-block;"></div>
                        <p class="small text-muted mt-1 d-print-none">クリックでQR検品</p>
                    </div>
                </div>
            </div>
            <div class="mt-3 d-flex flex-wrap gap-2">
                <button class="btn btn-primary btn-sm flex-grow-1 flex-md-grow-0" data-role="start-inspection">
                    <i class="fas fa-play me-1"></i>検品開始
                </button>
                <button class="btn btn-warning btn-sm flex-grow-1 flex-md-grow-0" data-role="start-qr">
                    <i class="fas fa-qrcode me-1"></i>QR検品
                </button>
                <button class="btn btn-info btn-sm flex-grow-1 flex-md-grow-0" data-role="start-ocr">
                    <i class="fas fa-camera me-1"></i>OCR検品
                </button>
                <button class="btn btn-outline-secondary btn-sm flex-grow-1 flex-md-grow-0" data-role="view-details">
                    <i class="fas fa-eye me-1"></i>詳細表示
                </button>
            </div>
        </div>
    `;

    // QRコード生成
    const qrContainer = card.querySelector(`#qrcode-${item.id}`);
    if (qrContainer && typeof QRCode !== 'undefined') {
        // QRコードのデータ: QR検品画面へのFQDN URL
        const qrData = `https://hispot-iot.com/qr-inspection.html?id=${item.id}`;

        new QRCode(qrContainer, {
            text: qrData,
            width: 128,
            height: 128,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });
    }

    // QRコードをクリックした時にQR検品画面に遷移
    card.querySelector('[data-role="qr-code-container"]').addEventListener('click', () => openQRInspection(item));

    card.querySelector('[data-role="start-inspection"]').addEventListener('click', () => openInspection(item));
    card.querySelector('[data-role="start-qr"]').addEventListener('click', () => openQRInspection(item));
    card.querySelector('[data-role="start-ocr"]').addEventListener('click', () => openOCRInspection(item));
    card.querySelector('[data-role="view-details"]').addEventListener('click', () => openDetails(item));

    return card;
}

function getWorkerPath(buildInfo) {
    const base = DEFAULT_WORKER_PATH;
    if (buildInfo?.raw) {
        return `${base}?v=${buildInfo.raw}`;
    }
    return base;
}

function formatDate(value) {
    if (!value) return '未設定';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function generateBarcodePlaceholder(code = '') {
    const normalized = code.replace(/[^A-Z0-9]/gi, '').slice(0, 12);
    return normalized
        .split('')
        .map((_, index) => (index % 2 === 0 ? '||||' : '|||'))
        .join(' ');
}

async function openInspection(item) {
    try {
        const detail = await fetchShipmentDetail(item.id);
        currentShipment = detail;
        populateInspectionForm(detail);

        if (inspectionModal) {
            inspectionModal.show();
        }
    } catch (error) {
        console.error('openInspection error:', error);
        showToast('検品フォームの生成に失敗しました。', 'danger');
    }
}

async function fetchShipmentDetail(id) {
    const response = await fetch(`${API_BASE_URL}/shipping-instructions/${id}`);
    if (!response.ok) {
        throw new Error(`出荷指示詳細の取得に失敗しました (HTTP ${response.status})`);
    }
    return response.json();
}

function populateInspectionForm(detail) {
    const content = document.getElementById('inspection-content');
    if (!content) return;

    const customer = detail.customer_name || '未設定';
    const plannedQty = detail.quantity || 0;

    content.innerHTML = `
        <div class="row">
            <div class="col-md-6">
                <div class="card">
                    <div class="card-header">
                        <h6 class="mb-0">出荷情報</h6>
                    </div>
                    <div class="card-body">
                        <p><strong>出荷指示:</strong> ${detail.instruction_id}</p>
                        <p><strong>製品:</strong> ${detail.product_name} (${detail.product_code})</p>
                        <p><strong>予定数量:</strong> ${plannedQty.toLocaleString()}個</p>
                        <p><strong>顧客:</strong> ${customer}</p>
                        <p><strong>配送先:</strong> ${detail.delivery_location_name || '未設定'}</p>
                        <p><strong>希望配送日:</strong> ${formatDate(detail.shipping_date)}</p>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="card">
                    <div class="card-header">
                        <h6 class="mb-0">検品情報入力</h6>
                    </div>
                    <div class="card-body">
                        <div class="mb-3">
                            <label class="form-label" for="inspector">検品者名 *</label>
                            <input type="text" class="form-control" id="inspector"
                                   list="inspector-datalist"
                                   placeholder="検品者名を入力または選択してください"
                                   maxlength="100"
                                   required>
                            <datalist id="inspector-datalist">
                                <!-- 検品者リストがここに動的に追加されます -->
                            </datalist>
                            <small class="text-muted">マスタから選択するか、新規の名前を入力できます</small>
                        </div>
                        <div class="row g-3">
                            <div class="col-6">
                                <label class="form-label" for="inspectedQty">検品数量 *</label>
                                <input type="number" class="form-control" id="inspectedQty" value="${plannedQty}" min="0" required>
                            </div>
                            <div class="col-6">
                                <label class="form-label" for="passedQty">合格数量 *</label>
                                <input type="number" class="form-control" id="passedQty" value="${plannedQty}" min="0" required>
                            </div>
                        </div>
                        <div class="mt-3">
                            <label class="form-label" for="failedQty">不合格数量</label>
                            <input type="number" class="form-control" id="failedQty" value="0" readonly>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <div class="row mt-3">
            <div class="col-12">
                <div class="card">
                    <div class="card-header">
                        <h6 class="mb-0">検品チェック項目</h6>
                    </div>
                    <div class="card-body">
                        <div class="row">
                            <div class="col-md-6">
                                <div class="form-check mb-2">
                                    <input class="form-check-input" type="checkbox" id="labelCheck">
                                    <label class="form-check-label" for="labelCheck">ラベル確認完了</label>
                                </div>
                                <div class="form-check mb-2">
                                    <input class="form-check-input" type="checkbox" id="packagingCheck">
                                    <label class="form-check-label" for="packagingCheck">梱包状態確認</label>
                                </div>
                                <div class="form-check mb-2">
                                    <input class="form-check-input" type="checkbox" id="documentCheck">
                                    <label class="form-check-label" for="documentCheck">出荷書類確認</label>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="form-check mb-2">
                                    <input class="form-check-input" type="checkbox" id="qualityCheck">
                                    <label class="form-check-label" for="qualityCheck">品質基準適合</label>
                                </div>
                                <div class="form-check mb-2">
                                    <input class="form-check-input" type="checkbox" id="quantityCheck">
                                    <label class="form-check-label" for="quantityCheck">数量一致確認</label>
                                </div>
                                <div class="form-check mb-2">
                                    <input class="form-check-input" type="checkbox" id="finalApproval">
                                    <label class="form-check-label" for="finalApproval"><strong>最終承認</strong></label>
                                </div>
                            </div>
                        </div>
                        <div class="mt-3">
                            <label class="form-label" for="notes">不具合詳細・備考</label>
                            <textarea class="form-control" id="notes" rows="3"></textarea>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    setupQuantityAutoCalculation();
    loadInspectorsList();
}

function setupQuantityAutoCalculation() {
    const inspectedInput = document.getElementById('inspectedQty');
    const passedInput = document.getElementById('passedQty');
    const failedInput = document.getElementById('failedQty');

    if (!inspectedInput || !passedInput || !failedInput) return;

    const updateFailed = () => {
        const inspected = parseInt(inspectedInput.value, 10) || 0;
        const passed = parseInt(passedInput.value, 10) || 0;
        failedInput.value = Math.max(0, inspected - passed);
    };

    inspectedInput.addEventListener('input', updateFailed);
    passedInput.addEventListener('input', updateFailed);
}

async function loadInspectorsList() {
    try {
        const response = await fetch(`${API_BASE_URL}/inspectors/recent?limit=20`);

        if (!response.ok) {
            console.error('検品者リストの取得に失敗しました');
            return;
        }

        const inspectors = await response.json();
        const datalist = document.getElementById('inspector-datalist');

        if (datalist) {
            datalist.innerHTML = inspectors.map(inspector =>
                `<option value="${inspector.name}">${inspector.name} (${inspector.inspection_count}件)</option>`
            ).join('');
        }
    } catch (error) {
        console.error('Failed to load inspectors:', error);
        // エラー時でも手入力は可能（datalistは空のまま）
    }
}

function clearInspectionForm() {
    const content = document.getElementById('inspection-content');
    if (content) {
        content.innerHTML = '';
    }
}

async function submitInspection({ isDraft }) {
    if (!currentShipment) {
        showToast('出荷指示情報が読み込まれていません。', 'warning');
        return;
    }

    const inspectorInput = document.getElementById('inspector');
    const inspectedInput = document.getElementById('inspectedQty');
    const passedInput = document.getElementById('passedQty');
    const failedInput = document.getElementById('failedQty');

    if (!inspectorInput || !inspectedInput || !passedInput || !failedInput) {
        showToast('検品フォームが正しく表示されていません。', 'danger');
        return;
    }

    const inspector = inspectorInput.value.trim();
    const inspectedQuantity = Number(inspectedInput.value);
    const passedQuantity = Number(passedInput.value);
    const failedQuantity = Number(failedInput.value);
    const finalApprovalChecked = document.getElementById('finalApproval')?.checked ?? false;

    if (!inspector) {
        showToast('検品者名を入力してください。', 'warning');
        inspectorInput.focus();
        return;
    }
    if (Number.isNaN(inspectedQuantity) || inspectedQuantity < 0) {
        showToast('検品数量が不正です。', 'warning');
        inspectedInput.focus();
        return;
    }
    if (Number.isNaN(passedQuantity) || passedQuantity < 0) {
        showToast('合格数量が不正です。', 'warning');
        passedInput.focus();
        return;
    }
    if (passedQuantity > inspectedQuantity) {
        showToast('合格数量は検品数量を超えることはできません。', 'warning');
        passedInput.focus();
        return;
    }

    if (!isDraft && !finalApprovalChecked) {
        const proceed = window.confirm('最終承認が未チェックです。このまま完了しますか？');
        if (!proceed) return;
    }

    const payload = {
        shipping_instruction_id: currentShipment.id,
        inspector_name: inspector,
        inspected_quantity: inspectedQuantity,
        passed_quantity: passedQuantity,
        failed_quantity: failedQuantity,
        defect_details: document.getElementById('notes')?.value || '',
        packaging_condition: document.getElementById('packagingCheck')?.checked ? 'OK' : '要確認',
        label_check: Boolean(document.getElementById('labelCheck')?.checked),
        documentation_check: Boolean(document.getElementById('documentCheck')?.checked),
        final_approval: !isDraft && finalApprovalChecked,
        notes: isDraft ? 'ドラフト保存' : ''
    };

    try {
        const response = await fetch(`${API_BASE_URL}/shipping-inspections`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const message = await extractErrorMessage(response);
            throw new Error(message);
        }

        showToast(isDraft ? '下書きとして保存しました。' : '検品が完了しました。', 'success');

        if (inspectionModal) {
            inspectionModal.hide();
        }

        await loadShipments();
    } catch (error) {
        console.error('submitInspection error:', error);
        showToast(`検品結果の送信に失敗しました: ${error.message}`, 'danger');
    }
}

async function openDetails(item) {
    try {
        const detail = await fetchShipmentDetail(item.id);
        currentShipment = detail; // 印刷用に現在の出荷指示を保存
        populateDetailModal(detail);
        if (detailModal) {
            detailModal.show();
        }
    } catch (error) {
        console.error('openDetails error:', error);
        showToast('詳細情報の取得に失敗しました。', 'danger');
    }
}

function populateDetailModal(detail) {
    const content = document.getElementById('detail-content');
    if (!content) return;

    content.innerHTML = `
        <div class="row">
            <div class="col-md-6">
                <h6>基本情報</h6>
                <table class="table table-sm">
                    <tr><td>出荷指示番号:</td><td>${detail.instruction_id}</td></tr>
                    <tr><td>作成日時:</td><td>${formatDate(detail.created_at)}</td></tr>
                    <tr><td>ステータス:</td><td><span class="badge bg-warning">${detail.status}</span></td></tr>
                    <tr><td>優先度:</td><td>${detail.priority}</td></tr>
                </table>
            </div>
            <div class="col-md-6">
                <h6>配送情報</h6>
                <table class="table table-sm">
                    <tr><td>配送方法:</td><td>${detail.delivery_method || '未設定'}</td></tr>
                    <tr><td>配送業者:</td><td>${detail.delivery_contact || '未設定'}</td></tr>
                    <tr><td>希望配達日:</td><td>${formatDate(detail.shipping_date)}</td></tr>
                    <tr><td>納入場所:</td><td>${detail.delivery_location_name || '未設定'}</td></tr>
                </table>
            </div>
        </div>
        <div class="mt-3">
            <h6>生産履歴</h6>
            <p class="text-muted">※ 実装例: 別途API連携により履歴を表示可能</p>
        </div>
    `;
}

async function openQRInspection(item) {
    try {
        // QR検品を別タブで開く
        const qrInspectionUrl = `qr-inspection.html?id=${item.id}`;
        const qrWindow = window.open(qrInspectionUrl, 'qr-inspection', 'width=1400,height=900,left=100,top=100');
        
        if (!qrWindow) {
            showToast('ポップアップがブロックされました。ブラウザの設定を確認してください。', 'warning');
            // フォールバック: 同じウィンドウで開く
            window.location.href = qrInspectionUrl;
        } else {
            // 別タブが開いた場合、完了メッセージを受信するリスナーを設定
            window.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'qr-inspection-complete') {
                    showToast(`QR検品が完了しました（${event.data.data.scannedCount}/${event.data.data.totalCount}件）`, 'success');
                    // 出荷指示リストを再読み込み
                    loadShipments();
                }
            });
        }
    } catch (error) {
        console.error('openQRInspection error:', error);
        showToast(`QR検品画面を開けませんでした: ${error.message}`, 'danger');
    }
}

async function openOCRInspection(item) {
    try {
        // OCR検品を別タブで開く（製品情報をURLパラメータで渡す）
        const ocrInspectionUrl = `ocr-v2-enhanced.html?productId=${item.product_id}&productName=${encodeURIComponent(item.product_name)}&shipmentId=${item.id}`;
        const ocrWindow = window.open(ocrInspectionUrl, 'ocr-inspection', 'width=1200,height=800,left=100,top=100');
        
        if (!ocrWindow) {
            showToast('ポップアップがブロックされました。ブラウザの設定を確認してください。', 'warning');
            // フォールバック: 同じウィンドウで開く
            window.location.href = ocrInspectionUrl;
        } else {
            // 別タブが開いた場合、完了メッセージを受信するリスナーを設定
            window.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'ocr-inspection-complete') {
                    showToast(`OCR検品が完了しました`, 'success');
                    // 出荷指示リストを再読み込み
                    loadShipments();
                }
            });
        }
    } catch (error) {
        console.error('openOCRInspection error:', error);
        showToast(`OCR検品画面を開けませんでした: ${error.message}`, 'danger');
    }
}

function renderQRInspectionContent(context) {
    const container = document.getElementById('qr-inspection-content');
    if (!container) return;

    const buildInfoDisplay = APP_BUILD_INFO
        ? `コード修正日時: ${APP_BUILD_INFO.label}${APP_BUILD_INFO.raw !== APP_BUILD_INFO.label ? ` (v=${APP_BUILD_INFO.raw})` : ''}`
        : 'コード修正日時: 不明';

    const itemsHtml = context.items.map(item => `
        <div class="card qr-item-card" id="qr-item-${item.id}">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <h6 class="mb-1">
                            <span class="qr-status-icon qr-pending" id="icon-${item.id}">
                                <i class="fas fa-clock"></i>
                            </span>
                            ${item.name}
                        </h6>
                        <small class="text-muted">QRコード: ${item.qrCode}</small>
                        <span class="badge bg-info ms-2 text-uppercase">${item.type}</span>
                    </div>
                    <div>
                        <span class="badge bg-warning" id="status-${item.id}">未確認</span>
                    </div>
                </div>
            </div>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="row g-3">
            <div class="col-md-6">
                <div class="card">
                    <div class="card-header">
                        <h6 class="mb-0">出荷情報</h6>
                    </div>
                    <div class="card-body">
                        <p><strong>出荷指示:</strong> ${context.shippingInstructionCode}</p>
                        <p><strong>製品:</strong> ${context.productName}</p>
                        <p><strong>予定数量:</strong> ${context.quantity.toLocaleString()}個</p>
                        <p><strong>顧客:</strong> ${context.customer}</p>
                        <div class="mb-3">
                            <label class="form-label" for="qr-inspector-name">検品者名 *</label>
                            <input type="text" class="form-control" id="qr-inspector-name" placeholder="例) 田中太郎">
                        </div>
                    </div>
                </div>
                <div class="inventory-info">
                    <h6 class="mb-2"><i class="fas fa-warehouse me-2"></i>在庫情報</h6>
                    <p class="mb-1"><strong>現在庫:</strong> <span id="current-stock">${context.currentStock}</span>個</p>
                    <p class="mb-0"><strong>検品後予定在庫:</strong> <span id="predicted-stock">${context.currentStock - context.quantity}</span>個</p>
                </div>
            </div>
            <div class="col-md-6">
                <div class="qr-scanner-area w-100" id="qr-scanner-area">
                    <div class="text-end text-muted small mb-2" id="qr-build-info">${buildInfoDisplay}</div>
                    <div class="qr-video-container" id="qr-video-wrapper" style="display:none;">
                        <video id="qr-video" playsinline webkit-playsinline muted autoplay></video>
                        <div class="qr-scan-overlay">
                            <div class="qr-scan-corner tl"></div>
                            <div class="qr-scan-corner tr"></div>
                            <div class="qr-scan-corner bl"></div>
                            <div class="qr-scan-corner br"></div>
                            <div class="qr-scan-line" id="qr-scan-line" style="display:none;"></div>
                        </div>
                        <div class="qr-status-overlay" id="qr-status-overlay">準備中...</div>
                    </div>
                    <div class="text-center" id="qr-initial-message">
                        <i class="fas fa-qrcode fa-3x text-muted mb-3"></i>
                        <div class="text-muted mb-3" id="qr-status-text">QRコードスキャン待機中</div>
                        <p class="text-sm text-muted mb-3">「QRスキャン開始」ボタンを押してください</p>
                    </div>
                    <div class="mt-2" id="qr-result" style="display:none;"></div>
                    <div class="d-flex gap-2 mt-3">
                        <button class="btn btn-outline-secondary btn-sm" id="btn-simulate-qr">
                            <i class="fas fa-vial me-1"></i>テストスキャン
                        </button>
                        <button class="btn btn-outline-primary btn-sm" id="btn-manual-input-qr">
                            <i class="fas fa-keyboard me-1"></i>手動入力
                        </button>
                    </div>
                    <div class="mt-3 p-3 bg-light rounded" id="qr-last-scanned" style="display:none;">
                        <small class="text-muted d-block mb-1">最後に読み取ったQRコード:</small>
                        <code class="d-block text-break mb-2" id="qr-last-value"></code>
                        <!-- safari2.html機能: コピー/共有ボタンは動的に追加される -->
                    </div>
                </div>
            </div>
            <div class="col-12">
                <div class="card">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <h6 class="mb-0"><i class="fas fa-list-check me-2"></i>同梱物チェックリスト</h6>
                        <span class="badge bg-secondary" id="qr-progress">0/${context.items.length}</span>
                    </div>
                    <div class="card-body">
                        ${itemsHtml}
                        <div class="mt-3 text-end">
                            <strong>検品合格数:</strong> <span id="passed-quantity">0</span>個
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    qrVideoElement = document.getElementById('qr-video');
    const qrVideoWrapper = document.getElementById('qr-video-wrapper');
    const qrInitialMessage = document.getElementById('qr-initial-message');
    qrStatusBadge = document.getElementById('qr-status-text');
    const qrStatusOverlay = document.getElementById('qr-status-overlay');
    const qrScanLine = document.getElementById('qr-scan-line');
    qrResultContainer = document.getElementById('qr-result');
    qrProgressLabel = document.getElementById('qr-progress');
    qrPassedQuantity = document.getElementById('passed-quantity');
    qrScanButton = document.getElementById('btn-start-qr-scan');
    qrSimulateButton = document.getElementById('btn-simulate-qr');
    const qrManualInputButton = document.getElementById('btn-manual-input-qr');

    if (qrSimulateButton) {
        qrSimulateButton.addEventListener('click', simulateQRScan);
    }

    if (qrManualInputButton) {
        qrManualInputButton.addEventListener('click', manualInputQRCode);
    }

    // カメラ起動時の表示制御用にグローバルに保存
    window.qrUIElements = {
        videoWrapper: qrVideoWrapper,
        initialMessage: qrInitialMessage,
        statusOverlay: qrStatusOverlay,
        scanLine: qrScanLine
    };
}

async function startQRScanner() {
    if (!qrContext) {
        showToast('QR検品情報が初期化されていません。', 'warning');
        return;
    }

    const inspectorInput = document.getElementById('qr-inspector-name');
    const inspectorName = inspectorInput?.value.trim();

    if (!inspectorName) {
        showToast('検品者名を入力してください。', 'warning');
        inspectorInput?.focus();
        return;
    }

    // カメラAPIの詳細診断
    console.log('Camera API Check:', {
        hasNavigator: !!navigator,
        hasMediaDevices: !!navigator.mediaDevices,
        hasGetUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
        protocol: window.location.protocol,
        hostname: window.location.hostname,
        userAgent: navigator.userAgent
    });

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        let errorMsg = 'カメラAPIを利用できません。';
        
        // HTTPアクセスの場合の警告
        if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
            errorMsg = 'HTTPSまたはlocalhostでアクセスしてください。カメラAPIはセキュアな環境でのみ動作します。\n\n推奨アクセス方法:\n• https://' + window.location.hostname + '\n• http://localhost';
            showToast(errorMsg, 'danger', 10000);
        } else {
            errorMsg = 'このブラウザまたは端末ではカメラAPIがサポートされていません。\n\n対処方法:\n• ブラウザを最新版に更新\n• Safari設定 → プライバシーとセキュリティ → カメラ を確認\n• iOSの場合、設定 → Safari → カメラ を許可に設定';
            showToast(errorMsg, 'danger', 10000);
        }
        
        console.error('Camera API not supported:', errorMsg);
        return;
    }

    try {
        toggleQRControls({ scanning: true });

        if (!qrInspectionRecord) {
            const response = await fetch(`${API_BASE_URL}/qr-inspections`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    shipping_instruction_id: qrContext.shippingInstructionId,
                    inspector_name: inspectorName
                })
            });

            if (!response.ok) {
                const message = await extractErrorMessage(response);
                throw new Error(message);
            }

            qrInspectionRecord = await response.json();
        }

        if (!safariScanner) {
            safariScanner = new SafariOptimizedQRScanner({
                onResult: handleQRScanResult,
                onError: handleQRScannerError,
                onStatusUpdate: updateQRStatusMessage
            });
        }

        if (qrVideoElement) {
            // UIを切り替え：初期メッセージを非表示、ビデオコンテナを表示
            if (window.qrUIElements) {
                if (window.qrUIElements.initialMessage) {
                    window.qrUIElements.initialMessage.style.display = 'none';
                }
                if (window.qrUIElements.videoWrapper) {
                    window.qrUIElements.videoWrapper.style.display = 'block';
                }
                if (window.qrUIElements.statusOverlay) {
                    window.qrUIElements.statusOverlay.textContent = 'カメラを起動しています...';
                }
            }

            await safariScanner.startScan(qrVideoElement);
            
            // スキャンライン表示
            if (window.qrUIElements && window.qrUIElements.scanLine) {
                window.qrUIElements.scanLine.style.display = 'block';
            }
            if (window.qrUIElements && window.qrUIElements.statusOverlay) {
                window.qrUIElements.statusOverlay.textContent = 'QRコードを枠内に収めてください';
            }
            
            updateQRStatusMessage('カメラを起動しました。QRコードを枠内に収めてください。');
            toggleQRControls({ scanning: true });
        }
    } catch (error) {
        console.error('startQRScanner error:', error);
        
        // エラー時はビデオコンテナを非表示、初期メッセージを再表示
        if (window.qrUIElements) {
            if (window.qrUIElements.videoWrapper) {
                window.qrUIElements.videoWrapper.style.display = 'none';
            }
            if (window.qrUIElements.initialMessage) {
                window.qrUIElements.initialMessage.style.display = 'block';
            }
        }
        
        showToast(`QRスキャナーの起動に失敗しました: ${error.message}`, 'danger');
        updateQRStatusMessage('スキャナー起動に失敗しました。');
        toggleQRControls({ scanning: false });
    }
}

function stopQRScanner() {
    if (safariScanner) {
        safariScanner.stopScan();
    }
    
    // UIをリセット：ビデオコンテナを非表示、初期メッセージを表示
    if (window.qrUIElements) {
        if (window.qrUIElements.videoWrapper) {
            window.qrUIElements.videoWrapper.style.display = 'none';
        }
        if (window.qrUIElements.initialMessage) {
            window.qrUIElements.initialMessage.style.display = 'block';
        }
        if (window.qrUIElements.scanLine) {
            window.qrUIElements.scanLine.style.display = 'none';
        }
    }
    
    toggleQRControls({ scanning: false });
}

function resetQRState() {
    qrContext = null;
    qrInspectionRecord = null;
    qrVideoElement = null;
    qrStatusBadge = null;
    qrResultContainer = null;
    qrProgressLabel = null;
    qrPassedQuantity = null;
    qrSimulateButton = null;
}

async function handleQRScanResult(qrCode) {
    // まず、製品QRコード（URL形式）かチェック
    // https://hispot-iot.com/qr-inspection.html?id=XXX
    if (qrCode.includes('hispot-iot.com/qr-inspection.html?id=')) {
        console.log('Product QR URL detected:', qrCode);

        // QRスキャナーを停止
        stopQRScanner();

        // URLからIDを抽出
        try {
            const url = new URL(qrCode);
            const shippingInstructionId = url.searchParams.get('id');

            if (shippingInstructionId) {
                // QR検品画面を開く（QR検品ボタン押下と同じ動作）
                const item = { id: parseInt(shippingInstructionId) };
                await openQRInspection(item);
                return; // 通常の同梱物スキャン処理はスキップ
            }
        } catch (urlError) {
            console.error('Failed to parse QR URL:', urlError);
        }
    }

    // 読み取ったQRコードを表示
    displayLastScannedQR(qrCode);

    const success = await processQRScan(qrCode);

    const hasPending = qrContext?.items?.some(item => item.status === 'pending');
    if (success && hasPending && safariScanner && qrVideoElement) {
        // 連続スキャンに備えて少し待機してから再開
        updateQRStatusMessage('次のQRコードの準備中...');
        setTimeout(async () => {
            try {
                if (qrContext && safariScanner && qrVideoElement) {
                    console.log('Restarting scanner for next item...');
                    // iPhone Safari向けに再初期化
                    safariScanner.isScanning = true;
                    await safariScanner.calibrateCamera();
                    updateQRStatusMessage('次のQRコードをスキャンしてください。');
                    
                    // スキャンライン再表示
                    if (window.qrUIElements && window.qrUIElements.scanLine) {
                        window.qrUIElements.scanLine.style.display = 'block';
                    }
                }
            } catch (error) {
                console.error('restart scanner error:', error);
                updateQRStatusMessage('カメラの再開に失敗しました。「QRスキャン開始」ボタンを押してください。');
                toggleQRControls({ scanning: false });
            }
        }, 1000); // 1秒待機（iPhone Safari向けに延長）
    } else if (!hasPending) {
        toggleQRControls({ scanning: false });
        updateQRStatusMessage('すべての同梱物を確認しました。');
        
        // スキャンライン非表示
        if (window.qrUIElements && window.qrUIElements.scanLine) {
            window.qrUIElements.scanLine.style.display = 'none';
        }
    }
}

function updateQRStatusMessage(message) {
    if (qrStatusBadge) {
        qrStatusBadge.textContent = message;
    }
    // オーバーレイにも反映
    if (window.qrUIElements && window.qrUIElements.statusOverlay) {
        window.qrUIElements.statusOverlay.textContent = message;
    }
}

function handleQRScannerError(message, error) {
    // HTML形式のメッセージを検出
    const isHTML = message.includes('<div') || message.includes('<strong>');
    
    if (isHTML) {
        // HTML形式のエラーメッセージを表示
        const container = document.getElementById('qr-result');
        if (container) {
            container.innerHTML = message;
            container.style.display = 'block';
            container.className = 'alert alert-danger';
        }
        // ステータスにはテキストのみ表示
        const textOnly = message.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().substring(0, 50);
        updateQRStatusMessage(textOnly);
    } else {
        // 従来のテキストメッセージ
        showToast(message, 'danger', 8000); // HTML形式の場合は長めに表示
        updateQRStatusMessage(message);
    }
}

function toggleQRControls({ scanning }) {
    if (qrScanButton) {
        qrScanButton.disabled = scanning;
    }
    if (qrSimulateButton) {
        qrSimulateButton.disabled = !scanning && !qrInspectionRecord;
    }
}

async function simulateQRScan() {
    if (!qrContext) return;
    const pendingItems = qrContext.items.filter(item => item.status === 'pending');
    if (!pendingItems.length) {
        showToast('全アイテムが確認済みです。', 'info');
        return;
    }

    const randomItem = pendingItems[Math.floor(Math.random() * pendingItems.length)];
    displayLastScannedQR(randomItem.qrCode);
    await processQRScan(randomItem.qrCode);
}

async function manualInputQRCode() {
    // 入力ダイアログを表示
    const qrCode = prompt('QRコードの値を入力してください:');
    
    if (!qrCode) {
        return; // キャンセルまたは空入力
    }
    
    const trimmedCode = qrCode.trim();
    if (!trimmedCode) {
        showToast('QRコードの値を入力してください。', 'warning');
        return;
    }
    
    // 入力値を表示
    displayLastScannedQR(trimmedCode);
    
    // スキャン処理を実行
    await processQRScan(trimmedCode);
}

function displayLastScannedQR(qrCode) {
    const lastScannedContainer = document.getElementById('qr-last-scanned');
    const lastValueElement = document.getElementById('qr-last-value');
    
    if (lastScannedContainer && lastValueElement) {
        lastValueElement.textContent = qrCode;
        lastScannedContainer.style.display = 'block';
        
        // safari2.html機能: コピーボタンを追加
        addCopyButtonToQRDisplay(qrCode);
    }
}

// safari2.html機能: QRコード値のコピー機能
function addCopyButtonToQRDisplay(qrCode) {
    const lastScannedContainer = document.getElementById('qr-last-scanned');
    if (!lastScannedContainer) return;
    
    // 既存のボタンを削除
    const existingBtn = lastScannedContainer.querySelector('.btn-copy-qr');
    if (existingBtn) {
        existingBtn.remove();
    }
    
    // コピーボタンを作成
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-sm btn-outline-primary mt-2 btn-copy-qr';
    copyBtn.innerHTML = '<i class="fas fa-copy me-1"></i>コピー';
    copyBtn.onclick = async () => {
        try {
            await navigator.clipboard.writeText(qrCode);
            copyBtn.innerHTML = '<i class="fas fa-check me-1"></i>コピー完了!';
            copyBtn.className = 'btn btn-sm btn-success mt-2 btn-copy-qr';
            setTimeout(() => {
                copyBtn.innerHTML = '<i class="fas fa-copy me-1"></i>コピー';
                copyBtn.className = 'btn btn-sm btn-outline-primary mt-2 btn-copy-qr';
            }, 2000);
        } catch (error) {
            console.error('コピー失敗:', error);
            showToast('クリップボードへのコピーに失敗しました。', 'danger');
        }
    };
    
    lastScannedContainer.appendChild(copyBtn);
}

// safari2.html機能: QRコード値の共有機能
async function shareQRCode(qrCode) {
    if (navigator.share) {
        try {
            await navigator.share({
                title: 'QRコード読み取り結果',
                text: qrCode
            });
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('共有失敗:', error);
                showToast('共有に失敗しました。', 'warning');
            }
        }
    } else {
        // 共有APIがない場合はコピー
        try {
            await navigator.clipboard.writeText(qrCode);
            showToast('クリップボードにコピーしました。', 'success');
        } catch (error) {
            console.error('コピー失敗:', error);
            showToast('コピーに失敗しました。', 'danger');
        }
    }
}

async function processQRScan(qrCode) {
    if (!qrContext || !qrInspectionRecord) {
        showToast('QR検品セッションが開始されていません。', 'warning');
        return false;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/qr-inspections/${qrInspectionRecord.id}/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ qr_code: qrCode })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            showQRResult(`❌ ${result.message || 'スキャンに失敗しました'}`, 'danger');
            return false;
        }

        const component = result.component;
        const matched = qrContext.items.find(item => item.qrCode === qrCode);
        if (matched) {
            matched.status = 'scanned';
            updateQRItemState(component.id, '確認済み');
        }

        const scannedCount = qrContext.items.filter(item => item.status === 'scanned').length;
        updateQRProgress(scannedCount, qrContext.items.length);

        if (qrPassedQuantity) {
            if (scannedCount === qrContext.items.length) {
                qrPassedQuantity.textContent = qrContext.quantity.toString();
            } else {
                qrPassedQuantity.textContent = scannedCount.toString();
            }
        }

        showQRResult(`✅ ${component.component_name} (${qrCode}) を確認しました。`, 'success');
        return true;
    } catch (error) {
        console.error('processQRScan error:', error);
        showQRResult(`❌ スキャン処理でエラーが発生しました: ${error.message}`, 'danger');
        return false;
    }
}

function updateQRItemState(componentId, statusText) {
    const card = document.getElementById(`qr-item-${componentId}`);
    const icon = document.getElementById(`icon-${componentId}`);
    const status = document.getElementById(`status-${componentId}`);

    if (card) card.classList.add('scanned');
    if (icon) {
        icon.className = 'qr-status-icon qr-scanned';
        icon.innerHTML = '<i class="fas fa-check-circle"></i>';
    }
    if (status) {
        status.className = 'badge bg-success';
        status.textContent = statusText;
    }
}

function updateQRProgress(scanned, total) {
    if (qrProgressLabel) {
        qrProgressLabel.textContent = `${scanned}/${total}`;
    }
}

function showQRResult(message, type = 'info') {
    if (!qrResultContainer) return;
    const className = type === 'success' ? 'alert alert-success'
        : type === 'danger' ? 'alert alert-danger'
        : 'alert alert-info';

    qrResultContainer.style.display = 'block';
    qrResultContainer.className = className;
    qrResultContainer.textContent = message;
}

async function completeQRInspection() {
    if (!qrContext || !qrInspectionRecord) {
        showToast('QR検品が開始されていません。', 'warning');
        return;
    }

    const totalItems = qrContext.items.length;
    const scannedItems = qrContext.items.filter(item => item.status === 'scanned').length;

    if (scannedItems < totalItems) {
        const proceed = window.confirm(`未確認のアイテムが${totalItems - scannedItems}件あります。このまま完了しますか？`);
        if (!proceed) return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/qr-inspections/${qrInspectionRecord.id}/complete`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                notes: `QR検品完了 - ${scannedItems}/${totalItems} 件確認`
            })
        });

        if (!response.ok) {
            const message = await extractErrorMessage(response);
            throw new Error(message);
        }

        const result = await response.json();
        showToast('QR検品を完了しました。', 'success');

        if (qrModal) {
            qrModal.hide();
        }

        await loadShipments();

        alert([
            'QR検品が完了しました。',
            `検品合格数: ${result.passed_quantity}個`,
            `在庫更新: ${result.current_stock_before} → ${result.current_stock_after}`,
            `確認済みアイテム: ${scannedItems}/${totalItems}`
        ].join('\n'));
    } catch (error) {
        console.error('completeQRInspection error:', error);
        showToast(`検品完了処理に失敗しました: ${error.message}`, 'danger');
    }
}

async function extractErrorMessage(response) {
    try {
        const text = await response.text();
        if (!text) return `HTTP ${response.status}`;
        const json = JSON.parse(text);
        return json.error || json.message || text;
    } catch (error) {
        return `HTTP ${response.status}`;
    }
}

function showToast(message, type = 'info', duration = 4000) {
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
    toastEl.ariaLive = 'assertive';
    toastEl.ariaAtomic = 'true';
    
    // 改行をサポート & HTML形式メッセージの検出
    const isHTML = message.includes('<div') || message.includes('<strong>');
    const formattedMessage = isHTML ? message : message.replace(/\n/g, '<br>');
    
    toastEl.innerHTML = `
        <div class="d-flex">
            <div class="toast-body" style="white-space: ${isHTML ? 'normal' : 'pre-wrap'};">${formattedMessage}</div>
            <button type="button" class="btn-close ${isHTML ? 'btn-close' : 'btn-close-white'} me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;

    container.appendChild(toastEl);

    if (bootstrap.Toast) {
        const toast = new bootstrap.Toast(toastEl, { delay: duration });
        toast.show();
    } else {
        toastEl.style.display = 'block';
        setTimeout(() => toastEl.remove(), duration);
    }
}

// 出荷指示リスト印刷機能
function printShipmentList() {
    // 印刷日時を設定
    const now = new Date();
    const dateTimeStr = now.getFullYear() + '年' + 
                      (now.getMonth() + 1) + '月' + 
                      now.getDate() + '日 ' +
                      now.getHours().toString().padStart(2, '0') + ':' +
                      now.getMinutes().toString().padStart(2, '0');
    
    const printDateElement = document.getElementById('print-datetime');
    if (printDateElement) {
        printDateElement.textContent = dateTimeStr;
    }
    
    // 印刷前の準備
    const originalTitle = document.title;
    
    // 印刷用タイトルを設定
    document.title = `検品待ち出荷指示一覧 - ${dateTimeStr}`;
    
    // 印刷ダイアログを表示
    window.print();
    
    // 印刷後、元のタイトルに戻す
    setTimeout(() => {
        document.title = originalTitle;
    }, 100);
    
    showToast('印刷プレビューを開きました', 'info');
}

// グローバルスコープに公開
window.printPendingShipments = printShipmentList;

// 出荷指示詳細印刷機能
function printShipmentDetail() {
    if (!currentShipment) {
        showToast('印刷する出荷指示が選択されていません', 'warning');
        return;
    }
    
    const printArea = document.getElementById('printDetailArea');
    if (!printArea) {
        showToast('印刷エリアが見つかりません', 'danger');
        return;
    }
    
    // 印刷日時
    const now = new Date();
    const printDate = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
    const printTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    // ステータスの日本語表示
    const statusMap = {
        'pending': '検品待ち',
        'in_progress': '検品中',
        'completed': '完了',
        'shipped': '出荷済み'
    };
    const statusText = statusMap[currentShipment.status] || currentShipment.status;
    
    // 優先度の日本語表示
    const priorityMap = {
        'high': '高',
        'normal': '通常',
        'low': '低'
    };
    const priorityText = priorityMap[currentShipment.priority] || currentShipment.priority;
    
    // 印刷用HTML生成
    const printHTML = `
        <div class="print-detail-header">
            <div class="print-detail-title">出荷指示詳細</div>
            <div style="font-size: 9pt;">印刷日時: ${printDate} ${printTime}</div>
        </div>
        
        <div class="print-detail-section">
            <div class="print-detail-section-title">基本情報</div>
            <table class="print-detail-table">
                <tr>
                    <th>出荷指示番号</th>
                    <td>${escapeHtml(currentShipment.instruction_id)}</td>
                    <th>作成日時</th>
                    <td>${formatDate(currentShipment.created_at)}</td>
                </tr>
                <tr>
                    <th>ステータス</th>
                    <td>${statusText}</td>
                    <th>優先度</th>
                    <td>${priorityText}</td>
                </tr>
            </table>
        </div>
        
        <div class="print-detail-section">
            <div class="print-detail-section-title">製品情報</div>
            <table class="print-detail-table">
                <tr>
                    <th>製品コード</th>
                    <td>${escapeHtml(currentShipment.product_code || '-')}</td>
                    <th>製品名</th>
                    <td colspan="3">${escapeHtml(currentShipment.product_name || '-')}</td>
                </tr>
                <tr>
                    <th>出荷数量</th>
                    <td colspan="3">${currentShipment.quantity ? currentShipment.quantity.toLocaleString() : '-'} 個</td>
                </tr>
            </table>
        </div>
        
        <div class="print-detail-section">
            <div class="print-detail-section-title">配送情報</div>
            <table class="print-detail-table">
                <tr>
                    <th>出荷予定日</th>
                    <td>${formatDate(currentShipment.shipping_date)}</td>
                    <th>配送先</th>
                    <td>${escapeHtml(currentShipment.delivery_location_name || '未設定')}</td>
                </tr>
                <tr>
                    <th>顧客名</th>
                    <td>${escapeHtml(currentShipment.customer_name || '-')}</td>
                    <th>配送方法</th>
                    <td>${escapeHtml(currentShipment.delivery_method || '未設定')}</td>
                </tr>
                <tr>
                    <th>配送業者</th>
                    <td>${escapeHtml(currentShipment.delivery_contact || '未設定')}</td>
                    <th>追跡番号</th>
                    <td>${escapeHtml(currentShipment.tracking_number || '-')}</td>
                </tr>
            </table>
        </div>
        
        ${currentShipment.notes ? `
        <div class="print-detail-section">
            <div class="print-detail-section-title">備考</div>
            <div class="print-detail-notes">${escapeHtml(currentShipment.notes)}</div>
        </div>
        ` : ''}
        
        <div class="print-detail-footer">
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="width: 50%; padding-right: 5mm; vertical-align: top;">
                        <div style="font-weight: bold; margin-bottom: 2mm;">検品者</div>
                        <div>氏名: _______________________</div>
                        <div style="margin-top: 2mm;">日付: _______________________</div>
                    </td>
                    <td style="width: 50%; text-align: right; vertical-align: top;">
                        <div style="font-weight: bold; margin-bottom: 2mm;">承認印</div>
                        <div style="border: 1px solid #000; width: 40mm; height: 25mm; display: inline-block;"></div>
                    </td>
                </tr>
            </table>
        </div>
    `;
    
    // 印刷エリアに内容を設定
    printArea.innerHTML = printHTML;
    
    // bodyにクラスを追加して印刷モードに
    document.body.classList.add('printing-detail');
    
    // 印刷実行
    const originalTitle = document.title;
    document.title = `出荷指示詳細 - ${currentShipment.instruction_id}`;
    
    window.print();
    
    // 印刷後、元に戻す
    setTimeout(() => {
        document.body.classList.remove('printing-detail');
        document.title = originalTitle;
        printArea.innerHTML = '';
    }, 100);
    
    showToast('印刷プレビューを開きました', 'info');
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

