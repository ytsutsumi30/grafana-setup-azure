/**
 * 配送マップモジュール
 * Leaflet.jsを使用した地図機能
 */

export class DeliveryMap {
    constructor() {
        this.map = null;
        this.markers = [];
        console.log('DeliveryMap module loaded');
    }

    initializeMap() {
        console.log('DeliveryMap: initializeMap called');
        // 地図の初期化処理（必要に応じて実装）
    }

    destroy() {
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
        this.markers = [];
    }
}