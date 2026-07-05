/**
 * アプリケーションメイン制御ファイル
 * モジュールの初期化と統合管理
 */

import { DeliveryMap } from './modules/delivery-map.js';
import { QRScanner } from './modules/qr-scanner.js';
import { InventoryManager } from './modules/inventory-manager.js';

class ShippingApp {
    constructor() {
        this.deliveryMap = null;
        this.qrScanner = null;
        this.inventoryManager = null;
        this.isInitialized = false;
        this.apiBaseUrl = '/api';
        
        // 初期化フラグ
        this.modules = {
            deliveryMap: false,
            qrScanner: false,
            inventoryManager: false
        };

        // 現在の検索パラメータを保持
        this.currentSearchParams = {};
    }

    /**
     * アプリケーションを初期化
     */
    async init() {
        try {
            console.log('Initializing Shipping Management System...');
            
            // DOM準備完了を待機
            await this.waitForDOM();
            
            // 初期データを読み込み
            await this.loadInitialData();
            
            // モジュールを初期化
            await this.initializeModules();
            
            // グローバルイベントリスナーを設定
            this.setupGlobalEventListeners();
            
            // タブ機能を初期化
            this.initializeTabs();
            
            // パフォーマンス監視
            this.monitorPerformance();
            
            this.isInitialized = true;
            console.log('System initialized successfully.');
            
        } catch (error) {
            console.error('Application initialization failed:', error);
            this.showError('システムの初期化に失敗しました。ページを再読み込みしてください。');
        }
    }

    /**
     * 初期データを読み込み
     */
    async loadInitialData() {
        try {
            // 出荷場所と納入場所のマスターデータを読み込み
            await Promise.all([
                this.loadShippingLocations(),
                this.loadDeliveryLocations()
            ]);
            
            // 初期検索を実行
            await this.searchShipments();
        } catch (error) {
            console.error('Failed to load initial data:', error);
        }
    }

