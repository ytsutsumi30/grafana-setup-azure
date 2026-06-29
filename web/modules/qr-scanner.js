/**
 * QRスキャナーモジュール (Safari最適化版)
 * 在庫照合機能付きQRコードスキャナー
 */

export class QRScanner {
    constructor() {
        this.video = null;
        this.stream = null;
        this.isScanning = false;
        this.qrScanner = null;
        this.currentCamera = 'environment';
        this.cameras = [];
        this.calibrationAttempts = 0;
        this.maxCalibrationAttempts = 3;
        this.frameCount = 0;
        this.lastDetectionAttempt = 0;
        this.isCalibrating = false;
        this.debugMode = false;
        this.scanTimeout = null;
        
        this.initElements();
        this.initEventListeners();
        this.initPageLifecycleHandling();
        this.detectCameras();
    }

    /**
     * DOM要素を初期化
     */
    initElements() {
        this.initialScreen = document.getElementById('qr-initial-screen');
        this.cameraScreen = document.getElementById('qr-camera-screen');
        this.video = document.getElementById('qr-camera-video');
        this.resultDisplay = document.getElementById('qr-result-display');
        this.scanStatus = document.getElementById('qr-scan-status');
        this.resultData = document.getElementById('qr-result-data');
        this.verificationStatus = document.getElementById('verification-status');
        this.scanningAnimation = document.getElementById('qr-scanning-animation');
        this.calibrationIndicator = document.getElementById('qr-calibration-indicator');
        this.successOverlay = document.getElementById('qr-success-overlay');
        this.errorOverlay = document.getElementById('qr-error-overlay');
        this.errorMessage = document.getElementById('qr-error-message');
        this.debugInfo = document.getElementById('qr-debug-info');
        
        // デバッグ要素
        this.debugElements = {
            status: document.getElementById('debug-status'),
            stream: document.getElementById('debug-stream'),
            detection: document.getElementById('debug-detection'),
            frames: document.getElementById('debug-frames')
        };
        
        // 設定要素
        this.autoVerifyInventory = document.getElementById('auto-verify-inventory');
        this.enableDebugMode = document.getElementById('enable-debug-mode');
        this.scanTimeoutSelect = document.getElementById('scan-timeout');
    }

    /**
     * イベントリスナーを初期化
     */
    initEventListeners() {
        const startBtn = document.getElementById('start-qr-scan');
        const stopBtn = document.getElementById('stop-qr-scan');
        const calibrateBtn = document.getElementById('calibrate-qr-camera');
        const debugBtn = document.getElementById('toggle-qr-debug');
        const clearBtn = document.getElementById('clear-qr-result');
        const manualBtn = document.getElementById('manual-lot-input');

        if (startBtn) startBtn.addEventListener('click', () => this.startScan());
        if (stopBtn) stopBtn.addEventListener('click', () => this.stopScan());
        if (calibrateBtn) calibrateBtn.addEventListener('click', () => this.calibrateCamera());
        if (debugBtn) debugBtn.addEventListener('click', () => this.toggleDebug());
        if (clearBtn) clearBtn.addEventListener('click', () => this.clearResult());
        if (manualBtn) manualBtn.addEventListener('click', () => this.showManualInput());

        // 設定変更イベント
        if (this.enableDebugMode) {
            this.enableDebugMode.addEventListener('change', (e) => {
                this.debugMode = e.target.checked;
                if (this.debugInfo) {
                    this.debugInfo.classList.toggle('hidden', !this.debugMode);
                }
            });
        }
    }

