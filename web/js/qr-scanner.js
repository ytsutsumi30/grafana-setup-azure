/**
 * Safari最適化QRスキャナー v2.0
 * iPad/iPhone Safari 18.6+ 対応版
 */

const MODULE_URL = (typeof import.meta !== 'undefined' && import.meta.url)
    ? new URL(import.meta.url)
    : null;

let DEFAULT_WORKER_URL = 'js/qr-scanner-worker.min.js';

if (MODULE_URL) {
    const workerUrl = new URL('./qr-scanner-worker.min.js', MODULE_URL);
    const version = MODULE_URL.searchParams.get('v');
    if (version) {
        workerUrl.searchParams.set('v', version);
    }
    DEFAULT_WORKER_URL = workerUrl.href;
}

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
    this.workerPath = options.workerPath || DEFAULT_WORKER_URL;
        
        // 詳細デバッグ機能追加
        this.debugElements = null;
        this.debugFrameInterval = null;
        this.lastDebugUpdate = 0;
        
        // 新機能: 連続スキャンモードとスキャン履歴
        this.continuousMode = options.continuousMode || false;
        this.scanHistory = [];
        this.maxHistorySize = options.maxHistorySize || 10;
        this.duplicateThreshold = options.duplicateThreshold || 2000; // 2秒
        
        // iPad/iPhone最適化: デバイス情報
        this.deviceInfo = this.detectDevice();
        
        // コールバック関数
        this.onResult = options.onResult || (() => {});
        this.onError = options.onError || (() => {});
        this.onStatusUpdate = options.onStatusUpdate || (() => {});
        this.onValidate = options.onValidate || null; // 結果検証用コールバック
        
        this.initPageLifecycleHandling();
        this.detectCameras();
        this.initDebugElements();
    }

    // デバイス検出（iPad/iPhone判定強化）
    detectDevice() {
        const ua = navigator.userAgent;
        const isIOS = /iPad|iPhone|iPod/.test(ua);
        const isIPad = /iPad/.test(ua);
        const isIPhone = /iPhone/.test(ua);
        
        // iOS バージョン検出
        let iosVersion = null;
        const match = ua.match(/OS (\d+)_(\d+)(?:_(\d+))?/);
        if (match) {
            iosVersion = {
                major: parseInt(match[1]),
                minor: parseInt(match[2]),
                patch: match[3] ? parseInt(match[3]) : 0
            };
        }
        
        return {
            isIOS,
            isIPad,
            isIPhone,
            iosVersion,
            userAgent: ua,
            supportsImageCapture: 'ImageCapture' in window,
            supportsBarcodeDetector: 'BarcodeDetector' in window
        };
    }

    // ページライフサイクルイベントの処理（Safari最適化 - safari.html実装）
    initPageLifecycleHandling() {
        // Page Visibility API
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                if (this.isScanning) {
                    this.log('Page hidden - pausing scan');
                    this.pauseScanning();
                }
            } else {
                if (this.isScanning) {
                    this.log('Page visible - resuming scan');
                    setTimeout(() => this.resumeScanning(), 500);
                }
            }
        });

        // Safari用のbeforeunload対策
        window.addEventListener('beforeunload', () => {
            this.log('Page unloading - cleaning up');
            this.cleanupResources();
        });

        // Safari用のpagehide/pageshowイベント（safari.html実装）
        window.addEventListener('pagehide', () => {
            this.log('Page hiding - cleaning up');
            this.cleanupResources();
        });

        window.addEventListener('pageshow', (event) => {
            if (event.persisted) {
                // ページがBFCache（Back-Forward Cache）から復元された場合（safari.html実装）
                this.log('Page restored from BFCache - リソースをクリーンアップ');
                // BFCacheから復元された場合、ストリームが無効になっている可能性があるため
                // クリーンアップして再初期化の準備をする
                this.cleanupResources();
            }
        });
    }

    // ログ出力（デバッグモード対応）
    log(...args) {
        if (this.debugMode) {
            console.log('[QRScanner]', ...args);
        }
    }

    async detectCameras() {
        try {
            // iOS Safari: カメラ許可後にラベルが取得可能
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.cameras = devices.filter(device => device.kind === 'videoinput');
            
            this.log(`Detected ${this.cameras.length} cameras`, this.cameras);
            
            // デバイス情報をログ
            if (this.debugMode) {
                this.cameras.forEach((cam, idx) => {
                    this.log(`Camera ${idx + 1}:`, {
                        label: cam.label || '(未許可)',
                        deviceId: cam.deviceId ? cam.deviceId.substring(0, 8) + '...' : 'N/A'
                    });
                });
            }
        } catch (error) {
            this.log('Camera detection error:', error);
        }
    }

    async startScan(videoElement) {
        try {
            this.video = videoElement;
            this.calibrationAttempts = 0;
            this.frameCount = 0;
            
            this.log('Starting scan...', {
                device: this.deviceInfo.isIPad ? 'iPad' : 
                        this.deviceInfo.isIPhone ? 'iPhone' : 'Other',
                iosVersion: this.deviceInfo.iosVersion
            });
            
            // デバッグ情報更新
            this.updateDebug('ready', this.video.readyState);
            this.updateDebug('stream', 'Initializing...');
            this.updateDebug('detection', 'Preparing...');
            
            this.onStatusUpdate('カメラにアクセス中...');
            
            await this.initializeCamera();
            
        } catch (error) {
            this.updateDebug('stream', 'Error');
            this.updateDebug('detection', 'Failed');
            this.handleError(error);
        }
    }

    // iPad/iPhone Safari最適化: カメラ制約の自動選択
    getOptimalConstraints() {
        const baseConstraints = {
            video: {
                facingMode: this.currentCamera,
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            }
        };
        
        // iPad/iPhone 特有の最適化
        if (this.deviceInfo.isIOS) {
            // iOS 18以降は高解像度対応
            if (this.deviceInfo.iosVersion && this.deviceInfo.iosVersion.major >= 18) {
                baseConstraints.video.width = { ideal: 1920 };
                baseConstraints.video.height = { ideal: 1080 };
            }
            
            // iPadは大画面なので解像度を上げる
            if (this.deviceInfo.isIPad) {
                baseConstraints.video.aspectRatio = { ideal: 16/9 };
            }
        }
        
        return baseConstraints;
    }

    async initializeCamera() {
        // iPad/iPhone Safari向けに最適化された制約リスト
        const constraintsList = [
            // レベル1: 最適設定（iOS 18+向け）
            this.getOptimalConstraints(),
            
            // レベル2: 標準HD
            {
                video: {
                    facingMode: this.currentCamera,
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            },
            
            // レベル3: 標準SD
            {
                video: {
                    facingMode: this.currentCamera,
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                }
            },
            
            // レベル4: 最小制約
            {
                video: { facingMode: this.currentCamera }
            },
            
            // レベル5: 完全フォールバック
            { video: true }
        ];

        let lastError = null;
            for (let i = 0; i < constraintsList.length; i++) {
                try {
                    this.log(`Attempting constraints level ${i + 1}/${constraintsList.length}`);
                    this.updateDebug('stream', `Level ${i + 1} trying...`);
                    
                    this.stream = await navigator.mediaDevices.getUserMedia(constraintsList[i]);
                    
                    // ストリーム取得成功
                    const track = this.stream.getVideoTracks()[0];
                    const settings = track.getSettings();
                    
                    this.log(`Camera acquired successfully:`, {
                        level: i + 1,
                        resolution: `${settings.width}x${settings.height}`,
                        fps: settings.frameRate,
                        facingMode: settings.facingMode
                    });
                    
                    this.updateDebug('stream', `Level ${i + 1} success: ${settings.width}x${settings.height}`);
                    break;
                } catch (error) {
                    this.log(`Constraints level ${i + 1} failed:`, error.name);
                    this.updateDebug('stream', `Level ${i + 1} failed: ${error.name}`);
                    lastError = error;
                    
                    if (i === constraintsList.length - 1) {
                        throw lastError;
                    }
                }
            }        if (!this.stream) {
            throw new Error('カメラストリームの取得に失敗しました');
        }

        // Safari最適化: ストリームを先に割り当て
        this.video.srcObject = this.stream;
        this.updateDebug('stream', 'Connected');

        // iPad/iPhone Safari向けの特別な属性設定（safari.html実装）
        this.video.setAttribute('playsinline', true);
        this.video.setAttribute('webkit-playsinline', true);
        this.video.setAttribute('autoplay', true);
        this.video.muted = true;
        this.video.playsInline = true;
        
        // iOS向けの追加最適化（safari.html実装）
        this.video.style.objectFit = 'cover';

        // ミラー効果はフロントカメラのみ適用（ユーザビリティ向上）
        const track = this.stream.getVideoTracks()[0];
        const settings = track.getSettings();
        if (this.deviceInfo.isIOS && settings.facingMode === 'user') {
            this.video.style.transform = 'scaleX(-1)';
        }
        
        this.updateDebug('ready', this.video.readyState);

        // Safari最適化: より確実なビデオ準備待機（safari.html実装）
        await this.waitForVideoReady();
        
        this.isScanning = true;
        this.updateDebug('detection', 'Calibrating...');
        this.updateDebug('calibration', `${this.calibrationAttempts}/${this.maxCalibrationAttempts}`);
        
        // キャリブレーション実行
        await this.calibrateCamera();
    }

    // Safari最適化: より確実なビデオ準備待機（safari.html実装）
    async waitForVideoReady() {
        return new Promise((resolve, reject) => {
            let checkCount = 0;
            const maxChecks = 200; // iPhone向けに増加（safari.html実装）
            
            const timeout = setTimeout(() => {
                this.log('Video initialization timeout', {
                    readyState: this.video.readyState,
                    videoWidth: this.video.videoWidth,
                    videoHeight: this.video.videoHeight,
                    streamActive: this.stream?.active,
                    checks: checkCount
                });
                
                // readyState >= 2 なら続行を試みる
                if (this.video.readyState >= 2) {
                    this.log('Timeout but video ready, continuing...');
                    resolve();
                } else {
                    reject(new Error('ビデオ初期化タイムアウト'));
                }
            }, 30000); // 30秒に延長（safari.html実装）

            const checkReady = () => {
                checkCount++;
                this.updateDebug('ready', `${this.video.readyState} (${checkCount})`);
                
                // ストリーム状態確認
                if (!this.stream || !this.stream.active) {
                    clearTimeout(timeout);
                    reject(new Error('カメラストリームが無効です'));
                    return;
                }
                
                if (checkCount % 20 === 0) {
                    this.log(`Video check ${checkCount}:`, {
                        readyState: this.video.readyState,
                        size: `${this.video.videoWidth}x${this.video.videoHeight}`,
                        currentTime: this.video.currentTime,
                        paused: this.video.paused
                    });
                }
                
                // メタデータ読み込み完了 & 映像データあり
                if (this.video.readyState >= 2 && 
                    this.video.videoWidth > 0 && 
                    this.video.videoHeight > 0) {
                    
                    clearTimeout(timeout);
                    
                    // Safari最適化: 再生開始を確実に実行（safari.html実装）
                    const startPlayback = async () => {
                        try {
                            await this.video.play();
                            this.log('Video playback started', {
                                size: `${this.video.videoWidth}x${this.video.videoHeight}`,
                                readyState: this.video.readyState,
                                currentTime: this.video.currentTime
                            });
                            
                            // iPhone/iPad向けの追加待機時間（safari.html実装）
                            const waitTime = this.deviceInfo.isIOS ? 2000 : 1000;
                            setTimeout(resolve, waitTime);
                        } catch (playError) {
                            this.log('Video play failed, but continuing:', playError);
                            
                            // autoplayが効いている場合や、すでに再生中の場合は続行（safari.html実装）
                            if (this.video.readyState >= 2 && !this.video.paused) {
                                this.log('Video playing without explicit play()');
                                setTimeout(resolve, 1500);
                            } else {
                                // 再生に失敗したが、準備はできているので続行（safari.html実装）
                                this.log('Play failed but readyState OK, continuing...');
                                setTimeout(resolve, 1000);
                            }
                        }
                    };
                    
                    startPlayback();
                    
                } else if (checkCount >= maxChecks) {
                    clearTimeout(timeout);
                    reject(new Error(`ビデオが準備できません (checks: ${checkCount})`));
                } else {
                    setTimeout(checkReady, 100);
                }
            };

            // イベントリスナー設定（safari.html実装）
            this.video.onloadedmetadata = () => {
                this.log('Video metadata loaded');
                setTimeout(checkReady, 100); // 少し待ってからチェック
            };
            
            this.video.oncanplay = () => {
                this.log('Video can start playing');
            };
            
            this.video.oncanplaythrough = () => {
                this.log('Video can play through');
            };
            
            this.video.onerror = (error) => {
                this.log('Video element error:', error);
                clearTimeout(timeout);
                reject(new Error('ビデオ要素エラー'));
            };
            
            // 初回チェック開始（safari.html実装）
            setTimeout(checkReady, 200);
        });
    }

    // キャリブレーション機能（Safari最適化の核心 - 強化版）
    async calibrateCamera() {
        try {
            if (this.isCalibrating || this.calibrationAttempts >= this.maxCalibrationAttempts) {
                return this.startQRDetection();
            }

            this.isCalibrating = true;
            this.calibrationAttempts++;
            
            this.onStatusUpdate(`キャリブレーション中... (${this.calibrationAttempts}/${this.maxCalibrationAttempts})`);
            this.log(`Calibration attempt ${this.calibrationAttempts}`);

            // カメラストリームの状態確認
            if (!this.stream || !this.stream.active) {
                throw new Error('カメラストリームが無効です');
            }

            if (!this.video || !this.video.srcObject) {
                throw new Error('ビデオ要素が初期化されていません');
            }

            // iPad/iPhone向けの強化キャリブレーション期間（3秒に延長）
            const calibrationTime = this.deviceInfo.isIOS ? 3000 : 2000;
            console.log(`Enhanced calibrating for ${calibrationTime}ms (iOS: ${this.deviceInfo.isIOS})`);
            
            await new Promise(resolve => setTimeout(resolve, calibrationTime));

            this.isCalibrating = false;

            // カメラ準備完了確認（詳細状態ログ出力）
            const isReady = this.video.readyState >= 2 && 
                           this.video.videoWidth > 0 && 
                           this.video.videoHeight > 0;
                           
            // 詳細状態ログ出力
            console.log('Enhanced calibration check:', {
                readyState: this.video.readyState,
                size: `${this.video.videoWidth}x${this.video.videoHeight}`,
                currentTime: this.video.currentTime,
                attempt: this.calibrationAttempts,
                streamActive: this.stream?.active,
                paused: this.video.paused
            });
                
            if (isReady) {
                console.log('Enhanced calibration successful, starting QR detection');
                this.log('Enhanced calibration successful', {
                    size: `${this.video.videoWidth}x${this.video.videoHeight}`,
                    readyState: this.video.readyState
                });
                
                this.startQRDetection();
            } else if (this.calibrationAttempts < this.maxCalibrationAttempts) {
                console.log('Enhanced calibration incomplete, retrying...');
                this.log('Enhanced calibration incomplete, retrying...');
                setTimeout(() => this.calibrateCamera(), 1500);
            } else {
                // 最大試行回数到達 - 柔軟な継続基準（readyState >= 1）
                if (this.video.readyState >= 1) { // 柔軟な基準に変更
                    console.log('Max enhanced calibration attempts but continuing with readyState >= 1...');
                    this.log('Max attempts but continuing with flexible criteria...');
                    this.startQRDetection();
                } else {
                    throw new Error('カメラのキャリブレーションに失敗しました');
                }
            }
        } catch (error) {
            this.log('Enhanced calibration error:', error);
            this.isCalibrating = false;
            this.handleError('強化キャリブレーションエラー', error);
        }
    }

    async startQRDetection() {
        this.onStatusUpdate('QRコードをスキャン中...');
        this.log('QR検出を開始します...');
        this.updateDebug('detection', 'Starting QR detection...');

        // QR Scannerライブラリを使用（iOS Safari対応のUMD版）
        // window.QrScannerとグローバルQrScannerの両方をチェック
        const QrScannerLib = typeof QrScanner !== 'undefined' ? QrScanner : (typeof window !== 'undefined' && window.QrScanner);

        if (QrScannerLib) {
            try {
                if (this.workerPath) {
                    QrScannerLib.WORKER_PATH = this.workerPath;
                    if (typeof window !== 'undefined' && window.QrScanner) {
                        window.QrScanner.WORKER_PATH = this.workerPath;
                    }
                }

                console.log('Initializing QR Scanner with library (UMD)...');
                console.log('Device info:', this.deviceInfo);
                console.log('QrScanner lib:', QrScannerLib);

                // iPhone/iPad Safari最適化設定（safari.html実証済み設定を採用）
                const scannerOptions = {
                    returnDetailedScanResult: true,
                    highlightScanRegion: false,
                    highlightCodeOutline: false,
                    // safari.html実証済み: iOS 3回/秒、その他 5回/秒（安定性重視）
                    // 高頻度スキャンはiOS Safariでリソース競合を引き起こすため低レートを採用
                    maxScansPerSecond: this.deviceInfo.isIOS ? 3 : 5,
                    calculateScanRegion: this.calculateScanRegion.bind(this),
                    preferredCamera: 'environment'
                };

                console.log('Scanner options:', scannerOptions);
                console.log('QR Scanner initialized with settings:', {
                    device: this.deviceInfo.isIPad ? 'iPad' : (this.deviceInfo.isIPhone ? 'iPhone' : 'Other'),
                    iosVersion: this.deviceInfo.iosVersion,
                    maxScansPerSecond: scannerOptions.maxScansPerSecond,
                    optimizationProfile: 'safari.html-proven'
                });

                this.qrScanner = new QrScannerLib(
                    this.video,
                    result => {
                        console.log('QR Scanner callback received:', result);
                        this.handleQRResult(result.data || result);
                    },
                    scannerOptions
                );

                // iOS Safari向けに明示的にカメラを設定（既存のストリームを使用）
                if (this.deviceInfo.isIOS && this.stream) {
                    console.log('iOS detected: using existing stream for QR scanner');
                    // QrScannerライブラリは自動的に既存のストリームを検出して使用
                }

                await this.qrScanner.start();
                console.log('QR Scanner started successfully with UMD library');
                this.log('QRスキャナーが正常に起動しました');
                this.updateDebug('detection', 'QrScanner active');

                // フレームカウンター開始
                this.startFrameCounter();

            } catch (error) {
                console.error('QR Scanner library failed:', error);
                console.log('Error details:', {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                });
                this.log('QRスキャナーライブラリ失敗、フォールバック試行');
                this.updateDebug('detection', 'Library failed, using fallback');
                this.fallbackToManualDetection();
            }
        } else {
            console.warn('QR Scanner library (QrScanner) not available');
            console.log('Available objects:', {
                QrScanner: typeof QrScanner,
                window_QrScanner: typeof window.QrScanner,
                windowKeys: typeof window !== 'undefined' ? Object.keys(window).filter(k => k.toLowerCase().includes('qr')) : []
            });
            this.log('QRスキャナーライブラリが見つかりません、フォールバック使用');
            this.updateDebug('detection', 'Library not available');
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
        this.log('フォールバック検出モードを試行中...');

        // iOS Safari の場合、QR Scanner library が失敗した理由を特定
        if (this.deviceInfo.isIOS) {
            console.error('QR Scanner library failed on iOS Safari');
            console.log('Possible reasons:', {
                videoReady: this.video?.readyState,
                streamActive: this.stream?.active,
                videoSize: `${this.video?.videoWidth}x${this.video?.videoHeight}`,
                iosVersion: this.deviceInfo.iosVersion
            });

            // iOS Safari では BarcodeDetector が使えないので、jsQR ライブラリを推奨
            this.showIOSQRScannerError();
            return;
        }

        // BarcodeDetector APIを試す（iOS Safari以外）
        if ('BarcodeDetector' in window) {
            console.log('Using BarcodeDetector API');
            this.onStatusUpdate('QRコードをスキャン中... (BarcodeDetector使用)');
            this.updateDebug('detection', 'BarcodeDetector fallback');

            BarcodeDetector.getSupportedFormats().then(formats => {
                console.log('Supported barcode formats:', formats);
            }).catch(err => {
                console.warn('Failed to get supported formats:', err);
            });

            const detector = new BarcodeDetector({ formats: ['qr_code'] });

            const detectQR = async () => {
                if (this.isScanning && this.video.readyState >= 2) {
                    try {
                        const currentTime = Date.now();
                        // iPhone/iPad向けに検出間隔を調整
                        const detectionInterval = this.deviceInfo.isIOS ? 500 : 300;

                        if (currentTime - this.lastDetectionAttempt > detectionInterval) {
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
                        // NotSupportedErrorの場合はBarcodeDetectorが使えない
                        if (error.name === 'NotSupportedError') {
                            console.error('BarcodeDetector not supported, cannot proceed');
                            this.updateDebug('detection', 'BarcodeDetector not supported');
                            this.showNotSupportedError();
                            return;
                        }
                    }
                }

                if (this.isScanning) {
                    requestAnimationFrame(detectQR);
                }
            };

            detectQR();
            console.log('BarcodeDetector fallback active');
        } else {
            // BarcodeDetector APIが利用できない（主にiOS Safari）
            console.error('BarcodeDetector API not available');
            this.updateDebug('detection', 'No detection API');
            this.showNotSupportedError();
        }
    }

    // iOS Safari で QR Scanner library が失敗した場合の専用エラー
    showIOSQRScannerError() {
        this.stopScan();

        const errorHTML = `
            <div class="bg-orange-50 border-l-4 border-orange-500 p-4 mb-4">
                <div class="flex items-start">
                    <div class="flex-shrink-0">
                        <span class="text-2xl">📱</span>
                    </div>
                    <div class="ml-3 flex-1">
                        <h3 class="text-lg font-medium text-orange-800 mb-2">
                            iOS Safari でのQRスキャナー初期化エラー
                        </h3>
                        <div class="text-sm text-orange-700 space-y-2">
                            <p><strong>🔧 解決方法:</strong></p>
                            <ol class="list-decimal list-inside space-y-1 ml-2">
                                <li><strong>ページを再読み込み</strong>してください（F5キーまたは画面を引き下げ）</li>
                                <li>カメラ権限を確認: 設定 → Safari → カメラ → 許可</li>
                                <li>他のアプリでカメラを使用していないか確認</li>
                                <li>Safariを再起動してみてください</li>
                                <li>iOSを<strong>最新バージョン</strong>に更新（推奨: iOS 15以降）</li>
                            </ol>
                            <p class="mt-3"><strong>📋 代替手段:</strong></p>
                            <ul class="list-disc list-inside space-y-1 ml-2">
                                <li><strong>Chrome for iOS</strong>または<strong>Edge for iOS</strong>を使用</li>
                                <li>iOSの標準<strong>カメラアプリ</strong>でQRコードを読み取り</li>
                                <li>「テストスキャン」ボタンで手動入力も可能です</li>
                            </ul>
                            <p class="mt-3 text-xs text-orange-600">
                                ℹ️ iOS Safari ではQR Scanner library の初期化に失敗しました。上記の方法をお試しください。
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.handleError(
            errorHTML,
            new Error('QR Scanner library initialization failed on iOS Safari')
        );
        this.onStatusUpdate('QRスキャナーの初期化に失敗しました');
        this.updateDebug('detection', 'iOS QR Scanner failed');
    }

    // iOS Safariでサポートされていない場合の専用エラー表示
    showNotSupportedError() {
        this.stopScan();

        const isIOS = this.deviceInfo.isIOS;

        if (isIOS) {
            const errorHTML = `
                <div class="bg-red-50 border-l-4 border-red-500 p-4 mb-4">
                    <div class="flex items-start">
                        <div class="flex-shrink-0">
                            <span class="text-2xl">⚠️</span>
                        </div>
                        <div class="ml-3 flex-1">
                            <h3 class="text-lg font-medium text-red-800 mb-2">
                                iOS SafariではQR検出APIが利用できません
                            </h3>
                            <div class="text-sm text-red-700 space-y-2">
                                <p><strong>🔧 推奨解決方法:</strong></p>
                                <ul class="list-disc list-inside space-y-1 ml-2">
                                    <li>iOSを<strong>最新バージョン</strong>に更新してください</li>
                                    <li><strong>Chrome for iOS</strong>または<strong>Edge for iOS</strong>をお試しください</li>
                                    <li>iOSの<strong>カメラアプリ</strong>の標準QRスキャナーをご利用ください</li>
                                </ul>
                                <p class="mt-3 text-xs text-red-600">
                                    ℹ️ iOS Safariは現在BarcodeDetector APIをサポートしていません。
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            this.handleError(
                errorHTML,
                new Error('BarcodeDetector API unavailable on iOS Safari')
            );
        } else {
            this.handleError(
                'このブラウザではQRコード検出機能がサポートされていません。最新のChrome、Edge、またはSafariをご利用ください。',
                new Error('No QR detection API available')
            );
        }

        this.onStatusUpdate('QR検出APIが利用できません');
        this.updateDebug('detection', 'No API available');
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
        this.updateDebug('detection', 'Error');
        this.updateDebug('stream', 'Error');
        
        let message = 'カメラにアクセスできませんでした。';
        let actualError = error;
        
        // 引数が1つの場合（Errorオブジェクトのみ）
        if (messageOrError instanceof Error && !error) {
            actualError = messageOrError;
        } else if (typeof messageOrError === 'string') {
            message = messageOrError;
        }
        
        // iOS特化エラー処理
        if (actualError) {
            console.error('QR Scanner Error:', actualError);
            
            // iOS特化のエラー分類とHTML形式メッセージ
            if (this.deviceInfo.isIOS) {
                message = this.getIOSSpecificErrorMessage(actualError);
            } else {
                message = this.getGenericErrorMessage(actualError);
            }
        }

        console.error('Final error message:', message);
        this.onError(message, actualError);
    }

    // iOS特化エラーメッセージ（HTML形式）
    getIOSSpecificErrorMessage(error) {
        switch (error.name) {
            case 'NotAllowedError':
                return `
                    <div class="mb-3">
                        <strong>🚫 カメラの使用が拒否されました</strong>
                    </div>
                    <div class="alert alert-info small">
                        <p><strong>📱 iPhone/iPadでの解決方法:</strong></p>
                        <ol class="mb-0">
                            <li><strong>設定</strong> アプリを開く</li>
                            <li><strong>Safari</strong> を選択</li>
                            <li><strong>カメラ</strong> を選択</li>
                            <li><strong>"許可"</strong> を選択</li>
                            <li>このページを再読み込み</li>
                        </ol>
                    </div>
                `;
            case 'NotFoundError':
                return `
                    <div class="mb-3">
                        <strong>📷 カメラが見つかりませんでした</strong>
                    </div>
                    <div class="alert alert-warning small">
                        <p><strong>🔧 確認事項:</strong></p>
                        <ul class="mb-0">
                            <li>カメラが正常に動作しているか確認</li>
                            <li>他のアプリでカメラが使用中でないか確認</li>
                            <li>デバイスを再起動してみてください</li>
                        </ul>
                    </div>
                `;
            case 'NotSupportedError':
                return `
                    <div class="mb-3">
                        <strong>⚠️ このiOSバージョンではサポートされていません</strong>
                    </div>
                    <div class="alert alert-warning small">
                        <p><strong>🔄 推奨解決方法:</strong></p>
                        <ul class="mb-0">
                            <li><strong>iOSを最新バージョンに更新</strong></li>
                            <li>Chrome for iOS または Edge アプリを使用</li>
                            <li>カメラアプリの標準QRスキャナーを使用</li>
                        </ul>
                        <hr class="my-2">
                        <small class="text-muted">
                            💡 iOS ${this.deviceInfo.iosVersion?.major || 'Unknown'} をお使いです
                        </small>
                    </div>
                `;
            case 'NotReadableError':
                return `
                    <div class="mb-3">
                        <strong>🔒 カメラが他のアプリで使用中です</strong>
                    </div>
                    <div class="alert alert-info small">
                        <p><strong>📱 解決方法:</strong></p>
                        <ul class="mb-0">
                            <li>他のカメラアプリを終了</li>
                            <li>アプリスイッチャーで不要なアプリを終了</li>
                            <li>少し時間をおいてから再試行</li>
                        </ul>
                    </div>
                `;
            case 'SecurityError':
                return `
                    <div class="mb-3">
                        <strong>🔐 セキュリティ制限によりアクセスできません</strong>
                    </div>
                    <div class="alert alert-danger small">
                        <p><strong>🌐 必要な条件:</strong></p>
                        <ul class="mb-0">
                            <li><strong>HTTPS環境が必要です</strong></li>
                            <li>信頼できるサイトからアクセス</li>
                            <li>プライベートブラウジングモードを無効に</li>
                        </ul>
                    </div>
                `;
            case 'AbortError':
                return `
                    <div class="mb-3">
                        <strong>⏹️ カメラアクセスが中断されました</strong>
                    </div>
                    <div class="alert alert-info small">
                        <p><strong>🔄 対処方法:</strong></p>
                        <ul class="mb-0">
                            <li>「QRスキャン開始」ボタンを再度押す</li>
                            <li>ページを再読み込み</li>
                            <li>Safari を再起動</li>
                        </ul>
                    </div>
                `;
            default:
                if (error.message) {
                    if (error.message.includes('iOS Safari QR detection unavailable')) {
                        return `
                            <div class="mb-3">
                                <strong>📱 iOS SafariのQR検出制限</strong>
                            </div>
                            <div class="alert alert-warning small">
                                <p><strong>🔧 代替手段:</strong></p>
                                <ul class="mb-0">
                                    <li><strong>Chrome for iOS</strong> または <strong>Edge</strong> アプリを使用</li>
                                    <li>カメラアプリの標準QRスキャナーを使用</li>
                                    <li>iOS設定で実験的機能を有効化</li>
                                </ul>
                            </div>
                        `;
                    } else {
                        return `
                            <div class="mb-3">
                                <strong>❌ iOS カメラエラー</strong>
                            </div>
                            <div class="alert alert-danger small">
                                <p><strong>エラー詳細:</strong> ${error.message}</p>
                                <p><strong>🔄 一般的な解決方法:</strong></p>
                                <ul class="mb-0">
                                    <li>Safari を再起動</li>
                                    <li>デバイスを再起動</li>
                                    <li>Chrome for iOS を試す</li>
                                </ul>
                            </div>
                        `;
                    }
                }
                return this.getGenericErrorMessage(error);
        }
    }

    // 一般的なエラーメッセージ
    getGenericErrorMessage(error) {
        switch (error.name) {
            case 'NotAllowedError':
                return 'カメラの使用が拒否されました。ブラウザの設定からカメラの許可を有効にしてください。';
            case 'NotFoundError':
                return 'カメラが見つかりませんでした。デバイスにカメラが接続されているか確認してください。';
            case 'NotSupportedError':
                return 'このブラウザではカメラ機能がサポートされていません。最新のSafari、Chrome、またはEdgeをお試しください。';
            case 'NotReadableError':
                return 'カメラが他のアプリケーションで使用中です。他のアプリを閉じてから再試行してください。';
            case 'SecurityError':
                return 'セキュリティ制限によりカメラにアクセスできません。HTTPS環境が必要です。';
            default:
                if (error.message) {
                    return `カメラエラー: ${error.message}`;
                }
                return 'カメラにアクセスできませんでした。';
        }
    }

    // 手動キャリブレーション
    async recalibrate() {
        this.calibrationAttempts = 0;
        await this.calibrateCamera();
    }

    // デバッグモード切り替え
    toggleDebug() {
        this.debugMode = !this.debugMode;
        console.log('Debug mode:', this.debugMode ? 'enabled' : 'disabled');
        
        // デバッグ要素の表示/非表示切り替え
        if (this.debugElements && this.debugElements.container) {
            this.debugElements.container.style.display = this.debugMode ? 'block' : 'none';
        }
        
        return this.debugMode;
    }

    // 詳細デバッグ機能初期化
    initDebugElements() {
        // デバッグ要素を探すか作成
        let debugContainer = document.getElementById('qr-debug-info');
        if (!debugContainer) {
            debugContainer = this.createDebugElements();
        }
        
        this.debugElements = {
            container: debugContainer,
            ready: document.getElementById('qr-debug-ready'),
            stream: document.getElementById('qr-debug-stream'),
            detection: document.getElementById('qr-debug-detection'),
            frames: document.getElementById('qr-debug-frames'),
            device: document.getElementById('qr-debug-device'),
            calibration: document.getElementById('qr-debug-calibration')
        };
        
        // 初期状態設定
        this.updateDebug('device', `${this.deviceInfo.isIPad ? 'iPad' : this.deviceInfo.isIPhone ? 'iPhone' : 'Other'} iOS:${this.deviceInfo.iosVersion?.major || 'N/A'}`);
        this.updateDebug('ready', '0');
        this.updateDebug('stream', 'Disconnected');
        this.updateDebug('detection', 'Stopped');
        this.updateDebug('frames', '0');
        this.updateDebug('calibration', '0/3');
        
        // 非表示で開始
        if (debugContainer) {
            debugContainer.style.display = 'none';
        }
    }

    // デバッグ要素を動的作成
    createDebugElements() {
        const debugContainer = document.createElement('div');
        debugContainer.id = 'qr-debug-info';
        debugContainer.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px;
            border-radius: 6px;
            font-size: 12px;
            font-family: monospace;
            max-width: 200px;
            z-index: 10000;
            display: none;
        `;
        
        debugContainer.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 5px;">🐛 QR Debug Info</div>
            <div>Device: <span id="qr-debug-device">Unknown</span></div>
            <div>ReadyState: <span id="qr-debug-ready">0</span></div>
            <div>Stream: <span id="qr-debug-stream">Disconnected</span></div>
            <div>Detection: <span id="qr-debug-detection">Stopped</span></div>
            <div>Frames: <span id="qr-debug-frames">0</span></div>
            <div>Calibration: <span id="qr-debug-calibration">0/3</span></div>
        `;
        
        // body に追加
        document.body.appendChild(debugContainer);
        return debugContainer;
    }

    // リアルタイム状態監視機能
    updateDebug(type, value) {
        if (this.debugElements && this.debugElements[type]) {
            this.debugElements[type].textContent = value;
        }
        
        // ログ出力（デバッグモード時）
        if (this.debugMode) {
            const now = Date.now();
            if (now - this.lastDebugUpdate > 1000) { // 1秒間隔でログ出力
                console.log(`[QRDebug] ${type}:`, value);
                this.lastDebugUpdate = now;
            }
        }
    }

    // フレームカウンター強化
    startFrameCounter() {
        const countFrames = () => {
            if (this.isScanning) {
                this.frameCount++;
                
                // リアルタイム状態監視
                this.updateDebug('frames', this.frameCount);
                
                // 詳細ログ出力（30フレームごと）
                if (this.debugMode && this.frameCount % 30 === 0) {
                    console.log(`[QRDebug] Frame count: ${this.frameCount}, Detection attempts: ${this.lastDetectionAttempt}, ReadyState: ${this.video?.readyState}`);
                }
                
                requestAnimationFrame(countFrames);
            }
        };
        countFrames();
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