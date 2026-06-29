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
        this.currentScreen = 'shipping-screen'; // 現在のスクリーンを追跡
        
        // 初期化フラグ
        this.modules = {
            deliveryMap: false,
            qrScanner: false,
            inventoryManager: false
        };

        // 現在の検索パラメータを保持
        this.currentSearchParams = {};
        
        // モバイル検出
        this.isMobile = this.detectMobile();
        this.isIOS = this.detectIOS();
        
        // モバイル最適化を適用
        if (this.isMobile) {
            this.applyMobileOptimizations();
        }
    }
    
    /**
     * モバイルデバイスの検出
     */
    detectMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
               (window.innerWidth <= 768);
    }
    
    /**
     * iOSデバイスの検出
     */
    detectIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }
    
    /**
     * モバイル最適化の適用
     */
    applyMobileOptimizations() {
        // bodyにモバイルクラスを追加
        document.body.classList.add('mobile-device');
        if (this.isIOS) {
            document.body.classList.add('ios-device');
        }
        
        // ビューポートの高さを計算（iOS対応）
        this.updateViewportHeight();
        window.addEventListener('resize', () => this.updateViewportHeight());
        window.addEventListener('orientationchange', () => {
            setTimeout(() => this.updateViewportHeight(), 100);
        });
        
        // タッチイベントの最適化
        this.optimizeTouchEvents();
        
        console.log('Mobile optimizations applied');
    }
    
    /**
     * ビューポート高さの更新（iOS対応）
     */
    updateViewportHeight() {
        const vh = window.innerHeight * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
    }
    
    /**
     * タッチイベントの最適化
     */
    optimizeTouchEvents() {
        // パッシブリスナーでスクロールパフォーマンス向上
        document.addEventListener('touchstart', () => {}, { passive: true });
        document.addEventListener('touchmove', () => {}, { passive: true });
        
        // ダブルタップズーム防止（QRスキャン画面のみ）
        let lastTouchEnd = 0;
        document.addEventListener('touchend', (event) => {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) {
                const target = event.target;
                if (target.closest('.qr-video-container')) {
                    event.preventDefault();
                }
            }
            lastTouchEnd = now;
        }, { passive: false });
    }

    /**
     * アプリケーションを初期化
     */
    async init() {
        try {
            console.log('Initializing ShippingApp...');
            
            // DOMが完全に準備できるまで待機
            await this.waitForDOM();
            
            // デバイスモード変更のリスナーを追加
            this.initDeviceModeListener();
            
            // モジュールの遅延読み込み
            await this.initializeModules();
            
            // QRスキャナー初期化
            this.initQRScanner();
            
            // 初期化完了フラグ
            this.isInitialized = true;
            console.log('ShippingApp initialized successfully');
            
            // 初期データ読み込み
            await this.loadInitialData();
            
        } catch (error) {
            console.error('Initialization failed:', error);
            this.logError(error);
        }
    }

    /**
     * デバイスモード変更のリスナーを初期化
     */
    initDeviceModeListener() {
        window.addEventListener('deviceModeChanged', (event) => {
            console.log('Device mode changed in app:', event.detail);
            
            // デバイスモードに応じた調整
            this.adjustForDeviceMode(event.detail.mode);
        });
        
        // 初期モードの適用
        if (window.deviceModeManager) {
            const currentMode = window.deviceModeManager.getCurrentMode();
            if (currentMode) {
                this.adjustForDeviceMode(currentMode);
            }
        }
    }

    /**
     * デバイスモードに応じた調整
     */
    adjustForDeviceMode(mode) {
        console.log(`Adjusting app for device mode: ${mode}`);
        
        // QRスキャナーの再調整が必要な場合
        if (this.qrScanner && this.qrScanner.isScanning) {
            console.log('QR Scanner is active, recalibrating...');
            setTimeout(() => {
                if (this.qrScanner) {
                    this.qrScanner.recalibrate();
                }
            }, 500);
        }
        
        // モード別の最適化
        if (mode === 'ipad-mini') {
            this.optimizeForIPadMini();
        } else if (mode === 'iphone-6') {
            this.optimizeForIPhone6();
        }
    }

    /**
     * iPad Mini向けの最適化
     */
    optimizeForIPadMini() {
        console.log('Optimizing for iPad Mini...');
        // iPad Mini向けの設定
        // 例: より大きなフォント、2カラムレイアウトなど
    }

    /**
     * iPhone 6向けの最適化
     */
    optimizeForIPhone6() {
        console.log('Optimizing for iPhone 6...');
        // iPhone 6向けの設定
        // 例: コンパクトなレイアウト、1カラムなど
    }

    /**
     * QRスキャナーの初期化
     */
    initQRScanner() {
        // QRスキャナーのイベントリスナーを設定
        const startQRButton = document.getElementById('start-qr-scan');
        const stopQRButton = document.getElementById('stop-qr-scan');
        const calibrateButton = document.getElementById('calibrate-qr-camera');
        const debugButton = document.getElementById('toggle-qr-debug');
        const clearResultButton = document.getElementById('clear-qr-result');

        if (startQRButton) {
            startQRButton.addEventListener('click', () => this.startQRScan());
        }
        if (stopQRButton) {
            stopQRButton.addEventListener('click', () => this.stopQRScan());
        }
        if (calibrateButton) {
            calibrateButton.addEventListener('click', () => this.calibrateQRCamera());
        }
        if (debugButton) {
            debugButton.addEventListener('click', () => this.toggleQRDebug());
        }
        if (clearResultButton) {
            clearResultButton.addEventListener('click', () => this.clearQRResult());
        }
        
        // カメラ検出の事前実行
        this.detectCamerasForInfo();
    }

    /**
     * カメラ情報の事前検出
     */
    async detectCamerasForInfo() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cameras = devices.filter(device => device.kind === 'videoinput');
            
            const cameraInfoElement = document.getElementById('camera-count');
            if (cameraInfoElement && cameras.length > 0) {
                cameraInfoElement.innerHTML = `📷 カメラ検出: <strong>${cameras.length}台</strong> 利用可能`;
                cameraInfoElement.style.color = '#059669';
            }
        } catch (error) {
            console.warn('カメラ事前検出エラー:', error);
        }
    }

    /**
     * 初期データを読み込み
     */
    async loadInitialData() {
        try {
            // 読み込み中の表示
            const container = document.getElementById('delivery-locations');
            if (container) {
                container.innerHTML = '<div class="loading">📡 データを読み込み中...</div>';
            }

            // 出荷場所と納入場所のマスターデータを読み込み
            await Promise.all([
                this.loadShippingLocations(),
                this.loadDeliveryLocations()
            ]);
            
            // 初期検索を実行
            await this.searchShipments();
        } catch (error) {
            console.error('Failed to load initial data:', error);
            this.showError('初期データの読み込みに失敗しました。');
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
            if (select) {
                select.innerHTML = '<option value="">すべて</option>';
                
                locations.forEach(location => {
                    const option = document.createElement('option');
                    option.value = location.location_code;
                    option.textContent = location.location_name;
                    select.appendChild(option);
                });
            }
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
            if (select) {
                select.innerHTML = '<option value="">すべて</option>';
                
                locations.forEach(location => {
                    const option = document.createElement('option');
                    option.value = location.location_code;
                    option.textContent = location.location_name;
                    select.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Failed to load delivery locations:', error);
        }
    }

    /**
     * 出荷指示検索
     */
    async searchShipments() {
        try {
            console.log('Starting search...');
            
            // 検索ボタンを無効化
            const searchButton = document.querySelector('button[onclick="searchShipments()"]');
            if (searchButton) {
                searchButton.disabled = true;
                searchButton.innerHTML = '🔄 検索中...';
            }

            // 検索パラメータを取得
            const params = new URLSearchParams();
            
            const shippingLocation = document.getElementById('shipping-location')?.value;
            const deliveryLocation = document.getElementById('delivery-location')?.value;
            const shippingDateFrom = document.getElementById('shipping-date-from')?.value;
            const shippingDateTo = document.getElementById('shipping-date-to')?.value;
            const instructionId = document.getElementById('instruction-id')?.value;

            console.log('Search parameters:', {
                shippingLocation,
                deliveryLocation,
                shippingDateFrom,
                shippingDateTo,
                instructionId
            });

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
            const url = `${this.apiBaseUrl}/shipping-instructions/summary/by-delivery-location?${params}`;
            console.log('Fetching:', url);
            
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const deliveryLocationSummaries = await response.json();
            console.log('Search results:', deliveryLocationSummaries);
            
            // 結果を表示
            this.displayDeliveryLocationSummaries(deliveryLocationSummaries);
            
        } catch (error) {
            console.error('Search failed:', error);
            this.showError(`検索に失敗しました: ${error.message}`);
        } finally {
            // 検索ボタンを再有効化
            const searchButton = document.querySelector('button[onclick="searchShipments()"]');
            if (searchButton) {
                searchButton.disabled = false;
                searchButton.innerHTML = '🔍 検索';
            }
        }
    }

    /**
     * 納入場所別サマリー表示
     */
    displayDeliveryLocationSummaries(summaries) {
        const container = document.getElementById('delivery-locations');
        if (!container) return;
        
        container.innerHTML = '';

        if (summaries.length === 0) {
            container.innerHTML = '<div class="no-results">該当する出荷指示が見つかりませんでした。</div>';
            return;
        }

        summaries.forEach(summary => {
            const card = document.createElement('div');
            card.className = 'delivery-card fade-in';
            
            // 出荷予定日の表示を決定
            let shippingDateDisplay = '';
            if (summary.earliest_shipping_date) {
                if (summary.earliest_shipping_date === summary.latest_shipping_date) {
                    shippingDateDisplay = this.formatDate(summary.earliest_shipping_date);
                } else {
                    shippingDateDisplay = `${this.formatDate(summary.earliest_shipping_date)} ~ ${this.formatDate(summary.latest_shipping_date)}`;
                }
            } else {
                shippingDateDisplay = '-';
            }
            
            card.innerHTML = `
                <div class="delivery-header">
                    <div class="delivery-info">
                        <h3>${summary.location_name}</h3>
                        <div class="delivery-meta">
                            <strong>住所:</strong> ${summary.address}<br>
                            <strong>電話番号:</strong> ${summary.phone}<br>
                            <strong>担当者:</strong> ${summary.contact_person || '-'}<br>
                            <strong>出荷予定日:</strong> ${shippingDateDisplay}<br>
                            <strong>配送方法:</strong> ${summary.delivery_method || '宅配便'}
                        </div>
                    </div>
                    <button class="btn btn-info" onclick="app.goToDeliveryDetail('${summary.location_code}')">
                        📋 詳細表示
                    </button>
                </div>
                
                <div class="item-summary">
                    <div class="summary-item">
                        <div class="summary-value">${summary.total_items || 0}</div>
                        <div class="summary-label">品目数</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-value">${summary.total_quantity || 0}</div>
                        <div class="summary-label">総数量</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-value">${summary.completed_items || 0}/${summary.total_items || 0}</div>
                        <div class="summary-label">完了状況</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-value">${summary.pending_items || 0}</div>
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
            // 現在のlocationCodeを保存
            this.currentLocationCode = locationCode;
            
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
                const deliveryName = document.getElementById('delivery-name');
                const detailInfo = document.getElementById('detail-info');
                
                if (deliveryName) deliveryName.textContent = items[0].delivery_location_name;
                if (detailInfo) {
                    // 出荷予定日の範囲を計算
                    const shippingDates = items.map(item => item.shipping_date).filter(Boolean);
                    let shippingDateDisplay = '-';
                    if (shippingDates.length > 0) {
                        const minDate = new Date(Math.min(...shippingDates.map(d => new Date(d))));
                        const maxDate = new Date(Math.max(...shippingDates.map(d => new Date(d))));
                        if (minDate.getTime() === maxDate.getTime()) {
                            shippingDateDisplay = this.formatDate(minDate);
                        } else {
                            shippingDateDisplay = `${this.formatDate(minDate)} ~ ${this.formatDate(maxDate)}`;
                        }
                    }
                    
                    detailInfo.innerHTML = `
                        <strong>住所:</strong> ${items[0].delivery_address}<br>
                        <strong>電話番号:</strong> ${items[0].delivery_phone}<br>
                        <strong>担当者:</strong> ${items[0].delivery_contact || '-'}<br>
                        <strong>出荷予定日:</strong> ${shippingDateDisplay}<br>
                        <strong>配送方法:</strong> ${items[0].delivery_method || '宅配便'}
                    `;
                }

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
        const container = document.getElementById('items-container');
        if (!container) return;
        
        container.innerHTML = '';

        if (items.length === 0) {
            container.innerHTML = '<div class="no-results">表示する品目がありません。</div>';
            this.updateSummary(0, 0);
            return;
        }

        // サマリー計算
        let totalQuantity = 0;
        let completedQuantity = 0;

        items.forEach(item => {
            totalQuantity += item.quantity || 0;
            completedQuantity += item.picked_quantity || 0;
            const itemCard = document.createElement('div');
            itemCard.className = 'item-card';
            
            const statusClass = this.getStatusClass(item.status);
            const statusText = this.getStatusText(item.status);

            itemCard.innerHTML = `
                <div class="item-header">
                    <div class="item-info">
                        <div class="item-title">${item.product_code} - ${item.product_name}</div>
                        <div class="item-meta">客先注番: ${item.customer_order_number || '-'}</div>
                        <div class="item-meta">出荷指示数: ${item.quantity}個 | 出荷予定日: ${this.formatDate(item.shipping_date)}</div>
                        <div class="item-meta">
                            <span class="status-badge ${statusClass}">${statusText}</span>
                        </div>
                    </div>
                    <div class="item-actions">
                        <button class="btn btn-warning" onclick="app.goToPicking('${item.product_code}', '${item.product_name}', '${item.customer_order_number || ''}', ${item.quantity}, '${item.delivery_location_name}', '${item.shipping_date}')">📋 ピッキング</button>
                        <button class="btn btn-info" onclick="window.goToShipping('${item.id}')">� QR検品</button>
                    </div>
                </div>
                <div class="input-group">
                    <div class="form-group">
                        <label>ピッキング済み数量</label>
                        <input type="number" class="qty-input" value="${item.picked_quantity || 0}" max="${item.quantity}" data-item-id="${item.id}">
                    </div>
                    <button class="btn btn-success" onclick="app.updatePickedQuantity('${item.id}')">💾 更新</button>
                </div>
            `;
            container.appendChild(itemCard);
        });

        // サマリーを更新
        this.updateSummary(totalQuantity, completedQuantity);
    }

    /**
     * サマリーを更新
     */
    updateSummary(totalQuantity, completedQuantity) {
        const totalElement = document.getElementById('total-quantity');
        const completedElement = document.getElementById('completed-quantity');
        
        if (totalElement) totalElement.textContent = totalQuantity;
        if (completedElement) completedElement.textContent = completedQuantity;
    }

    /**
     * ピッキング画面に遷移
     */
    async goToPicking(itemCode, itemName, customerOrderNumber, quantity, deliveryLocation, shippingDate) {
        try {
            // パラメータが渡されていない場合は従来のAPI取得方式
            if (arguments.length === 1) {
                const itemId = itemCode; // 最初の引数をitemIdとして扱う
                const response = await fetch(`${this.apiBaseUrl}/shipping-instructions/${itemId}`);
                const item = await response.json();

                if (item) {
                    this.setPickingItemData(item.product_code, item.product_name, item.customer_order_number, item.quantity, item.delivery_location_name, item.shipping_date, item);
                }
            } else {
                // パラメータで渡された情報を使用
                const mockItem = {
                    product_code: itemCode,
                    product_name: itemName,
                    customer_order_number: customerOrderNumber,
                    quantity: quantity,
                    delivery_location_name: deliveryLocation,
                    shipping_date: shippingDate,
                    picked_quantity: 0
                };
                this.setPickingItemData(itemCode, itemName, customerOrderNumber, quantity, deliveryLocation, shippingDate, mockItem);
            }
        } catch (error) {
            console.error('Failed to load picking detail:', error);
            this.showError('ピッキング情報の取得に失敗しました。');
        }
    }

    /**
     * ピッキング画面の品目データを設定
     */
    setPickingItemData(itemCode, itemName, customerOrderNumber, quantity, deliveryLocation, shippingDate, itemData) {
        // 画面を切り替え
        this.showScreen('picking-screen');
        
        // 品目情報を設定
        const pickingTitle = document.getElementById('picking-item-title');
        const pickingInfo = document.getElementById('picking-item-info');
        const quantityInput = document.getElementById('picked-quantity');
        const targetQuantityElement = document.getElementById('target-quantity');
        
        if (pickingTitle) pickingTitle.textContent = `${itemCode} - ${itemName}`;
        if (pickingInfo) {
            pickingInfo.innerHTML = `
                ${itemCode} - ${itemName}<br>
                客先注番: ${customerOrderNumber || '-'} | 出荷指示数: ${quantity}個<br>
                納入場所: ${deliveryLocation || '-'} | 出荷予定日: ${shippingDate}
            `;
        }
        if (quantityInput) {
            quantityInput.max = quantity;
            quantityInput.value = itemData.picked_quantity || 0;
        }
        if (targetQuantityElement) {
            targetQuantityElement.textContent = `${quantity}個`;
        }
        
        // 現在の品目IDとデータを保存
        this.currentItemId = itemCode;
        this.currentItemData = itemData;
        
        // ピッキング状況を更新
        this.updatePickingStatus(itemData.picked_quantity || 0);
    }

    /**
     * ピッキング数量を更新
     */
    async updatePickedQuantity(itemId) {
        try {
            const input = document.querySelector(`input[data-item-id="${itemId}"]`);
            if (!input) {
                this.showError('入力欄が見つかりません。');
                return;
            }
            
            const pickedQuantity = parseInt(input.value) || 0;
            
            if (pickedQuantity < 0) {
                this.showError('ピッキング数量は0以上で入力してください。');
                return;
            }
            
            // ローディング表示
            this.showLoadingState();
            
            const response = await fetch(`${this.apiBaseUrl}/shipping-instructions/${itemId}/picking`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    picked_quantity: pickedQuantity
                })
            });
            
            this.hideLoadingState();
            
            if (response.ok) {
                alert(`ピッキング数量を更新しました: ${pickedQuantity}個`);
                // 現在の画面を再読み込み
                this.refreshCurrentScreen();
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'ピッキング数量の更新に失敗しました。');
            }
        } catch (error) {
            this.hideLoadingState();
            console.error('Failed to update picked quantity:', error);
            this.showError('ピッキング数量の更新に失敗しました: ' + error.message);
        }
    }

    /**
     * 現在の画面を再読み込み
     */
    async refreshCurrentScreen() {
        if (this.currentLocationCode) {
            // 納入場所詳細を再読み込み
            await this.goToDeliveryDetail(this.currentLocationCode);
        }
    }

    /**
     * 出荷指示一覧画面に戻る
     */
    goToShipping() {
        this.showScreen('shipping-screen');
    }

    /**
     * 納入場所詳細に戻る
     */
    goBackToDeliveryDetail() {
        this.showScreen('delivery-detail-screen');
    }

    /**
     * ピッキング保存
     */
    async savePicking() {
        try {
            const quantityInput = document.getElementById('picked-quantity');
            const notesInput = document.getElementById('picking-notes');
            
            if (!quantityInput || !this.currentItemId) {
                this.showError('ピッキング情報が不正です。');
                return;
            }
            
            const pickedQuantity = parseInt(quantityInput.value) || 0;
            const notes = notesInput ? notesInput.value : '';
            
            if (pickedQuantity <= 0) {
                this.showError('ピッキング数量を入力してください。');
                return;
            }
            
            // ローディング表示
            this.showLoadingState();
            
            const response = await fetch(`${this.apiBaseUrl}/shipping-instructions/${this.currentItemId}/picking`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    picked_quantity: pickedQuantity,
                    notes: notes
                })
            });
            
            this.hideLoadingState();
            
            if (response.ok) {
                alert(`ピッキング情報を保存しました。\n出荷対象: ${this.currentItemData?.product_name || ''}\n出荷数: ${pickedQuantity}個`);
                // ピッキング状況を更新
                this.updatePickingStatus(pickedQuantity);
                // 納入場所詳細に戻る
                this.goBackToDeliveryDetail();
            } else {
                const errorData = await response.json();
                throw new Error(errorData.error || 'ピッキング保存に失敗しました。');
            }
        } catch (error) {
            this.hideLoadingState();
            console.error('Failed to save picking:', error);
            this.showError('ピッキング保存に失敗しました: ' + error.message);
        }
    }

    /**
     * ピッキング状況の表示を更新
     */
    updatePickingStatus(pickedQuantity) {
        const targetQuantity = this.currentItemData?.quantity || 0;
        const remainingQuantity = Math.max(0, targetQuantity - pickedQuantity);
        
        const pickedSummary = document.getElementById('picked-summary');
        const remainingElement = document.getElementById('remaining-quantity');
        
        if (pickedSummary) pickedSummary.textContent = `${pickedQuantity}個`;
        if (remainingElement) remainingElement.textContent = `${remainingQuantity}個`;
    }

    /**
     * 照合画面に遷移
     */
    goToVerification() {
        if (!this.currentItemId) {
            this.showError('品目情報が不正です。');
            return;
        }
        
        // 照合画面を表示
        this.showScreen('verification-screen');
        
        // QRスキャナーUIの初期状態に設定
        this.resetQRScannerUI();
        
        console.log('照合画面に遷移しました。品目ID:', this.currentItemId);
    }

    /**
     * QRスキャナーUIを初期状態にリセット
     */
    resetQRScannerUI() {
        const initialScreen = document.getElementById('qr-initial-screen');
        const cameraScreen = document.getElementById('qr-camera-screen');
        const resultDisplay = document.getElementById('qr-result-display');
        
        if (initialScreen) initialScreen.style.display = 'block';
        if (cameraScreen) cameraScreen.classList.add('hidden');
        if (resultDisplay) {
            const resultData = document.getElementById('qr-result-data');
            const verificationStatus = document.getElementById('verification-status');
            if (resultData) resultData.textContent = 'スキャンデータがここに表示されます';
            if (verificationStatus) verificationStatus.textContent = '待機中';
        }
    }

    /**
     * QRスキャン開始
     */
    async startQRScan() {
        try {
            const video = document.getElementById('qr-camera-video');
            const initialScreen = document.getElementById('qr-initial-screen');
            const cameraScreen = document.getElementById('qr-camera-screen');
            const calibrationIndicator = document.getElementById('qr-calibration-indicator');
            const scanningAnimation = document.getElementById('qr-scanning-animation');
            
            if (!video) {
                throw new Error('Video element not found');
            }

            // Safari最適化QRスキャナーを動的インポート
            if (!this.qrScanner) {
                const { SafariOptimizedQRScanner } = await import('./qr-scanner.js');
                this.qrScanner = new SafariOptimizedQRScanner({
                    onResult: (data) => this.handleQRResult(data),
                    onError: (message, error) => this.handleQRError(message, error),
                    onStatusUpdate: (status) => this.updateQRStatus(status)
                });
                
                // カメラ情報の初期更新
                setTimeout(() => this.updateCameraInfo(), 1000);
            }

            // UI切り替え
            if (initialScreen) initialScreen.style.display = 'none';
            if (cameraScreen) cameraScreen.classList.remove('hidden');
            
            // スキャン開始
            await this.qrScanner.startScan(video);
            
            // キャリブレーション表示の制御
            this.monitorCalibration(calibrationIndicator, scanningAnimation);
            
            // 統計情報の定期更新
            this.startStatsMonitoring();
            
        } catch (error) {
            console.error('QR scan start failed:', error);
            this.handleQRError('QRスキャンの開始に失敗しました。', error);
        }
    }

    /**
     * キャリブレーション状態の監視
     */
    monitorCalibration(calibrationIndicator, scanningAnimation) {
        const checkCalibration = () => {
            if (this.qrScanner) {
                const status = this.qrScanner.getStatus();
                
                if (calibrationIndicator) {
                    if (status.isCalibrating) {
                        calibrationIndicator.classList.remove('hidden');
                    } else {
                        calibrationIndicator.classList.add('hidden');
                    }
                }
                
                if (scanningAnimation) {
                    if (status.isScanning && !status.isCalibrating) {
                        scanningAnimation.classList.remove('hidden');
                    } else {
                        scanningAnimation.classList.add('hidden');
                    }
                }
                
                if (status.isScanning) {
                    setTimeout(checkCalibration, 500);
                }
            }
        };
        
        checkCalibration();
    }

    /**
     * 統計情報の定期監視開始
     */
    startStatsMonitoring() {
        if (this.statsMonitoringInterval) {
            clearInterval(this.statsMonitoringInterval);
        }
        
        this.statsMonitoringInterval = setInterval(() => {
            if (this.qrScanner && this.qrScanner.getStatus().isScanning) {
                this.updateQRStats();
            } else {
                this.stopStatsMonitoring();
            }
        }, 500); // 500msごとに更新
    }

    /**
     * 統計情報の定期監視停止
     */
    stopStatsMonitoring() {
        if (this.statsMonitoringInterval) {
            clearInterval(this.statsMonitoringInterval);
            this.statsMonitoringInterval = null;
        }
    }

    /**
     * QRスキャン停止
     */
    stopQRScan() {
        if (this.qrScanner) {
            this.qrScanner.stopScan();
        }
        
        // 統計監視を停止
        this.stopStatsMonitoring();
        
        const initialScreen = document.getElementById('qr-initial-screen');
        const cameraScreen = document.getElementById('qr-camera-screen');
        
        if (initialScreen) initialScreen.style.display = 'block';
        if (cameraScreen) cameraScreen.classList.add('hidden');
        
        this.updateQRStatus('停止しました');
    }

    /**
     * QRカメラの再キャリブレーション
     */
    async calibrateQRCamera() {
        if (this.qrScanner) {
            await this.qrScanner.recalibrate();
        }
    }

    /**
     * QRデバッグモード切り替え
     */
    toggleQRDebug() {
        if (this.qrScanner) {
            const debugMode = this.qrScanner.toggleDebug();
            const debugInfo = document.getElementById('qr-debug-info');
            if (debugInfo) {
                debugInfo.classList.toggle('hidden', !debugMode);
            }
        }
    }

    /**
     * QR結果クリア
     */
    clearQRResult() {
        const resultData = document.getElementById('qr-result-data');
        const verificationStatus = document.getElementById('verification-status');
        
        if (resultData) resultData.textContent = 'スキャンデータがここに表示されます';
        if (verificationStatus) verificationStatus.textContent = '待機中';
    }

    /**
     * QRスキャン結果の処理
     */
    handleQRResult(data) {
        console.log('QR scan result:', data);
        
        // 成功オーバーレイを表示
        this.showQRSuccessOverlay();
        
        const resultData = document.getElementById('qr-result-data');
        const verificationStatus = document.getElementById('verification-status');
        
        if (resultData) {
            resultData.textContent = data;
        }
        
        // 統計監視を停止
        this.stopStatsMonitoring();
        
        // 在庫照合ロジック（簡易版）
        this.verifyInventory(data).then(result => {
            if (verificationStatus) {
                if (result.success) {
                    verificationStatus.textContent = '✅ 照合成功';
                    verificationStatus.style.color = '#16a34a';
                    
                    // 照合済み品目リストに追加
                    this.addVerifiedItem(data, result.message);
                } else {
                    verificationStatus.textContent = '❌ 照合失敗: ' + result.message;
                    verificationStatus.style.color = '#dc2626';
                }
            }
        });
    }

    /**
     * QR成功オーバーレイの表示
     */
    showQRSuccessOverlay() {
        const successOverlay = document.getElementById('qr-success-overlay');
        if (successOverlay) {
            successOverlay.classList.remove('hidden');
            
            // 2秒後に自動非表示
            setTimeout(() => {
                successOverlay.classList.add('hidden');
            }, 2000);
        }
    }

    /**
     * 照合済み品目をリストに追加
     */
    addVerifiedItem(qrData, message) {
        const verifiedItemsList = document.getElementById('verified-items');
        if (!verifiedItemsList) return;
        
        // 既存のサンプルデータを削除（初回のみ）
        const sampleItems = verifiedItemsList.querySelectorAll('.item-card');
        if (sampleItems.length > 0 && sampleItems[0].querySelector('.item-title').textContent.includes('LOT-2024-001')) {
            sampleItems.forEach(item => item.remove());
        }
        
        // 新しい照合済み品目を追加
        const now = new Date();
        const timeString = now.toLocaleString('ja-JP', { 
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit', 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });
        
        const itemCard = document.createElement('div');
        itemCard.className = 'item-card';
        itemCard.innerHTML = `
            <div class="item-header">
                <div class="item-info">
                    <div class="item-title">${qrData}</div>
                    <div class="item-meta">スキャン日時: ${timeString}</div>
                    <div class="item-meta" style="color: #059669;">✓ ${message}</div>
                </div>
                <div class="status-badge status-completed">照合済み</div>
            </div>
        `;
        
        // リストの先頭に追加
        const heading = verifiedItemsList.querySelector('h3');
        if (heading && heading.nextSibling) {
            verifiedItemsList.insertBefore(itemCard, heading.nextSibling);
        } else {
            verifiedItemsList.appendChild(itemCard);
        }
    }

    /**
     * 在庫照合処理（簡易版）
     */
    async verifyInventory(qrData) {
        try {
            // 実際の実装では、QRデータを解析して在庫システムと照合
            console.log('Verifying inventory for:', qrData);
            
            // 模擬的な照合処理
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // QRデータの形式チェック（例：LOT番号形式）
            if (qrData.match(/^LOT-\d{4}-\d{3}$/)) {
                return { success: true, message: '在庫確認完了' };
            } else {
                return { success: false, message: 'QRコード形式が不正です' };
            }
            
        } catch (error) {
            console.error('Inventory verification failed:', error);
            return { success: false, message: '照合処理でエラーが発生しました' };
        }
    }

    /**
     * QRエラーの処理
     */
    handleQRError(message, error) {
        console.error('QR Error:', message, error);
        
        const errorOverlay = document.getElementById('qr-error-overlay');
        const errorMessage = document.getElementById('qr-error-message');
        
        if (errorOverlay && errorMessage) {
            errorMessage.textContent = message;
            errorOverlay.classList.remove('hidden');
            
            // 3秒後に自動非表示
            setTimeout(() => {
                errorOverlay.classList.add('hidden');
            }, 3000);
        }
        
        this.showError(message);
    }

    /**
     * QRステータス更新
     */
    updateQRStatus(status) {
        const statusElement = document.getElementById('qr-scan-status');
        if (statusElement) {
            statusElement.textContent = status;
        }
        
        // 統計情報の更新
        this.updateQRStats();
        
        // デバッグ情報の更新
        if (this.qrScanner) {
            const scannerStatus = this.qrScanner.getStatus();
            const debugElements = {
                'debug-ready': scannerStatus.videoReady,
                'debug-stream': scannerStatus.isScanning ? 'Active' : 'Inactive',
                'debug-detection': scannerStatus.isCalibrating ? 'Calibrating' : 'Ready',
                'debug-frames': scannerStatus.frameCount,
                'debug-calibration': `${scannerStatus.calibrationAttempts}/${this.qrScanner.maxCalibrationAttempts}`,
                'debug-cameras': scannerStatus.cameraCount
            };
            
            Object.entries(debugElements).forEach(([id, value]) => {
                const element = document.getElementById(id);
                if (element) element.textContent = value;
            });
        }
    }

    /**
     * QR統計情報の更新
     */
    updateQRStats() {
        if (!this.qrScanner) return;
        
        const status = this.qrScanner.getStatus();
        
        // フレーム数
        const framesElement = document.getElementById('stats-frames');
        if (framesElement) {
            framesElement.textContent = status.frameCount.toLocaleString();
        }
        
        // キャリブレーション回数
        const calibrationElement = document.getElementById('stats-calibration');
        if (calibrationElement) {
            calibrationElement.textContent = `${status.calibrationAttempts}/3`;
            calibrationElement.style.color = status.calibrationAttempts >= 3 ? '#dc2626' : '#1f2937';
        }
        
        // ステータス
        const statusElement = document.getElementById('stats-status');
        if (statusElement) {
            let statusText = '待機中';
            let statusColor = '#6b7280';
            
            if (status.isCalibrating) {
                statusText = 'キャリブレーション';
                statusColor = '#f59e0b';
            } else if (status.isScanning) {
                statusText = 'スキャン中';
                statusColor = '#10b981';
            }
            
            statusElement.textContent = statusText;
            statusElement.style.color = statusColor;
        }
    }

    /**
     * カメラ情報の更新
     */
    updateCameraInfo() {
        if (!this.qrScanner) return;
        
        const status = this.qrScanner.getStatus();
        const cameraInfoElement = document.getElementById('camera-count');
        
        if (cameraInfoElement) {
            if (status.cameraCount > 0) {
                cameraInfoElement.innerHTML = `📷 カメラ検出: <strong>${status.cameraCount}台</strong> 利用可能`;
                cameraInfoElement.style.color = '#059669';
            } else {
                cameraInfoElement.textContent = '📷 カメラを検出しています...';
                cameraInfoElement.style.color = '#6b7280';
            }
        }
    }

    /**
     * ローディング状態の表示
     */
    showLoadingState() {
        const loadingDiv = document.getElementById('loadingOverlay');
        if (loadingDiv) {
            loadingDiv.style.display = 'flex';
        }
    }

    /**
     * ローディング状態の非表示
     */
    hideLoadingState() {
        const loadingDiv = document.getElementById('loadingOverlay');
        if (loadingDiv) {
            loadingDiv.style.display = 'none';
        }
    }

    /**
     * 品目詳細表示（プレースホルダー）
     */
    viewItemDetail(itemId) {
        console.log('View item detail:', itemId);
        // TODO: 品目詳細画面の実装
    }

    /**
     * 出荷指示一覧画面に戻る
     */
    goBackToShipping() {
        this.goToShipping();
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
            this.currentScreen = screenId; // 現在のスクリーンを更新
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
     * 照合済み品目かどうかを判定
     */
    isItemVerified(item) {
        return item.picked_quantity && item.picked_quantity > 0;
    }

    /**
     * 在庫照合画面かどうかを判定
     */
    isVerificationScreen() {
        return this.currentScreen === 'verification-screen';
    }

    /**
     * DOM準備完了を待機
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
        const mapButton = document.querySelector('button[onclick*="goToMap"]');
        if (mapButton) {
            mapButton.addEventListener('click', () => {
                this.initializeMapIfNeeded();
            });
        }
    }

    /**
     * QRスキャナーの遅延初期化を設定
     */
    setupLazyQRInitialization() {
        const qrButton = document.querySelector('button[onclick*="goToQRScan"]');
        if (qrButton) {
            qrButton.addEventListener('click', () => {
                this.initializeQRScannerIfNeeded();
            });
        }
    }

    /**
     * 地図機能を必要に応じて初期化
     */
    async initializeMapIfNeeded() {
        if (!this.modules.deliveryMap) {
            try {
                this.deliveryMap = new DeliveryMap();
                this.modules.deliveryMap = true;
                
                // グローバルアクセス用（互換性のため）
                window.deliveryMap = this.deliveryMap;
                
                console.log('DeliveryMap initialized');
                
                // 初期化後に地図を表示
                setTimeout(() => {
                    if (this.deliveryMap && this.deliveryMap.initializeMap) {
                        this.deliveryMap.initializeMap();
                    }
                }, 100);
                
            } catch (error) {
                console.error('DeliveryMap initialization failed:', error);
                this.logError(error);
            }
        }
    }

    /**
     * QRスキャナーを必要に応じて初期化
     */
    initializeQRScannerIfNeeded() {
        if (!this.modules.qrScanner) {
            try {
                this.qrScanner = new QRScanner();
                this.modules.qrScanner = true;
                
                // グローバルアクセス用（互換性のため）
                window.qrScanner = this.qrScanner;
                
                console.log('QRScanner initialized');
            } catch (error) {
                console.error('QRScanner initialization failed:', error);
                this.logError(error);
            }
        }
    }

    /**
     * グローバルイベントリスナーを設定
     */
    setupGlobalEventListeners() {
        // エラーハンドリング
        window.addEventListener('error', (event) => {
            this.logError(event.error);
        });

        // 未処理のPromise拒否をキャッチ
        window.addEventListener('unhandledrejection', (event) => {
            this.logError(event.reason);
        });

        // ネットワーク状態監視
        window.addEventListener('online', () => {
            console.log('Network connection restored');
        });

        window.addEventListener('offline', () => {
            console.log('Network connection lost');
        });

        // パフォーマンス監視
        if ('PerformanceObserver' in window) {
            try {
                const observer = new PerformanceObserver((list) => {
                    list.getEntries().forEach((entry) => {
                        if (entry.duration > 100) { // 100ms以上の処理を記録
                            console.warn(`Long task detected: ${entry.name} (${entry.duration}ms)`);
                        }
                    });
                });
                observer.observe({ entryTypes: ['longtask'] });
            } catch (error) {
                console.warn('PerformanceObserver not available:', error);
            }
        }
    }

    /**
     * タブ機能を初期化
     */
    initializeTabs() {
        const navButtons = document.querySelectorAll('.nav-btn');
        const screens = document.querySelectorAll('.screen');

        navButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const targetScreen = e.target.getAttribute('data-screen');
                
                if (targetScreen) {
                    // アクティブクラスを更新
                    navButtons.forEach(btn => btn.classList.remove('active'));
                    screens.forEach(screen => screen.classList.remove('active'));
                    
                    e.target.classList.add('active');
                    const screen = document.getElementById(targetScreen);
                    if (screen) {
                        screen.classList.add('active');
                    }
                }
            });
        });
    }

    /**
     * パフォーマンス監視
     */
    monitorPerformance() {
        // メモリ使用量監視（可能な場合）
        if (performance.memory) {
            setInterval(() => {
                const memory = performance.memory;
                if (memory.usedJSHeapSize > memory.jsHeapSizeLimit * 0.9) {
                    console.warn('High memory usage detected');
                }
            }, 30000); // 30秒ごと
        }
    }

    /**
     * エラーログ出力
     */
    logError(error) {
        const errorInfo = {
            message: error.message || error.toString(),
            stack: error.stack,
            timestamp: new Date().toISOString(),
            url: window.location.href,
            userAgent: navigator.userAgent
        };
        
        console.error('Application Error:', errorInfo);
        
        // 必要に応じてサーバーに送信
        if (this.isInitialized && navigator.onLine) {
            try {
                fetch('/api/log-error', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(errorInfo)
                }).catch(e => console.error('Failed to log error to server:', e));
            } catch (e) {
                // サーバーログ送信に失敗した場合は無視
            }
        }
    }

    /**
     * エラー表示
     */
    showError(message) {
        // TODO: より良いエラー表示UIを実装
        alert(message);
    }

    /**
     * デバウンス機能
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
     * 日付フォーマットのヘルパーメソッド
     */
    formatDate(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * アプリケーションを破棄
     */
    destroy() {
        // QRスキャナーを破棄
        if (this.qrScanner) {
            this.qrScanner.stopScan();
            this.qrScanner = null;
        }
        
        // モジュールを破棄
        if (this.deliveryMap && this.deliveryMap.destroy) {
            this.deliveryMap.destroy();
        }
        if (this.inventoryManager && this.inventoryManager.destroy) {
            this.inventoryManager.destroy();
        }
        
        this.isInitialized = false;
    }
}

// グローバルインスタンス
const app = new ShippingApp();

// アプリケーション初期化
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});

// グローバルアクセス用
window.app = app;

// 安全なグローバル関数（初期化チェック付き）
window.searchShipments = async () => {
    try {
        if (!window.app || !window.app.isInitialized) {
            console.log('App is still initializing, please wait...');
            return;
        }
        await window.app.searchShipments();
    } catch (error) {
        console.error('Search error:', error);
        alert('検索中にエラーが発生しました。');
    }
};

window.goToDeliveryDetail = (locationCode) => {
    if (!window.app || !window.app.isInitialized) {
        console.log('App is still initializing, please wait...');
        return;
    }
    window.app.goToDeliveryDetail(locationCode);
};

window.goToShipping = (itemId) => {
    if (!window.app || !window.app.isInitialized) {
        console.log('App is still initializing, please wait...');
        return;
    }
    
    if (itemId) {
        // QR検品画面に遷移
        window.location.href = `/shipping-inspection-mockup.html?itemId=${itemId}`;
    } else {
        // 出荷指示一覧画面に遷移
        window.app.goToShipping();
    }
};

window.goBackToShipping = () => {
    if (!window.app || !window.app.isInitialized) {
        console.log('App is still initializing, please wait...');
        return;
    }
    window.app.goBackToShipping();
};

window.goToPicking = (itemCode, itemName, customerOrderNumber, quantity, deliveryLocation, shippingDate) => {
    if (!window.app || !window.app.isInitialized) {
        console.log('App is still initializing, please wait...');
        return;
    }
    window.app.goToPicking(itemCode, itemName, customerOrderNumber, quantity, deliveryLocation, shippingDate);
};

window.goBackToDeliveryDetail = () => {
    if (!window.app || !window.app.isInitialized) {
        console.log('App is still initializing, please wait...');
        return;
    }
    window.app.goBackToDeliveryDetail();
};

window.savePicking = () => {
    if (!window.app || !window.app.isInitialized) {
        console.log('App is still initializing, please wait...');
        return;
    }
    window.app.savePicking();
};

window.goToQRVerification = () => {
    if (!window.app || !window.app.isInitialized) {
        console.log('App is still initializing, please wait...');
        return;
    }
    // TODO: QR照合画面への遷移実装
    console.log('QR verification not implemented yet');
};

window.goToVerification = () => {
    if (!window.app || !window.app.isInitialized) {
        console.log('App is still initializing, please wait...');
        return;
    }
    window.app.goToVerification();
};

export default app;