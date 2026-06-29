/**
 * 在庫管理モジュール
 * 出荷指示、ピッキング、照合機能を統合管理
 */

export class InventoryManager {
    constructor() {
        this.currentDeliveryLocation = '';
        this.currentPage = 'shipping';
        this.shippingInstructions = [];
        this.pickedItems = [];
        this.verifiedItems = [];
        
        // 模擬データ
        this.mockData = {
            deliveryLocations: {
                'TOKYO': {
                    name: '東京営業所',
                    code: 'TOKYO',
                    address: '東京都港区赤坂1-1-1',
                    phone: '03-1234-5678',
                    items: [
                        { id: 'A-001', name: '特殊部品', quantity: 100, picked: 0, verified: 0 },
                        { id: 'B-002', name: '標準部品', quantity: 50, picked: 0, verified: 0 }
                    ]
                },
                'OSAKA': {
                    name: '大阪営業所',
                    code: 'OSAKA',
                    address: '大阪府大阪市北区梅田1-1-1',
                    phone: '06-1234-5678',
                    items: [
                        { id: 'C-003', name: '消耗品', quantity: 200, picked: 0, verified: 0 }
                    ]
                },
                'NAGOYA': {
                    name: '名古屋営業所',
                    code: 'NAGOYA',
                    address: '愛知県名古屋市中村区名駅1-1-1',
                    phone: '052-123-4567',
                    items: [
                        { id: 'D-004', name: 'オプション部品', quantity: 75, picked: 0, verified: 0 }
                    ]
                }
            },
            
            expectedItems: [
                { lotNumber: 'LOT-2024-001', itemCode: 'A-001', name: '特殊部品', location: 'A-01' },
                { lotNumber: 'LOT-2024-002', itemCode: 'A-001', name: '特殊部品マニュアル', location: 'A-02' },
                { lotNumber: 'LOT-2024-003', itemCode: 'B-002', name: '標準部品', location: 'B-01' },
                { lotNumber: 'LOT-2024-004', itemCode: 'C-003', name: '消耗品', location: 'C-01' },
                { lotNumber: 'LOT-2024-005', itemCode: 'D-004', name: 'オプション部品', location: 'D-01' }
            ]
        };
        
        this.initEventListeners();
    }

    /**
     * イベントリスナーを初期化
     */
    initEventListeners() {
        // PWA対応の初期化
        this.initializePWA();
        
        // レスポンシブ対応
        this.initializeResponsive();
    }

