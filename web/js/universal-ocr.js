/**
 * 再利用可能OCRモジュール
 * 
 * 他のサブシステム(QR検品、出荷、ピッキング)でも使用可能
 */

class UniversalOCR {
  constructor(config = {}) {
    this.config = {
      defaultEngine: config.defaultEngine || 'tesseract-enhanced',
      autoPreprocessing: config.autoPreprocessing !== false,
      hybridMode: config.hybridMode || false,
      qualityCheck: config.qualityCheck !== false,
      ...config
    };
    
    this.preprocessor = new ImagePreprocessor();
    this.engine = new OCREngineEnhanced();
  }

  /**
   * シンプルなOCR実行
   * @param {HTMLImageElement|HTMLCanvasElement|File} input
   * @param {Object} options
   * @returns {Promise<OCRResult>}
   */
  async recognize(input, options = {}) {
    const opts = { ...this.config, ...options };
    
    // 画像準備
    const image = await this.prepareImage(input);
    
    // 品質チェック
    let quality = null;
    if (opts.qualityCheck) {
      quality = this.preprocessor.assessImageQuality(image);
      console.log('[UniversalOCR] 品質スコア:', quality.score);
      
      if (quality.score < 50) {
        console.warn('[UniversalOCR] 画質が低いです:', quality.recommendations);
      }
    }
    
    // 前処理
    let processedImage = image;
    if (opts.autoPreprocessing) {
      processedImage = await this.preprocessor.processImage(image, opts.preprocessing || {});
    }
    
    // OCR実行
    let result;
    if (opts.hybridMode) {
      result = await this.engine.hybridOCR(processedImage, opts.engines || ['tesseract', 'textract']);
    } else {
      const engineMethod = this.getEngineMethod(opts.defaultEngine);
      result = await engineMethod.call(this.engine, processedImage, opts);
    }
    
    // 後処理
    if (opts.postProcess !== false) {
      result = this.engine.postProcess(result);
    }
    
    return {
      ...result,
      quality: quality
    };
  }

  /**
   * 特定フィールド抽出 (構造化データ)
   * @param {*} input 
   * @param {Array<FieldDefinition>} fields - [{ name: '商品名', pattern: /.*/, type: 'text' }]
   */
  async extractFields(input, fields) {
    const result = await this.recognize(input);
    const extracted = {};
    
    fields.forEach(field => {
      const value = this.extractField(result.text, field);
      extracted[field.name] = value;
    });
    
    return {
      ...result,
      fields: extracted
    };
  }

  /**
   * フィールド抽出ヘルパー
   */
  extractField(text, fieldDef) {
    const { pattern, type, defaultValue = null } = fieldDef;
    
    if (pattern instanceof RegExp) {
      const match = text.match(pattern);
      return match ? match[1] || match[0] : defaultValue;
    }
    
    return defaultValue;
  }

  /**
   * バッチOCR処理
   * @param {Array} inputs
   */
  async recognizeBatch(inputs, options = {}) {
    const results = [];
    
    for (const input of inputs) {
      try {
        const result = await this.recognize(input, options);
        results.push({ success: true, result });
      } catch (error) {
        results.push({ success: false, error: error.message });
      }
    }
    
    return results;
  }

  /**
   * 画像準備
   */
  async prepareImage(input) {
    // File → Image
    if (input instanceof File) {
      return await this.fileToImage(input);
    }
    
    // Image → Canvas
    if (input instanceof HTMLImageElement) {
      return await this.imageToCanvas(input);
    }
    
    // Canvas そのまま
    if (input instanceof HTMLCanvasElement) {
      return input;
    }
    
    throw new Error('サポートされていない画像形式です');
  }

  /**
   * File → Canvas
   */
  fileToImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(canvas);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  /**
   * Image → Canvas
   */
  imageToCanvas(img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.width || img.naturalWidth;
    canvas.height = img.height || img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return Promise.resolve(canvas);
  }

  /**
   * エンジンメソッド取得
   */
  getEngineMethod(engineName) {
    const methods = {
      'tesseract': this.engine.tesseractEnhanced,
      'tesseract-enhanced': this.engine.tesseractEnhanced,
      'textract': this.engine.textractOCR,
      'google-vision': this.engine.googleVisionOCR
    };
    
    return methods[engineName] || methods['tesseract-enhanced'];
  }

  /**
   * イベントリスナー
   */
  on(event, callback) {
    if (!this.listeners) this.listeners = {};
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  emit(event, data) {
    if (!this.listeners || !this.listeners[event]) return;
    this.listeners[event].forEach(cb => cb(data));
  }
}

/**
 * TypeScript用型定義 (JSDocコメント)
 * 
 * @typedef {Object} OCRResult
 * @property {string} engine - 使用したエンジン名
 * @property {string} text - 抽出されたテキスト
 * @property {number} confidence - 信頼度 (0-100)
 * @property {Array} lines - 行ごとのデータ
 * @property {number} processingTime - 処理時間(ms)
 * @property {Object} quality - 画質評価結果
 * 
 * @typedef {Object} FieldDefinition
 * @property {string} name - フィールド名
 * @property {RegExp|string} pattern - 抽出パターン
 * @property {string} type - データ型 (text|number|date)
 * @property {*} defaultValue - デフォルト値
 */

// グローバルエクスポート
window.UniversalOCR = UniversalOCR;
