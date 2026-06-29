/**
 * OCR統合モジュール
 * 
 * すべてのOCR機能を統合した再利用可能なモジュール
 * - 画像前処理
 * - 複数OCRエンジン
 * - AI補正
 * - フィードバック学習
 */

class OCRModule {
  constructor(options = {}) {
    this.options = {
      defaultEngine: options.defaultEngine || 'tesseract-enhanced',
      enablePreprocessing: options.enablePreprocessing !== false,
      enableAICorrection: options.enableAICorrection || false,
      enableFeedback: options.enableFeedback !== false,
      apiEndpoint: options.apiEndpoint || '/api',
      ...options
    };
    
    this.preprocessor = null;
    this.engineEnhanced = null;
    this.initialized = false;
  }

  /**
   * 初期化
   */
  async initialize() {
    if (this.initialized) return this;
    
    console.log('[OCR Module] 初期化中...');
    
    // 画像前処理モジュール
    if (this.options.enablePreprocessing && typeof ImagePreprocessor !== 'undefined') {
      this.preprocessor = new ImagePreprocessor();
      console.log('[OCR Module] 画像前処理: 有効');
    }
    
    // OCR強化エンジン
    if (typeof OCREngineEnhanced !== 'undefined') {
      this.engineEnhanced = new OCREngineEnhanced();
      await this.engineEnhanced.initialize();
      console.log('[OCR Module] OCR強化エンジン: 有効');
    }
    
    this.initialized = true;
    console.log('[OCR Module] 初期化完了');
    
    return this;
  }

  /**
   * メインOCR実行
   * @param {HTMLImageElement|HTMLCanvasElement|File} input - 入力画像
   * @param {Object} options - オプション
   * @returns {Promise<Object>} OCR結果
   */
  async recognize(input, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const startTime = Date.now();
    
    try {
      // 1. 画像準備
      const image = await this.prepareImage(input);
      
      // 2. 画像品質評価
      let quality = null;
      if (this.preprocessor) {
        quality = this.preprocessor.assessQuality(image);
        console.log('[OCR Module] 画質評価:', quality);
      }
      
      // 3. OCR実行
      const engine = options.engine || this.options.defaultEngine;
      let ocrResult;
      
      if (engine === 'hybrid' && this.engineEnhanced) {
        // ハイブリッドOCR
        ocrResult = await this.engineEnhanced.hybridOCR(image, options.engines || ['tesseract', 'textract']);
      } else if (this.engineEnhanced) {
        // 強化版Tesseract
        ocrResult = await this.engineEnhanced.tesseractEnhanced(image, options);
      } else {
        // フォールバック: 基本Tesseract
        ocrResult = await this.basicTesseract(image, options);
      }
      
      // 4. AI補正（オプション）
      if (this.options.enableAICorrection && ocrResult.text) {
        ocrResult = await this.correctWithAI(ocrResult, options);
      }
      
      // 5. 後処理
      if (this.engineEnhanced) {
        ocrResult = this.engineEnhanced.postProcess(ocrResult);
      }
      
      // 6. 結果に品質情報を追加
      ocrResult.quality = quality;
      ocrResult.totalProcessingTime = Date.now() - startTime;
      
      console.log('[OCR Module] 完了:', {
        engine: ocrResult.engine,
        confidence: ocrResult.confidence,
        textLength: ocrResult.text.length,
        processingTime: ocrResult.totalProcessingTime
      });
      
      return ocrResult;
      
    } catch (error) {
      console.error('[OCR Module] エラー:', error);
      throw error;
    }
  }

  /**
   * 画像準備
   */
  async prepareImage(input) {
    let canvas;
    
    if (input instanceof HTMLCanvasElement) {
      canvas = input;
    } else if (input instanceof HTMLImageElement) {
      canvas = await this.imageToCanvas(input);
    } else if (input instanceof File) {
      const img = await this.fileToImage(input);
      canvas = await this.imageToCanvas(img);
    } else {
      throw new Error('サポートされていない入力形式です');
    }
    
    return canvas;
  }

  /**
   * FileをImageに変換
   */
  fileToImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * ImageをCanvasに変換
   */
  imageToCanvas(image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width || image.naturalWidth;
    canvas.height = image.height || image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return canvas;
  }

  /**
   * 基本Tesseract（フォールバック）
   */
  async basicTesseract(image, options = {}) {
    const result = await Tesseract.recognize(
      image,
      options.lang || 'jpn+eng'
    );
    
    return {
      engine: 'tesseract-basic',
      text: result.data.text,
      confidence: result.data.confidence,
      lines: result.data.lines,
      words: result.data.words
    };
  }

