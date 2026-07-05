/**
 * 配送地図管理モジュール
 * Leafletを使用した地図機能とマーカー管理
 */

export class DeliveryMap {
    constructor() {
        this.map = null;
        this.markers = [];
        this.selectedLocation = null;
        this.selectedMarker = null;
        this.isInitialized = false;
        
        // 営業所データ
        this.branchLocations = [
            {
                name: "東京営業所",
                code: "TKY001",
                address: "東京都港区赤坂1-1-1",
                phone: "03-1234-5678",
                type: "main_office",
                capacity: 1000,
                coordinates: [35.6762, 139.7380]
            },
            {
                name: "相模営業所",
                code: "SGM001",
                address: "神奈川県相模原市中央区相模原1-1-1",
                phone: "042-123-4567",
                type: "branch",
                capacity: 500,
                coordinates: [35.5756, 139.3697]
            },
            {
                name: "大阪営業所",
                code: "OSK001",
                address: "大阪府大阪市北区梅田1-1-1",
                phone: "06-1234-5678",
                type: "branch",
                capacity: 800,
                coordinates: [34.7024, 135.4960]
            },
            {
                name: "名古屋営業所",
                code: "NGY001",
                address: "愛知県名古屋市中村区名駅1-1-1",
                phone: "052-123-4567",
                type: "branch",
                capacity: 600,
                coordinates: [35.1709, 136.8816]
            },
            {
                name: "福岡営業所",
                code: "FUK001",
                address: "福岡県福岡市博多区博多駅前1-1-1",
                phone: "092-123-4567",
                type: "branch",
                capacity: 400,
                coordinates: [33.5904, 130.4017]
            }
        ];
    }

    /**
     * 地図を初期化
     */
    async init() {
        try {
            await this.waitForLeaflet();
            console.log('DeliveryMap initialized');
        } catch (error) {
            console.error('DeliveryMap initialization failed:', error);
            throw error;
        }
    }

