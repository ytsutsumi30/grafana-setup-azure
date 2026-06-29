/**
 * QRスキャナーモジュール
 * QRコード読み取り機能
 */

export class QRScanner {
    constructor() {
        this.scanner = null;
        console.log('QRScanner module loaded');
    }

    destroy() {
        if (this.scanner) {
            this.scanner.destroy();
            this.scanner = null;
        }
    }
}