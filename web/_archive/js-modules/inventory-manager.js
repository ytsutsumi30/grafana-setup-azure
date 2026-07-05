/**
 * インベントリマネージャーモジュール
 * 在庫管理機能
 */

export class InventoryManager {
    constructor() {
        this.inventory = [];
        console.log('InventoryManager module loaded');
    }

    destroy() {
        this.inventory = [];
    }
}