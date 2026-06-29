/**
 * デバイスモード管理
 * iPad MiniモードとiPhone 6モードの切り替え機能
 */

class DeviceModeManager {
    constructor() {
        this.currentMode = null;
        this.storageKey = 'shipping-app-device-mode';
        this.modes = {
            'ipad-mini': {
                name: 'iPad Mini',
                displayName: 'iPad Mini モード',
                icon: '📱',
                viewport: { width: 768, height: 1024 }
            },
            'iphone-6': {
                name: 'iPhone 6',
                displayName: 'iPhone 6 モード',
                icon: '📱',
                viewport: { width: 375, height: 667 }
            }
        };
    }

    /**
     * 初期化
     */
    init() {
        // 保存されたモードを取得
        const savedMode = this.getSavedMode();
        
        if (savedMode) {
            // 保存されたモードを適用
            this.applyMode(savedMode, false);
            this.hideSelection();
        } else {
            // モード選択画面を表示
            this.showSelection();
        }
    }

    /**
     * 保存されたモードを取得
     */
    getSavedMode() {
        try {
            return localStorage.getItem(this.storageKey);
        } catch (error) {
            console.warn('LocalStorage access failed:', error);
            return null;
        }
    }

    /**
     * モードを保存
     */
    saveMode(mode) {
        try {
            localStorage.setItem(this.storageKey, mode);
            console.log(`Device mode saved: ${mode}`);
        } catch (error) {
            console.warn('Failed to save device mode:', error);
        }
    }

    /**
     * モード選択画面を表示
     */
    showSelection() {
        const overlay = document.getElementById('device-mode-selection');
        if (overlay) {
            overlay.classList.remove('hidden');
            
            // 現在のモードをハイライト
            if (this.currentMode) {
                const cards = overlay.querySelectorAll('.mode-selection-card');
                cards.forEach(card => {
                    if (card.dataset.mode === this.currentMode) {
                        card.classList.add('active');
                    } else {
                        card.classList.remove('active');
                    }
                });
            }
        }
    }

    /**
     * モード選択画面を非表示
     */
    hideSelection() {
        const overlay = document.getElementById('device-mode-selection');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }

    /**
     * モードを選択
     */
    selectMode(mode) {
        if (!this.modes[mode]) {
            console.error(`Invalid mode: ${mode}`);
            return;
        }

        console.log(`Selecting device mode: ${mode}`);
        
        // モードを適用
        this.applyMode(mode, true);
        
        // モードを保存
        this.saveMode(mode);
        
        // 選択画面を非表示
        setTimeout(() => {
            this.hideSelection();
        }, 300);
    }

    /**
     * モードを適用
     */
    applyMode(mode, animate = false) {
        if (!this.modes[mode]) {
            console.error(`Invalid mode: ${mode}`);
            return;
        }

        // 既存のモードクラスを削除
        document.body.classList.remove('device-mode-ipad-mini', 'device-mode-iphone-6');
        
        // 新しいモードクラスを追加
        document.body.classList.add(`device-mode-${mode}`);
        
        // 現在のモードを更新
        this.currentMode = mode;
        
        // ヘッダーのモード表示を更新
        this.updateModeDisplay();
        
        // アニメーション
        if (animate) {
            this.playTransitionAnimation();
        }
        
        // イベント発火
        this.dispatchModeChangeEvent(mode);
        
        console.log(`Device mode applied: ${mode}`);
    }

    /**
     * ヘッダーのモード表示を更新
     */
    updateModeDisplay() {
        const modeText = document.getElementById('current-mode-text');
        if (modeText && this.currentMode) {
            const modeInfo = this.modes[this.currentMode];
            modeText.textContent = modeInfo.name;
        }
    }

    /**
     * 遷移アニメーション
     */
    playTransitionAnimation() {
        const container = document.querySelector('.container');
        if (container) {
            container.style.opacity = '0';
            container.style.transform = 'scale(0.95)';
            
            setTimeout(() => {
                container.style.transition = 'all 0.3s ease';
                container.style.opacity = '1';
                container.style.transform = 'scale(1)';
                
                setTimeout(() => {
                    container.style.transition = '';
                }, 300);
            }, 50);
        }
    }

    /**
     * モード変更イベントを発火
     */
    dispatchModeChangeEvent(mode) {
        const event = new CustomEvent('deviceModeChanged', {
            detail: {
                mode: mode,
                modeInfo: this.modes[mode]
            }
        });
        window.dispatchEvent(event);
    }

    /**
     * 現在のモードを取得
     */
    getCurrentMode() {
        return this.currentMode;
    }

    /**
     * モード情報を取得
     */
    getModeInfo(mode) {
        return this.modes[mode] || null;
    }

    /**
     * すべてのモード情報を取得
     */
    getAllModes() {
        return this.modes;
    }

    /**
     * モードをリセット
     */
    resetMode() {
        try {
            localStorage.removeItem(this.storageKey);
            console.log('Device mode reset');
            this.currentMode = null;
            this.showSelection();
        } catch (error) {
            console.warn('Failed to reset device mode:', error);
        }
    }
}

// グローバルインスタンス
window.deviceModeManager = new DeviceModeManager();

/**
 * モード選択（グローバル関数）
 */
window.selectDeviceMode = function(mode) {
    window.deviceModeManager.selectMode(mode);
};

/**
 * モード選択画面を表示（グローバル関数）
 */
window.showModeSelection = function() {
    window.deviceModeManager.showSelection();
};

/**
 * DOMロード完了時に初期化
 */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.deviceModeManager.init();
    });
} else {
    window.deviceModeManager.init();
}

/**
 * モード変更イベントのリスナー例
 */
window.addEventListener('deviceModeChanged', (event) => {
    console.log('Device mode changed:', event.detail);
    
    // QRスキャナーなどの再初期化が必要な場合はここで処理
    // 例: window.app?.reinitializeForMode(event.detail.mode);
});

// デバッグ用（開発時のみ使用）
window.debugDeviceMode = {
    getCurrentMode: () => window.deviceModeManager.getCurrentMode(),
    getAllModes: () => window.deviceModeManager.getAllModes(),
    resetMode: () => window.deviceModeManager.resetMode(),
    showSelection: () => window.deviceModeManager.showSelection()
};