    /**
     * ページライフサイクルイベントを処理 (Safari最適化)
     */
    initPageLifecycleHandling() {
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.pauseScanning();
            } else {
                this.resumeScanning();
            }
        });

        window.addEventListener('beforeunload', () => {
            this.cleanupResources();
        });

        window.addEventListener('pagehide', () => {
            this.cleanupResources();
        });

        window.addEventListener('pageshow', (event) => {
            if (event.persisted) {
                this.resetScanner();
            }
        });
    }

    /**
     * 利用可能なカメラを検出
     */
    async detectCameras() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.cameras = devices.filter(device => device.kind === 'videoinput');
            this.updateDebug('status', `${this.cameras.length} cameras found`);
        } catch (error) {
            console.warn('カメラ検出エラー:', error);
            this.updateDebug('status', 'Camera detection failed');
        }
    }

    /**
     * 画面を切り替え
     */
    showScreen(screenName) {
        if (this.initialScreen) this.initialScreen.classList.add('hidden');
        if (this.cameraScreen) this.cameraScreen.classList.add('hidden');
        
        if (screenName === 'initial' && this.initialScreen) {
            this.initialScreen.classList.remove('hidden');
        } else if (screenName === 'camera' && this.cameraScreen) {
            this.cameraScreen.classList.remove('hidden');
        }
    }

    /**
     * ステータスメッセージを更新
     */
    updateStatus(message) {
        if (this.scanStatus) {
            this.scanStatus.textContent = message;
        }
    }

    /**
     * デバッグ情報を更新
     */
    updateDebug(type, value) {
        if (this.debugElements[type]) {
            this.debugElements[type].textContent = value;
        }
    }

    /**
     * デバッグモードを切り替え
     */
    toggleDebug() {
        this.debugMode = !this.debugMode;
        if (this.debugInfo) {
            this.debugInfo.classList.toggle('hidden', !this.debugMode);
        }
        if (this.enableDebugMode) {
            this.enableDebugMode.checked = this.debugMode;
        }
    }

    /**
     * スキャンを開始 (Safari最適化: 段階的初期化)
     */
    async startScan() {
        try {
            this.showScreen('camera');
            this.hideAllOverlays();
            await this.initializeCamera();
            this.setupScanTimeout();
        } catch (error) {
            this.handleError(error);
        }
    }

    /**
     * カメラを初期化
     */
    async initializeCamera() {
        const constraints = {
            video: {
                facingMode: this.currentCamera,
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        };

        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (this.video) {
            this.video.srcObject = this.stream;
            this.updateDebug('stream', 'Connected');

            this.video.setAttribute('playsinline', true);
            this.video.setAttribute('webkit-playsinline', true);
            this.video.muted = true;

            await this.waitForVideoReady();
            
            this.isScanning = true;
            await this.calibrateCamera();
        }
    }

    /**
     * ビデオの準備を待機
     */
    async waitForVideoReady() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Video initialization timeout'));
            }, 10000);

            const checkReady = () => {
                if (this.video && this.video.readyState === 4 && this.video.videoWidth > 0) {
                    clearTimeout(timeout);
                    resolve();
                } else {
                    setTimeout(checkReady, 100);
                }
            };
            checkReady();
        });
    }

    /**
     * カメラを調整
     */
    async calibrateCamera() {
        if (this.isCalibrating || this.calibrationAttempts >= this.maxCalibrationAttempts) {
            return;
        }

        this.isCalibrating = true;
        this.calibrationAttempts++;
        
        if (this.calibrationIndicator) {
            this.calibrationIndicator.classList.remove('hidden');
        }
        this.updateStatus(`カメラ調整中... (${this.calibrationAttempts}/${this.maxCalibrationAttempts})`);

        await new Promise(resolve => setTimeout(resolve, 2000));

        if (this.calibrationIndicator) {
            this.calibrationIndicator.classList.add('hidden');
        }
        this.isCalibrating = false;

        if (this.video && this.video.readyState === 4 && this.video.videoWidth > 0) {
            this.startQRDetection();
        } else {
            setTimeout(() => this.calibrateCamera(), 1000);
        }
    }

    /**
     * QRコード検出を開始
     */
    async startQRDetection() {
        this.updateStatus('在庫QRコードをスキャン中...');
        if (this.scanningAnimation) {
            this.scanningAnimation.classList.remove('hidden');
        }
        this.updateDebug('detection', 'Starting');
        
        if (typeof QrScanner !== 'undefined') {
            try {
                this.qrScanner = new QrScanner(
                    this.video,
                    result => this.handleQRResult(result.data),
                    {
                        returnDetailedScanResult: true,
                        highlightScanRegion: true,
                        highlightCodeOutline: true,
                        preferredCamera: this.currentCamera
                    }
                );

                await this.qrScanner.start();
                this.startFrameCounter();
                        
            } catch (error) {
                console.error('QrScanner error:', error);
                this.fallbackToManualDetection();
            }
        } else {
            this.fallbackToManualDetection();
        }
    }

    /**
     * スキャン領域を計算
     */
    calculateScanRegion(video) {
        const { videoWidth, videoHeight } = video;
        const size = Math.min(videoWidth, videoHeight) * 0.6;
        const x = (videoWidth - size) / 2;
        const y = (videoHeight - size) / 2;
        
        return {
            x: Math.round(x),
            y: Math.round(y),
            width: Math.round(size),
            height: Math.round(size)
        };
    }

    /**
     * フレームカウンターを開始
     */
    startFrameCounter() {
        const countFrames = () => {
            if (this.isScanning) {
                this.frameCount++;
                this.updateDebug('frames', this.frameCount);
                setTimeout(countFrames, 100);
            }
        };
        countFrames();
    }

    /**
     * 手動検出にフォールバック
     */
    fallbackToManualDetection() {
        if ('BarcodeDetector' in window) {
            const detector = new BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39'] });
            
            const detectQR = async () => {
                if (!this.isScanning || !this.video) return;
                
                try {
                    const barcodes = await detector.detect(this.video);
                    if (barcodes.length > 0) {
                        this.handleQRResult(barcodes[0].rawValue);
                    } else {
                        setTimeout(detectQR, 500);
                    }
                } catch (error) {
                    console.error('Barcode detection error:', error);
                    setTimeout(detectQR, 1000);
                }
            };
            
            detectQR();
            this.updateDebug('detection', 'Manual fallback active');
        } else {
            this.handleError(new Error('QRコード検出機能がサポートされていません'));
        }
    }

    /**
     * QRコード結果を処理
     */
    handleQRResult(data) {
        if (!this.isScanning) return;
        
        this.updateDebug('detection', 'QR detected!');
        this.showSuccessOverlay();
        
        setTimeout(() => {
            this.stopScan();
            this.processInventoryData(data);
        }, 1500);
    }

    /**
     * 在庫データを処理
     */
    processInventoryData(data) {
        console.log('処理中のデータ:', data);
        
        if (this.resultData) {
            this.resultData.textContent = data;
        }
        if (this.resultDisplay) {
            this.resultDisplay.classList.add('show');
        }
        
        if (this.autoVerifyInventory && this.autoVerifyInventory.checked) {
            this.verifyWithInventory(data);
        } else {
            if (this.verificationStatus) {
                this.verificationStatus.textContent = '手動確認待ち';
                this.verificationStatus.style.color = '#f59e0b';
            }
        }
        
        this.addToVerifiedList(data);
    }

    /**
     * 在庫と照合
     */
    verifyWithInventory(scannedData) {
        // 期待される在庫アイテム（実際はAPIから取得）
        const expectedItems = [
            { lotNumber: 'LOT-2024-001', itemCode: 'A-001', name: '特殊部品', location: 'A-01' },
            { lotNumber: 'LOT-2024-002', itemCode: 'A-001', name: '特殊部品マニュアル', location: 'A-02' },
            { lotNumber: 'LOT-2024-003', itemCode: 'B-002', name: '標準部品', location: 'B-01' },
            { lotNumber: 'LOT-2024-004', itemCode: 'C-003', name: '消耗品', location: 'C-01' }
        ];

        const matchedItem = expectedItems.find(item => 
            scannedData.includes(item.lotNumber) || 
            scannedData.includes(item.itemCode)
        );
        
        if (matchedItem) {
            if (this.verificationStatus) {
                this.verificationStatus.textContent = `✅ 照合成功: ${matchedItem.name}`;
                this.verificationStatus.style.color = '#16a34a';
            }
            
            // SyteLine IDOとの連携をシミュレート
            this.updateSyteLineInventory(matchedItem, scannedData);
        } else {
            if (this.verificationStatus) {
                this.verificationStatus.textContent = '❌ 照合失敗: 該当する在庫が見つかりません';
                this.verificationStatus.style.color = '#dc2626';
            }
        }
    }

    /**
     * SyteLine在庫を更新
     */
    updateSyteLineInventory(item, scannedData) {
        console.log('SyteLine IDO更新:', {
            item: item,
            scannedData: scannedData,
            timestamp: new Date().toISOString()
        });
        
        // 実際の実装では、ここでSyteLine IDOのAPIを呼び出す
        setTimeout(() => {
            alert(`在庫照合完了!\n\n品目: ${item.name}\nロット: ${item.lotNumber}\n保管場所: ${item.location}\n\n✅ SyteLine在庫管理システムに記録されました。`);
        }, 500);
    }

    /**
     * 照合済みリストに追加
     */
    addToVerifiedList(data) {
        const verifiedItemsContainer = document.getElementById('verified-items');
        if (verifiedItemsContainer) {
            const timestamp = new Date().toLocaleTimeString('ja-JP');
            const newItem = document.createElement('div');
            newItem.className = 'item-card fade-in';
            newItem.innerHTML = `
                <div class="item-header">
                    <div class="item-info">
                        <div class="item-title">スキャン済み: ${data}</div>
                        <div class="item-meta">スキャン日時: ${timestamp}</div>
                        <div class="item-meta" id="verification-status">照合中...</div>
                    </div>
                    <div class="status-badge status-completed">照合済み</div>
                </div>
            `;
            
            // 最新のアイテムを先頭に挿入
            const firstChild = verifiedItemsContainer.querySelector('.item-card');
            if (firstChild) {
                verifiedItemsContainer.insertBefore(newItem, firstChild);
            } else {
                verifiedItemsContainer.appendChild(newItem);
            }
        }
    }

    /**
     * 手動入力を処理
     */
    handleManualInput(lotNumber) {
        console.log('手動入力:', lotNumber);
        this.processInventoryData(lotNumber);
    }

    /**
     * 手動入力ダイアログを表示
     */
    showManualInput() {
        const lotNumber = prompt('ロット番号またはアイテムコードを入力してください:');
        if (lotNumber && lotNumber.trim()) {
            this.handleManualInput(lotNumber.trim());
        }
    }

    /**
     * スキャンタイムアウトを設定
     */
    setupScanTimeout() {
        if (this.scanTimeoutSelect) {
            const timeoutSeconds = parseInt(this.scanTimeoutSelect.value) * 1000;
            this.scanTimeout = setTimeout(() => {
                if (this.isScanning) {
                    this.handleError(new Error('スキャンがタイムアウトしました'));
                }
            }, timeoutSeconds);
        }
    }

    /**
     * スキャンタイムアウトをクリア
     */
    clearScanTimeout() {
        if (this.scanTimeout) {
            clearTimeout(this.scanTimeout);
            this.scanTimeout = null;
        }
    }

    /**
     * 成功オーバーレイを表示
     */
    showSuccessOverlay() {
        this.hideAllOverlays();
        if (this.successOverlay) {
            this.successOverlay.classList.remove('hidden');
            setTimeout(() => {
                this.successOverlay.classList.add('hidden');
            }, 2000);
        }
    }

    /**
     * エラーオーバーレイを表示
     */
    showErrorOverlay(message) {
        this.hideAllOverlays();
        if (this.errorMessage) {
            this.errorMessage.textContent = message;
        }
        if (this.errorOverlay) {
            this.errorOverlay.classList.remove('hidden');
            setTimeout(() => {
                this.errorOverlay.classList.add('hidden');
            }, 3000);
        }
    }

    /**
     * すべてのオーバーレイを非表示
     */
    hideAllOverlays() {
        const overlays = [
            this.calibrationIndicator,
            this.successOverlay,
            this.errorOverlay
        ];
        
        overlays.forEach(overlay => {
            if (overlay) {
                overlay.classList.add('hidden');
            }
        });
    }

    /**
     * スキャンを一時停止
     */
    pauseScanning() {
        if (this.qrScanner) {
            this.qrScanner.stop();
        }
        if (this.scanningAnimation) {
            this.scanningAnimation.classList.add('hidden');
        }
        this.updateStatus('一時停止中...');
    }

    /**
     * スキャンを再開
     */
    async resumeScanning() {
        if (this.qrScanner && this.isScanning) {
            try {
                await this.qrScanner.start();
                if (this.scanningAnimation) {
                    this.scanningAnimation.classList.remove('hidden');
                }
                this.updateStatus('在庫QRコードをスキャン中...');
            } catch (error) {
                console.error('Resume scanning error:', error);
                this.handleError(error);
            }
        }
    }

    /**
     * スキャンを停止
     */
    stopScan() {
        this.isScanning = false;
        this.isCalibrating = false;
        if (this.scanningAnimation) {
            this.scanningAnimation.classList.add('hidden');
        }
        this.hideAllOverlays();
        this.clearScanTimeout();
        
        this.cleanupResources();
        this.showScreen('initial');
    }

    /**
     * リソースをクリーンアップ
     */
    cleanupResources() {
        if (this.qrScanner) {
            this.qrScanner.stop();
            this.qrScanner.destroy();
            this.qrScanner = null;
        }
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        
        this.updateDebug('stream', 'Disconnected');
        this.updateDebug('detection', 'Stopped');
    }

    /**
     * エラーを処理
     */
    handleError(error) {
        this.stopScan();
        
        let message = 'カメラにアクセスできませんでした。';
        
        switch (error.name) {
            case 'NotAllowedError':
                message = 'カメラの使用が許可されていません。設定を確認してください。';
                break;
            case 'NotFoundError':
                message = 'カメラが見つかりませんでした。';
                break;
            case 'NotSupportedError':
                message = 'お使いのブラウザではカメラがサポートされていません。';
                break;
            default:
                message = error.message || message;
        }

        this.showErrorOverlay(message);
        console.error('QR Scanner Error:', error);
    }

    /**
     * スキャナーをリセット
     */
    resetScanner() {
        this.stopScan();
        this.calibrationAttempts = 0;
        this.frameCount = 0;
        this.showScreen('initial');
    }

    /**
     * 結果をクリア
     */
    clearResult() {
        if (this.resultDisplay) {
            this.resultDisplay.classList.remove('show');
        }
        if (this.resultData) {
            this.resultData.textContent = '';
        }
        if (this.verificationStatus) {
            this.verificationStatus.textContent = '待機中';
            this.verificationStatus.style.color = '#6b7280';
        }
    }
}

// グローバルアクセス用（後で削除予定）
window.QRScanner = QRScanner;