    /**
     * 出荷場所マスターデータを読み込み
     */
    async loadShippingLocations() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/shipping-locations`);
            const locations = await response.json();
            
            const select = document.getElementById('shipping-location');
            select.innerHTML = '<option value="">すべて</option>';
            
            locations.forEach(location => {
                const option = document.createElement('option');
                option.value = location.location_code;
                option.textContent = location.location_name;
                select.appendChild(option);
            });
        } catch (error) {
            console.error('Failed to load shipping locations:', error);
        }
    }

    /**
     * 納入場所マスターデータを読み込み
     */
    async loadDeliveryLocations() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/delivery-locations`);
            const locations = await response.json();
            
            const select = document.getElementById('delivery-location');
            select.innerHTML = '<option value="">すべて</option>';
            
            locations.forEach(location => {
                const option = document.createElement('option');
                option.value = location.location_code;
                option.textContent = location.location_name;
                select.appendChild(option);
            });
        } catch (error) {
            console.error('Failed to load delivery locations:', error);
        }
    }

    /**
     * 出荷指示検索
     */
    async searchShipments() {
        try {
            // 検索パラメータを取得
            const params = new URLSearchParams();
            
            const shippingLocation = document.getElementById('shipping-location')?.value;
            const deliveryLocation = document.getElementById('delivery-location')?.value;
            const shippingDateFrom = document.getElementById('shipping-date-from')?.value;
            const shippingDateTo = document.getElementById('shipping-date-to')?.value;
            const instructionId = document.getElementById('instruction-id')?.value;

            if (shippingLocation) params.append('shipping_location', shippingLocation);
            if (deliveryLocation) params.append('delivery_location', deliveryLocation);
            if (shippingDateFrom) params.append('shipping_date_from', shippingDateFrom);
            if (shippingDateTo) params.append('shipping_date_to', shippingDateTo);
            if (instructionId) params.append('instruction_id', instructionId);

            // パラメータを保存
            this.currentSearchParams = {
                shipping_location: shippingLocation,
                delivery_location: deliveryLocation,
                shipping_date_from: shippingDateFrom,
                shipping_date_to: shippingDateTo,
                instruction_id: instructionId
            };

            // 納入場所別サマリーを取得
            const response = await fetch(`${this.apiBaseUrl}/shipping-instructions/summary/by-delivery-location?${params}`);
            const deliveryLocationSummaries = await response.json();
            
            // 結果を表示
            this.displayDeliveryLocationSummaries(deliveryLocationSummaries);
            
        } catch (error) {
            console.error('Search failed:', error);
            this.showError('検索に失敗しました。');
        }
    }

    /**
     * 納入場所別サマリー表示
     */
    displayDeliveryLocationSummaries(summaries) {
        const container = document.getElementById('delivery-locations');
        container.innerHTML = '';

        if (summaries.length === 0) {
            container.innerHTML = '<div class="no-results">該当する出荷指示が見つかりませんでした。</div>';
            return;
        }

        summaries.forEach(summary => {
            const card = document.createElement('div');
            card.className = 'delivery-card fade-in';
            card.innerHTML = `
                <div class="delivery-header">
                    <div class="delivery-info">
                        <h3>${summary.location_name}</h3>
                        <div class="delivery-meta">
                            <strong>住所:</strong> ${summary.address}<br>
                            <strong>電話:</strong> ${summary.phone}<br>
                            <strong>担当者:</strong> ${summary.contact_person}
                        </div>
                    </div>
                    <button class="btn btn-info" onclick="app.goToDeliveryDetail('${summary.location_code}')">
                        📋 詳細表示
                    </button>
                </div>
                
                <div class="item-summary">
                    <div class="summary-item">
                        <div class="summary-value">${summary.total_items}</div>
                        <div class="summary-label">品目数</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-value">${summary.total_quantity}</div>
                        <div class="summary-label">総数量</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-value">${summary.completed_items}/${summary.total_items}</div>
                        <div class="summary-label">完了状況</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-value">${summary.pending_items}</div>
                        <div class="summary-label">未処理</div>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    }

    /**
     * 納入場所詳細画面に遷移
     */
    async goToDeliveryDetail(locationCode) {
        try {
            // パラメータを構築
            const params = new URLSearchParams();
            if (this.currentSearchParams.shipping_location) {
                params.append('shipping_location', this.currentSearchParams.shipping_location);
            }
            if (this.currentSearchParams.shipping_date_from) {
                params.append('shipping_date_from', this.currentSearchParams.shipping_date_from);
            }
            if (this.currentSearchParams.shipping_date_to) {
                params.append('shipping_date_to', this.currentSearchParams.shipping_date_to);
            }
            if (this.currentSearchParams.instruction_id) {
                params.append('instruction_id', this.currentSearchParams.instruction_id);
            }

            // 納入場所詳細データを取得
            const response = await fetch(`${this.apiBaseUrl}/shipping-instructions/detail/${locationCode}?${params}`);
            const items = await response.json();

            if (items.length > 0) {
                // 画面を切り替え
                this.showScreen('delivery-detail-screen');
                
                // ヘッダー情報を設定
                document.getElementById('detail-location-name').textContent = items[0].delivery_location_name;
                document.getElementById('detail-title').textContent = `${items[0].delivery_location_name} - 品目詳細`;
                document.getElementById('detail-info').innerHTML = `
                    <div><strong>住所:</strong> ${items[0].delivery_address}</div>
                    <div><strong>電話:</strong> ${items[0].delivery_phone}</div>
                    <div><strong>担当者:</strong> ${items[0].delivery_contact}</div>
                `;

                // 品目リストを表示
                this.displayItemList(items);
            }
        } catch (error) {
            console.error('Failed to load delivery detail:', error);
            this.showError('詳細情報の取得に失敗しました。');
        }
    }

    /**
     * 品目リストを表示
     */
    displayItemList(items) {
        const container = document.getElementById('items-list');
        container.innerHTML = '';

        items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'table-row';
            
            const statusClass = this.getStatusClass(item.status);
            const statusText = this.getStatusText(item.status);

            row.innerHTML = `
                <div class="table-cell">${item.instruction_id}</div>
                <div class="table-cell">${item.product_code}</div>
                <div class="table-cell">${item.product_name}</div>
                <div class="table-cell">${item.quantity}</div>
                <div class="table-cell">${this.formatDate(item.shipping_date)}</div>
                <div class="table-cell">
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </div>
                <div class="table-cell">
                    <button class="btn btn-sm" onclick="app.viewItemDetail(${item.id})">
                        📋 詳細
                    </button>
                </div>
            `;
            container.appendChild(row);
        });
    }

    /**
     * 出荷指示一覧画面に戻る
     */
    goBackToShipping() {
        this.showScreen('shipping-screen');
    }

    /**
     * 画面切り替え
     */
    showScreen(screenId) {
        // すべての画面を非表示
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        
        // 指定された画面を表示
        const targetScreen = document.getElementById(screenId);
        if (targetScreen) {
            targetScreen.classList.add('active');
        }
    }

    /**
     * ステータスクラス取得
     */
    getStatusClass(status) {
        switch (status) {
            case 'pending': return 'status-pending';
            case 'processing': return 'status-processing';
            case 'shipped': return 'status-shipped';
            case 'delivered': return 'status-completed';
            default: return 'status-pending';
        }
    }

    /**
     * ステータステキスト取得
     */
    getStatusText(status) {
        switch (status) {
            case 'pending': return '未処理';
            case 'processing': return '処理中';
            case 'shipped': return '出荷済み';
            case 'delivered': return '配送完了';
            default: return '未処理';
        }
    }

    /**
     * 日付フォーマット
     */
    formatDate(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleDateString('ja-JP');
    }

    /**
     * エラー表示
     */
    showError(message) {
        // TODO: エラー表示機能を実装
        alert(message);
    }
     */
    async waitForDOM() {
        return new Promise((resolve) => {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', resolve);
            } else {
                resolve();
            }
        });
    }

    /**
     * モジュールを初期化
     */
    async initializeModules() {
        // インベントリマネージャーを初期化（基本機能）
        await this.initializeInventoryManager();
        
        // 地図機能は遅延読み込み
        this.setupLazyMapInitialization();
        
        // QRスキャナーは遅延読み込み
        this.setupLazyQRInitialization();
    }

    /**
     * インベントリマネージャーを初期化
     */
    async initializeInventoryManager() {
        try {
            this.inventoryManager = new InventoryManager();
            this.modules.inventoryManager = true;
            
            // グローバルアクセス用（互換性のため）
            window.inventoryManager = this.inventoryManager;
            
            console.log('InventoryManager initialized');
        } catch (error) {
            console.error('InventoryManager initialization failed:', error);
        }
    }

    /**
     * 地図機能の遅延初期化を設定
     */
    setupLazyMapInitialization() {
        // 地図タブがクリックされた時に初期化
        const mapTab = document.querySelector('[data-tab="map"]');
        if (mapTab) {
            mapTab.addEventListener('click', () => {
                this.initializeMapIfNeeded();
            });
        }
    }

    /**
     * QRスキャナーの遅延初期化を設定
     */
    setupLazyQRInitialization() {
        // 照合画面に移動した時に初期化
        const originalGoToVerification = window.goToVerification;
        window.goToVerification = () => {
            if (originalGoToVerification) {
                originalGoToVerification();
            }
            this.initializeQRScannerIfNeeded();
        };
    }

    /**
     * 必要に応じて地図を初期化
     */
    async initializeMapIfNeeded() {
        if (!this.modules.deliveryMap) {
            try {
                this.deliveryMap = new DeliveryMap();
                await this.deliveryMap.init();
                this.modules.deliveryMap = true;
                
                // グローバルアクセス用（互換性のため）
                window.deliveryMap = this.deliveryMap;
                
                console.log('DeliveryMap initialized (lazy)');
            } catch (error) {
                console.error('DeliveryMap lazy initialization failed:', error);
            }
        }
        
        // 地図サイズを再計算
        if (this.deliveryMap) {
            this.deliveryMap.invalidateSize();
        }
    }

    /**
     * 必要に応じてQRスキャナーを初期化
     */
    initializeQRScannerIfNeeded() {
        if (!this.modules.qrScanner) {
            try {
                this.qrScanner = new QRScanner();
                this.modules.qrScanner = true;
                
                // グローバルアクセス用（互換性のため）
                window.inventoryQRScanner = this.qrScanner;
                
                console.log('QRScanner initialized (lazy)');
            } catch (error) {
                console.error('QRScanner lazy initialization failed:', error);
            }
        }
    }

    /**
     * グローバルイベントリスナーを設定
     */
    setupGlobalEventListeners() {
        // ウィンドウリサイズイベント
        window.addEventListener('resize', this.debounce(() => {
            if (this.deliveryMap) {
                this.deliveryMap.invalidateSize();
            }
        }, 250));

        // ページの可視性変更
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // ページが非表示になった時の処理
                if (this.qrScanner) {
                    this.qrScanner.pauseScanning();
                }
            }
        });

        // エラーハンドリング
        window.addEventListener('error', (event) => {
            console.error('Global error caught:', event.error);
            this.logError(event.error);
        });

        // 未処理のPromise拒否
        window.addEventListener('unhandledrejection', (event) => {
            console.error('Unhandled promise rejection:', event.reason);
            this.logError(event.reason);
        });
    }

    /**
     * タブ機能を初期化
     */
    initializeTabs() {
        const tabButtons = document.querySelectorAll('.tab-button');
        const tabContents = document.querySelectorAll('.delivery-tab-content');
        
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.getAttribute('data-tab');
                
                // タブボタンのアクティブ状態を切り替え
                tabButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                
                // コンテンツの表示を切り替え
                tabContents.forEach(content => content.classList.remove('active'));
                const targetContent = document.getElementById(targetTab + '-content');
                if (targetContent) {
                    targetContent.classList.add('active');
                }
                
                // 地図タブが選択された場合、地図を初期化
                if (targetTab === 'map') {
                    this.initializeMapIfNeeded();
                }
            });
        });
    }

    /**
     * パフォーマンスを監視
     */
    monitorPerformance() {
        if ('performance' in window) {
            window.addEventListener('load', () => {
                const loadTime = performance.timing.loadEventEnd - performance.timing.navigationStart;
                console.log(`Page load time: ${loadTime}ms`);
                
                // パフォーマンスデータを収集
                if (loadTime > 5000) {
                    console.warn('Page load time exceeded 5 seconds');
                }
            });
        }
    }

    /**
     * エラーをログに記録
     */
    logError(error) {
        // 実際の実装では外部ログサービスに送信
        const errorData = {
            message: error.message || error,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            url: window.location.href
        };
        
        // ローカルストレージに一時保存
        try {
            const existingLogs = JSON.parse(localStorage.getItem('error_logs') || '[]');
            existingLogs.push(errorData);
            
            // 最新の10件のみ保持
            if (existingLogs.length > 10) {
                existingLogs.splice(0, existingLogs.length - 10);
            }
            
            localStorage.setItem('error_logs', JSON.stringify(existingLogs));
        } catch (storageError) {
            console.error('Failed to store error log:', storageError);
        }
    }

    /**
     * エラーメッセージを表示
     */
    showError(message) {
        // 簡単なエラー通知を表示
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-notification';
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ef4444;
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            max-width: 400px;
            font-weight: 500;
        `;
        errorDiv.textContent = message;
        
        document.body.appendChild(errorDiv);
        
        // 5秒後に自動削除
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 5000);
    }

    /**
     * デバウンス関数
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * アプリケーションをクリーンアップ
     */
    destroy() {
        if (this.deliveryMap) {
            this.deliveryMap.destroy();
        }
        
        if (this.qrScanner) {
            this.qrScanner.cleanupResources();
        }
        
        if (this.inventoryManager) {
            this.inventoryManager.destroy();
        }
        
        this.isInitialized = false;
        console.log('Application destroyed');
    }
}