  /**
   * AI補正
   */
  async correctWithAI(ocrResult, options = {}) {
    try {
      const response = await fetch(`${this.options.apiEndpoint}/ocr-ai/correct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: ocrResult.text,
          context: options.context || 'default',
          expectedFields: options.expectedFields || [],
          language: options.language || 'ja'
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        return {
          ...ocrResult,
          text: data.corrected,
          originalText: data.original,
          aiCorrected: true,
          changes: data.changes
        };
      }
      
      return ocrResult;
      
    } catch (error) {
      console.warn('[OCR Module] AI補正エラー:', error);
      return ocrResult;
    }
  }

  /**
   * フィードバック送信
   * @param {Object} ocrResult - OCR結果
   * @param {String} correctedText - ユーザーが修正したテキスト
   */
  async submitFeedback(ocrResult, correctedText) {
    if (!this.options.enableFeedback) {
      console.warn('[OCR Module] フィードバック機能が無効です');
      return null;
    }
    
    try {
      const response = await fetch(`${this.options.apiEndpoint}/ocr-feedback/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engine: ocrResult.engine,
          originalText: ocrResult.text,
          correctedText: correctedText,
          confidence: ocrResult.confidence,
          imageHash: ocrResult.imageHash,
          documentType: ocrResult.documentType
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        console.log('[OCR Module] フィードバック送信完了:', data);
        
        // ローカルにも保存
        if (this.engineEnhanced) {
          this.engineEnhanced.collectFeedback(ocrResult, correctedText);
        }
      }
      
      return data;
      
    } catch (error) {
      console.error('[OCR Module] フィードバック送信エラー:', error);
      throw error;
    }
  }

  /**
   * フィードバック統計取得
   */
  async getFeedbackStats(options = {}) {
    try {
      const params = new URLSearchParams(options);
      const response = await fetch(`${this.options.apiEndpoint}/ocr-feedback/stats?${params}`);
      const data = await response.json();
      
      return data.success ? data.stats : null;
      
    } catch (error) {
      console.error('[OCR Module] 統計取得エラー:', error);
      return null;
    }
  }

  /**
   * 構造化データ抽出
   * @param {String} text - OCRテキスト
   * @param {Object} schema - 抽出スキーマ
   */
  async extractStructuredData(text, schema) {
    try {
      const response = await fetch(`${this.options.apiEndpoint}/ocr-ai/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, schema })
      });
      
      const data = await response.json();
      
      return data.success ? data.data : null;
      
    } catch (error) {
      console.error('[OCR Module] データ抽出エラー:', error);
      throw error;
    }
  }

  /**
   * 画質評価
   */
  async assessImageQuality(input) {
    const image = await this.prepareImage(input);
    
    if (!this.preprocessor) {
      console.warn('[OCR Module] 画像前処理モジュールが利用できません');
      return null;
    }
    
    return this.preprocessor.assessQuality(image);
  }

  /**
   * クリーンアップ
   */
  async cleanup() {
    if (this.engineEnhanced) {
      await this.engineEnhanced.cleanup();
    }
    
    this.initialized = false;
    console.log('[OCR Module] クリーンアップ完了');
  }
}

/**
 * 簡易API - グローバル関数
 */

// シングルトンインスタンス
let defaultOCRModule = null;

/**
 * OCR実行（簡易API）
 */
async function ocrRecognize(input, options = {}) {
  if (!defaultOCRModule) {
    defaultOCRModule = new OCRModule();
    await defaultOCRModule.initialize();
  }
  
  return await defaultOCRModule.recognize(input, options);
}

/**
 * フィードバック送信（簡易API）
 */
async function ocrSubmitFeedback(ocrResult, correctedText) {
  if (!defaultOCRModule) {
    throw new Error('OCRモジュールが初期化されていません');
  }
  
  return await defaultOCRModule.submitFeedback(ocrResult, correctedText);
}

/**
 * 画質評価（簡易API）
 */
async function ocrAssessQuality(input) {
  if (!defaultOCRModule) {
    defaultOCRModule = new OCRModule();
    await defaultOCRModule.initialize();
  }
  
  return await defaultOCRModule.assessImageQuality(input);
}

// グローバルエクスポート
if (typeof window !== 'undefined') {
  window.OCRModule = OCRModule;
  window.ocrRecognize = ocrRecognize;
  window.ocrSubmitFeedback = ocrSubmitFeedback;
  window.ocrAssessQuality = ocrAssessQuality;
}

// モジュールエクスポート
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    OCRModule,
    ocrRecognize,
    ocrSubmitFeedback,
    ocrAssessQuality
  };
}
