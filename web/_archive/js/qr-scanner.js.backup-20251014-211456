/**
 * Safari最適化QRスキャナー
 * safari_qr_with_url_redirect.htmlのコア機能を移植
 */

export class SafariOptimizedQRScanner {
    constructor(options = {}) {
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
        
        // 新機能: 連続スキャンモードとスキャン履歴
        this.continuousMode = options.continuousMode || false;
        this.scanHistory = [];
        this.maxHistorySize = options.maxHistorySize || 10;
        this.duplicateThreshold = options.duplicateThreshold || 2000; // 2秒
        
        // コールバック関数
        this.onResult = options.onResult || (() => {});
        this.onError = options.onError || (() => {});
        this.onStatusUpdate = options.onStatusUpdate || (() => {});
        this.onValidate = options.onValidate || null; // 結果検証用コールバック
        
        this.initPageLifecycleHandling();
        this.detectCameras();
    }

    // ページライフサイクルイベントの処理（Safari最適化）
    initPageLifecycleHandling() {
        // Page Visibility API
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (this.isScanning) {
                    this.pauseScanning();
                }
            } else {
                if (this.isScanning) {
                    setTimeout(() => this.resumeScanning(), 500);
                }
            }
        });

        // Safari用のbeforeunload対策
        window.addEventListener('beforeunload', () => {
            this.cleanupResources();
        });

        // Safari用のpagehide/pageshowイベント
        window.addEventListener('pagehide', () => {
            this.cleanupResources();
        });

        window.addEventListener('pageshow', (event) => {
            if (event.persisted) {
                // ページがキャッシュから復元された場合
                console.log('Page restored from cache - QR Scanner ready');
            }
        });
    }

    async detectCameras() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.cameras = devices.filter(device => device.kind === 'videoinput');
            console.log(`${this.cameras.length} cameras detected`);
        } catch (error) {
            console.warn('カメラ検出エラー:', error);
        }
    }

    // Safari最適化: 段階的なカメラ初期化
    async startScan(videoElement) {
        try {
            this.video = videoElement;
            this.calibrationAttempts = 0;
            this.frameCount = 0;
            this.onStatusUpdate('カメラにアクセス中...');
            
            await this.initializeCamera();
            
        } catch (error) {
            this.handleError(error);
        }
    }

    async initializeCamera() {
        // iPhone Safari向けに段階的な制約で試行
        const constraintsList = [
            // 最適な設定
            {
                video: {
                    facingMode: { exact: this.currentCamera },
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                }
            },
            // フォールバック1: exactを外す
            {
                video: {
                    facingMode: this.currentCamera,
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            },
            // フォールバック2: 解像度を下げる
            {
                video: {
                    facingMode: this.currentCamera,
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                }
            },
            // フォールバック3: 最小限の制約
            {
                video: {
                    facingMode: this.currentCamera
                }
            },
            // 最終フォールバック: 制約なし
            {
                video: true
            }
        ];

        let lastError = null;
        for (let i = 0; i < constraintsList.length; i++) {
            try {
                console.log(`Trying camera constraints (attempt ${i + 1}/${constraintsList.length})...`);
                this.stream = await navigator.mediaDevices.getUserMedia(constraintsList[i]);
                console.log(`Camera stream acquired successfully with constraints ${i + 1}`);
                break;
            } catch (error) {
                console.warn(`Camera constraints ${i + 1} failed:`, error);
                lastError = error;
                if (i === constraintsList.length - 1) {
                    throw lastError;
                }
            }
        }

        if (!this.stream) {
            throw new Error('カメラストリームの取得に失敗しました');
        }
        // iPhone Safari向けの特別な属性設定（ストリーム割り当て前）
        this.video.setAttribute('playsinline', '');
        this.video.setAttribute('webkit-playsinline', '');
        this.video.setAttribute('autoplay', '');
        this.video.muted = true;
        this.video.playsInline = true;
        
        // ストリームを割り当て
        this.video.srcObject = this.stream;

        // より確実な初期化待機
        await this.waitForVideoReady();
        
        this.isScanning = true;
        
        // Safari最適化: キャリブレーション実行
        await this.calibrateCamera();
    }

    // Safari最適化: より確実なビデオ準備待機
    async waitForVideoReady() {
        return new Promise((resolve, reject) => {
            let checkCount = 0;
            const maxChecks = 150; // 最大15秒（100ms × 150回）
            
            const timeout = setTimeout(() => {
                console.error('Video initialization timeout after 30 seconds', {
                    readyState: this.video.readyState,
                    videoWidth: this.video.videoWidth,
                    videoHeight: this.video.videoHeight,
                    streamActive: this.stream?.active,
                    checks: checkCount
                });
                
                // タイムアウトでも readyState >= 2 なら続行を試みる
                if (this.video.readyState >= 2) {
                    console.warn('Timeout but video readyState acceptable, continuing...');
                    resolve();
                } else {
                    reject(new Error('ビデオ初期化タイムアウト: カメラの準備ができませんでした'));
                }
            }, 30000); // 30秒に延長

            const checkReady = () => {
                checkCount++;
                
                // ストリームの状態確認
                if (!this.stream || !this.stream.active) {
                    clearTimeout(timeout);
                    reject(new Error('カメラストリームが無効です'));
                    return;
                }
                
                console.log(`Video check ${checkCount}: readyState=${this.video.readyState}, size=${this.video.videoWidth}x${this.video.videoHeight}`);
                
                // iPhone Safariでは readyState が 2 (HAVE_CURRENT_DATA) でも動作することがある
                if (this.video.readyState >= 2) {
                    // メタデータが読み込まれているか確認
                    if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
                        clearTimeout(timeout);
                        
                        // 再生開始（明示的に呼び出し）
                        this.video.play()
                            .then(() => {
                                console.log('Video playback started successfully');
                                // 追加の待機時間（Safari最適化）
                                setTimeout(() => {
                                    console.log('Video ready - final state:', {
                                        readyState: this.video.readyState,
                                        size: `${this.video.videoWidth}x${this.video.videoHeight}`,
                                        paused: this.video.paused
                                    });
                                    resolve();
                                }, 1500); // 1.5秒待機
                            })
                            .catch((error) => {
                                console.error('Video play failed:', error);
                                // play失敗しても続行を試みる（autoplayが効いている場合）
                                if (this.video.readyState >= 2) {
                                    console.warn('Play failed but readyState is acceptable, continuing...');
                                    setTimeout(resolve, 1000);
                                } else {
                                    clearTimeout(timeout);
                                    reject(error);
                                }
                            });
                    } else if (checkCount >= maxChecks) {
                        clearTimeout(timeout);
                        reject(new Error('ビデオの寸法を取得できません'));
                    } else {
                        setTimeout(checkReady, 100);
                    }
                } else if (checkCount >= maxChecks) {
                    clearTimeout(timeout);
                    reject(new Error(`ビデオが準備できません (readyState: ${this.video.readyState})`));
                } else {
                    setTimeout(checkReady, 100);
                }
            };

            this.video.onloadedmetadata = () => {
                console.log('Video metadata loaded event fired');
                checkReady();
            };
            
            this.video.onerror = (error) => {
                console.error('Video element error:', error);
                clearTimeout(timeout);
                reject(new Error('ビデオ要素でエラーが発生しました'));
            };
            
            // 即座にチェック開始
            setTimeout(checkReady, 100);
        });
    }

    // キャリブレーション機能（Safari最適化の核心）
    async calibrateCamera() {
        try {
            if (this.isCalibrating || this.calibrationAttempts >= this.maxCalibrationAttempts) {
                return this.startQRDetection();
            }

            this.isCalibrating = true;
            this.calibrationAttempts++;
            
            this.onStatusUpdate(`キャリブレーション中... (${this.calibrationAttempts}/${this.maxCalibrationAttempts})`);

            // カメラストリームの状態確認
            if (!this.stream || !this.stream.active) {
                throw new Error('カメラストリームが無効です');
            }

            // ビデオ要素の状態確認
            if (!this.video || !this.video.srcObject) {
                throw new Error('ビデオ要素が初期化されていません');
            }

            // キャリブレーション期間（Safari最適化）
            await new Promise(resolve => setTimeout(resolve, 2000));

            this.isCalibrating = false;

            // カメラが完全に準備できているかチェック
            if (this.video.readyState >= 2 && this.video.videoWidth > 0 && this.video.videoHeight > 0) {
                console.log('Calibration successful. Video dimensions:', this.video.videoWidth, 'x', this.video.videoHeight);
                this.startQRDetection();
            } else if (this.calibrationAttempts < this.maxCalibrationAttempts) {
                // 再キャリブレーション
                console.warn('Calibration incomplete, retrying...', {
                    readyState: this.video.readyState,
                    videoWidth: this.video.videoWidth,
                    videoHeight: this.video.videoHeight
                });
                setTimeout(() => this.calibrateCamera(), 1000);
            } else {
                // 最大試行回数に達した場合でも、readyState >= 2 なら続行を試みる
                if (this.video.readyState >= 2) {
                    console.warn('Max calibration attempts reached but readyState acceptable, proceeding...');
                    this.startQRDetection();
                } else {
                    throw new Error('カメラのキャリブレーションに失敗しました');
                }
            }
        } catch (error) {
            console.error('Calibration error:', error);
            this.isCalibrating = false;
            this.handleError('カメラのキャリブレーションエラー', error);
        }
    }

    async startQRDetection() {
        this.onStatusUpdate('QRコードをスキャン中...');
        
        // QR Scannerライブラリを使用
        if (typeof QrScanner !== 'undefined') {
            try {
                console.log('Initializing QR Scanner with library...');
                this.qrScanner = new QrScanner(
                    this.video,
                    result => this.handleQRResult(result.data),
                    {
                        returnDetailedScanResult: true,
                        highlightScanRegion: false,
                        highlightCodeOutline: false,
                        // Safari最適化設定
                        maxScansPerSecond: 5, // iPhone Safari向けにさらに頻度を下げる
                        calculateScanRegion: this.calculateScanRegion.bind(this),
                        // iPhone Safari向けの追加設定
                        preferredCamera: 'environment'
                    }
                );
                
                await this.qrScanner.start();
                console.log('QR Scanner started successfully');
                
                // フレームカウンター開始
                this.startFrameCounter();
                
            } catch (error) {
                console.warn('QR Scanner library failed, using fallback:', error);
                this.fallbackToManualDetection();
            }
        } else {
            console.log('QR Scanner library not available, using fallback');
            this.fallbackToManualDetection();
        }
    }

    // Safari最適化: スキャン領域の計算
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

    // フレームカウンター（デバッグ用）
    startFrameCounter() {
        const countFrames = () => {
            if (this.isScanning) {
                this.frameCount++;
                requestAnimationFrame(countFrames);
            }
        };
        countFrames();
    }

    fallbackToManualDetection() {
        console.log('Attempting fallback detection methods...');
        
        if ('BarcodeDetector' in window) {
            console.log('Using BarcodeDetector API');
            
            BarcodeDetector.getSupportedFormats().then(formats => {
                console.log('Supported barcode formats:', formats);
            });
            
            const detector = new BarcodeDetector({ formats: ['qr_code'] });
            
            const detectQR = async () => {
                if (this.isScanning && this.video.readyState >= 2) {
                    try {
                        const currentTime = Date.now();
                        if (currentTime - this.lastDetectionAttempt > 300) { // 300ms間隔（iPhone Safari向けに調整）
                            const barcodes = await detector.detect(this.video);
                            this.lastDetectionAttempt = currentTime;
                            
                            if (barcodes.length > 0) {
                                console.log('QR code detected via BarcodeDetector:', barcodes[0].rawValue);
                                this.handleQRResult(barcodes[0].rawValue);
                                return;
                            }
                        }
                    } catch (error) {
                        console.warn('BarcodeDetector error:', error);
                    }
                }
                
                if (this.isScanning) {
                    requestAnimationFrame(detectQR);
                }
            };
            
            detectQR();
            this.onStatusUpdate('QRコードをスキャン中... (フォールバックモード)');
            console.log('BarcodeDetector fallback active');
        } else {
            console.error('No QR detection method available');
            this.onStatusUpdate('このブラウザではQRコード検出がサポートされていません');
            
            // iPhone Safariの場合は、ユーザーに別の方法を提案
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            if (isIOS) {
                this.handleError(new Error('iOS Safariでは最新バージョンが必要です。設定→Safari→詳細→実験的な機能で「Web API」を有効にしてください。'));
            } else {
                this.handleError(new Error('このブラウザではQRコード検出機能がサポートされていません。最新のSafari、Chrome、またはEdgeをお試しください。'));
            }
        }
    }

    handleQRResult(data) {
        // スキャン中でない場合は無視
        if (!this.isScanning) return;
        
        // 重複スキャンチェック
        const lastScan = this.scanHistory[this.scanHistory.length - 1];
        if (lastScan && lastScan.data === data && 
            (Date.now() - lastScan.timestamp) < this.duplicateThreshold) {
            console.log('Duplicate scan ignored:', data);
            return; // 重複スキャンを無視
        }
        
        console.log('QR detected:', data);
        
        // 結果検証（オプション）
        if (this.onValidate && typeof this.onValidate === 'function') {
            const validationResult = this.onValidate(data);
            if (validationResult === false) {
                console.warn('QR validation failed:', data);
                this.onStatusUpdate('QRコードの検証に失敗しました');
                
                // 連続モードの場合は次のスキャンを待つ
                if (!this.continuousMode) {
                    this.stopScan();
                }
                return;
            }
        }
        
        // スキャン履歴に追加
        this.scanHistory.push({
            data: data,
            timestamp: Date.now()
        });
        
        // 履歴サイズ制限
        if (this.scanHistory.length > this.maxHistorySize) {
            this.scanHistory.shift();
        }
        
        // 連続スキャンモードでない場合はスキャン停止
        if (!this.continuousMode) {
            this.stopScan();
        }
        
        // 結果をコールバックで返す
        this.onResult(data);
    }

    // Safari最適化: スキャン一時停止/再開
    pauseScanning() {
        if (this.qrScanner) {
            this.qrScanner.stop();
        }
        this.onStatusUpdate('一時停止中...');
    }

    async resumeScanning() {
        if (this.qrScanner && this.isScanning) {
            try {
                await this.qrScanner.start();
                this.onStatusUpdate('QRコードをスキャン中...');
            } catch (error) {
                console.warn('Resume scanning failed:', error);
                this.calibrateCamera();
            }
        }
    }

    stopScan() {
        this.isScanning = false;
        this.isCalibrating = false;
        this.cleanupResources();
    }

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
        
        if (this.video) {
            this.video.srcObject = null;
        }
    }

    handleError(messageOrError, error) {
        this.stopScan();
        
        let message = 'カメラにアクセスできませんでした。';
        let actualError = error;
        
        // 引数が1つの場合（Errorオブジェクトのみ）
        if (messageOrError instanceof Error && !error) {
            actualError = messageOrError;
        } else if (typeof messageOrError === 'string') {
            message = messageOrError;
        }
        
        // エラータイプに応じたメッセージ
        if (actualError) {
            console.error('QR Scanner Error:', actualError);
            
            switch (actualError.name) {
                case 'NotAllowedError':
                    message = 'カメラの使用が拒否されました。ブラウザの設定からカメラの許可を有効にしてください。';
                    break;
                case 'NotFoundError':
                    message = 'カメラが見つかりませんでした。デバイスにカメラが接続されているか確認してください。';
                    break;
                case 'NotSupportedError':
                    message = 'このブラウザではカメラ機能がサポートされていません。最新のSafari、Chrome、またはEdgeをお試しください。';
                    break;
                case 'NotReadableError':
                    message = 'カメラが他のアプリケーションで使用中です。他のアプリを閉じてから再試行してください。';
                    break;
                case 'SecurityError':
                    message = 'セキュリティ制限によりカメラにアクセスできません。HTTPS環境が必要です。';
                    break;
                default:
                    // カスタムエラーメッセージがある場合
                    if (actualError.message && !message.includes(actualError.message)) {
                        message = `${message}\n詳細: ${actualError.message}`;
                    }
            }
        }

        console.error('Final error message:', message);
        this.onError(message, actualError);
    }

    // 手動キャリブレーション
    async recalibrate() {
        this.calibrationAttempts = 0;
        await this.calibrateCamera();
    }

    // デバッグモード切り替え
    toggleDebug() {
        this.debugMode = !this.debugMode;
        return this.debugMode;
    }

    // ステータス情報取得
    getStatus() {
        return {
            isScanning: this.isScanning,
            isCalibrating: this.isCalibrating,
            calibrationAttempts: this.calibrationAttempts,
            frameCount: this.frameCount,
            cameraCount: this.cameras.length,
            videoReady: this.video ? this.video.readyState : 0,
            continuousMode: this.continuousMode,
            scanHistoryCount: this.scanHistory.length
        };
    }

    // 新機能: 手動入力
    async manualInput(promptMessage = 'QRコードの内容を手入力してください:') {
        return new Promise((resolve, reject) => {
            try {
                const input = prompt(promptMessage);
                if (input && input.trim()) {
                    const trimmedInput = input.trim();
                    
                    // 結果検証（オプション）
                    if (this.onValidate && typeof this.onValidate === 'function') {
                        const validationResult = this.onValidate(trimmedInput);
                        if (validationResult === false) {
                            reject(new Error('入力されたデータの検証に失敗しました'));
                            return;
                        }
                    }
                    
                    // スキャン履歴に追加
                    this.scanHistory.push({
                        data: trimmedInput,
                        timestamp: Date.now(),
                        manual: true
                    });
                    
                    // 履歴サイズ制限
                    if (this.scanHistory.length > this.maxHistorySize) {
                        this.scanHistory.shift();
                    }
                    
                    // 結果をコールバックで返す
                    this.onResult(trimmedInput);
                    resolve(trimmedInput);
                } else {
                    reject(new Error('入力がキャンセルされました'));
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    // 新機能: 連続スキャンモードの切り替え
    setContinuousMode(enabled) {
        this.continuousMode = enabled;
        console.log('Continuous scan mode:', enabled ? 'enabled' : 'disabled');
        return this.continuousMode;
    }

    // 新機能: スキャン履歴の取得
    getScanHistory() {
        return [...this.scanHistory]; // コピーを返す
    }

    // 新機能: スキャン履歴のクリア
    clearScanHistory() {
        this.scanHistory = [];
        console.log('Scan history cleared');
    }

    // 新機能: 最後のスキャン結果を取得
    getLastScan() {
        return this.scanHistory.length > 0 
            ? this.scanHistory[this.scanHistory.length - 1] 
            : null;
    }

    // 新機能: スキャン統計情報
    getStatistics() {
        const now = Date.now();
        const recentScans = this.scanHistory.filter(
            scan => (now - scan.timestamp) < 60000 // 直近1分間
        );
        
        return {
            totalScans: this.scanHistory.length,
            recentScans: recentScans.length,
            manualScans: this.scanHistory.filter(scan => scan.manual).length,
            autoScans: this.scanHistory.filter(scan => !scan.manual).length,
            oldestScan: this.scanHistory.length > 0 
                ? new Date(this.scanHistory[0].timestamp) 
                : null,
            newestScan: this.scanHistory.length > 0 
                ? new Date(this.scanHistory[this.scanHistory.length - 1].timestamp) 
                : null
        };
    }
}

export default SafariOptimizedQRScanner;