// グローバル関数の定義（互換性のため）
window.goToShipping = () => {
    if (window.inventoryManager) {
        window.inventoryManager.goToShipping();
    }
};

window.goToDeliveryDetail = (locationCode) => {
    if (window.inventoryManager) {
        window.inventoryManager.goToDeliveryDetail(locationCode);
    }
};

window.goToPicking = (itemCode) => {
    if (window.inventoryManager) {
        window.inventoryManager.goToPicking(itemCode);
    }
};

window.goToVerification = () => {
    if (window.inventoryManager) {
        window.inventoryManager.goToVerification();
    }
};

window.searchShipments = () => {
    if (window.inventoryManager) {
        window.inventoryManager.searchShipments();
    }
};

window.savePicking = () => {
    if (window.inventoryManager) {
        window.inventoryManager.savePicking();
    }
};

window.startCamera = () => {
    if (window.inventoryQRScanner) {
        window.inventoryQRScanner.startScan();
    }
};

window.manualInput = () => {
    if (window.inventoryQRScanner) {
        window.inventoryQRScanner.showManualInput();
    }
};

// アプリケーションのグローバルインスタンスを作成
const shippingApp = new ShippingApp();

// アプリケーションを初期化
shippingApp.init();

// グローバルアクセス用
window.shippingApp = shippingApp;

export default shippingApp;