    /**
     * PWA機能を初期化
     */
    initializePWA() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/service-worker.js')
                .then(registration => console.log('SW registered:', registration))
                .catch(error => console.log('SW registration failed:', error));
        }
        
        // オフライン対応
        window.addEventListener('online', () => {
            console.log('オンラインに復帰しました');
            this.syncOfflineData();
        });
        
        window.addEventListener('offline', () => {
            console.log('オフラインモードに切り替わりました');
        });
    }

    /**
     * レスポンシブ対応を初期化
     */
    initializeResponsive() {
        // タッチデバイス対応
        if ('ontouchstart' in window) {
            document.body.classList.add('touch-device');
        }
        
        // 現在の日付をデフォルト値に設定
        const today = new Date().toISOString().split('T')[0];
        const scheduledDateInput = document.getElementById('scheduled-date');
        if (scheduledDateInput) {
            scheduledDateInput.value = today;
        }
    }

    /**
     * 画面を表示
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
            targetScreen.classList.add('fade-in');
        }
        
        this.currentPage = screenId.replace('-screen', '');
    }

    /**
     * 出荷指示画面に移動
     */
    goToShipping() {
        this.showScreen('shipping-screen');
    }

    /**
     * 納入場所詳細画面に移動
     */
    goToDeliveryDetail(locationCode = '') {
        if (locationCode) {
            this.currentDeliveryLocation = locationCode;
        }
        
        // 納入場所名を設定
        this.updateDeliveryLocationName();
        
        this.showScreen('delivery-detail-screen');
    }

    /**
     * ピッキング画面に移動
     */
    goToPicking(itemCode = '') {
        this.showScreen('picking-screen');
    }

    /**
     * 照合画面に移動
     */
    goToVerification() {
        this.showScreen('verification-screen');
    }

    /**
     * 納入場所名を更新
     */
    updateDeliveryLocationName() {
        const locationData = this.mockData.deliveryLocations[this.currentDeliveryLocation];
        const deliveryNameElement = document.getElementById('delivery-name');
        
        if (deliveryNameElement && locationData) {
            deliveryNameElement.textContent = locationData.name;
        }
    }

    /**
     * 出荷指示を検索
     */
    searchShipments() {
        console.log('SyteLine IDOから出荷指示データを検索中...');
        
        // ローディング表示
        const deliveryLocations = document.getElementById('delivery-locations');
        if (deliveryLocations) {
            deliveryLocations.innerHTML = '<div style="text-align: center; padding: 2rem;">🔍 検索中...</div>';
        }
        
        // 検索結果を模擬的に表示
        setTimeout(() => {
            this.displaySearchResults();
        }, 1500);
    }

    /**
     * 検索結果を表示
     */
    displaySearchResults() {
        const deliveryLocations = document.getElementById('delivery-locations');
        if (!deliveryLocations) return;
        
        let html = '';
        
        Object.values(this.mockData.deliveryLocations).forEach(location => {
            const totalItems = location.items.length;
            const totalQuantity = location.items.reduce((sum, item) => sum + item.quantity, 0);
            const completedItems = location.items.filter(item => item.verified > 0).length;
            
            html += `
                <div class="delivery-card fade-in">
                    <div class="delivery-header">
                        <div class="delivery-info">
                            <h3>${location.name}</h3>
                            <div class="delivery-meta">
                                <strong>住所:</strong> ${location.address}<br>
                                <strong>電話:</strong> ${location.phone}
                            </div>
                        </div>
                        <button class="btn btn-info" onclick="window.inventoryManager.goToDeliveryDetail('${location.code}')">
                            📋 詳細表示
                        </button>
                    </div>
                    
                    <div class="item-summary">
                        <div class="summary-item">
                            <div class="summary-value">${totalItems}</div>
                            <div class="summary-label">品目数</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-value">${totalQuantity.toLocaleString()}</div>
                            <div class="summary-label">総数量</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-value">${completedItems}/${totalItems}</div>
                            <div class="summary-label">完了状況</div>
                        </div>
                    </div>
                </div>
            `;
        });
        
        deliveryLocations.innerHTML = html;
    }

    /**
     * ピッキング情報を保存
     */
    savePicking() {
        // SyteLine IDOとの連携をシミュレート
        console.log('ピッキング情報をSyteLine出荷指示IDOに保存中...');
        
        const data = {
            deliveryLocation: this.currentDeliveryLocation,
            pickedItems: this.pickedItems,
            timestamp: new Date().toISOString(),
            operator: 'システムユーザー'
        };
        
        // 実際の実装ではAPIコールを行う
        this.syncToSyteLine('picking', data);
        
        alert('ピッキング情報をSyteLine出荷指示IDOに保存しました。\n\n・ピッキング詳細データの更新\n・在庫数量の引当処理\n・ステータスの更新');
    }

    /**
     * 照合情報を保存
     */
    saveVerification() {
        console.log('照合情報をSyteLine在庫管理IDOに保存中...');
        
        const data = {
            deliveryLocation: this.currentDeliveryLocation,
            verifiedItems: this.verifiedItems,
            timestamp: new Date().toISOString(),
            operator: 'システムユーザー'
        };
        
        // 実際の実装ではAPIコールを行う
        this.syncToSyteLine('verification', data);
        
        alert('照合情報をSyteLine在庫管理IDOに保存しました。\n\n・在庫数量の更新\n・品質チェック記録\n・トレーサビリティ情報の記録');
    }

    /**
     * SyteLineとの同期
     */
    syncToSyteLine(operation, data) {
        console.log(`SyteLine ${operation} sync:`, data);
        
        // 実際の実装では以下のようなAPI呼び出しを行う
        /*
        fetch('/api/syteline/sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + this.getAuthToken()
            },
            body: JSON.stringify({
                operation: operation,
                data: data
            })
        })
        .then(response => response.json())
        .then(result => {
            console.log('SyteLine sync result:', result);
        })
        .catch(error => {
            console.error('SyteLine sync error:', error);
        });
        */
    }

    /**
     * オフラインデータを同期
     */
    syncOfflineData() {
        const offlineData = this.getOfflineData();
        
        if (offlineData.length > 0) {
            console.log('オフラインデータをSyteLineと同期中...', offlineData);
            
            offlineData.forEach(data => {
                this.syncToSyteLine(data.operation, data.payload);
            });
            
            // 同期完了後にオフラインデータをクリア
            this.clearOfflineData();
        }
    }

    /**
     * オフラインデータを取得
     */
    getOfflineData() {
        try {
            const data = localStorage.getItem('offline_inventory_data');
            return data ? JSON.parse(data) : [];
        } catch (error) {
            console.error('Failed to get offline data:', error);
            return [];
        }
    }

    /**
     * オフラインデータを保存
     */
    saveOfflineData(operation, payload) {
        try {
            const existingData = this.getOfflineData();
            existingData.push({
                operation: operation,
                payload: payload,
                timestamp: new Date().toISOString()
            });
            localStorage.setItem('offline_inventory_data', JSON.stringify(existingData));
        } catch (error) {
            console.error('Failed to save offline data:', error);
        }
    }

    /**
     * オフラインデータをクリア
     */
    clearOfflineData() {
        try {
            localStorage.removeItem('offline_inventory_data');
        } catch (error) {
            console.error('Failed to clear offline data:', error);
        }
    }

    /**
     * ピッキング品目を追加
     */
    addPickedItem(itemCode, quantity) {
        const existingIndex = this.pickedItems.findIndex(item => item.itemCode === itemCode);
        
        if (existingIndex >= 0) {
            this.pickedItems[existingIndex].quantity += quantity;
        } else {
            this.pickedItems.push({
                itemCode: itemCode,
                quantity: quantity,
                timestamp: new Date().toISOString()
            });
        }
        
        // オフライン対応
        if (!navigator.onLine) {
            this.saveOfflineData('picking', {
                itemCode: itemCode,
                quantity: quantity,
                deliveryLocation: this.currentDeliveryLocation
            });
        }
    }

    /**
     * 照合品目を追加
     */
    addVerifiedItem(itemCode, lotNumber, result) {
        this.verifiedItems.push({
            itemCode: itemCode,
            lotNumber: lotNumber,
            result: result,
            timestamp: new Date().toISOString()
        });
        
        // オフライン対応
        if (!navigator.onLine) {
            this.saveOfflineData('verification', {
                itemCode: itemCode,
                lotNumber: lotNumber,
                result: result,
                deliveryLocation: this.currentDeliveryLocation
            });
        }
    }

    /**
     * 在庫アイテムを検索
     */
    findInventoryItem(searchValue) {
        return this.mockData.expectedItems.find(item => 
            item.lotNumber === searchValue || 
            item.itemCode === searchValue ||
            searchValue.includes(item.lotNumber) ||
            searchValue.includes(item.itemCode)
        );
    }

    /**
     * 統計データを取得
     */
    getStatistics() {
        const totalItems = Object.values(this.mockData.deliveryLocations)
            .reduce((sum, location) => sum + location.items.length, 0);
        
        const totalQuantity = Object.values(this.mockData.deliveryLocations)
            .reduce((sum, location) => 
                sum + location.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0);
        
        const pickedQuantity = this.pickedItems.reduce((sum, item) => sum + item.quantity, 0);
        const verifiedCount = this.verifiedItems.length;
        
        return {
            totalItems: totalItems,
            totalQuantity: totalQuantity,
            pickedQuantity: pickedQuantity,
            verifiedCount: verifiedCount,
            pickingProgress: totalQuantity > 0 ? (pickedQuantity / totalQuantity * 100) : 0,
            verificationProgress: totalItems > 0 ? (verifiedCount / totalItems * 100) : 0
        };
    }

    /**
     * データをエクスポート
     */
    exportData() {
        const data = {
            deliveryLocation: this.currentDeliveryLocation,
            pickedItems: this.pickedItems,
            verifiedItems: this.verifiedItems,
            statistics: this.getStatistics(),
            exportTime: new Date().toISOString()
        };
        
        const dataStr = JSON.stringify(data, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        
        const exportFileDefaultName = `inventory_export_${new Date().toISOString().split('T')[0]}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
    }

    /**
     * 認証トークンを取得
     */
    getAuthToken() {
        // 実際の実装では適切な認証システムと連携
        return localStorage.getItem('auth_token') || 'mock_token';
    }

    /**
     * リソースをクリーンアップ
     */
    destroy() {
        this.pickedItems = [];
        this.verifiedItems = [];
        this.currentDeliveryLocation = '';
        this.currentPage = 'shipping';
    }
}

// グローバルアクセス用（後で削除予定）
window.InventoryManager = InventoryManager;