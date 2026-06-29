/**
 * OCRエンジン強化版
 * 
 * - Tesseractパラメータ最適化
 * - ハイブリッドOCR戦略
 * - 精度評価メトリクス
 */

class OCREngineEnhanced {
  constructor() {
    this.preprocessor = null; // 遅延初期化
    this.results = [];
    this.tesseractWorker = null;
  }

  /**
   * 初期化
   */
  async initialize() {
    if (typeof ImagePreprocessor !== 'undefined') {
      this.preprocessor = new ImagePreprocessor();
    }
    
    // Tesseract Worker初期化
    if (typeof Tesseract !== 'undefined') {
      this.tesseractWorker = await Tesseract.createWorker('jpn+eng', 1, {
        logger: m => console.log('[Tesseract Worker]', m)
      });
      await this.tesseractWorker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
        tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY,
      });
    }
    
    return this;
  }

  /**
   * Tesseract強化版 - パラメータ最適化
   */
  async tesseractEnhanced(image, options = {}) {
    const startTime = Date.now();
    
    // 画像前処理
    let processedImage = image;
    if (this.preprocessor) {
      processedImage = await this.preprocessor.process(image, {
        grayscale: true,
        denoise: true,
        contrast: true,
        deskew: options.deskew !== false,
        binarize: true,
        upscale: options.upscale || false
      });
    }
    
    // Tesseract設定最適化
    const tesseractConfig = {
      lang: options.lang || 'jpn+eng',
      
      // OCR Engine Mode
      // 0: Legacy engine only
      // 1: Neural nets LSTM engine only (推奨)
      // 2: Legacy + LSTM
      // 3: Default
      tessedit_ocr_engine_mode: options.oem || 1,
      
      // Page Segmentation Mode
      // 3: Fully automatic page segmentation (デフォルト)
      // 6: Assume a single uniform block of text (推奨 - 伝票用)
      // 7: Treat the image as a single text line
      // 11: Sparse text. Find as much text as possible
      tessedit_pageseg_mode: options.psm || 6,
      
      // 追加設定
      preserve_interword_spaces: '1',
      ...(options.whitelist && { tessedit_char_whitelist: options.whitelist })
    };
    
    console.log('[OCR Enhanced] Tesseract設定:', tesseractConfig);
    
    try {
      let result;
      if (this.tesseractWorker) {
        // Worker使用（高速）
        await this.tesseractWorker.setParameters(tesseractConfig);
        result = await this.tesseractWorker.recognize(processedImage);
      } else {
        // 通常モード
        result = await Tesseract.recognize(
          processedImage,
          tesseractConfig.lang,
          {
            logger: (m) => {
              if (m.status === 'recognizing text') {
                console.log(`[OCR Enhanced] 進捗: ${(m.progress * 100).toFixed(0)}%`);
              }
            }
          }
        );
      }
      
      const processingTime = Date.now() - startTime;
      
      return {
        engine: 'tesseract-enhanced',
        text: result.data.text,
        confidence: result.data.confidence,
        lines: result.data.lines.map(line => ({
          text: line.text,
          confidence: line.confidence,
          bbox: line.bbox
        })),
        words: result.data.words.map(word => ({
          text: word.text,
          confidence: word.confidence,
          bbox: word.bbox
        })),
        processingTime,
        preprocessed: !!this.preprocessor
      };
      
    } catch (error) {
      console.error('[OCR Enhanced] Tesseractエラー:', error);
      throw error;
    }
  }

  /**
   * ハイブリッドOCR - 複数エンジンを並列実行
   */
  async hybridOCR(image, engines = ['tesseract', 'textract']) {
    console.log('[OCR Hybrid] 複数エンジンで並列実行:', engines);
    
    const promises = [];
    
    // Tesseract Enhanced
    if (engines.includes('tesseract')) {
      promises.push(
        this.tesseractEnhanced(image).catch(err => ({
          engine: 'tesseract-enhanced',
          error: err.message,
          confidence: 0
        }))
      );
    }
    
    // AWS Textract
    if (engines.includes('textract')) {
      promises.push(
        this.textractOCR(image).catch(err => ({
          engine: 'textract',
          error: err.message,
          confidence: 0
        }))
      );
    }
    
    // Google Vision (APIキー必要)
    if (engines.includes('google-vision')) {
      promises.push(
        this.googleVisionOCR(image).catch(err => ({
          engine: 'google-vision',
          error: err.message,
          confidence: 0
        }))
      );
    }
    
    const results = await Promise.all(promises);
    
    console.log('[OCR Hybrid] 全結果:', results);
    
    // 最良結果を選択
    const bestResult = this.selectBestResult(results);
    
    return {
      ...bestResult,
      allResults: results,
      hybrid: true
    };
  }

  /**
   * AWS Textract OCR
   */
  async textractOCR(image) {
    const startTime = Date.now();
    
    // Canvas → Base64
    const canvas = image instanceof HTMLCanvasElement ? image : await this.imageToCanvas(image);
    const base64 = canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
    
    try {
      const response = await fetch('/api/ocr/textract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 })
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Textract APIエラー');
      }
      
      return {
        engine: 'textract',
        text: data.text,
        confidence: data.confidence,
        lines: data.lines,
        processingTime: Date.now() - startTime,
        preprocessed: false
      };
      
    } catch (error) {
      console.error('[OCR Enhanced] Textractエラー:', error);
      throw error;
    }
  }

  /**
   * GCP Document AI OCR
   */
  async googleVisionOCR(image) {
    try {
      console.log('[OCR Enhanced] Document AI処理開始');
      
      // API呼び出し
      const response = await fetch('/api/ocr/documentai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: image,
          mimeType: 'image/png'
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Document AI APIエラー');
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Document AI処理失敗');
      }
      
      // 結果を統一フォーマットに変換
      const lines = [];
      if (result.pages && result.pages.length > 0) {
        for (const page of result.pages) {
          if (page.lines) {
            lines.push(...page.lines.map(line => ({
              text: line.text,
              confidence: line.confidence
            })));
          }
        }
      }
      
      console.log(`[OCR Enhanced] Document AI完了: 信頼度=${result.confidence}%`);
      
      return {
        text: result.text,
        confidence: result.confidence,
        lines: lines,
        engine: 'documentai',
        processingTime: result.processingTime
      };
      
    } catch (error) {
      console.error('[OCR Enhanced] Document AIエラー:', error);
      throw error;
    }
  }

  /**
   * 最良結果を選択
   */
  selectBestResult(results) {
    // エラー結果を除外
    const validResults = results.filter(r => !r.error && r.confidence > 0);
    
    if (validResults.length === 0) {
      return results[0]; // エラーでも返す
    }
    
    // 信頼度でソート
    validResults.sort((a, b) => b.confidence - a.confidence);
    
    const best = validResults[0];
    
    console.log(`[OCR Hybrid] 最良エンジン: ${best.engine} (信頼度: ${best.confidence.toFixed(2)}%)`);
    
    return best;
  }

  /**
   * OCR結果の後処理 - テキスト補正
   */
  postProcess(ocrResult) {
    let text = ocrResult.text;
    
    // よくある誤認識を修正
    const corrections = {
      // 数字の誤認識
      'O': '0',
      'l': '1',
      'I': '1',
      'S': '5',
      'Z': '2',
      
      // 日本語の誤認識
      '力': 'カ',
      '夕': 'タ',
      '卜': 'ト'
    };
    
    // 適用
    Object.entries(corrections).forEach(([wrong, correct]) => {
      const regex = new RegExp(wrong, 'g');
      text = text.replace(regex, correct);
    });
    
    return {
      ...ocrResult,
      originalText: ocrResult.text,
      correctedText: text,
      text: text
    };
  }

  /**
   * 精度評価メトリクス計算
   */
  calculateMetrics(ocrResult, groundTruth = null) {
    const metrics = {
      confidence: ocrResult.confidence,
      processingTime: ocrResult.processingTime,
      textLength: ocrResult.text.length,
      lineCount: ocrResult.lines ? ocrResult.lines.length : 0,
      wordCount: ocrResult.words ? ocrResult.words.length : 0
    };
    
    // 真値との比較 (提供された場合)
    if (groundTruth) {
      metrics.characterAccuracy = this.calculateCharacterAccuracy(ocrResult.text, groundTruth);
      metrics.wordAccuracy = this.calculateWordAccuracy(ocrResult.text, groundTruth);
      metrics.editDistance = this.levenshteinDistance(ocrResult.text, groundTruth);
    }
    
    return metrics;
  }

  /**
   * 文字レベル精度
   */
  calculateCharacterAccuracy(recognized, truth) {
    const distance = this.levenshteinDistance(recognized, truth);
    const maxLen = Math.max(recognized.length, truth.length);
    return ((maxLen - distance) / maxLen) * 100;
  }

  /**
   * 単語レベル精度
   */
  calculateWordAccuracy(recognized, truth) {
    const recognizedWords = recognized.split(/\s+/);
    const truthWords = truth.split(/\s+/);
    
    let correct = 0;
    const maxLen = Math.max(recognizedWords.length, truthWords.length);
    
    for (let i = 0; i < Math.min(recognizedWords.length, truthWords.length); i++) {
      if (recognizedWords[i] === truthWords[i]) {
        correct++;
      }
    }
    
    return (correct / maxLen) * 100;
  }

  /**
   * Levenshtein距離 (編集距離)
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * ユーティリティ: Image → Canvas
   */
  async imageToCanvas(image) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width || image.naturalWidth;
    canvas.height = image.height || image.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return canvas;
  }

  /**
   * フィードバック収集
   */
  collectFeedback(ocrResult, userCorrection) {
    const feedback = {
      timestamp: new Date().toISOString(),
      engine: ocrResult.engine,
      originalText: ocrResult.text,
      correctedText: userCorrection,
      confidence: ocrResult.confidence,
      accuracy: this.calculateCharacterAccuracy(ocrResult.text, userCorrection)
    };
    
    // LocalStorageに保存
    const feedbacks = JSON.parse(localStorage.getItem('ocrFeedbacks') || '[]');
    feedbacks.push(feedback);
    
    // 最新100件のみ保持
    if (feedbacks.length > 100) {
      feedbacks.shift();
    }
    
    localStorage.setItem('ocrFeedbacks', JSON.stringify(feedbacks));
    
    console.log('[OCR Feedback] 収集完了:', feedback);
    
    return feedback;
  }

  /**
   * フィードバック統計
   */
  getFeedbackStats() {
    const feedbacks = JSON.parse(localStorage.getItem('ocrFeedbacks') || '[]');
    
    if (feedbacks.length === 0) {
      return null;
    }
    
    const avgAccuracy = feedbacks.reduce((sum, f) => sum + f.accuracy, 0) / feedbacks.length;
    const avgConfidence = feedbacks.reduce((sum, f) => sum + f.confidence, 0) / feedbacks.length;
    
    const engineStats = {};
    feedbacks.forEach(f => {
      if (!engineStats[f.engine]) {
        engineStats[f.engine] = { count: 0, totalAccuracy: 0 };
      }
      engineStats[f.engine].count++;
      engineStats[f.engine].totalAccuracy += f.accuracy;
    });
    
    Object.keys(engineStats).forEach(engine => {
      engineStats[engine].avgAccuracy = engineStats[engine].totalAccuracy / engineStats[engine].count;
    });
    
    return {
      totalFeedbacks: feedbacks.length,
      avgAccuracy: avgAccuracy.toFixed(2),
      avgConfidence: avgConfidence.toFixed(2),
      byEngine: engineStats
    };
  }

  /**
   * クリーンアップ
   */
  async cleanup() {
    if (this.tesseractWorker) {
      await this.tesseractWorker.terminate();
      this.tesseractWorker = null;
    }
  }
}

// グローバルエクスポート
window.OCREngineEnhanced = OCREngineEnhanced;