    /**
     * Leafletライブラリの読み込みを待機
     */
    async waitForLeaflet() {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const maxAttempts = 100;
            
            const checkLeaflet = () => {
                attempts++;
                
                if (typeof L !== 'undefined') {
                    this.initializeMap();
                    resolve();
                } else if (attempts >= maxAttempts) {
                    reject(new Error('Leaflet library failed to load'));
                } else {
                    setTimeout(checkLeaflet, 100);
                }
            };
            
            checkLeaflet();
        });
    }

    /**
     * Leaflet地図を初期化
     */
    initializeMap() {
        try {
            const loadingOverlay = document.getElementById('mapLoadingOverlay');
            const mapInfo = document.getElementById('mapInfo');
            
            if (loadingOverlay) loadingOverlay.style.display = 'flex';
            if (mapInfo) mapInfo.textContent = '地図を初期化中...';

            // 日本中心の地図を作成
            this.map = L.map('map', {
                center: [36.2048, 138.2529],
                zoom: 6,
                zoomControl: true,
                scrollWheelZoom: true,
                doubleClickZoom: true,
                boxZoom: true,
                keyboard: true
            });

            // OpenStreetMapタイルレイヤーを追加
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 18,
                minZoom: 3
            }).addTo(this.map);

            // 地図が完全に読み込まれた後にマーカーを配置
            this.map.whenReady(() => {
                this.loadBranchMarkers();
                if (loadingOverlay) loadingOverlay.style.display = 'none';
                if (mapInfo) mapInfo.textContent = 'クリックで配送先を選択';
                console.log('Map initialized successfully');
            });

            this.isInitialized = true;
        } catch (error) {
            console.error('Map initialization error:', error);
            this.handleMapError('地図の初期化に失敗しました: ' + error.message);
        }
    }

    /**
     * 地図エラーを処理
     */
    handleMapError(message) {
        const mapElement = document.getElementById('map');
        if (mapElement) {
            mapElement.innerHTML = `<div class="map-error">${message}<br>ページを更新してください</div>`;
        }
        
        const loadingOverlay = document.getElementById('mapLoadingOverlay');
        const mapInfo = document.getElementById('mapInfo');
        
        if (loadingOverlay) loadingOverlay.style.display = 'none';
        if (mapInfo) mapInfo.textContent = 'エラーが発生しました';
    }

    /**
     * 営業所マーカーを読み込み
     */
    loadBranchMarkers() {
        this.branchLocations.forEach(location => {
            const [lat, lng] = location.coordinates;
            
            // カスタムアイコンを作成
            const iconClass = location.type === 'main_office' ? 'main-office' : 'branch';
            const iconSize = location.type === 'main_office' ? [24, 24] : [20, 20];
            
            const customIcon = L.divIcon({
                className: `custom-marker-icon ${iconClass}`,
                iconSize: iconSize,
                iconAnchor: [iconSize[0]/2, iconSize[1]/2]
            });

            const marker = L.marker([lat, lng], { icon: customIcon }).addTo(this.map);
            
            // ポップアップ内容を作成
            const popupContent = this.createPopupContent(location);
            marker.bindPopup(popupContent);

            // マーカークリックイベント
            marker.on('click', () => {
                this.selectLocation(location, marker);
            });

            // マーカーをリストに追加
            this.markers.push({
                marker: marker,
                location: location
            });
        });

        console.log('Loaded', this.markers.length, 'markers');
    }

    /**
     * ポップアップ内容を作成
     */
    createPopupContent(location) {
        const typeText = location.type === 'main_office' ? '本社' : '支社';
        
        return `
            <div>
                <h3 class="popup-title">${location.name}</h3>
                <div class="popup-info"><strong>種別:</strong> ${typeText}</div>
                <div class="popup-info"><strong>住所:</strong> ${location.address}</div>
                <div class="popup-info"><strong>電話:</strong> ${location.phone}</div>
                <div class="popup-info"><strong>処理能力:</strong> ${location.capacity}件/日</div>
                <div class="popup-buttons">
                    <button class="popup-button select" onclick="window.deliveryMap.selectFromPopup('${location.code}')">
                        この場所を選択
                    </button>
                    <button class="popup-button" onclick="window.deliveryMap.map.closePopup()">
                        閉じる
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * ポップアップから場所を選択
     */
    selectFromPopup(locationCode) {
        const locationData = this.branchLocations.find(loc => loc.code === locationCode);
        const markerData = this.markers.find(item => item.location.code === locationCode);
        
        if (locationData && markerData) {
            this.selectLocation(locationData, markerData.marker);
            this.map.closePopup();
        }
    }

    /**
     * 場所を選択
     */
    selectLocation(location, marker) {
        console.log('Location selected:', location.name);
        
        // 前回選択をクリア
        this.clearLocationSelection();
        
        // 新しい選択を設定
        this.selectedLocation = location;
        this.selectedMarker = marker;
        
        // マーカーをハイライト
        const iconClass = location.type === 'main_office' ? 'main-office selected' : 'branch selected';
        const iconSize = location.type === 'main_office' ? [30, 30] : [26, 26];
        
        const selectedIcon = L.divIcon({
            className: `custom-marker-icon ${iconClass}`,
            iconSize: iconSize,
            iconAnchor: [iconSize[0]/2, iconSize[1]/2]
        });
        
        marker.setIcon(selectedIcon);
        
        // 地図を中央に移動・ズーム
        this.map.setView([location.coordinates[0], location.coordinates[1]], 10);
        
        // 選択情報表示
        this.showSelectedLocationInfo(location);
        
        // 配送先情報も更新
        this.updateDeliveryInfo(location);
    }

    /**
     * 選択された場所の情報を表示
     */
    showSelectedLocationInfo(location) {
        const infoDiv = document.getElementById('selectedLocationInfo');
        const titleElement = document.getElementById('selectedLocationTitle');
        const detailsElement = document.getElementById('selectedLocationDetails');
        
        if (titleElement) {
            titleElement.textContent = '選択中: ' + location.name;
        }
        
        if (detailsElement) {
            detailsElement.innerHTML = `
                <strong>コード:</strong> ${location.code}<br>
                <strong>住所:</strong> ${location.address}<br>
                <strong>電話:</strong> ${location.phone}<br>
                <strong>処理能力:</strong> ${location.capacity}件/日
            `;
        }
        
        if (infoDiv) {
            infoDiv.classList.add('show');
        }
    }

    /**
     * 配送先情報を更新
     */
    updateDeliveryInfo(location) {
        const deliveryNameElement = document.getElementById('delivery-name');
        if (deliveryNameElement) {
            deliveryNameElement.textContent = location.name;
        }
        
        // 配送先情報タブの内容も更新
        const deliveryMetaElements = document.querySelectorAll('.delivery-meta');
        deliveryMetaElements.forEach(element => {
            element.innerHTML = `
                <strong>住所:</strong> ${location.address}<br>
                <strong>電話:</strong> ${location.phone}<br>
                <strong>処理能力:</strong> ${location.capacity}件/日<br>
                <strong>配送方法:</strong> 宅配便
            `;
        });
    }

    /**
     * 場所選択をクリア
     */
    clearLocationSelection() {
        if (this.selectedLocation && this.selectedMarker) {
            // マーカーアイコンを元に戻す
            const iconClass = this.selectedLocation.type === 'main_office' ? 'main-office' : 'branch';
            const iconSize = this.selectedLocation.type === 'main_office' ? [24, 24] : [20, 20];
            
            const originalIcon = L.divIcon({
                className: `custom-marker-icon ${iconClass}`,
                iconSize: iconSize,
                iconAnchor: [iconSize[0]/2, iconSize[1]/2]
            });
            
            this.selectedMarker.setIcon(originalIcon);
        }

        this.selectedLocation = null;
        this.selectedMarker = null;

        // ポップアップを閉じる
        if (this.map) {
            this.map.closePopup();
        }

        // 選択情報非表示
        const selectedLocationInfo = document.getElementById('selectedLocationInfo');
        if (selectedLocationInfo) {
            selectedLocationInfo.classList.remove('show');
        }

        // 地図を日本全体に戻す
        if (this.map) {
            this.map.setView([36.2048, 138.2529], 6);
        }
    }

    /**
     * 地図を再描画
     */
    invalidateSize() {
        if (this.map) {
            setTimeout(() => {
                this.map.invalidateSize();
            }, 100);
        }
    }

    /**
     * リソースをクリーンアップ
     */
    destroy() {
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
        this.markers = [];
        this.selectedLocation = null;
        this.selectedMarker = null;
        this.isInitialized = false;
    }
}

// グローバルアクセス用（後で削除予定）
window.DeliveryMap = DeliveryMap;